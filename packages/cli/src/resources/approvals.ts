import type { Doc, Ref, Class, Space } from '@hcengineering/core'
type Tx = any
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, header, kv, C, success, updated, bulkRemoved, refString, relTime } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'

const REQUEST_STATUSES = ['Active', 'Completed', 'Rejected', 'Cancelled'] as const
type RequestStatus = (typeof REQUEST_STATUSES)[number]

type RequestDoc = Doc & {
  requested: Ref<Doc>[]
  approved: Ref<Doc>[]
  approvedDates?: number[]
  requiredApprovesCount: number
  status: RequestStatus
  rejected?: Ref<Doc>
  tx: Tx
  rejectedTx?: Tx
  attachedTo: Ref<Doc>
  attachedToClass: Ref<Class<Doc>>
  collection?: string
  [k: string]: unknown
}

type Person = Doc & {
  name: string
  email?: string
  [k: string]: unknown
}

const REQUEST_CLASS = CLASS.Request as Ref<Class<RequestDoc>>
const PERSON_CLASS = CLASS.Person as Ref<Class<Person>>

/**
 * Canonical "current user" identity used for authorization checks.
 * Prefers the Person ref when present; falls back to the account UUID
 * right after signup when no Person doc has propagated yet.
 */
function currentUserId(account: { person?: Ref<Doc>; uuid: Ref<Doc> }): Ref<Doc> {
  return account.person ?? account.uuid
}

async function resolvePersonIds(client: Awaited<ReturnType<typeof connectCli>>, emails: string[]): Promise<Ref<Doc>[]> {
  const persons = (await client.findAll(PERSON_CLASS, {}, { limit: 500 })) as Person[]
  const map = new Map<string, Person>()
  for (const p of persons) {
    if (p.name) map.set(p.name.toLowerCase(), p)
    if (p.email) map.set(p.email.toLowerCase(), p)
  }
  const account = await client.getAccount()
  // The current user may have no Person doc yet (common right after signup).
  // Accept `me` and the current account's email as a fallback to the
  // account UUID, since many tests / small workspaces are single-user.
  const myEmail = (account as any).email as string | undefined
  const myPersonFallback: Ref<Doc> = account.uuid as Ref<Doc>
  const ids: Ref<Doc>[] = []
  for (const e of emails) {
    if (e === 'me' || (myEmail && e.toLowerCase() === myEmail.toLowerCase())) {
      ids.push(myPersonFallback)
      continue
    }
    const hit = map.get(e.toLowerCase())
    if (!hit) throw new CliError(ExitCode.NotFound, `person not found: ${e} (use 'me' for current user)`)
    ids.push(hit._id as Ref<Doc>)
  }
  return ids
}

async function fetchRequest(client: Awaited<ReturnType<typeof connectCli>>, ref: string): Promise<{ id: Ref<RequestDoc>; doc: RequestDoc }> {
  const id = await resolveRef(ref, { client, classId: REQUEST_CLASS as Ref<Class<Doc>> }) as Ref<RequestDoc>
  const doc = await client.findOne(REQUEST_CLASS, { _id: id })
  if (!doc) throw new CliError(ExitCode.NotFound, `approval ${ref} not found`)
  return { id, doc }
}

// ---- list ----

export interface ListApprovalsOpts {
  status?: RequestStatus
  attachedTo?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listApprovals(opts: ListApprovalsOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const q: Record<string, unknown> = {}
    if (opts.status) q.status = opts.status
    if (opts.attachedTo) {
      // Caller may pin the target class via --attached-to-class; default to Issue.
      // Without the right class ref, resolveRef throws "not found" for valid
      // requests attached to other doc types (documents, commits, etc.).
      const aClass = ((opts as { attachedToClass?: string }).attachedToClass ?? CLASS.Issue) as Ref<Class<Doc>>
      q.attachedTo = await resolveRef(opts.attachedTo, { client, classId: aClass })
    }
    const docs = (await withSpinner('Loading approvals…', () => client.findAll(REQUEST_CLASS, q as any), opts)) as RequestDoc[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    if (docs.length === 0) { console.log(C.muted('(no approval requests)')); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'status', header: 'STATUS', format: (r) => {
        const s = String((r as RequestDoc).status ?? '—')
        if (s === 'Active') return C.warn(s)
        if (s === 'Completed') return C.ok(s)
        if (s === 'Rejected' || s === 'Cancelled') return C.fail(s)
        return C.muted(s)
      } },
      { key: 'attachedTo', header: 'TARGET', format: (r) => C.id(String((r as RequestDoc).attachedTo ?? '').slice(-12)) },
      { key: 'requested', header: 'REQUESTED', format: (r) => String(((r as RequestDoc).requested ?? []).length) },
      { key: 'approved', header: 'APPROVED', format: (r) => String(((r as RequestDoc).approved ?? []).length) + '/' + String((r as RequestDoc).requiredApprovesCount) },
      { key: 'createdOn', header: 'WHEN', align: 'right', format: (r) => relTime((r as RequestDoc).createdOn as number | null) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as RequestDoc)._id).slice(-12)) }
    ], { count: true, title: 'approval-requests' })
  } finally { await client.close() }
}

