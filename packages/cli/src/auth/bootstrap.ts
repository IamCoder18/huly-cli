import { randomUUID } from 'node:crypto'
import type { PlatformClient } from '@hcengineering/api-client'
import { CLASS, SPACE } from '../transport/identifiers.js'
import { isBootstrapped, loadBootstrap, markBootstrapped } from './bootstrap-cache.js'
import { normalizeHost } from './cache.js'

// In-memory short-circuit so a CLI process that runs many commands in a
// row (e.g. `huly issue list`, then `huly action list`, then `huly user
// get`) does not re-read bootstrap.json on every call. Keyed on the
// normalized host + workspace; presence of any account entry under that
// host/workspace counts as "workspace bootstrapped".
const bootstrappedWorkspaces = new Set<string>()
const unknownWorkspaces = new Set<string>()

function workspaceKey(host: string, workspace: string): string {
  return `${normalizeHost(host)}\n${workspace}`
}

function isWorkspaceKnownBootstrapped(host: string, workspace: string): boolean {
  return bootstrappedWorkspaces.has(workspaceKey(host, workspace))
}

function isWorkspaceKnownAbsent(host: string, workspace: string): boolean {
  return unknownWorkspaces.has(workspaceKey(host, workspace))
}

function rememberWorkspaceBootstrapped(host: string, workspace: string): void {
  bootstrappedWorkspaces.add(workspaceKey(host, workspace))
  unknownWorkspaces.delete(workspaceKey(host, workspace))
}

function rememberWorkspaceAbsent(host: string, workspace: string): void {
  unknownWorkspaces.add(workspaceKey(host, workspace))
  bootstrappedWorkspaces.delete(workspaceKey(host, workspace))
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
 * cache keyed on (host, workspace, accountUuid). The next call returns
 * early after a single `findOne` round-trip.
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
  // Two-level short-circuit so repeated calls within the same process
  // (and even the first call after a previous one) skip both the disk
  // read of bootstrap.json AND the getAccount() transactor round-trip:
  //
  //   1. In-memory hit (Set lookup, ~0ms): definite no-op.
  //   2. In-memory miss + known-absent: definitely needs bootstrap, but
  //      we still need getAccount() for social IDs.
  //   3. First time this workspace is seen: read bootstrap.json ONCE.
  //      If ANY account entry exists under (host, workspace), the
  //      workspace is treated as bootstrapped for the typical
  //      single-operator-per-CLI-install case and getAccount() is
  //      skipped entirely.
  const key = workspaceKey(args.url, args.workspace)
  if (bootstrappedWorkspaces.has(key)) {
    return { state: 'already-bootstrapped' }
  }

  let workspaceHasMarker: boolean
  if (unknownWorkspaces.has(key)) {
    workspaceHasMarker = false
  } else {
    const file = await loadBootstrap()
    workspaceHasMarker = Object.values(file[normalizeHost(args.url)] ?? {}).some(
      (ws) => Object.keys(ws ?? {}).length > 0
    )
    if (workspaceHasMarker) {
      rememberWorkspaceBootstrapped(args.url, args.workspace)
      return { state: 'already-bootstrapped' }
    }
    rememberWorkspaceAbsent(args.url, args.workspace)
  }

  const account = await args.client.getAccount()
  if (account === undefined || account.uuid === undefined || account.uuid === '') {
    return { state: 'no-account' }
  }

  if (workspaceHasMarker || (await isBootstrapped(args.url, args.workspace, account.uuid))) {
    rememberWorkspaceBootstrapped(args.url, args.workspace)
    return { state: 'already-bootstrapped' }
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
    const socialIdRefs = Array.isArray(account.socialIds) ? account.socialIds : []
    for (const sidRef of socialIdRefs) {
      const found = await args.client.findOne<{ attachedTo: string }>(
        CLASS.SocialIdentity,
        { _id: sidRef }
      )
      if (found?.attachedTo !== undefined) {
        personId = found.attachedTo
        break
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
  const socialIdRefs = Array.isArray(account.socialIds) ? account.socialIds : []
  if (socialIdRefs.length > 0) {
    const existingSids = await args.client.findAll<{ _id: string }>(
      CLASS.SocialIdentity,
      { _id: { $in: socialIdRefs } }
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

  // 3. Create the Employee mixin if missing or stale.
  const employeeRole = employeeRoleFor(account.role)
  const employee = await args.client.findOne<{ active?: boolean; role?: string }>(
    CLASS.Employee,
    { _id: personId }
  )
  const isActiveEmployee = employee !== undefined && employee.active === true
  if (!isActiveEmployee) {
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
  rememberWorkspaceBootstrapped(args.url, args.workspace)
  return { state: 'bootstrapped', personId }
}