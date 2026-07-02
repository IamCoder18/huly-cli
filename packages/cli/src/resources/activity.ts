import { type Doc, type Ref, type Class, type Space } from '@hcengineering/core'
import { SPACE } from '../transport/identifiers.js'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, header, kv, C, success, updated, bulkRemoved, refString, relTime } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'

type ActivityMessage = Doc & {
  message?: string
  isPinned?: boolean
  attachedTo?: Ref<Doc>
  attachedToClass?: Ref<Class<Doc>>
  collection?: string
  createdBy?: string
  createdOn?: number
  modifiedOn?: number
  repliedPersons?: Ref<Doc>[]
  [k: string]: unknown
}

type Reaction = Doc & {
  emoji: string
  attachedTo: Ref<ActivityMessage>
  attachedToClass: Ref<Class<ActivityMessage>>
  createBy?: string
  [k: string]: unknown
}

type SavedMessage = Doc & {
  attachedTo: Ref<ActivityMessage>
  [k: string]: unknown
}

type UserMentionInfo = Doc & {
  user: Ref<Doc>
  content?: string
  attachedTo?: Ref<Doc>
  [k: string]: unknown
}

const ACTIVITY_CLASS = CLASS.ActivityMessage as Ref<Class<ActivityMessage>>
const REACTION_CLASS = 'activity:class:Reaction' as Ref<Class<Reaction>>
const SAVED_CLASS = 'activity:class:SavedMessage' as Ref<Class<SavedMessage>>
const MENTION_CLASS = 'activity:class:UserMentionInfo' as Ref<Class<UserMentionInfo>>

// ---- list ----

export interface ListActivityOpts {
  target?: string
  targetClass?: string
  pinned?: boolean
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listActivity(opts: ListActivityOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const q: Record<string, unknown> = {}
    if (opts.target) {
      const tClass = (opts.targetClass ?? 'core:class:Doc') as Ref<Class<Doc>>
      const tId = await resolveRef(opts.target, { client, classId: tClass })
      q.attachedTo = tId
    }
    if (opts.pinned) q.isPinned = true
    const docs = (await withSpinner('Loading activity…', () => client.findAll(ACTIVITY_CLASS, q as any), opts)) as ActivityMessage[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    if (r.length === 0) { console.log(C.muted('(no activity)')); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'message', header: 'MESSAGE', format: (r) => {
        const m = String((r as ActivityMessage).message ?? '').replace(/\n/g, ' ').slice(0, 60)
        return m || C.muted('(no text)')
      } },
      { key: 'isPinned', header: 'PIN', align: 'center', format: (r) => (r as ActivityMessage).isPinned ? C.warn('★') : C.muted('—') },
      { key: 'attachedTo', header: 'TARGET', format: (r) => C.id(String((r as ActivityMessage).attachedTo ?? '').slice(-12)) },
      { key: 'createdOn', header: 'WHEN', align: 'right', format: (r) => relTime((r as ActivityMessage).createdOn as number | null) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as ActivityMessage)._id).slice(-12)) }
    ], { count: true, title: 'activity' })
  } finally { await client.close() }
}

// ---- get ----