// ---- get ----

export async function getApproval(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchRequest(client, ref)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`Approval — ${String(id).slice(-12)}`, { subtitle: String(doc.status ?? '—') })
    kv([
      ['ID', C.id(String(id))],
      ['Status', C.emphasis(String(doc.status ?? '—'))],
      ['Target', C.id(String(doc.attachedTo))],
      ['Required', String(doc.requiredApprovesCount)],
      ['Requested by', String((doc.requested ?? []).length) + ' person(s)'],
      ['Approved', String((doc.approved ?? []).length)],
      ['Rejected by', doc.rejected ? C.id(String(doc.rejected)) : C.muted('—')],
      ['Has tx', doc.tx ? C.ok('yes') : C.muted('no')]
    ])
  } finally { await client.close() }
}

// ---- request (create) ----

export interface CreateApprovalOpts {
  attachedTo: string
  attachedToClass?: string
  requested: string[]
  requiredCount?: number
  // We accept a JSON-encoded transaction descriptor that will be stored as
  // the "tx" property of the Request. This is the simplest cross-version
  // shape — the user can pass a JSON object describing the change to apply
  // on approval.
  txJson?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function createApproval(opts: CreateApprovalOpts): Promise<void> {
  if (!opts.attachedTo) throw new CliError(ExitCode.Validation, 'missing --attached-to')
  if (!opts.requested || opts.requested.length === 0) throw new CliError(ExitCode.Validation, 'missing --requested <emails...>')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const aClass = (opts.attachedToClass ?? CLASS.Issue) as Ref<Class<Doc>>
    const aId = await resolveRef(opts.attachedTo, { client, classId: aClass })
    const target = await client.findOne(aClass, { _id: aId as Ref<Doc> })
    if (!target) throw new CliError(ExitCode.NotFound, `attached-to ${opts.attachedTo} not found`)
    const personIds = await resolvePersonIds(client, opts.requested)
    // The `tx` field of a Request describes the change to apply on approval.
    // It is required: the server validates tx shape on create. Pass a JSON
    // descriptor via --tx-json (see `huly approval request --help`).
    if (!opts.txJson) {
      throw new CliError(
        ExitCode.Validation,
        'missing --tx-json',
        'a tx descriptor is required to create an approval request (try: huly approval request --help)'
      )
    }
    const tx: Tx = JSON.parse(opts.txJson)
    const data: Record<string, unknown> = {
      requested: personIds,
      approved: [],
      requiredApprovesCount: opts.requiredCount ?? personIds.length,
      status: 'Active',
      tx
    }
    const id = await withSpinner('Creating approval request…', () => client.addCollection(REQUEST_CLASS, (target as Doc).space as Ref<Doc>, aId, aClass, 'requests', data as any), opts)
    invalidateIndex(client, REQUEST_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success('created approval', '', refString(id))
  } finally { await client.close() }
}

// ---- comment (a ChatMessage in the comments collection with the
// RequestDecisionComment mixin) ----

export interface CommentOpts {
  ref: string
  body: string
  decision?: 'approve' | 'reject' | 'comment'
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

export async function commentOnApproval(opts: CommentOpts): Promise<void> {
  if (!opts.body) throw new CliError(ExitCode.Validation, 'missing --body')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchRequest(client, opts.ref!)
    const data: Record<string, unknown> = { message: opts.body }
    if (opts.decision) data.decision = opts.decision
    const cid = await withSpinner('Commenting…', () => client.addCollection('chunter:class:ChatMessage' as Ref<Class<Doc>>, doc.space as Ref<Doc>, id, REQUEST_CLASS, 'comments', data as any), opts)
    success('commented', '', refString(cid))
  } finally { await client.close() }
}

// ---- approve / reject / cancel ----

export interface ApproveOpts {
  ref: string
  comment?: string
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

export async function approveRequest(opts: ApproveOpts): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchRequest(client, opts.ref!)
    if (doc.status !== 'Active') throw new CliError(ExitCode.Validation, `request is ${doc.status}, not Active`)
    const account = await client.getAccount()
    // Resolve the current user's Person id when present; the requested/approved
    // arrays store Person refs. Without an account.person, fall back to
    // account.uuid so empty-filter serialization doesn't accidentally match
    // some other account's Person.
    const me = account.person !== undefined
      ? await client.findOne(PERSON_CLASS, { _id: account.person as unknown as Ref<Doc> })
      : null
    const approverId = (me?._id ?? account.uuid) as Ref<Doc>
    // The trigger auto-completes when requiredApprovesCount is reached.
    const ops: Record<string, unknown> = { $push: { approved: approverId } }
    await withSpinner('Approving…', () => client.updateCollection(REQUEST_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Doc>, doc.attachedTo, doc.attachedToClass, 'requests', ops as any), opts)
    if (opts.comment) {
      await client.addCollection('chunter:class:ChatMessage' as Ref<Class<Doc>>, doc.space as Ref<Doc>, id, REQUEST_CLASS, 'comments', { message: opts.comment, decision: 'approve' } as any)
    }
    updated('approved', refString(id))
  } finally { await client.close() }
}

