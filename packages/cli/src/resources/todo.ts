import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import {
  shouldJson,
  json,
  table,
  kv,
  header,
  C,
  withTimeout,
  success,
  updated,
  relTime,
  isoDate,
  bulkRemoved,
} from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'
import { resolveEmailToLocalId, type ResolveOpts } from './_helpers.js'

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
const CALENDAR_CLASS = 'calendar:class:Calendar' as Ref<Class<Doc>>
const EXTERNAL_CALENDAR_CLASS = 'calendar:class:ExternalCalendar' as Ref<Class<Doc>>
const PRIMARY_CALENDAR_PREF = 'calendar:class:PrimaryCalendar' as Ref<Class<Doc>>

/**
 * True when the SDK error indicates the queried class doesn't exist in the
 * workspace model (`Hierarchy` throws `Error('domain not found: <class>')`).
 * Used to distinguish "this workspace doesn't model Employee/Person/Calendar"
 * from real network/auth failures, which must surface to the caller.
 */
function isDomainNotFound(err: unknown): boolean {
  // Hierarchy throws `Error('domain not found: <class>')` when the queried
  // class isn't in the workspace model. Match case-insensitively so a
  // future SDK message tweak (casing, translation) doesn't silently break
  // the discriminator.
  return err instanceof Error && /domain not found/i.test(err.message)
}

/**
 * Resolve the user's PersonalCalendar the same way the web UI's
 * `findPrimaryCalendar` / `getPrimaryCalendar` does
 * (plugins/time-resources/src/utils.ts, plugins/calendar/src/utils.ts).
 * Mirrors the platform's selection order:
 *   1. PrimaryCalendar preference's `attachedTo` (the user-picked Calendar).
 *   2. First ExternalCalendar with `default: true` and `hidden: false`.
 *   3. Synthetic `${accountUuid}_calendar` (matches the platform's fallback
 *      so the WorkSlot lands in the same calendar the UI would use).
 *
 * The shared `getPrimaryCalendar` helper from `@hcengineering/calendar`
 * is not reused because the CLI does not depend on that package; the
 * logic is small enough to inline and the platform contract is the source
 * of truth.
 */
async function resolvePrimaryCalendar(
  client: Awaited<ReturnType<typeof connectCli>>,
  primarySocialId: string,
  accountUuid: string,
): Promise<Ref<Doc>> {
  let calendars: Array<
    Doc & {
      _id: Ref<Doc>
      _class?: Ref<Class<Doc>>
      user?: string
      hidden?: boolean
      access?: string
      default?: boolean
    }
  >
  try {
    calendars = (await client.findAll(CALENDAR_CLASS, {
      user: primarySocialId,
      hidden: false,
      access: { $in: ['owner', 'writer'] },
    })) as typeof calendars
  } catch (err) {
    // "domain not found" means this workspace doesn't model Calendar — fall
    // through to the synthetic default so the slot still lands somewhere
    // visible. Any other error (network, auth, server) must propagate.
    if (!isDomainNotFound(err)) throw err
    return `${accountUuid}_calendar` as Ref<Doc>
  }

  // 1. PrimaryCalendar preference names the chosen Calendar via attachedTo.
  // The platform UI queries with an empty filter (Preference is treated as a
  // workspace singleton there), so we match that contract instead of
  // guessing a user-scoped filter.
  try {
    const pref = (await client.findOne(PRIMARY_CALENDAR_PREF, {})) as
      | (Doc & { attachedTo?: Ref<Doc> })
      | undefined
    if (pref?.attachedTo !== undefined) {
      const match = calendars.find((c) => c._id === pref.attachedTo)
      if (match !== undefined) return match._id
    }
  } catch (err) {
    if (!isDomainNotFound(err)) throw err
    // preference class not in this workspace — fall through to ExternalCalendar scan
  }

  // 2. Eligible ExternalCalendar default.
  for (const c of calendars) {
    if (c._class === EXTERNAL_CALENDAR_CLASS && !c.hidden && c.default === true) {
      return c._id
    }
  }

  // 3. Synthetic account-default Calendar — matches what getPrimaryCalendar
  //    returns so the WorkSlot lands in the same calendar the UI would use.
  return `${accountUuid}_calendar` as Ref<Doc>
}

