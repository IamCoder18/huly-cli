import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv, header, COLUMNS, C, withTimeout, success, updated, relTime, isoDate, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'
import { connectAccountCli } from '../transport/sdk.js'

type ToDo = Doc & {
  title: string
  description?: string
  user: Ref<Doc>
  attachedTo?: Ref<Doc>
  attachedToClass?: Ref<Class<Doc>>
  collection?: string
  priority?: string
  visibility?: string
  dueDate?: number | null
  doneOn?: number | null
  rank?: string
  [k: string]: unknown
}

type WorkSlot = Doc & {
  attachedTo: Ref<ToDo>
  attachedToClass: Ref<Class<ToDo>>
  title?: string
  date: number
  dueDate: number
  allDay?: boolean
  calendar?: Ref<Doc>
  collection?: string
  [k: string]: unknown
}

const TODO_CLASS = 'time:class:ToDo' as Ref<Class<ToDo>>
const TODO_SPACE = 'time:space:ToDos' as Ref<Space>
const WORKSLOT_CLASS = 'time:class:WorkSlot' as Ref<Class<WorkSlot>>
const CALENDAR_SPACE = 'calendar:space:Calendar' as Ref<Space>

const TODO_PRIORITIES = new Set(['High', 'Medium', 'Low', 'NoPriority', 'Urgent'])
const TODO_VISIBILITIES = new Set(['public', 'busy', 'private'])

function parseDate(value: string, field: string): number {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) throw new CliError(ExitCode.Validation, `invalid ${field}: ${value} (expected ISO date)`)
  return t
}

async function readBodyText(opts: { body?: string; bodyFile?: string }): Promise<string | undefined> {
  if (opts.body && opts.bodyFile) {
    throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  }
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    return (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  return opts.body
}

async function resolveEmployeeId(client: Awaited<ReturnType<typeof connectCli>>, email?: string): Promise<Ref<Doc>> {
  if (email) {
    // findPersonBySocialKey returns Forbidden on this selfhost; fall back to
    // a workspace-local Person scan (by email or by name).
    const persons = (await client.findAll('contact:class:Person' as Ref<Class<Doc>>, {}, { limit: 200 })) as Array<Doc & { name?: string }>
    const lower = email.toLowerCase()
    const hit = persons.find((p) => p.name?.toLowerCase() === lower || (p.name ?? '').toLowerCase().includes(lower))
    if (!hit) throw new CliError(ExitCode.NotFound, `no person matching ${email} in this workspace`)
    return hit._id
  }
  // Default: current user
  const account = await client.getAccount()
  return account.uuid as Ref<Doc>
}

// ---- list ----

export interface ListActionsOpts {
  owner?: string
  issue?: string
  title?: string
  dueFrom?: string
  dueTo?: string
  priority?: string
  visibility?: string
  completed?: boolean | 'all'
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listActions(opts: ListActionsOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.owner) query.user = await resolveEmployeeId(client, opts.owner)
    if (opts.priority) {
      if (!TODO_PRIORITIES.has(opts.priority)) {
        throw new CliError(ExitCode.Validation, `invalid --priority: ${opts.priority}`, `expected one of ${[...TODO_PRIORITIES].join(' | ')}`)
      }
      query.priority = opts.priority
    }
    if (opts.visibility) {
      if (!TODO_VISIBILITIES.has(opts.visibility)) {
        throw new CliError(ExitCode.Validation, `invalid --visibility: ${opts.visibility}`, `expected one of ${[...TODO_VISIBILITIES].join(' | ')}`)
      }
      query.visibility = opts.visibility
    }
    if (opts.title) query.title = { $regex: opts.title, $options: 'i' }
    if (opts.dueFrom || opts.dueTo) {
      const range: Record<string, number> = {}
      if (opts.dueFrom) range.$gte = parseDate(opts.dueFrom, '--due-from')
      if (opts.dueTo) range.$lte = parseDate(opts.dueTo, '--due-to')
      query.dueDate = range
    }
    if (opts.issue) {
      const account = await client.getAccount()
      const issueId = await resolveRef(opts.issue, {
        client,
        classId: CLASS.Issue as Ref<Class<Doc>>,
        workspaceId: account.uuid,
        defaultProjectIdentifier: readEnv().project
      })
      query.attachedTo = issueId
      query.attachedToClass = CLASS.Issue
    }
    if (opts.completed === true) query.doneOn = { $ne: null }
    else if (opts.completed === false) query.doneOn = null

    const docs = (await withSpinner('Loading actions…', () =>
      client.findAll(TODO_CLASS, query as any), opts
    )) as unknown as ToDo[]

    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)

    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE', format: (r) => String((r as ToDo).title ?? '').slice(0, 50) },
      { key: 'priority', header: 'PRIORITY' },
      { key: 'visibility', header: 'VIS' },
      { key: 'dueDate', header: 'DUE', format: (r) => (r as ToDo).dueDate ? new Date(Number((r as ToDo).dueDate)).toISOString().slice(0, 10) : '—' },
      { key: 'doneOn', header: 'DONE', format: (r) => (r as ToDo).doneOn ? new Date(Number((r as ToDo).doneOn)).toISOString().slice(0, 10) : '—' },
      { key: '_id', header: '_ID', format: (r) => String((r as ToDo)._id).slice(-12) }
    ], { count: true, title: 'todos' })
  } finally { await client.close() }
}

