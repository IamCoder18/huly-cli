import { randomUUID } from 'node:crypto'
import type { PlatformClient } from '@hcengineering/api-client'
import { CLASS, SPACE } from '../transport/identifiers.js'
import { loadBootstrap, markBootstrapped } from './bootstrap-cache.js'
import { normalizeHost } from './cache.js'

// In-memory short-circuit so a CLI process that runs many commands in a
// row (e.g. `huly issue list`, then `huly action list`, then `huly user
// get`) does not re-read bootstrap.json or re-run bootstrap on every
// call. Keyed on (normalized host, workspace, accountUuid) so a second
// account connecting in the same process is never treated as having
// bootstrapped under a different account.
const bootstrappedAccounts = new Set<string>()
const unknownAccounts = new Set<string>()

function accountKey(host: string, workspace: string, accountUuid: string): string {
  return `${normalizeHost(host)}\n${workspace}\n${accountUuid}`
}

function isWorkspaceAccountKnownBootstrapped(
  host: string,
  workspace: string,
  accountUuid: string
): boolean {
  return bootstrappedAccounts.has(accountKey(host, workspace, accountUuid))
}

function isWorkspaceAccountKnownAbsent(
  host: string,
  workspace: string,
  accountUuid: string
): boolean {
  return unknownAccounts.has(accountKey(host, workspace, accountUuid))
}

function rememberWorkspaceAccountBootstrapped(
  host: string,
  workspace: string,
  accountUuid: string
): void {
  bootstrappedAccounts.add(accountKey(host, workspace, accountUuid))
  unknownAccounts.delete(accountKey(host, workspace, accountUuid))
}

function rememberWorkspaceAccountAbsent(
  host: string,
  workspace: string,
  accountUuid: string
): void {
  unknownAccounts.add(accountKey(host, workspace, accountUuid))
  bootstrappedAccounts.delete(accountKey(host, workspace, accountUuid))
}

/**
 * Bootstraps the operator's workspace-local identity graph on a freshly
 * connected PlatformClient. Mirrors the SDK's `ensureEmployee()`
 * (`hcengineering/platform/plugins/contact/src/utils.ts:418`) using only
 * primitives the CLI already has access to:
 *
 *   1. TxCreateDoc(contact:class:Person, contact:space:Contacts, ...)
 *   2. TxCollectionCUD(Person, 'socialIds', TxCreateDoc(SocialIdentity))
 *   3. TxMixin(Person, contact:mixin:Employee, { active, role })
 *
 * These three transactions cause the server-side `OnPersonCreate` and
 * `OnEmployeeCreate` triggers (`server-plugins/contact-resources/src/index.ts:131,272`)
 * to fire and produce the rest of the identity graph (UserProfile,
 * PersonSpace, autoJoin memberships, Member role grants) automatically.
 *
 * Idempotent: a successful run writes a marker to the on-disk bootstrap
 * cache keyed on (host, workspace, accountUuid), so an unrelated account
 * on the same workspace will still trigger a full bootstrap on first
 * connect. The next call from the same account returns early after a
 * `bootstrap.json` read; subsequent calls within the same process
 * short-circuit on the in-memory cache and never touch disk or the
 * network.
 *
 * Failures are returned to the caller; the caller (`connectCli`) decides
 * whether to log/warn or propagate.
 */

export interface BootstrapArgs {
  url: string
  workspace: string
  client: PlatformClient
}

export type BootstrapResult =
  | { state: 'already-bootstrapped' }
  | { state: 'no-account' }
  | { state: 'bootstrapped'; personId: string }
  | { state: 'skipped'; reason: string }

const AVATAR_TYPE_COLOR = 'color'

interface ConnectionAdapter {
  tx: (tx: unknown) => Promise<unknown>
  txFactory: {
    createTxCreateDoc: (
      _class: string,
      space: string,
      attributes: Record<string, unknown>,
      objectId?: string
    ) => unknown
    createTxUpdateDoc: (
      _class: string,
      space: string,
      objectId: string,
      attributes: Record<string, unknown>
    ) => unknown
    createTxCollectionCUD: (
      _class: string,
      objectId: string,
      space: string,
      collection: string,
      tx: unknown
    ) => unknown
    createTxMixin: (
      objectId: string,
      objectClass: string,
      objectSpace: string,
      mixin: string,
      attributes: Record<string, unknown>
    ) => unknown
  }
}