export async function getActivity(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: ACTIVITY_CLASS as Ref<Class<Doc>> })
    const doc = await client.findOne(ACTIVITY_CLASS, { _id: id as Ref<ActivityMessage> })
    if (!doc) throw new CliError(ExitCode.NotFound, `activity ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`Activity — ${String(doc._id).slice(-12)}`, { subtitle: relTime(doc.createdOn as number | null) })
    kv([
      ['ID', C.id(String(doc._id))],
      ['Pinned', doc.isPinned ? C.warn('yes') : C.muted('no')],
      ['Target', C.id(String(doc.attachedTo ?? '—'))],
      ['Created by', String(doc.createdBy ?? '—')],
      ['Message', String(doc.message ?? C.muted('(no text)'))]
    ])
  } finally { await client.close() }
}

// ---- pin/unpin ----

export async function pinActivity(ref: string, opts: { unpin?: boolean; workspace?: string; url?: string; json?: boolean; ci?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: ACTIVITY_CLASS as Ref<Class<Doc>> })
    const doc = await client.findOne(ACTIVITY_CLASS, { _id: id as Ref<ActivityMessage> })
    if (!doc) throw new CliError(ExitCode.NotFound, `activity ${ref} not found`)
    // isPinned is a property of the ActivityMessage doc itself — updateDoc,
    // NOT updateCollection. The latter would mutate a non-existent
    // 'activity' collection tuple on the attached-to doc.
    await client.updateDoc(ACTIVITY_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Doc>, { isPinned: !opts.unpin } as any)
    success(opts.unpin ? 'unpinned' : 'pinned', '', refString(id))
  } finally { await client.close() }
}

// ---- reactions ----

export interface ReactionOpts {
  target: string
  emoji: string
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

async function fetchActivity(client: Awaited<ReturnType<typeof connectCli>>, ref: string): Promise<{ id: Ref<ActivityMessage>; doc: ActivityMessage }> {
  const id = await resolveRef(ref, { client, classId: ACTIVITY_CLASS as Ref<Class<Doc>> }) as Ref<ActivityMessage>
  const doc = await client.findOne(ACTIVITY_CLASS, { _id: id })
  if (!doc) throw new CliError(ExitCode.NotFound, `activity ${ref} not found`)
  return { id, doc }
}

export async function addReaction(opts: ReactionOpts): Promise<void> {
  if (!opts.target || !opts.emoji) throw new CliError(ExitCode.Validation, 'missing --target or --emoji')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchActivity(client, opts.target)
    const account = await client.getAccount()
    const data: Record<string, unknown> = {
      emoji: opts.emoji,
      createBy: account.primarySocialId
    }
    const rid = await withSpinner('Adding reaction…', () => client.addCollection(REACTION_CLASS, doc.space as Ref<Doc>, id, ACTIVITY_CLASS, 'reactions', data as any), opts)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: rid, ...data }); return }
    success('reacted', `${opts.emoji} on ${opts.target}`, refString(rid))
  } finally { await client.close() }
}

export async function removeReaction(opts: ReactionOpts): Promise<void> {
  if (!opts.target || !opts.emoji) throw new CliError(ExitCode.Validation, 'missing --target or --emoji')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchActivity(client, opts.target)
    const account = await client.getAccount()
    const reactions = (await client.findAll(REACTION_CLASS, { attachedTo: id, emoji: opts.emoji, createBy: account.primarySocialId })) as Reaction[]
    if (reactions.length === 0) { console.log(C.muted('(no matching reaction)')); return }
    for (const r of reactions) {
      await client.removeCollection(REACTION_CLASS, r.space as Ref<Doc>, r._id as Ref<Doc>, id, ACTIVITY_CLASS, r.collection ?? 'reactions')
    }
    console.log(`removed ${reactions.length} reaction(s)`)
  } finally { await client.close() }
}

export async function listReactions(target: string, opts: { workspace?: string; url?: string; json?: boolean; ci?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id } = await fetchActivity(client, target)
    const reactions = (await client.findAll(REACTION_CLASS, { attachedTo: id })) as Reaction[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(reactions); return }
    if (reactions.length === 0) { console.log(C.muted('(no reactions)')); return }
    table(reactions as unknown as Record<string, unknown>[], [
      { key: 'emoji', header: 'EMOJI' },
      { key: 'createBy', header: 'BY' },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as Reaction)._id).slice(-12)) }
    ], { count: true, title: 'reactions' })
  } finally { await client.close() }
}

// ---- replies ----
// Replies are ActivityMessages attached to other ActivityMessages.

export async function listReplies(target: string, opts: { workspace?: string; url?: string; json?: boolean; ci?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id } = await fetchActivity(client, target)
    const replies = (await client.findAll(ACTIVITY_CLASS, { attachedTo: id, attachedToClass: ACTIVITY_CLASS })) as ActivityMessage[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(replies); return }
    if (replies.length === 0) { console.log(C.muted('(no replies)')); return }
    table(replies as unknown as Record<string, unknown>[], [
      { key: 'message', header: 'REPLY', format: (r) => String((r as ActivityMessage).message ?? '').replace(/\n/g, ' ').slice(0, 60) || C.muted('(empty)') },
      { key: 'createdBy', header: 'BY' },
      { key: 'createdOn', header: 'WHEN', align: 'right', format: (r) => relTime((r as ActivityMessage).createdOn as number | null) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as ActivityMessage)._id).slice(-12)) }
    ], { count: true, title: 'replies' })
  } finally { await client.close() }
}

export interface ReplyOpts {
  target: string
  body: string
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

export async function addReply(opts: ReplyOpts): Promise<void> {
  if (!opts.target || !opts.body) throw new CliError(ExitCode.Validation, 'missing --target or --body')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchActivity(client, opts.target)
    const data: Record<string, unknown> = { message: opts.body }
    const rid = await withSpinner('Replying…', () => client.addCollection(ACTIVITY_CLASS, doc.space as Ref<Doc>, id, ACTIVITY_CLASS, 'replies', data as any), opts)
    invalidateIndex(client, ACTIVITY_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: rid, ...data }); return }
    success('replied', '', refString(rid))
  } finally { await client.close() }
}

export async function updateReply(ref: string, opts: { body?: string; workspace?: string; url?: string } = {}): Promise<void> {
  if (!opts.body) throw new CliError(ExitCode.Validation, 'missing --body')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchActivity(client, ref)
    // Replies are themselves ActivityMessage docs (with their own
    // attachedTo pointing at the parent). `message` lives on the reply
    // doc itself — updateDoc, NOT updateCollection against the parent's
    // 'replies' tuple (which doesn't exist).
    await client.updateDoc(ACTIVITY_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Doc>, { message: opts.body, modifiedOn: Date.now() } as any)
    updated('updated reply', refString(id))
  } finally { await client.close() }
}

export async function deleteReplies(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean; json?: boolean; ci?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, { client, classId: ACTIVITY_CLASS as Ref<Class<Doc>> })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${refs.length} replies requires --yes`)
    const removed: Ref<Doc>[] = []
    const errors: Array<{ id: string; message: string }> = []
    for (const id of ids) {
      const doc = (await client.findOne(ACTIVITY_CLASS, { _id: id as Ref<ActivityMessage> })) as ActivityMessage | undefined
      if (!doc || !doc.attachedTo) { errors.push({ id: String(id), message: 'not found or unattached' }); continue }
      try {
        await client.removeCollection(ACTIVITY_CLASS, doc.space as Ref<Doc>, id as Ref<Doc>, doc.attachedTo, doc.attachedToClass ?? ACTIVITY_CLASS, doc.collection ?? 'replies')
        removed.push(id as Ref<Doc>)
      } catch (err) {
        errors.push({ id: String(id), message: (err as Error).message })
      }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ removed, errors })
      return
    }
    if (errors.length > 0) for (const e of errors) console.error(`  ${e.id}: ${e.message}`)
    bulkRemoved(removed.length, errors.length, 'replies')
  } finally { await client.close() }
}

