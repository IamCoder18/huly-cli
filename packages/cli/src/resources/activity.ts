import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, header, kv, C, success, updated, bulkRemoved, relTime } from '../output/format.js'
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
    await client.updateCollection(ACTIVITY_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Doc>, doc.attachedTo as Ref<Doc>, doc.attachedToClass ?? 'core:class:Doc' as Ref<Class<Doc>>, doc.collection ?? 'activity', { isPinned: !opts.unpin } as any)
    success(opts.unpin ? 'unpinned' : 'pinned', '', id as unknown as string)
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
    success('reacted', `${opts.emoji} on ${opts.target}`, rid as unknown as string)
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
    success('replied', '', rid as unknown as string)
  } finally { await client.close() }
}

export async function updateReply(ref: string, opts: { body?: string; workspace?: string; url?: string } = {}): Promise<void> {
  if (!opts.body) throw new CliError(ExitCode.Validation, 'missing --body')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchActivity(client, ref)
    await client.updateCollection(ACTIVITY_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Doc>, doc.attachedTo as Ref<Doc>, doc.attachedToClass ?? 'core:class:Doc' as Ref<Class<Doc>>, doc.collection ?? 'replies', { message: opts.body, modifiedOn: Date.now() } as any)
    updated('updated reply', id as unknown as string)
  } finally { await client.close() }
}

export async function deleteReplies(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, { client, classId: ACTIVITY_CLASS as Ref<Class<Doc>> })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} replies requires --yes`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = (await client.findOne(ACTIVITY_CLASS, { _id: id as Ref<ActivityMessage> })) as ActivityMessage | undefined
      if (!doc || !doc.attachedTo) { skipped++; continue }
      try {
        await client.removeCollection(ACTIVITY_CLASS, doc.space as Ref<Doc>, id as Ref<Doc>, doc.attachedTo, doc.attachedToClass ?? ACTIVITY_CLASS, doc.collection ?? 'replies')
        deleted++
      } catch { skipped++ }
    }
    bulkRemoved(deleted, skipped, 'replies')
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
    // List ALL saved messages (filtering by modifiedBy doesn't match because
    // the createDoc sets modifiedBy to the session's account, but the
    // local SDK can return a slightly different uuid shape). We let the
    // server filter by class only and rely on the workspace permission to
    // show only the current user's saves.
    const docs = (await client.findAll(SAVED_CLASS, {})) as SavedMessage[]
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
    const { id, doc } = await fetchActivity(client, opts.target)
    // SavedMessage is a Preference (not an AttachedDoc), so we use createDoc
    // with the activity's space as the doc space.
    const data: Record<string, unknown> = { attachedTo: id }
    const sid = await withSpinner('Saving…', () => client.createDoc(SAVED_CLASS, doc.space as Ref<Doc>, data as any), opts)
    success('saved', '', sid as unknown as string)
  } finally { await client.close() }
}

export async function unsaveMessage(opts: SavedOpts): Promise<void> {
  if (!opts.target) throw new CliError(ExitCode.Validation, 'missing --target')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { id, doc } = await fetchActivity(client, opts.target)
    const all = (await client.findAll(SAVED_CLASS, { attachedTo: id })) as SavedMessage[]
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
    // UserMentionInfo is attached to a Person (the mentioned user). We look
    // for entries pointing at the current user's Person ref.
    const me = await client.findOne('contact:class:Person' as Ref<Class<Doc>>, { _id: account.person as unknown as Ref<Doc> })
    if (!me) {
      const all = (await client.findAll(MENTION_CLASS, { user: account.person as unknown as Ref<Doc> })) as UserMentionInfo[]
      if (shouldJson({ json: opts.json, ci: opts.ci })) { json(all); return }
      if (all.length === 0) { console.log(C.muted('(no mentions)')); return }
      table(all as unknown as Record<string, unknown>[], [
        { key: 'content', header: 'CONTEXT', format: (r) => String((r as UserMentionInfo).content ?? '').slice(0, 60) },
        { key: 'attachedTo', header: 'MESSAGE', format: (r) => C.id(String((r as UserMentionInfo).attachedTo ?? '').slice(-12)) },
        { key: '_id', header: '_ID', format: (r) => C.id(String((r as UserMentionInfo)._id).slice(-12)) }
      ], { count: true, title: 'mentions' })
      return
    }
    const all = (await client.findAll(MENTION_CLASS, { user: me._id as Ref<Doc> })) as UserMentionInfo[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(all); return }
    if (all.length === 0) { console.log(C.muted('(no mentions)')); return }
    table(all as unknown as Record<string, unknown>[], [
      { key: 'content', header: 'CONTEXT', format: (r) => String((r as UserMentionInfo).content ?? '').slice(0, 60) },
      { key: 'attachedTo', header: 'MESSAGE', format: (r) => C.id(String((r as UserMentionInfo).attachedTo ?? '').slice(-12)) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as UserMentionInfo)._id).slice(-12)) }
    ], { count: true, title: 'mentions' })
  } finally { await client.close() }
}