function getConnection(client: PlatformClient): ConnectionAdapter {
  const conn = (client as unknown as {
    connection?: { tx: (tx: unknown) => Promise<unknown> }
  }).connection
  if (conn?.tx === undefined) {
    throw new Error('platform client has no .connection.tx; bootstrap requires a connected transactor')
  }
  const txFactory = (client as unknown as {
    client?: {
      txFactory?: {
        createTxCreateDoc: ConnectionAdapter['txFactory']['createTxCreateDoc']
        createTxUpdateDoc: ConnectionAdapter['txFactory']['createTxUpdateDoc']
        createTxCollectionCUD: ConnectionAdapter['txFactory']['createTxCollectionCUD']
        createTxMixin: ConnectionAdapter['txFactory']['createTxMixin']
      }
    }
  }).client?.txFactory
  if (txFactory === undefined) {
    throw new Error('platform client has no .client.txFactory; bootstrap requires TxFactory access')
  }
  return { tx: (tx) => conn.tx(tx), txFactory }
}

function buildSocialIdKey(type: string, value: string): string {
  // The SDK uses `buildSocialIdString` to compute `key`. Mirroring its
  // format keeps existing DB rows matching what the server expects.
  return `${type}:${value}`
}

function deriveName(fullSocialIds: Array<Record<string, unknown>>): string {
  // Prefer the primary email local part; fall back to the first non-deleted
  // social id value, then empty. The UI gets names from the global account
  // Person which we don't have here without an extra account-pod round trip.
  const email = fullSocialIds.find(
    (s) => s.type === 'email' && (s.isDeleted === undefined || s.isDeleted === false)
  )
  const emailVal = email?.value
  if (typeof emailVal === 'string' && emailVal.length > 0) {
    const at = emailVal.indexOf('@')
    return at > 0 ? emailVal.slice(0, at) : emailVal
  }
  const first = fullSocialIds.find(
    (s) => s.isDeleted === undefined || s.isDeleted === false
  )
  const firstVal = first?.value
  return typeof firstVal === 'string' ? firstVal : ''
}

function employeeRoleFor(accountRole: string): 'GUEST' | 'USER' {
  if (accountRole === 'GUEST' || accountRole === 'READONLYGUEST' || accountRole === 'DocGuest') {
    return 'GUEST'
  }
  return 'USER'
}