// ---- saved messages ----

export interface SavedOpts {
  target?: string
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

export async function listSaved(opts: SavedOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    // SavedMessage extends Preference (NOT AttachedDoc). Per-user filtering
    // relies on workspace-scoped security filters — match the reference
    // front-end (`activity-resources/src/activity.ts:38`): filter by
    // space = SPACE.Workspace so the server's per-user security
    // middleware can scope to the current account.
    const account = await client.getAccount()
    const docs = (await client.findAll(SAVED_CLASS, { space: SPACE.Workspace as Ref<Doc>, modifiedBy: String(account.uuid) })) as SavedMessage[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    if (docs.length === 0) { console.log(C.muted('(no saved messages)')); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'attachedTo', header: 'MESSAGE', format: (r) => C.id(String((r as SavedMessage).attachedTo).slice(-12)) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as SavedMessage)._id).slice(-12)) }
    ], { count: true, title: 'saved-messages' })
  } finally { await client.close() }
}

export async function saveMessage(opts: SavedOpts): Promise<void> {
  if (!opts.target) throw new CliError(ExitCode.Validation, 'missing --target')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id } = await fetchActivity(client, opts.target)
    // SavedMessage extends Preference (NOT AttachedDoc) — see reference
    // front-end `activity-resources/src/utils.ts:91` for the canonical
    // shape. Use SPACE.Workspace, the activity's space is the wrong
    // scope for a per-user preference.
    const data: Record<string, unknown> = { attachedTo: id }
    const sid = await withSpinner('Saving…', () => client.createDoc(SAVED_CLASS, SPACE.Workspace as Ref<Space>, data as any), opts)
    success('saved', '', refString(sid))
  } finally { await client.close() }
}