function parseDate(value: string, field: string): number {
  const t = new Date(value).getTime()
  if (Number.isNaN(t))
    throw new CliError(ExitCode.Validation, `invalid ${field}: ${value} (expected ISO date)`)
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

/**
 * Resolves a workspace user reference for an email address or the current account.
 *
 * Returns both the doc `_id` and the class it belongs to. Callers that build
 * `attachedTo` / `attachedToClass` pairs (e.g. `addCollection`) MUST use the
 * returned class — ToDo `user` accepts either Employee or Person refs depending
 * on the workspace model, and a mismatch between ref and class will be
 * rejected by the server or land the todo in the wrong collection.
 *
 * @param email - The person to resolve
 * @param resolveOpts - Optional `--url` / `--workspace` to thread through to the account-service fallback
 * @returns The matching `_id` paired with its class, or the current account UUID with `contact:class:Person` when `email` is omitted
 * @throws {CliError} When no matching person is found in the workspace
 */
async function resolveEmployeeId(
  client: Awaited<ReturnType<typeof connectCli>>,
  email?: string,
  resolveOpts: ResolveOpts = {},
): Promise<{ ref: Ref<Doc>; class: Ref<Class<Doc>> }> {
  if (email) {
    // Todo `user` accepts either an Employee or a Person ref depending on
    // the workspace model, so try Employee first then Person via the shared
    // helper (local email scan → cross-workspace account-service fallback).
    if (email.includes('@')) {
      const id = await resolveEmailToLocalId(
        client,
        email,
        ['contact:class:Employee', 'contact:class:Person'],
        resolveOpts,
      )
      if (id !== undefined) {
        // The helper returns only the _id, not the class. Probe to find
        // which class it belongs to so `attachedToClass` matches the ref.
        for (const classId of ['contact:class:Employee', 'contact:class:Person']) {
          try {
            const doc = await client.findOne(classId as Ref<Class<Doc>>, { _id: id })
            if (doc) return { ref: id, class: classId as Ref<Class<Doc>> }
          } catch (err) {
            if (!isDomainNotFound(err)) throw err
            // class not in this workspace's model; try the next one
          }
        }
      }
    }
    // Workspace-local fallback for name-based lookups or when the
    // cross-workspace lookup doesn't match anything in this workspace.
    // Scan both Employee and Person so users who exist only as Employee
    // are still matched by name. Track the class each candidate came from
    // so callers can mirror it into `attachedToClass`.
    const lower = email.toLowerCase()
    for (const classId of ['contact:class:Employee', 'contact:class:Person']) {
      try {
        const docs = (await client.findAll(classId as Ref<Class<Doc>>, {}, { limit: 500 })) as Array<
          Doc & { name?: string; email?: string }
        >
        const hit = docs.find(
          (p) => (p.name ?? '').toLowerCase() === lower || (p.email ?? '').toLowerCase() === lower,
        )
        if (hit) return { ref: hit._id, class: classId as Ref<Class<Doc>> }
      } catch (err) {
        if (!isDomainNotFound(err)) throw err
        // class not in this workspace's model; try the next one
      }
    }
    throw new CliError(ExitCode.NotFound, `no person matching ${email} in this workspace`)
  }
  // Default: current user. Look up the workspace-local Person/Employee linked
  // to the current account by `personUuid` — account.uuid is the
  // account-level UUID and may not be a valid Person/Employee doc _id in
  // this workspace. Probe both classes, matching the email branch above.
  // Throws if neither class is provisioned (the bootstrap step should
  // create one).
  const account = await client.getAccount()
  for (const classId of ['contact:class:Employee', 'contact:class:Person']) {
    try {
      const doc = (await client.findOne(classId as Ref<Class<Doc>>, { personUuid: account.uuid })) as
        | Doc
        | undefined
      if (doc !== undefined) return { ref: doc._id, class: classId as Ref<Class<Doc>> }
    } catch (err) {
      if (!isDomainNotFound(err)) throw err
      // class not in this workspace's model; try the next one
    }
  }
  throw new CliError(
    ExitCode.NotFound,
    `no contact:class:Person or contact:class:Employee provisioned for current account`,
    'open the workspace once in the browser, or re-run without omitting --owner',
  )
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
    if (opts.owner)
      query.user = (
        await resolveEmployeeId(client, opts.owner, { url: opts.url, workspace: opts.workspace })
      ).ref
    if (opts.priority) {
      if (!TODO_PRIORITIES.has(opts.priority)) {
        throw new CliError(
          ExitCode.Validation,
          `invalid --priority: ${opts.priority}`,
          `expected one of ${[...TODO_PRIORITIES].join(' | ')}`,
        )
      }
      query.priority = opts.priority
    }
    if (opts.visibility) {
      if (!TODO_VISIBILITIES.has(opts.visibility)) {
        throw new CliError(
          ExitCode.Validation,
          `invalid --visibility: ${opts.visibility}`,
          `expected one of ${[...TODO_VISIBILITIES].join(' | ')}`,
        )
      }
      query.visibility = opts.visibility
    }
    if (opts.title) query.title = { $regex: opts.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    if (opts.dueFrom || opts.dueTo) {
      const range: Record<string, number> = {}
      if (opts.dueFrom) range.$gte = parseDate(opts.dueFrom, '--due-from')
      if (opts.dueTo) range.$lte = parseDate(opts.dueTo, '--due-to')
      query.dueDate = range
    }
    if (opts.issue) {
      const issueId = await resolveRef(opts.issue, {
        client,
        classId: CLASS.Issue as Ref<Class<Doc>>,
        defaultProjectIdentifier: readEnv().project,
      })
      query.attachedTo = issueId
      query.attachedToClass = CLASS.Issue
    }
    if (opts.completed === true) query.doneOn = { $ne: null }
    else if (opts.completed === false) query.doneOn = null

    const docs = (await withSpinner(
      'Loading actions…',
      () => client.findAll(TODO_CLASS, query as any),
      opts,
    )) as unknown as ToDo[]

    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)

    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json(r)
      return
    }
    table(
      r as unknown as Record<string, unknown>[],
      [
        { key: 'title', header: 'TITLE', format: (r) => String((r as ToDo).title ?? '').slice(0, 50) },
        { key: 'priority', header: 'PRIORITY' },
        { key: 'visibility', header: 'VIS' },
        {
          key: 'dueDate',
          header: 'DUE',
          format: (r) =>
            (r as ToDo).dueDate ? new Date(Number((r as ToDo).dueDate)).toISOString().slice(0, 10) : '—',
        },
        {
          key: 'doneOn',
          header: 'DONE',
          format: (r) =>
            (r as ToDo).doneOn ? new Date(Number((r as ToDo).doneOn)).toISOString().slice(0, 10) : '—',
        },
        { key: '_id', header: '_ID', format: (r) => String((r as ToDo)._id).slice(-12) },
      ],
      { count: true, title: 'todos' },
    )
  } finally {
    await client.close()
  }
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
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!doc) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    if (opts.markdown && doc.description) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(
            TODO_CLASS as Ref<Class<Doc>>,
            doc._id,
            'description',
            doc.description as any,
            'markdown',
          ),
          5000,
          '(body fetch timed out)',
        )
        console.log(body)
        return
      } catch {
        console.log(String(doc.description))
        return
      }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json(doc)
      return
    }

    header(`Action — ${doc.title ?? '(untitled)'}`, {
      subtitle: `created ${relTime(doc.createdOn as number | null)}`,
    })
    const rows: Array<[string, string]> = [
      ['ID', C.emphasis(String(doc._id))],
      ['Title', String(doc.title ?? '—')],
      ['State', doc.doneOn != null ? C.ok('done') : C.muted('open')],
      ['Priority', String(doc.priority ?? '—')],
      ['Due', doc.dueDate != null ? isoDate(doc.dueDate) : C.muted('none')],
      ['Owner', String(doc.assignedTo ?? doc.user ?? '—')],
      ['Created by', String(doc.createdBy ?? '—')],
      [
        'Created',
        doc.createdOn != null
          ? `${isoDate(doc.createdOn)} (${relTime(doc.createdOn as number | null)})`
          : C.muted('—'),
      ],
      [
        'Modified',
        doc.modifiedOn != null
          ? `${isoDate(doc.modifiedOn)} (${relTime(doc.modifiedOn as number | null)})`
          : C.muted('—'),
      ],
      ['_class', C.id(String(doc._class))],
    ]
    if (doc.doneOn != null)
      rows.push(['Done', `${isoDate(doc.doneOn)} (${relTime(doc.doneOn as number | null)})`])
    kv(rows)
    if (doc.description && doc.description !== '' && !opts.markdown) {
      console.log()
      console.log(C.emphasis('Description'))
      console.log(C.muted('─'.repeat(20)))
      const desc = String(doc.description)
      console.log(desc.length > 500 ? desc.slice(0, 500) + '…' : desc)
    }
  } finally {
    await client.close()
  }
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
  const description = body ? body : opts.description ? opts.description : ''
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const { ref: user, class: userClass } = await resolveEmployeeId(client, opts.owner, {
      url: opts.url,
      workspace: opts.workspace,
    })
    if (opts.priority && !TODO_PRIORITIES.has(opts.priority)) {
      throw new CliError(
        ExitCode.Validation,
        `invalid --priority: ${opts.priority}`,
        `expected one of ${[...TODO_PRIORITIES].join(' | ')}`,
      )
    }
    if (opts.visibility && !TODO_VISIBILITIES.has(opts.visibility)) {
      throw new CliError(
        ExitCode.Validation,
        `invalid --visibility: ${opts.visibility}`,
        `expected one of ${[...TODO_VISIBILITIES].join(' | ')}`,
      )
    }
    const priority = opts.priority ?? 'NoPriority'
    const visibility = opts.visibility ?? 'public'

    let attachedTo: Ref<Doc>
    let attachedToClass: Ref<Class<Doc>>
    if (opts.attachedTo && opts.attachedToClass) {
      attachedTo = await resolveRef(opts.attachedTo, {
        client,
        classId: opts.attachedToClass as Ref<Class<Doc>>,
      })
      attachedToClass = opts.attachedToClass as Ref<Class<Doc>>
    } else {
      attachedTo = user
      attachedToClass = userClass
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
      rank: '0|aaaaa:',
    }
    if (opts.due) data.dueDate = parseDate(opts.due, '--due')
    else data.dueDate = null

    if (opts.dryRun) {
      console.log('would create action:')
      console.log(JSON.stringify({ _class: TODO_CLASS, space: TODO_SPACE, data }, null, 2))
      return
    }

    const id = await withSpinner('Creating action…', () =>
      client.addCollection(TODO_CLASS, TODO_SPACE, attachedTo, attachedToClass, 'todos', data as any),
    )
    invalidateIndex(client, TODO_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, ...data })
      return
    }
    success(`created action`, opts.title, id)
  } finally {
    await client.close()
  }
}

