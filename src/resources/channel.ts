import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, COLUMNS } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'
import { connectAccountCli } from '../transport/sdk.js'

type Channel = Doc & {
  name: string
  description?: string
  topic?: string
  private?: boolean
  archived?: boolean
  members?: Ref<Doc>[]
  owners?: Ref<Doc>[]
  autoJoin?: boolean
  autoJoinForRoles?: string[]
  messages?: number
}

type ChatMessage = Doc & {
  message: string
  attachedTo: Ref<Doc>
  attachedToClass: Ref<Class<Doc>>
  collection: string
  space: Ref<Doc>
  createdBy?: Ref<Doc>
  createdOn?: number
  editedOn?: number
}

type DirectMessage = Doc & {
  name: string
  description?: string
  members?: Ref<Doc>[]
  pinned?: boolean
}

const CHANNEL_CLASS = 'chunter:class:Channel' as Ref<Class<Channel>>
const CHAT_MESSAGE_CLASS = 'chunter:class:ChatMessage' as Ref<Class<ChatMessage>>
const DM_CLASS = 'chunter:class:DirectMessage' as Ref<Class<DirectMessage>>

async function resolveChannel(client: PlatformClient, ref: string): Promise<Channel> {
  const account = await client.getAccount()
  const idx = await buildIndex<Channel>(client, CHANNEL_CLASS, account.uuid)
  const hit = idx.get(ref)
  if (hit) {
    const doc = await client.findOne(CHANNEL_CLASS, { _id: hit as Ref<Channel> })
    if (doc) return doc
  }
  // try by name
  const all = (await client.findAll(CHANNEL_CLASS, {})) as Channel[]
  const byName = all.find((c) => c.name === ref)
  if (byName) return byName
  throw new CliError(ExitCode.NotFound, `channel ${ref} not found`)
}

async function resolvePersonId(emailOrName: string, client: PlatformClient): Promise<Ref<Doc>> {
  // The account-client's findPersonBySocialKey returns Forbidden on this
  // selfhost, so we go straight to the workspace-local Person scan.
  const persons = (await client.findAll('contact:class:Person' as Ref<Class<Doc>>, {}, { limit: 200 })) as Array<Doc & { name?: string }>
  const lower = emailOrName.toLowerCase()
  const hit = persons.find((p) => {
    const n = (p.name ?? '').toLowerCase()
    return n === lower || n.startsWith(lower) || n.includes(lower)
  })
  if (!hit) throw new CliError(ExitCode.NotFound, `no person matching ${emailOrName}`)
  return hit._id
}

// ---- list / get / create / update / delete ----

export async function listChannels(opts: {
  archived?: boolean
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
} = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.archived !== undefined) query.archived = opts.archived
    const docs = (await withSpinner('Loading channels…', () =>
      client.findAll(CHANNEL_CLASS, query as any), opts
    )) as Channel[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.channel())
  } finally { await client.close() }
}

export async function getChannel(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(channel); return }
    table([channel as unknown as Record<string, unknown>], COLUMNS.channel())
  } finally { await client.close() }
}