export async function unsaveMessage(opts: SavedOpts): Promise<void> {
  if (!opts.target) throw new CliError(ExitCode.Validation, 'missing --target')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id } = await fetchActivity(client, opts.target)
    // Per-user filter via modifiedBy; without this, unsave would wipe
    // every other user's bookmark of the message.
    const account = await client.getAccount()
    const all = (await client.findAll(SAVED_CLASS, { space: SPACE.Workspace as Ref<Doc>, attachedTo: id, modifiedBy: String(account.uuid) })) as SavedMessage[]
    for (const s of all) {
      await client.removeDoc(SAVED_CLASS, (s as Doc).space as Ref<Doc>, s._id as Ref<Doc>)
    }
    console.log(`removed ${all.length} saved entry(ies)`)
  } finally { await client.close() }
}

// ---- mentions ----

export async function listMentions(opts: { workspace?: string; url?: string; json?: boolean; ci?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    // A newly-created account may have no Person doc yet. Without this
    // guard, findOne({ _id: undefined }) would have its undefined key
    // stripped by the query serializer and match every Person in the
    // workspace — leaking everyone's mentions. As a fallback, search by
    // the account UUID (the UserMentionInfo.user field on the platform
    // uses the same identity it was created with, which is the account
    // UUID in single-user workspaces and the Person ref in multi-user).
    if (account.person === undefined) {
      const byUuid = (await client.findAll(MENTION_CLASS, { user: account.uuid as unknown as Ref<Doc> })) as UserMentionInfo[]
      if (shouldJson({ json: opts.json, ci: opts.ci })) { json(byUuid); return }
      if (byUuid.length === 0) { console.log(C.muted('(no mentions — current account has no Person profile yet)')); return }
      renderMentions(byUuid)
      return
    }
    const me = await client.findOne('contact:class:Person' as Ref<Class<Doc>>, { _id: account.person as unknown as Ref<Doc> })
    const userRef = (me?._id ?? account.person) as Ref<Doc>
    const all = (await client.findAll(MENTION_CLASS, { user: userRef })) as UserMentionInfo[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(all); return }
    renderMentions(all)
  } finally { await client.close() }
}

function renderMentions(all: UserMentionInfo[]): void {
  if (all.length === 0) { console.log(C.muted('(no mentions)')); return }
  table(all as unknown as Record<string, unknown>[], [
    { key: 'content', header: 'CONTEXT', format: (r) => String((r as UserMentionInfo).content ?? '').slice(0, 60) },
    { key: 'attachedTo', header: 'MESSAGE', format: (r) => C.id(String((r as UserMentionInfo).attachedTo ?? '').slice(-12)) },
    { key: '_id', header: '_ID', format: (r) => C.id(String((r as UserMentionInfo)._id).slice(-12)) }
  ], { count: true, title: 'mentions' })
}