// ---- update ----

export interface UpdateActionOpts {
  title?: string
  description?: string
  body?: string
  bodyFile?: string
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
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
    })
    const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)

    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    const body = await readBodyText({ body: opts.body, bodyFile: opts.bodyFile })
    if (body !== undefined) ops.description = body
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
    if (opts.owner)
      ops.user = (
        await resolveEmployeeId(client, opts.owner, { url: opts.url, workspace: opts.workspace })
      ).ref

    if (Object.keys(ops).length === 0) {
      throw new CliError(
        ExitCode.Validation,
        'nothing to update',
        'pass --title, --description, --due, --priority, --visibility, or --owner',
      )
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
      () =>
        client.updateCollection(
          TODO_CLASS,
          todo.space as unknown as Ref<Space>,
          id as Ref<ToDo>,
          todo.attachedTo as Ref<Doc>,
          (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
          todo.collection ?? 'todos',
          ops as any,
        ),
      opts,
    )
    updated(`updated action`, id)
  } finally {
    await client.close()
  }
}

// ---- complete / reopen ----

export async function completeAction(
  ref: string,
  opts: { dryRun?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {},
): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
    })
    const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    if (opts.dryRun) {
      console.log(`would complete action ${id} (set doneOn=now)`)
      return
    }
    await withSpinner(
      'Completing…',
      () =>
        client.updateCollection(
          TODO_CLASS,
          todo.space as unknown as Ref<Space>,
          id as Ref<ToDo>,
          todo.attachedTo as Ref<Doc>,
          (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
          todo.collection ?? 'todos',
          { doneOn: Date.now() } as any,
        ),
      opts,
    )
    console.log(`completed action: ${id}`)
  } finally {
    await client.close()
  }
}

