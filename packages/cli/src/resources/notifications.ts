import type { Doc, Ref, Class } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, header, kv, C, success, updated, bulkRemoved, relTime } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'

type InboxNotification = Doc & {
  user: string
  isViewed: boolean
  archived: boolean
  objectId: Ref<Doc>
  objectClass: Ref<Class<Doc>>
  docNotifyContext: Ref<Doc>
  [k: string]: unknown
}

type DocNotifyContext = Doc & {
  user: string
  objectId: Ref<Doc>
  objectClass: Ref<Class<Doc>>
  isPinned?: boolean
  hidden?: boolean
  [k: string]: unknown
}

type NotificationType = Doc & {
  label: string
  group: Ref<Doc>
  objectClass: Ref<Class<Doc>>
  defaultEnabled?: boolean
  [k: string]: unknown
}

type NotificationProvider = Doc & {
  label: string
  defaultEnabled?: boolean
  canDisable?: boolean
  [k: string]: unknown
}

type NotificationTypeSetting = Doc & {
  attachedTo: Ref<Doc>
  type: Ref<Doc>
  enabled: boolean
  [k: string]: unknown
}

const INBOX_CLASS = 'notification:class:InboxNotification' as Ref<Class<InboxNotification>>
const CONTEXT_CLASS = 'notification:class:DocNotifyContext' as Ref<Class<DocNotifyContext>>
const TYPE_CLASS = 'notification:class:NotificationType' as Ref<Class<NotificationType>>
const PROVIDER_CLASS = 'notification:class:NotificationProvider' as Ref<Class<NotificationProvider>>
const TYPE_SETTING_CLASS = 'notification:class:NotificationTypeSetting' as Ref<Class<NotificationTypeSetting>>

// ---- providers / types ----

export async function listProviders(opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner('Loading providers…', () => client.findAll(PROVIDER_CLASS, {}), opts)) as NotificationProvider[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'label', header: 'LABEL' },
      { key: 'canDisable', header: 'DISABLE', align: 'center', format: (r) => (r as NotificationProvider).canDisable ? C.muted('yes') : C.warn('no') },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as NotificationProvider)._id).slice(-16)) }
    ], { count: true, title: 'notification-providers' })
  } finally { await client.close() }
}

export async function listTypes(opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner('Loading types…', () => client.findAll(TYPE_CLASS, {}), opts)) as NotificationType[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'label', header: 'LABEL' },
      { key: 'group', header: 'GROUP', format: (r) => C.id(String((r as NotificationType).group).slice(-12)) },
      { key: 'objectClass', header: 'OBJECT', format: (r) => String((r as NotificationType).objectClass).split(':').pop() ?? '' },
      { key: 'defaultEnabled', header: 'ENABLED', align: 'center', format: (r) => (r as NotificationType).defaultEnabled ? C.ok('✓') : C.muted('—') },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as NotificationType)._id).slice(-16)) }
    ], { count: true, title: 'notification-types' })
  } finally { await client.close() }
}

// ---- list / get ----

export interface ListInboxOpts {
  read?: boolean
  unread?: boolean
  archived?: boolean
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listInbox(opts: ListInboxOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const q: Record<string, unknown> = { user: account.uuid }
    if (opts.read === true) q.isViewed = true
    else if (opts.unread === true) q.isViewed = false
    if (opts.archived === true) q.archived = true
    else if (opts.archived === false) q.archived = { $ne: true }
    const docs = (await withSpinner('Loading notifications…', () => client.findAll(INBOX_CLASS, q as any), opts)) as InboxNotification[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    if (r.length === 0) { console.log(C.muted('(no notifications)')); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'objectClass', header: 'KIND', format: (r) => String((r as InboxNotification).objectClass).split(':').pop() ?? '' },
      { key: 'isViewed', header: 'READ', align: 'center', format: (r) => (r as InboxNotification).isViewed ? C.muted('—') : C.warn('●') },
      { key: 'archived', header: 'ARC', align: 'center', format: (r) => (r as InboxNotification).archived ? C.muted('✓') : C.muted('—') },
      { key: 'objectId', header: 'OBJECT', format: (r) => C.id(String((r as InboxNotification).objectId).slice(-12)) },
      { key: 'modifiedOn', header: 'WHEN', align: 'right', format: (r) => relTime((r as InboxNotification).modifiedOn as number | null) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as InboxNotification)._id).slice(-12)) }
    ], { count: true, title: 'inbox' })
  } finally { await client.close() }
}