// ---- get ----

export interface GetActionOpts {
  json?: boolean
  ci?: boolean
  markdown?: boolean
  workspace?: string
  url?: string
}

export async function getAction(ref: string, opts: GetActionOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!doc) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    if (opts.markdown && doc.description) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(TODO_CLASS as Ref<Class<Doc>>, doc._id, 'description', doc.description as any, 'markdown'),
          5000,
          '(body fetch timed out)'
        )
        console.log(body)
        return
      } catch { console.log(String(doc.description)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }

    header(`Action — ${doc.title ?? '(untitled)'}`, { subtitle: `created ${relTime(doc.createdOn as number | null)}` })
    const rows: Array<[string, string]> = [
      ['ID', C.emphasis(String(doc._id))],
      ['Title', String(doc.title ?? '—')],
      ['State', doc.doneOn != null ? C.ok('done') : C.muted('open')],
      ['Priority', String(doc.priority ?? '—')],
      ['Due', doc.dueDate != null ? isoDate(doc.dueDate) : C.muted('none')],
      ['Owner', String(doc.assignedTo ?? doc.user ?? '—')],
      ['Created by', String(doc.createdBy ?? '—')],
      ['Created', doc.createdOn != null ? `${isoDate(doc.createdOn)} (${relTime(doc.createdOn as number | null)})` : C.muted('—')],
      ['Modified', doc.modifiedOn != null ? `${isoDate(doc.modifiedOn)} (${relTime(doc.modifiedOn as number | null)})` : C.muted('—')],
      ['_class', C.id(String(doc._class))]
    ]
    if (doc.doneOn != null) rows.push(['Done', `${isoDate(doc.doneOn)} (${relTime(doc.doneOn as number | null)})`])
    kv(rows)
    if (doc.description && doc.description !== '' && !opts.markdown) {
      console.log()
      console.log(C.emphasis('Description'))
      console.log(C.muted('─'.repeat(20)))
      const desc = String(doc.description)
      console.log(desc.length > 500 ? desc.slice(0, 500) + '…' : desc)
    }
  } finally { await client.close() }
}

// ---- create ----

export interface CreateActionOpts {
  title?: string
  description?: string
  body?: string
  bodyFile?: string
  due?: string
  priority?: string
  visibility?: string
  owner?: string
  attachedTo?: string
  attachedToClass?: string
  dryRun?: boolean
  minimal?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function createAction(opts: CreateActionOpts): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  const body = await readBodyText(opts)
  const description = body
    ? body
    : (opts.description ? opts.description : '')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const user = await resolveEmployeeId(client, opts.owner)
    const priority = opts.priority && TODO_PRIORITIES.has(opts.priority) ? opts.priority : 'NoPriority'
    const visibility = opts.visibility && TODO_VISIBILITIES.has(opts.visibility) ? opts.visibility : 'public'