export async function createChannel(opts: {
  name?: string
  description?: string
  topic?: string
  private?: boolean
  autoJoin?: boolean
  members?: string[]
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.name) throw new CliError(ExitCode.Validation, 'missing --name')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const memberIds: Ref<Doc>[] = []
    if (opts.members && opts.members.length > 0) {
      for (const m of opts.members) memberIds.push(await resolvePersonId(m, client))
    }
    memberIds.unshift(account.uuid as Ref<Doc>)
    const data: Record<string, unknown> = {
      name: opts.name,
      description: opts.description ?? '',
      topic: opts.topic ?? '',
      private: opts.private ?? false,
      archived: false,
      members: memberIds,
      owners: [account.uuid],
      autoJoin: opts.autoJoin ?? false,
      autoJoinForRoles: []
    }
    if (opts.dryRun) {
      console.log('would create channel:')
      console.log(JSON.stringify({ _class: CHANNEL_CLASS, space: 'core:space:Space', data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating channel…',
      () => client.createDoc(CHANNEL_CLASS, 'core:space:Space' as Ref<Space>, data as any),
      opts
    )
    invalidateIndex(account.uuid, CHANNEL_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created channel: ${opts.name} (${id})`)
  } finally { await client.close() }
}

export async function updateChannel(ref: string, opts: {
  name?: string
  description?: string
  topic?: string
  private?: boolean
  autoJoin?: boolean
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    const ops: Record<string, unknown> = {}
    if (opts.name) ops.name = opts.name
    if (opts.description !== undefined) ops.description = opts.description
    if (opts.topic !== undefined) ops.topic = opts.topic
    if (opts.private !== undefined) ops.private = opts.private
    if (opts.autoJoin !== undefined) ops.autoJoin = opts.autoJoin
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --name/--description/--topic/--private/--auto-join')
    if (opts.dryRun) {
      console.log(`would update channel ${channel._id}:`)
      console.log(JSON.stringify({ _class: CHANNEL_CLASS, objectId: channel._id, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CHANNEL_CLASS, channel.space, channel._id, ops as any),
      opts
    )
    console.log(`updated channel: ${channel._id}`)
  } finally { await client.close() }
}

export async function deleteChannels(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channels: Channel[] = []
    for (const r of refs) {
      try {
        channels.push(await resolveChannel(client, r))
      } catch (e) {
        if (e instanceof CliError) throw e
        throw new CliError(ExitCode.NotFound, `channel ${r} not found`)
      }
    }
    if (!opts.yes && channels.length > 1) {
      console.error(`warning: deleting ${channels.length} channels; pass --yes to confirm`)
    }
    let deleted = 0, skipped = 0
    for (const ch of channels) {
      try {
        await client.removeDoc(CHANNEL_CLASS, ch.space, ch._id as Ref<Channel>)
        deleted++
      } catch (e) {
        console.error(`failed to delete ${ch._id}: ${(e as Error).message}`)
        skipped++
      }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

// ---- archive / unarchive ----

export async function archiveChannel(ref: string, opts: { value?: boolean; dryRun?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  await updateChannel(ref, { private: undefined, ...opts, ...(opts as { json?: boolean; ci?: boolean }) } as { json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string })
  // We use updateChannel but need a 'archived' field; the user passes --archived true|false via a separate option.
  const archive = opts.value ?? true
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    if (opts.dryRun) {
      console.log(`would set archived=${archive} on ${channel._id}`)
      return
    }
    await withSpinner('Archiving…', () => client.updateDoc(CHANNEL_CLASS, channel.space, channel._id, { archived: archive } as any))
    console.log(`channel ${channel._id} archived=${archive}`)
  } finally { await client.close() }
}

// ---- members ----

export async function listChannelMembers(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    const members = channel.members ?? []
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(members); return }
    table(members.map((m) => ({ uuid: m })) as unknown as Record<string, unknown>[], [
      { key: 'uuid', header: 'UUID' }
    ])
  } finally { await client.close() }
}

export async function joinChannel(ref: string, opts: { member?: string; dryRun?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const channel = await resolveChannel(client, ref)
    const memberId = opts.member ? await resolvePersonId(opts.member, client) : (account.uuid as Ref<Doc>)
    if (channel.members?.includes(memberId)) {
      console.log('(already a member)')
      return
    }
    if (opts.dryRun) {
      console.log(`would join ${memberId} to channel ${channel._id}`)
      return
    }
    await withSpinner(
      'Joining…',
      () => client.updateDoc(CHANNEL_CLASS, channel.space, channel._id, {
        $push: { members: { $each: [memberId], $position: 0 } }
      } as any)
    )
    console.log(`joined: ${memberId} → ${channel._id}`)
  } finally { await client.close() }
}

export async function leaveChannel(ref: string, opts: { member?: string; dryRun?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const channel = await resolveChannel(client, ref)
    const memberId = opts.member ? await resolvePersonId(opts.member, client) : (account.uuid as Ref<Doc>)
    if (!channel.members?.includes(memberId)) {
      console.log('(not a member)')
      return
    }
    if (opts.dryRun) {
      console.log(`would remove ${memberId} from channel ${channel._id}`)
      return
    }
    await withSpinner(
      'Leaving…',
      () => client.updateDoc(CHANNEL_CLASS, channel.space, channel._id, {
        $pull: { members: { $in: [memberId] } }
      } as any)
    )
    console.log(`removed: ${memberId} from ${channel._id}`)
  } finally { await client.close() }
}

export async function addChannelMembers(ref: string, members: string[], opts: { dryRun?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    const ids: Ref<Doc>[] = []
    for (const m of members) ids.push(await resolvePersonId(m, client))
    if (opts.dryRun) {
      console.log(`would add ${ids.length} members to channel ${channel._id}`)
      return
    }
    await withSpinner(
      'Adding members…',
      () => client.updateDoc(CHANNEL_CLASS, channel.space, channel._id, {
        $push: { members: { $each: ids, $position: 0 } }
      } as any)
    )
    console.log(`added ${ids.length} members to ${channel._id}`)
  } finally { await client.close() }
}

export async function removeChannelMembers(ref: string, members: string[], opts: { dryRun?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    const ids: Ref<Doc>[] = []
    for (const m of members) ids.push(await resolvePersonId(m, client))
    if (opts.dryRun) {
      console.log(`would remove ${ids.length} members from channel ${channel._id}`)
      return
    }
    await withSpinner(
      'Removing members…',
      () => client.updateDoc(CHANNEL_CLASS, channel.space, channel._id, {
        $pull: { members: { $in: ids } }
      } as any)
    )
    console.log(`removed ${ids.length} members from ${channel._id}`)
  } finally { await client.close() }
}

// ---- messages ----

export async function listChannelMessages(ref: string, opts: {
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    const messages = (await withSpinner(
      'Loading messages…',
      () => client.findAll(CHAT_MESSAGE_CLASS, {
        attachedTo: channel._id,
        attachedToClass: CHANNEL_CLASS,
        collection: 'messages'
      }),
      opts
    )) as ChatMessage[]
    let r = messages
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.channelMessage())
  } finally { await client.close() }
}

export async function sendChannelMessage(ref: string, opts: {
  message?: string
  body?: string
  bodyFile?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const body = await readMessageBody(opts)
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    const data: Record<string, unknown> = {
      message: body
    }
    if (opts.dryRun) {
      console.log('would send channel message:')
      console.log(JSON.stringify({ _class: CHAT_MESSAGE_CLASS, space: channel.space, attachedTo: channel._id, attachedToClass: CHANNEL_CLASS, collection: 'messages', data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Sending…',
      () => client.addCollection(CHAT_MESSAGE_CLASS, channel.space, channel._id, CHANNEL_CLASS, 'messages', data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`sent: ${id}`)
  } finally { await client.close() }
}

export async function updateChannelMessage(ref: string, messageId: string, opts: {
  message?: string
  body?: string
  bodyFile?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const body = await readMessageBody(opts)
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    const msg = await client.findOne(CHAT_MESSAGE_CLASS, { _id: messageId as Ref<ChatMessage> })
    if (!msg) throw new CliError(ExitCode.NotFound, `message ${messageId} not found`)
    const data: Record<string, unknown> = {
      message: body,
      editedOn: Date.now()
    }
    if (opts.dryRun) {
      console.log(`would update message ${messageId}:`)
      console.log(JSON.stringify({ _class: CHAT_MESSAGE_CLASS, space: msg.space, ops: data }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateCollection(
        CHAT_MESSAGE_CLASS,
        msg.space as unknown as Ref<Space>,
        messageId as Ref<ChatMessage>,
        channel._id,
        CHANNEL_CLASS,
        'messages',
        data as any
      )
    )
    console.log(`updated message: ${messageId}`)
  } finally { await client.close() }
}

export async function deleteChannelMessages(ref: string, messageIds: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const channel = await resolveChannel(client, ref)
    if (!opts.yes && messageIds.length > 1) {
      console.error(`warning: deleting ${messageIds.length} messages; pass --yes to confirm`)
    }
    let deleted = 0, skipped = 0
    for (const id of messageIds) {
      const msg = await client.findOne(CHAT_MESSAGE_CLASS, { _id: id as Ref<ChatMessage> })
      if (!msg) { skipped++; continue }
      try {
        await client.removeCollection(
          CHAT_MESSAGE_CLASS,
          msg.space as unknown as Ref<Space>,
          id as Ref<ChatMessage>,
          channel._id,
          CHANNEL_CLASS,
          'messages'
        )
        deleted++
      } catch (e) {
        console.error(`failed: ${id}: ${(e as Error).message}`)
        skipped++
      }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

// ---- threads ----

export async function listThreadReplies(targetId: string, opts: {
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const replies = (await client.findAll(
      'chunter:class:ThreadMessage' as Ref<Class<ChatMessage>>,
      { attachedTo: targetId as Ref<Doc> }
    )) as ChatMessage[]
    let r = replies
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.channelMessage())
  } finally { await client.close() }
}

export async function addThreadReply(targetId: string, opts: {
  message?: string
  body?: string
  bodyFile?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const body = await readMessageBody(opts)
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const parent = await client.findOne(CHAT_MESSAGE_CLASS, { _id: targetId as Ref<ChatMessage> })
    if (!parent) throw new CliError(ExitCode.NotFound, `target message ${targetId} not found`)
    const data: Record<string, unknown> = {
      message: body
    }
    if (opts.dryRun) {
      console.log('would add thread reply:')
      console.log(JSON.stringify({ _class: 'chunter:class:ThreadMessage', space: parent.space, attachedTo: targetId, data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Adding reply…',
      () => client.addCollection(
        'chunter:class:ThreadMessage' as Ref<Class<ChatMessage>>,
        parent.space as unknown as Ref<Space>,
        targetId as Ref<Doc>,
        CHAT_MESSAGE_CLASS,
        'replies',
        data as any
      )
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`added reply: ${id}`)
  } finally { await client.close() }
}

export async function updateThreadReply(replyId: string, opts: {
  message?: string
  body?: string
  bodyFile?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const body = await readMessageBody(opts)
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const reply = await client.findOne('chunter:class:ThreadMessage' as Ref<Class<ChatMessage>>, { _id: replyId as Ref<ChatMessage> })
    if (!reply) throw new CliError(ExitCode.NotFound, `thread reply ${replyId} not found`)
    const data: Record<string, unknown> = { message: body, editedOn: Date.now() }
    if (opts.dryRun) {
      console.log(`would update thread reply ${replyId}:`)
      console.log(JSON.stringify({ _class: 'chunter:class:ThreadMessage', space: reply.space, ops: data }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateCollection(
        'chunter:class:ThreadMessage' as Ref<Class<ChatMessage>>,
        reply.space as unknown as Ref<Space>,
        replyId as Ref<ChatMessage>,
        (reply as ChatMessage).attachedTo,
        CHAT_MESSAGE_CLASS,
        'replies',
        data as any
      )
    )
    console.log(`updated reply: ${replyId}`)
  } finally { await client.close() }
}

export async function deleteThreadReplies(replyIds: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    if (!opts.yes && replyIds.length > 1) {
      console.error(`warning: deleting ${replyIds.length} replies; pass --yes to confirm`)
    }
    let deleted = 0, skipped = 0
    for (const id of replyIds) {
      const reply = await client.findOne('chunter:class:ThreadMessage' as Ref<Class<ChatMessage>>, { _id: id as Ref<ChatMessage> })
      if (!reply) { skipped++; continue }
      try {
        await client.removeCollection(
          'chunter:class:ThreadMessage' as Ref<Class<ChatMessage>>,
          reply.space as unknown as Ref<Space>,
          id as Ref<ChatMessage>,
          (reply as ChatMessage).attachedTo,
          CHAT_MESSAGE_CLASS,
          'replies'
        )
        deleted++
      } catch (e) {
        console.error(`failed: ${id}: ${(e as Error).message}`)
        skipped++
      }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

// ---- DMs ----

export async function listDms(opts: {
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
} = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const dms = (await withSpinner('Loading DMs…', () =>
      client.findAll(DM_CLASS, {}), opts
    )) as DirectMessage[]
    let r = dms
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME' },
      { key: 'description', header: 'DESCRIPTION' },
      { key: '_id', header: '_ID', format: (r) => String((r as DirectMessage)._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function createDm(opts: {
  person?: string
  members?: string[]
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.person && (!opts.members || opts.members.length === 0)) {
    throw new CliError(ExitCode.Validation, 'missing --person or --members')
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const memberIds: Ref<Doc>[] = []
    if (opts.person) memberIds.push(await resolvePersonId(opts.person, client))
    if (opts.members) {
      for (const m of opts.members) memberIds.push(await resolvePersonId(m, client))
    }
    memberIds.unshift(account.uuid as Ref<Doc>)
    const data: Record<string, unknown> = {
      name: '',
      description: '',
      members: memberIds,
      pinned: false
    }
    if (opts.dryRun) {
      console.log('would create DM:')
      console.log(JSON.stringify({ _class: DM_CLASS, space: 'core:space:Space', data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating DM…',
      () => client.createDoc(DM_CLASS, 'core:space:Space' as Ref<Space>, data as any),
      opts
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created DM: ${id}`)
  } finally { await client.close() }
}

export async function listDmMessages(dmRef: string, opts: {
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const dmId = await resolveRef(dmRef, {
      client,
      classId: DM_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const messages = (await withSpinner(
      'Loading DM messages…',
      () => client.findAll(CHAT_MESSAGE_CLASS, {
        attachedTo: dmId as Ref<Doc>,
        attachedToClass: DM_CLASS,
        collection: 'messages'
      }),
      opts
    )) as ChatMessage[]
    let r = messages
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.channelMessage())
  } finally { await client.close() }
}

export async function sendDmMessage(dmRef: string, opts: {
  message?: string
  body?: string
  bodyFile?: string
  person?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const body = await readMessageBody(opts)
  // --person <email>: resolve or auto-create DM, then send.
  if (opts.person !== undefined && opts.person !== '') {
    const { createDm } = await import('./channel.js')
    const dmId = await createDm({ person: opts.person, workspace: opts.workspace, url: opts.url })
    dmRef = String(dmId)
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const dmId = await resolveRef(dmRef, {
      client,
      classId: DM_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const dm = await client.findOne(DM_CLASS, { _id: dmId as Ref<DirectMessage> })
    if (!dm) throw new CliError(ExitCode.NotFound, `DM ${dmRef} not found`)
    const data: Record<string, unknown> = { message: body }
    if (opts.dryRun) {
      console.log('would send DM:')
      console.log(JSON.stringify({ _class: CHAT_MESSAGE_CLASS, space: dm.space, attachedTo: dmId, attachedToClass: DM_CLASS, collection: 'messages', data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Sending…',
      () => client.addCollection(
        CHAT_MESSAGE_CLASS,
        dm.space as unknown as Ref<Space>,
        dmId as Ref<Doc>,
        DM_CLASS,
        'messages',
        data as any
      )
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`sent: ${id}`)
  } finally { await client.close() }
}

// ---- helpers ----

async function readMessageBody(opts: { message?: string; body?: string; bodyFile?: string }): Promise<string> {
  if (opts.body && opts.bodyFile) {
    throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  }
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    return (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  if (opts.body) return opts.body
  if (opts.message) return opts.message
  throw new CliError(ExitCode.Validation, 'missing --body or --body-file')
}
