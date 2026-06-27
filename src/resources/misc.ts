import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli, connectAccountCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs } from '../transport/ref-resolver.js'
import { shouldJson, json, table } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'

function parseDate(value: string, field: string): number {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) throw new CliError(ExitCode.Validation, `invalid ${field}: ${value} (expected ISO date)`)
  return t
}

async function resolveAssignee(email: string): Promise<Ref<Doc>> {
  const ac = await connectAccountCli()
  const personId = await ac.findPersonBySocialKey(email)
  if (!personId) throw new CliError(ExitCode.NotFound, `no person with email ${email}`)
  return personId as Ref<Doc>
}

type Card = Doc & { title: string; identifier?: string; description?: string; status: Ref<Doc>; rank: string }

async function firstBoardSpace(client: PlatformClient): Promise<Ref<Doc>> {
  const spaces = (await client.findAll('board:class:Board' as Ref<Class<Doc>>, {})) as Doc[]
  if (spaces.length === 0) throw new CliError(ExitCode.NotFound, 'no board spaces')
  return spaces[0]._id
}

export async function listCards(opts: { space?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.space) query.space = opts.space
    const cards = (await withSpinner('Loading workspace model…', () =>
      client.findAll(CLASS.Card as Ref<Class<Card>>, query as any), opts
    )) as unknown as Card[]
    let docs = cards
    if (opts.offset && opts.offset > 0) docs = docs.slice(opts.offset)
    if (opts.limit) docs = docs.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE' },
      { key: 'status', header: 'STATUS' },
      { key: '_id', header: '_ID', format: (r) => String((r as Card)._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function getCard(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Card as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Card as Ref<Class<Card>>, { _id: id as Ref<Card> })
    if (!doc) throw new CliError(ExitCode.NotFound, `card ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    console.log(`${doc.title}\n${JSON.stringify(doc, null, 2)}`)
  } finally { await client.close() }
}

export async function createCard(opts: {
  space?: string; title?: string; body?: string; bodyFile?: string; description?: string; rank?: string;
  minimal?: boolean; dryRun?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (opts.body && opts.bodyFile) throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  let body = opts.body
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    body = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  const data: Record<string, unknown> = {
    title: opts.title,
    description: opts.description ?? '',
    rank: opts.rank ?? 'awaiting',
    status: 'backlog-state' as Ref<Doc>
  }
  if (body) data.description = new MarkupContent(body, 'markdown')
  if (opts.dryRun) {
    console.log('would create card:')
    console.log(JSON.stringify({ _class: CLASS.Card, space: opts.space ?? '<first-board>', data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const space = (opts.space as Ref<Space>) ?? (await firstBoardSpace(client))
    const id = await withSpinner('Creating card…', () =>
      client.createDoc(CLASS.Card as Ref<Class<Card>>, space, data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created card: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function deleteCards(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, { client, classId: CLASS.Card as Ref<Class<Doc>>, workspaceId: account.uuid })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} cards; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const card = await client.findOne(CLASS.Card as Ref<Class<Card>>, { _id: id as Ref<Card> })
      if (!card) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Card as Ref<Class<Card>>, card.space as unknown as Ref<Space>, card._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

type Task = Doc & { title: string; description?: string; status: Ref<Doc>; dueDate?: number | null; assignee?: Ref<Doc> | null }

export async function listActions(opts: { assignee?: string; status?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.status) query.status = opts.status
    if (opts.assignee) query.assignee = opts.assignee
    const docs = (await withSpinner('Loading…', () =>
      client.findAll(CLASS.Task as Ref<Class<Task>>, query as any), opts
    )) as unknown as Task[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE' },
      { key: 'status', header: 'STATUS' },
      { key: 'assignee', header: 'ASSIGNEE' },
      { key: '_id', header: '_ID', format: (r) => String((r as Task)._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function createAction(opts: {
  title?: string; description?: string; due?: string; assignee?: string;
  dryRun?: boolean; minimal?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  const dueDate = opts.due ? parseDate(opts.due, '--due') : null
  const assignee = opts.assignee ? await resolveAssignee(opts.assignee) : null
  const data: Record<string, unknown> = {
    title: opts.title,
    description: opts.description ?? '',
    status: 'todo-state' as Ref<Doc>,
    kind: 'task' as Ref<Doc>,
    assignee,
    dueDate
  }
  if (opts.minimal) delete data.kind

  if (opts.dryRun) {
    console.log('would create action:')
    console.log(JSON.stringify({ _class: CLASS.Task, data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner('Creating action…', () =>
      client.createDoc(CLASS.Task as Ref<Class<Task>>, 'task:space:MyTasks' as Ref<Space>, data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created action: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function deleteActions(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, { client, classId: CLASS.Task as Ref<Class<Doc>>, workspaceId: account.uuid })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} actions; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const t = await client.findOne(CLASS.Task as Ref<Class<Task>>, { _id: id as Ref<Task> })
      if (!t) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Task as Ref<Class<Task>>, t.space as unknown as Ref<Space>, t._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

type Document = Doc & { title: string; content?: string; parent?: Ref<Doc> }

export async function listDocuments(opts: { limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner('Loading…', () =>
      client.findAll(CLASS.Document as Ref<Class<Document>>, {}), opts
    )) as unknown as Document[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE' },
      { key: '_id', header: '_ID', format: (r) => String((r as Document)._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function createDocument(opts: {
  title?: string; body?: string; bodyFile?: string; parent?: string;
  dryRun?: boolean; minimal?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (opts.body && opts.bodyFile) throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  let body = opts.body
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    body = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  const data: Record<string, unknown> = {
    title: opts.title,
    content: body ? new MarkupContent(body, 'markdown') : ''
  }
  if (opts.parent) data.parent = opts.parent as Ref<Doc>

  if (opts.dryRun) {
    console.log('would create document:')
    console.log(JSON.stringify({ _class: CLASS.Document, data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner('Creating document…', () =>
      client.createDoc(CLASS.Document as Ref<Class<Document>>, 'document:space:Document' as Ref<Space>, data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created document: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function deleteDocuments(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, { client, classId: CLASS.Document as Ref<Class<Doc>>, workspaceId: account.uuid })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} documents; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const d = await client.findOne(CLASS.Document as Ref<Class<Document>>, { _id: id as Ref<Document> })
      if (!d) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Document as Ref<Class<Document>>, d.space as unknown as Ref<Space>, d._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

type CalendarEvent = Doc & { title: string; description?: string; startDate: number; dueDate: number; allDay: boolean; participants?: string[]; location?: string }

export async function listEvents(opts: { start?: string; end?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.start) query.startDate = { $gte: parseDate(opts.start, '--start') }
    if (opts.end) query.dueDate = { $lte: parseDate(opts.end, '--end') }
    const docs = (await withSpinner('Loading…', () =>
      client.findAll(CLASS.Event as Ref<Class<CalendarEvent>>, query as any), opts
    )) as unknown as CalendarEvent[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE' },
      { key: 'startDate', header: 'START', format: (r) => new Date((r as CalendarEvent).startDate).toISOString().slice(0, 16) },
      { key: 'dueDate', header: 'END', format: (r) => new Date((r as CalendarEvent).dueDate).toISOString().slice(0, 16) },
      { key: 'location', header: 'LOCATION' }
    ])
  } finally { await client.close() }
}

export async function createEvent(opts: {
  title?: string; start?: string; end?: string; allDay?: boolean; location?: string; attendee?: string;
  description?: string; body?: string; dryRun?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (!opts.start) throw new CliError(ExitCode.Validation, 'missing --start (ISO)')
  if (!opts.end) throw new CliError(ExitCode.Validation, 'missing --end (ISO)')
  const data: Record<string, unknown> = {
    title: opts.title,
    description: opts.description ?? opts.body ?? '',
    startDate: parseDate(opts.start, '--start'),
    dueDate: parseDate(opts.end, '--end'),
    allDay: !!opts.allDay,
    participants: opts.attendee ? [opts.attendee] : [],
    location: opts.location ?? ''
  }
  if (opts.dryRun) {
    console.log('would create event:')
    console.log(JSON.stringify({ _class: CLASS.Event, data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner('Creating event…', () =>
      client.createDoc(CLASS.Event as Ref<Class<CalendarEvent>>, 'calendar:space:Personal' as Ref<Space>, data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created event: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function deleteEvents(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, { client, classId: CLASS.Event as Ref<Class<Doc>>, workspaceId: account.uuid })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} events; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const e = await client.findOne(CLASS.Event as Ref<Class<CalendarEvent>>, { _id: id as Ref<CalendarEvent> })
      if (!e) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Event as Ref<Class<CalendarEvent>>, e.space as unknown as Ref<Space>, e._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}