    let attachedTo: Ref<Doc>
    let attachedToClass: Ref<Class<Doc>>
    if (opts.attachedTo && opts.attachedToClass) {
      attachedTo = await resolveRef(opts.attachedTo, {
        client,
        classId: opts.attachedToClass as Ref<Class<Doc>>,
        workspaceId: account.uuid
      })
      attachedToClass = opts.attachedToClass as Ref<Class<Doc>>
    } else {
      attachedTo = user
      attachedToClass = 'contact:class:Person' as Ref<Class<Doc>>
    }

    const data: Record<string, unknown> = {
      title: opts.title,
      description,
      user,
      attachedTo,
      attachedToClass,
      priority,
      visibility,
      doneOn: null,
      rank: '0|aaaaa:'
    }
    if (opts.due) data.dueDate = parseDate(opts.due, '--due')
    else data.dueDate = null

    if (opts.dryRun) {
      console.log('would create action:')
      console.log(JSON.stringify({ _class: TODO_CLASS, space: TODO_SPACE, data }, null, 2))
      return
    }

    const id = await withSpinner('Creating action…', () =>
      client.addCollection(TODO_CLASS, TODO_SPACE, attachedTo, attachedToClass, 'todos', data as any)
    )
    invalidateIndex(account.uuid, TODO_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success(`created action`, opts.title, id)
  } finally { await client.close() }
}

// ---- update ----

export interface UpdateActionOpts {
  title?: string
  description?: string
  body?: string
  due?: string
  priority?: string
  visibility?: string
  owner?: string
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function updateAction(ref: string, opts: UpdateActionOpts): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)

    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.body) ops.description = opts.body
    else if (opts.description !== undefined) ops.description = opts.description ? opts.description : ''
    if (opts.due) ops.dueDate = parseDate(opts.due, '--due')
    if (opts.priority) {
      if (!TODO_PRIORITIES.has(opts.priority)) {
        throw new CliError(ExitCode.Validation, `invalid --priority: ${opts.priority}`)
      }
      ops.priority = opts.priority
    }
    if (opts.visibility) {
      if (!TODO_VISIBILITIES.has(opts.visibility)) {
        throw new CliError(ExitCode.Validation, `invalid --visibility: ${opts.visibility}`)
      }
      ops.visibility = opts.visibility
    }
    if (opts.owner) ops.user = await resolveEmployeeId(client, opts.owner)

    if (Object.keys(ops).length === 0) {
      throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --title, --description, --due, --priority, --visibility, or --owner')
    }
    if (opts.dryRun) {
      console.log(`would update action ${id}:`)
      console.log(JSON.stringify({ _class: TODO_CLASS, objectId: id, ops }, null, 2))
      return
    }

    // ToDo is an AttachedDoc — update via updateCollection on the parent's
    // 'todos' collection.
    await withSpinner(
      'Updating…',
      () => client.updateCollection(
        TODO_CLASS,
        todo.space as unknown as Ref<Space>,
        id as Ref<ToDo>,
        todo.attachedTo as Ref<Doc>,
        (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
        todo.collection ?? 'todos',
        ops as any
      ),
      opts
    )
    updated(`updated action`, id)
  } finally { await client.close() }
}

// ---- complete / reopen ----