export async function getInbox(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: INBOX_CLASS as Ref<Class<Doc>> })
    const doc = await client.findOne(INBOX_CLASS, { _id: id as Ref<InboxNotification> })
    if (!doc) throw new CliError(ExitCode.NotFound, `notification ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`Notification — ${String(doc._id).slice(-12)}`)
    kv([
      ['ID', C.id(String(doc._id))],
      ['Object', C.id(String(doc.objectId))],
      ['Read', doc.isViewed ? C.ok('yes') : C.warn('no')],
      ['Archived', doc.archived ? C.muted('yes') : C.muted('no')],
      ['Context', C.id(String(doc.docNotifyContext))]
    ])
  } finally { await client.close() }
}

// ---- mark read / unread / archive / unarchive ----

async function updateInbox(client: Awaited<ReturnType<typeof connectCli>>, ref: string, ops: Record<string, unknown>, spinner: string, opts: { json?: boolean; ci?: boolean }) {
  const id = await resolveRef(ref, { client, classId: INBOX_CLASS as Ref<Class<Doc>> }) as Ref<InboxNotification>
  const doc = await client.findOne(INBOX_CLASS, { _id: id })
  if (!doc) throw new CliError(ExitCode.NotFound, `notification ${ref} not found`)
  await withSpinner(spinner, () => client.updateDoc(INBOX_CLASS, doc.space as Ref<Doc>, id as Ref<Doc>, ops as any), opts)
  return id
}

export async function markRead(refs: string[], opts: { workspace?: string; url?: string; json?: boolean; ci?: boolean; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    if (!opts.yes && refs.length > 1) throw new CliError(ExitCode.Validation, `destructive: marking ${refs.length} notifications read requires --yes`)
    let count = 0
    for (const r of refs) {
      await updateInbox(client, r, { isViewed: true }, 'Marking read…', opts)
      count++
    }
    success('marked read', `${count} notifications`)
  } finally { await client.close() }
}

export async function markUnread(refs: string[], opts: { workspace?: string; url?: string; json?: boolean; ci?: boolean; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    if (!opts.yes && refs.length > 1) throw new CliError(ExitCode.Validation, `destructive: marking ${refs.length} notifications unread requires --yes`)
    let count = 0
    for (const r of refs) {
      await updateInbox(client, r, { isViewed: false }, 'Marking unread…', opts)
      count++
    }
    success('marked unread', `${count} notifications`)
  } finally { await client.close() }
}

export async function markAllRead(opts: { workspace?: string; url?: string; json?: boolean; ci?: boolean; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const docs = (await client.findAll(INBOX_CLASS, { user: account.uuid, isViewed: false })) as InboxNotification[]
    if (docs.length === 0) { console.log(C.muted('(no unread notifications)')); return }
    for (const d of docs) {
      await client.updateDoc(INBOX_CLASS, d.space as Ref<Doc>, d._id as Ref<Doc>, { isViewed: true } as any)
    }
    success('marked all read', `${docs.length} notifications`)
  } finally { await client.close() }
}

export async function archive(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    if (!opts.yes && refs.length > 1) throw new CliError(ExitCode.Validation, `destructive: archiving ${refs.length} notifications requires --yes`)
    let count = 0
    for (const r of refs) {
      await updateInbox(client, r, { archived: true }, 'Archiving…', {})
      count++
    }
    success('archived', `${count} notifications`)
  } finally { await client.close() }
}

export async function unarchive(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    if (!opts.yes && refs.length > 1) throw new CliError(ExitCode.Validation, `destructive: unarchiving ${refs.length} notifications requires --yes`)
    let count = 0
    for (const r of refs) {
      await updateInbox(client, r, { archived: false }, 'Unarchiving…', {})
      count++
    }
    success('unarchived', `${count} notifications`)
  } finally { await client.close() }
}

export async function archiveAll(opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  if (!opts.yes) throw new CliError(ExitCode.Validation, 'destructive: archive-all requires --yes')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const docs = (await client.findAll(INBOX_CLASS, { user: account.uuid, archived: { $ne: true } })) as InboxNotification[]
    for (const d of docs) {
      await client.updateDoc(INBOX_CLASS, d.space as Ref<Doc>, d._id as Ref<Doc>, { archived: true } as any)
    }
    success('archived all', `${docs.length} notifications`)
  } finally { await client.close() }
}

export async function deleteInbox(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, { client, classId: INBOX_CLASS as Ref<Class<Doc>> })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} notifications requires --yes`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(INBOX_CLASS, { _id: id as Ref<InboxNotification> })
      if (!doc) { skipped++; continue }
      try {
        await client.removeDoc(INBOX_CLASS, doc.space as Ref<Doc>, id as Ref<Doc>)
        deleted++
      } catch { skipped++ }
    }
    bulkRemoved(deleted, skipped, 'notifications')
  } finally { await client.close() }
}