export async function bootstrapEmployee(args: BootstrapArgs): Promise<BootstrapResult> {
  // Two-level short-circuit, keyed on (host, workspace, accountUuid):
  //
  //   1. In-memory hit  — repeated calls within the same process for
  //      THIS account skip the disk read AND the bootstrap transactors.
  //      A different account on the same workspace in this process
  //      misses this cache and falls through to the disk check, so it
  //      cannot inherit another account's bootstrap state.
  //   2. In-memory miss + known-absent — skip the disk read but still
  //      need to do the bootstrap transactors.
  //   3. First time seen — read bootstrap.json from disk once.
  //
  // `PlatformClient.getAccount()` is a cached property accessor on the
  // SDK client (no network), so pulling it up here to key the in-memory
  // cache by accountUuid is free.
  let account
  try {
    account = await args.client.getAccount()
  } catch (err) {
    return {
      state: 'skipped',
      reason: `getAccount failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  if (account === undefined || account.uuid === undefined || account.uuid === '') {
    return { state: 'no-account' }
  }

  if (isWorkspaceAccountKnownBootstrapped(args.url, args.workspace, account.uuid)) {
    return { state: 'already-bootstrapped' }
  }

  if (!isWorkspaceAccountKnownAbsent(args.url, args.workspace, account.uuid)) {
    const file = await loadBootstrap()
    // Scope by (host, workspace, accountUuid) — a sibling account's
    // marker under the same workspace must NOT short-circuit this
    // account's bootstrap.
    const hostKey = normalizeHost(args.url)
    const accountHasMarker =
      file[hostKey]?.[args.workspace]?.[account.uuid] !== undefined
    if (accountHasMarker) {
      rememberWorkspaceAccountBootstrapped(args.url, args.workspace, account.uuid)
      return { state: 'already-bootstrapped' }
    }
    rememberWorkspaceAccountAbsent(args.url, args.workspace, account.uuid)
  }

  const { tx, txFactory } = getConnection(args.client)
  const fullSocialIds: Array<{
    _id: string
    type: string
    value: string
    key?: string
    verifiedOn?: number
    isDeleted?: boolean
  }> = Array.isArray(account.fullSocialIds) ? account.fullSocialIds : []

  // 1. Find or create the workspace-local Person doc.
  let personId: string | undefined = (
    await args.client.findOne<{ _id: string }>(CLASS.Person, { personUuid: account.uuid })
  )?._id

  if (personId === undefined) {
    // Recovery path: Person may exist without personUuid but already have
    // one of our social identities attached (e.g. a mail/github/telegram
    // pod ran `ensurePerson` on the transactor REST endpoint earlier).
    // Single batched query against the SocialIdentity table for all of
    // the account's social id refs, then pick the first attachedTo.
    const socialIdRefs = Array.isArray(account.socialIds) ? account.socialIds : []
    if (socialIdRefs.length > 0) {
      const foundSids = await args.client.findAll<{ attachedTo?: string }>(
        CLASS.SocialIdentity,
        { _id: { $in: socialIdRefs } }
      )
      const found = foundSids.find((s) => s.attachedTo !== undefined)
      if (found?.attachedTo !== undefined) {
        personId = found.attachedTo
      }
    }
  }

  if (personId === undefined) {
    personId = randomUUID()
    await tx(
      txFactory.createTxCreateDoc(CLASS.Person, SPACE.Contacts, {
        personUuid: account.uuid,
        name: deriveName(fullSocialIds),
        city: '',
        avatarType: AVATAR_TYPE_COLOR
      }, personId)
    )
  } else {
    // If we recovered via attachedTo, ensure personUuid is set.
    const existing = await args.client.findOne<{ personUuid?: string }>(
      CLASS.Person,
      { _id: personId }
    )
    if (existing?.personUuid === undefined) {
      await tx(
        txFactory.createTxUpdateDoc(CLASS.Person, SPACE.Contacts, personId, {
          personUuid: account.uuid
        })
      )
    }
  }

  // 2. Reconcile SocialIdentity collection items.
  // Gate on fullSocialIds (data we have) rather than account.socialIds
  // (refs to it) — the two arrays can drift apart on freshly-created or
  // not-yet-propagated accounts, and we'd otherwise leave the Person
  // with an empty socialIds collection.
  if (fullSocialIds.length > 0) {
    const fullSidsIds = fullSocialIds.map((s) => s._id)
    const existingSids = await args.client.findAll<{ _id: string }>(
      CLASS.SocialIdentity,
      { _id: { $in: fullSidsIds } }
    )
    const existingSet = new Set(existingSids.map((s) => s._id))
    for (const sid of fullSocialIds) {
      if (existingSet.has(sid._id)) continue
      await tx(
        txFactory.createTxCollectionCUD(
          CLASS.Person,
          personId,
          SPACE.Contacts,
          'socialIds',
          txFactory.createTxCreateDoc(
            CLASS.SocialIdentity,
            SPACE.Contacts,
            {
              attachedTo: personId,
              attachedToClass: CLASS.Person,
              collection: 'socialIds',
              type: sid.type,
              value: sid.value,
              key: sid.key ?? buildSocialIdKey(sid.type, sid.value),
              verifiedOn: sid.verifiedOn,
              isDeleted: sid.isDeleted ?? false
            },
            sid._id
          )
        )
      )
    }
  }

  // 3. Refresh the Employee mixin if missing, inactive, or stale role.
  // `role` reflects the account's current privilege on the account pod;
  // a promotion/demotion between User/Guest must propagate so that
  // role-gated UI features (auto-join for guests, etc.) stay correct.
  const employeeRole = employeeRoleFor(account.role)
  const employee = await args.client.findOne<{ active?: boolean; role?: string }>(
    CLASS.Employee,
    { _id: personId }
  )
  const isFreshEmployee =
    employee !== undefined && employee.active === true && employee.role === employeeRole
  if (!isFreshEmployee) {
    await tx(
      txFactory.createTxMixin(
        personId,
        CLASS.Person,
        SPACE.Contacts,
        CLASS.Employee,
        { active: true, role: employeeRole }
      )
    )
  }

  await markBootstrapped(args.url, args.workspace, account.uuid)
  rememberWorkspaceAccountBootstrapped(args.url, args.workspace, account.uuid)
  return { state: 'bootstrapped', personId }
}