export async function completeAction(ref: string, opts: { dryRun?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  return updateAction(ref, { ...opts } as UpdateActionOpts)
    .then(() => Promise.resolve())
    .catch(() => {
      // not used — explicit complete below
    })
  // Use direct setDoneOn semantics:
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    if (opts.dryRun) {
      console.log(`would complete action ${id} (set doneOn=now)`)
      return
    }
    await withSpinner(
      'Completing…',
      () => client.updateCollection(
        TODO_CLASS,
        todo.space as unknown as Ref<Space>,
        id as Ref<ToDo>,
        todo.attachedTo as Ref<Doc>,
        (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
        todo.collection ?? 'todos',
        { doneOn: Date.now() } as any
      ),
      opts
    )
    console.log(`completed action: ${id}`)
  } finally { await client.close() }
}

export async function reopenAction(ref: string, opts: { dryRun?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    if (opts.dryRun) {
      console.log(`would reopen action ${id} (clear doneOn)`)
      return
    }
    await withSpinner(
      'Reopening…',
      () => client.updateCollection(
        TODO_CLASS,
        todo.space as unknown as Ref<Space>,
        id as Ref<ToDo>,
        todo.attachedTo as Ref<Doc>,
        (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
        todo.collection ?? 'todos',
        { doneOn: null } as any
      ),
      opts
    )
    console.log(`reopened action: ${id}`)
  } finally { await client.close() }
}

// ---- delete ----

export async function deleteActions(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${refs.length} actions; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
      if (!todo) { skipped++; continue }
      try {
        await client.removeCollection(
          TODO_CLASS,
          todo.space as unknown as Ref<Space>,
          id as Ref<ToDo>,
          todo.attachedTo as Ref<Doc>,
          (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
          todo.collection ?? 'todos'
        )
        deleted++
      } catch (e) {
        console.error(`failed to delete ${id}: ${(e as Error).message}`)
        skipped++
      }
    }
    bulkRemoved(deleted, skipped)
  } finally { await client.close() }
}

// ---- schedule (WorkSlot) / unschedule ----

export interface ScheduleActionOpts {
  start?: string
  duration?: number
  allDay?: boolean
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}

export async function scheduleAction(ref: string, opts: ScheduleActionOpts): Promise<void> {
  if (!opts.start) throw new CliError(ExitCode.Validation, 'missing --start (ISO)')
  if (!opts.duration) throw new CliError(ExitCode.Validation, 'missing --duration <minutes>')

  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const todoId = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const todo = await client.findOne(TODO_CLASS, { _id: todoId as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    const startMs = parseDate(opts.start, '--start')
    const dueMs = startMs + opts.duration * 60 * 1000
    const data: Record<string, unknown> = {
      title: todo.title,
      date: startMs,
      dueDate: dueMs,
      allDay: !!opts.allDay,
      calendar: todo.user,
      eventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      access: 'owner',
      visibility: todo.visibility ?? 'public',
      blockTime: !opts.allDay,
      user: account.primarySocialId
    }
    if (opts.dryRun) {
      console.log('would create work-slot:')
      console.log(JSON.stringify({ _class: WORKSLOT_CLASS, space: CALENDAR_SPACE, attachedTo: todoId, attachedToClass: TODO_CLASS, collection: 'workslots', data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Scheduling…',
      () => client.addCollection(
        WORKSLOT_CLASS,
        CALENDAR_SPACE,
        todoId as Ref<Doc>,
        TODO_CLASS,
        'workslots',
        data as any
      ),
      opts
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, attachedTo: todoId, ...data }); return }
    console.log(`scheduled: ${id}`)
  } finally { await client.close() }
}

export async function unscheduleAction(ref: string, opts: { slotId?: string; yes?: boolean; dryRun?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const todoId = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const todo = await client.findOne(TODO_CLASS, { _id: todoId as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)

    let slots: WorkSlot[]
    if (opts.slotId) {
      const s = await client.findOne(WORKSLOT_CLASS, { _id: opts.slotId as Ref<WorkSlot> })
      slots = s ? [s] : []
    } else {
      slots = (await client.findAll(WORKSLOT_CLASS, { attachedTo: todoId as Ref<Doc> })) as WorkSlot[]
    }
    if (slots.length === 0) {
      console.log('(no work-slots attached)')
      return
    }
    if (!opts.yes && slots.length > 1) {
      console.error(`warning: removing ${slots.length} work-slots; pass --yes to confirm`)
    }
    let removed = 0, skipped = 0
    for (const s of slots) {
      if (opts.dryRun) {
        console.log(`would unschedule ${s._id}`)
        continue
      }
      try {
        await client.removeCollection(
          WORKSLOT_CLASS,
          s.space as unknown as Ref<Space>,
          s._id as Ref<Doc>,
          todoId as Ref<Doc>,
          TODO_CLASS,
          s.collection ?? 'workslots'
        )
        removed++
      } catch (e) {
        console.error(`failed to remove ${s._id}: ${(e as Error).message}`)
        skipped++
      }
    }
    console.log(`unscheduled: ${removed}, skipped: ${skipped}`)
  } finally { await client.close() }
}