export async function unreadCount(opts: { workspace?: string; url?: string; json?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const docs = (await client.findAll(INBOX_CLASS, { user: account.uuid, isViewed: false, archived: { $ne: true } })) as InboxNotification[]
    if (opts.json) { json({ count: docs.length }); return }
    console.log(String(docs.length))
  } finally { await client.close() }
}

// ---- contexts ----

export interface ListContextsOpts {
  pinned?: boolean
  hidden?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listContexts(opts: ListContextsOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const q: Record<string, unknown> = { user: account.uuid }
    if (opts.pinned) q.isPinned = true
    if (opts.hidden) q.hidden = true
    const docs = (await withSpinner('Loading contexts…', () => client.findAll(CONTEXT_CLASS, q as any), opts)) as DocNotifyContext[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    if (docs.length === 0) { console.log(C.muted('(no contexts)')); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'objectId', header: 'OBJECT', format: (r) => C.id(String((r as DocNotifyContext).objectId).slice(-12)) },
      { key: 'objectClass', header: 'CLASS', format: (r) => String((r as DocNotifyContext).objectClass).split(':').pop() ?? '' },
      { key: 'isPinned', header: 'PIN', align: 'center', format: (r) => (r as DocNotifyContext).isPinned ? C.warn('★') : C.muted('—') },
      { key: 'hidden', header: 'HIDDEN', align: 'center', format: (r) => (r as DocNotifyContext).hidden ? C.muted('yes') : C.muted('—') },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as DocNotifyContext)._id).slice(-12)) }
    ], { count: true, title: 'notification-contexts' })
  } finally { await client.close() }
}