export interface RejectOpts {
  ref: string
  comment: string
  rejectedTxJson?: string
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

export async function rejectRequest(opts: RejectOpts): Promise<void> {
  if (!opts.comment) throw new CliError(ExitCode.Validation, 'rejection requires --comment')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchRequest(client, opts.ref!)
    if (doc.status !== 'Active') throw new CliError(ExitCode.Validation, `request is ${doc.status}, not Active`)
    const account = await client.getAccount()
    const me = account.person !== undefined
      ? await client.findOne(PERSON_CLASS, { _id: account.person as unknown as Ref<Doc> })
      : null
    const rejecterId = (me?._id ?? account.uuid) as Ref<Doc>
    const ops: Record<string, unknown> = {
      status: 'Rejected',
      rejected: rejecterId
    }
    if (opts.rejectedTxJson) ops.rejectedTx = JSON.parse(opts.rejectedTxJson)
    await withSpinner('Rejecting…', () => client.updateCollection(REQUEST_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Doc>, doc.attachedTo, doc.attachedToClass, 'requests', ops as any), opts)
    await client.addCollection('chunter:class:ChatMessage' as Ref<Class<Doc>>, doc.space as Ref<Doc>, id, REQUEST_CLASS, 'comments', { message: opts.comment, decision: 'reject' } as any)
    updated('rejected', refString(id))
  } finally { await client.close() }
}

export async function cancelRequest(opts: { ref?: string; workspace?: string; url?: string; json?: boolean; ci?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchRequest(client, opts.ref!)
    if (doc.status !== 'Active') throw new CliError(ExitCode.Validation, `request is ${doc.status}, not Active`)
    const account = await client.getAccount()
    // Cancel allowed only by the requester. Use the canonical "current
    // user" identity (Person._id when present, else account.uuid) so
    // `[undefined].includes(...)` can't fire and requesters from any
    // identity shape match consistently.
    const requesterIds = (doc.requested ?? []).map((r) => String(r))
    const meId = String(currentUserId(account as { person?: Ref<Doc>; uuid: Ref<Doc> }))
    if (!requesterIds.includes(meId)) {
      throw new CliError(ExitCode.Auth, 'only requesters can cancel')
    }
    const ops: Record<string, unknown> = { status: 'Cancelled' }
    await withSpinner('Cancelling…', () => client.updateCollection(REQUEST_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Doc>, doc.attachedTo, doc.attachedToClass, 'requests', ops as any), opts)
    updated('cancelled', refString(id))
  } finally { await client.close() }
}

export async function deleteApprovals(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean; json?: boolean; ci?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, { client, classId: REQUEST_CLASS as Ref<Class<Doc>> })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} approvals requires --yes`)
    const removed: Ref<Doc>[] = []
    const errors: Array<{ id: string; message: string }> = []
    for (const id of ids) {
      const doc = (await client.findOne(REQUEST_CLASS, { _id: id as Ref<RequestDoc> })) as RequestDoc | undefined
      if (!doc) { errors.push({ id: String(id), message: 'not found' }); continue }
      try {
        // Request is an AttachedDoc — delete via removeCollection against
        // the 'requests' collection tuple on the attachedTo doc.
        await client.removeCollection(REQUEST_CLASS, doc.space as Ref<Doc>, id as Ref<Doc>, doc.attachedTo, doc.attachedToClass, 'requests')
        removed.push(id as Ref<Doc>)
      } catch (err) {
        // Surface non-silent failures to make debugging possible.
        errors.push({ id: String(id), message: (err as Error).message })
      }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ removed, errors })
      return
    }
    if (errors.length > 0) for (const e of errors) console.error(`  ${e.id}: ${e.message}`)
    bulkRemoved(removed.length, errors.length, 'approvals')
  } finally { await client.close() }
}