export async function reopenAction(
  ref: string,
  opts: { dryRun?: boolean; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {},
): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
    })
    const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    if (opts.dryRun) {
      console.log(`would reopen action ${id} (clear doneOn)`)
      return
    }
    await withSpinner(
      'Reopening…',
      () =>
        client.updateCollection(
          TODO_CLASS,
          todo.space as unknown as Ref<Space>,
          id as Ref<ToDo>,
          todo.attachedTo as Ref<Doc>,
          (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
          todo.collection ?? 'todos',
          { doneOn: null } as any,
        ),
      opts,
    )
    console.log(`reopened action: ${id}`)
  } finally {
    await client.close()
  }
}

// ---- delete ----

export async function deleteActions(
  refs: string[],
  opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {},
): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1)
      throw new CliError(
        ExitCode.Validation,
        `destructive: deleting ${refs.length} actions requires --yes`,
        're-run with --yes to confirm',
      )
    let deleted = 0,
      skipped = 0
    for (const id of ids) {
      const todo = await client.findOne(TODO_CLASS, { _id: id as Ref<ToDo> })
      if (!todo) {
        skipped++
        continue
      }
      try {
        await client.removeCollection(
          TODO_CLASS,
          todo.space as unknown as Ref<Space>,
          id as Ref<ToDo>,
          todo.attachedTo as Ref<Doc>,
          (todo.attachedToClass ?? 'contact:class:Person') as Ref<Class<Doc>>,
          todo.collection ?? 'todos',
        )
        deleted++
      } catch (e) {
        console.error(`failed to delete ${id}: ${(e as Error).message}`)
        skipped++
      }
    }
    bulkRemoved(deleted, skipped)
  } finally {
    await client.close()
  }
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
    const todoId = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
    })
    const todo = await client.findOne(TODO_CLASS, { _id: todoId as Ref<ToDo> })
    if (!todo) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    const account = await client.getAccount()
    const startMs = parseDate(opts.start, '--start')
    const dueMs = startMs + opts.duration * 60 * 1000
    // Resolve the user's PersonalCalendar the same way the web UI does
    // (see time-resources/utils.ts: findPrimaryCalendar). `todo.user` is an
    // Employee ref — using it as the `calendar` field makes the WorkSlot
    // invisible to the Schedule Calendar UI, which filters by Calendar ref.
    const calendarRef =
      account.primarySocialId !== undefined
        ? await resolvePrimaryCalendar(client, account.primarySocialId, account.uuid)
        : (`${account.uuid}_calendar` as Ref<Doc>)
    const data: Record<string, unknown> = {
      title: todo.title,
      date: startMs,
      dueDate: dueMs,
      allDay: !!opts.allDay,
      calendar: calendarRef,
      eventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      access: 'owner',
      visibility: todo.visibility ?? 'public',
      blockTime: !opts.allDay,
      user: account.primarySocialId,
    }
    if (opts.dryRun) {
      console.log('would create work-slot:')
      console.log(
        JSON.stringify(
          {
            _class: WORKSLOT_CLASS,
            space: CALENDAR_SPACE,
            attachedTo: todoId,
            attachedToClass: TODO_CLASS,
            collection: 'workslots',
            data,
          },
          null,
          2,
        ),
      )
      return
    }
    const id = await withSpinner(
      'Scheduling…',
      () =>
        client.addCollection(
          WORKSLOT_CLASS,
          CALENDAR_SPACE,
          todoId as Ref<Doc>,
          TODO_CLASS,
          'workslots',
          data as any,
        ),
      opts,
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, attachedTo: todoId, ...data })
      return
    }
    console.log(`scheduled: ${id}`)
  } finally {
    await client.close()
  }
}

export async function unscheduleAction(
  ref: string,
  opts: { slotId?: string; yes?: boolean; dryRun?: boolean; workspace?: string; url?: string } = {},
): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const todoId = await resolveRef(ref, {
      client,
      classId: TODO_CLASS as Ref<Class<Doc>>,
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
      // CLI-17: warning-and-proceed silently removed all slots. Throw so the
      // user must explicitly confirm with --yes.
      throw new CliError(
        ExitCode.Validation,
        `destructive: unscheduling ${slots.length} work-slots requires --yes`,
        're-run with --yes to confirm',
      )
    }
    let removed = 0,
      skipped = 0
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
          s.collection ?? 'workslots',
        )
        removed++
      } catch (e) {
        console.error(`failed to remove ${s._id}: ${(e as Error).message}`)
        skipped++
      }
    }
    console.log(`unscheduled: ${removed}, skipped: ${skipped}`)
  } finally {
    await client.close()
  }
}