export async function getContext(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CONTEXT_CLASS as Ref<Class<Doc>> })
    const doc = await client.findOne(CONTEXT_CLASS, { _id: id as Ref<DocNotifyContext> })
    if (!doc) throw new CliError(ExitCode.NotFound, `context ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`NotifyContext — ${String(doc._id).slice(-12)}`)
    kv([
      ['ID', C.id(String(doc._id))],
      ['Object', C.id(String(doc.objectId))],
      ['Pinned', doc.isPinned ? C.warn('yes') : C.muted('no')],
      ['Hidden', doc.hidden ? C.muted('yes') : C.muted('no')]
    ])
  } finally { await client.close() }
}

export async function pinContext(ref: string, opts: { unpin?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CONTEXT_CLASS as Ref<Class<Doc>> }) as Ref<DocNotifyContext>
    const doc = await client.findOne(CONTEXT_CLASS, { _id: id })
    if (!doc) throw new CliError(ExitCode.NotFound, `context ${ref} not found`)
    await client.updateDoc(CONTEXT_CLASS, doc.space as Ref<Doc>, id as Ref<Doc>, { isPinned: !opts.unpin } as any)
    success(opts.unpin ? 'unpinned context' : 'pinned context', '', id as unknown as string)
  } finally { await client.close() }
}

export async function hideContext(ref: string, opts: { unhide?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CONTEXT_CLASS as Ref<Class<Doc>> }) as Ref<DocNotifyContext>
    const doc = await client.findOne(CONTEXT_CLASS, { _id: id })
    if (!doc) throw new CliError(ExitCode.NotFound, `context ${ref} not found`)
    await client.updateDoc(CONTEXT_CLASS, doc.space as Ref<Doc>, id as Ref<Doc>, { hidden: !opts.unhide } as any)
    success(opts.unhide ? 'unhid context' : 'hid context', '', id as unknown as string)
  } finally { await client.close() }
}

// ---- subscribe / unsubscribe ----

export interface SubOpts {
  target: string
  targetClass?: string
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

export async function subscribe(opts: SubOpts): Promise<void> {
  if (!opts.target) throw new CliError(ExitCode.Validation, 'missing --target')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const tClass = (opts.targetClass ?? 'core:class:Doc') as Ref<Class<Doc>>
    const tId = await resolveRef(opts.target, { client, classId: tClass })
    const target = await client.findOne(tClass, { _id: tId as Ref<Doc> })
    if (!target) throw new CliError(ExitCode.NotFound, `target ${opts.target} not found`)
    const account = await client.getAccount()
    // The context's space is the user's PersonSpace.
    const data: Record<string, unknown> = {
      user: account.uuid,
      objectId: tId,
      objectClass: tClass,
      objectSpace: (target as Doc).space,
      isPinned: false,
      hidden: false
    }
    const id = await withSpinner('Subscribing…', () => client.addCollection(CONTEXT_CLASS, (target as Doc).space as Ref<Doc>, tId, tClass, 'contexts', data as any), opts)
    invalidateIndex(client, CONTEXT_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success('subscribed', opts.target, id as unknown as string)
  } finally { await client.close() }
}

export async function unsubscribe(opts: SubOpts): Promise<void> {
  if (!opts.target) throw new CliError(ExitCode.Validation, 'missing --target')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const tClass = (opts.targetClass ?? 'core:class:Doc') as Ref<Class<Doc>>
    const tId = await resolveRef(opts.target, { client, classId: tClass })
    const account = await client.getAccount()
    const docs = (await client.findAll(CONTEXT_CLASS, { user: account.uuid, objectId: tId, objectClass: tClass })) as DocNotifyContext[]
    if (docs.length === 0) { console.log(C.muted('(not subscribed)')); return }
    for (const d of docs) {
      await client.removeCollection(CONTEXT_CLASS, d.space as Ref<Doc>, d._id as Ref<Doc>, tId, tClass, d.collection ?? 'contexts')
    }
    console.log(`removed ${docs.length} context(s)`)
  } finally { await client.close() }
}

// ---- settings ----

export interface SettingsOpts {
  provider?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listSettings(opts: SettingsOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const q: Record<string, unknown> = { modifiedBy: account.uuid as unknown as string }
    if (opts.provider) q.attachedTo = opts.provider as Ref<Doc>
    const docs = (await client.findAll(TYPE_SETTING_CLASS, q as any)) as NotificationTypeSetting[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    if (docs.length === 0) { console.log(C.muted('(no settings)')); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'attachedTo', header: 'PROVIDER', format: (r) => C.id(String((r as NotificationTypeSetting).attachedTo).slice(-12)) },
      { key: 'type', header: 'TYPE', format: (r) => C.id(String((r as NotificationTypeSetting).type).slice(-12)) },
      { key: 'enabled', header: 'ENABLED', align: 'center', format: (r) => (r as NotificationTypeSetting).enabled ? C.ok('✓') : C.warn('—') }
    ], { count: true, title: 'notification-settings' })
  } finally { await client.close() }
}

export interface UpdateSettingOpts {
  provider: string
  type: string
  enabled: boolean
  workspace?: string
  url?: string
  json?: boolean
  ci?: boolean
}

export async function updateSetting(opts: UpdateSettingOpts): Promise<void> {
  if (!opts.provider || !opts.type) throw new CliError(ExitCode.Validation, 'missing --provider or --type')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const existing = (await client.findAll(TYPE_SETTING_CLASS, { attachedTo: opts.provider as Ref<Doc>, type: opts.type as Ref<Doc>, modifiedBy: account.uuid as unknown as string })) as NotificationTypeSetting[]
    if (existing.length > 0) {
      await client.updateDoc(TYPE_SETTING_CLASS, existing[0].space as Ref<Doc>, existing[0]._id as Ref<Doc>, { enabled: opts.enabled } as any)
      updated('updated setting', existing[0]._id as unknown as string)
    } else {
      const id = await client.addCollection(TYPE_SETTING_CLASS, account.person as Ref<Doc>, opts.provider as Ref<Doc>, PROVIDER_CLASS, 'types', {
        type: opts.type as Ref<Doc>,
        enabled: opts.enabled
      } as any)
      success('created setting', '', id as unknown as string)
    }
  } finally { await client.close() }
}
