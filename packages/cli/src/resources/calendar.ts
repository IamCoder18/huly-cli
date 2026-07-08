import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv, header, COLUMNS, C, isoDate, relTime, withTimeout, success, updated, removed, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { looksLikeRawMarkup, warnMarkdownFallback } from './_helpers.js'
import { readEnv } from '../auth/env.js'
import { connectAccountCli } from '../transport/sdk.js'
import { getCachedWorkspaceToken } from '../auth/cache.js'

type CalendarDoc = Doc & {
  name: string
  hidden: boolean
  visibility?: string
  access?: string
  user?: string
  [k: string]: unknown
}

type Event = Doc & {
  title: string
  description?: string
  startDate: number
  dueDate: number
  allDay: boolean
  location?: string
  calendar: Ref<Doc>
  participants?: string[]
  rules?: unknown[]
  externalId?: string
  externalUser?: string
  [k: string]: unknown
}

type Schedule = Doc & {
  owner: string
  title: string
  description?: string
  meetingDuration: number
  meetingInterval: number
  availability: Record<number, unknown>
  timeZone: string
  calendar?: Ref<Doc>
  [k: string]: unknown
}

function parseDate(value: string, field: string): number {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) throw new CliError(ExitCode.Validation, `invalid ${field}: ${value} (expected ISO date)`)
  return t
}

// ---- calendars ----

export async function listCalendars(g: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: g.url, workspace: g.workspace })
  try {
    const docs = (await withSpinner(
      'Loading calendars…',
      () => client.findAll(CLASS.Calendar as Ref<Class<CalendarDoc>>, {}),
      g
    )) as CalendarDoc[]
    if (shouldJson({ json: g.json, ci: g.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME', format: (r) => C.emphasis(String((r as CalendarDoc).name ?? '')) },
      { key: 'visibility', header: 'VISIBILITY', format: (r) => {
        const v = String((r as CalendarDoc).visibility ?? '')
        return v === 'public' ? C.green('public') : v === 'private' ? C.red('private') : C.muted(v)
      } },
      { key: 'access', header: 'ACCESS', format: (r) => {
        const a = String((r as CalendarDoc).access ?? '')
        return a === 'owner' ? C.cyan('owner') : a
      } },
      { key: 'hidden', header: 'HIDDEN', width: 8, align: 'center', format: (r) => (r as CalendarDoc).hidden ? C.yellow('yes') : C.muted('no') },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as { _id: string })._id).split(':').slice(-1)[0] ?? String((r as { _id: string })._id)) }
    ], { count: true, title: 'calendars' })
  } finally { await client.close() }
}

// ---- schedules ----

export async function createCalendar(opts: {
  name?: string
  description?: string
  visibility?: string
  private?: boolean
  hidden?: boolean
  access?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.name) throw new CliError(ExitCode.Validation, 'missing --name')
  const data: Record<string, unknown> = {
    name: opts.name,
    description: opts.description ?? '',
    visibility: opts.visibility ?? 'public',
    access: opts.access ?? 'owner',
    private: opts.private ?? false,
    hidden: opts.hidden ?? false
  }
  if (opts.dryRun) {
    console.log('would create calendar:')
    console.log(JSON.stringify({ _class: CLASS.Calendar, space: 'core:space:Workspace', data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner(
      'Creating calendar…',
      () => client.createDoc(CLASS.Calendar as Ref<Class<Doc>>, 'core:space:Workspace' as Ref<Space>, data as any),
      opts
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success(`created calendar`, opts.name, id)
  } finally { await client.close() }
}

export async function deleteCalendar(ref: string, opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Calendar as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Calendar, { _id: id })
    if (!doc) throw new CliError(ExitCode.NotFound, `calendar ${ref} not found`)
    try {
      await client.removeDoc(CLASS.Calendar, doc.space as unknown as Ref<Space>, id as Ref<Doc>)
      removed('deleted calendar', String(doc.name ?? ref), id)
    } catch (e) {
      throw new CliError(ExitCode.Server, `delete failed: ${(e as Error).message}`)
    }
  } finally { await client.close() }
}

export async function listSchedules(g: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: g.url, workspace: g.workspace })
  try {
    const docs = (await withSpinner(
      'Loading schedules…',
      () => client.findAll(CLASS.Schedule as Ref<Class<Schedule>>, {}),
      g
    )) as Schedule[]
    if (shouldJson({ json: g.json, ci: g.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE', format: (r) => C.emphasis(String((r as Schedule).title ?? '')) },
      { key: 'timeZone', header: 'TIMEZONE' },
      { key: 'meetingDuration', header: 'DURATION' },
      { key: 'meetingInterval', header: 'INTERVAL' },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as { _id: string })._id).slice(-12)) }
    ], { count: true, title: 'schedules' })
  } finally { await client.close() }
}

export async function getSchedule(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Schedule as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Schedule as Ref<Class<Schedule>>, { _id: id as Ref<Schedule> })
    if (!doc) throw new CliError(ExitCode.NotFound, `schedule ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }

    header(`Schedule — ${doc.title ?? doc.name ?? '(unnamed)'}`, { subtitle: `created ${relTime(doc.createdOn as number | null)}` })
    kv([
      ['ID', C.emphasis(String(doc._id))],
      ['Title', String(doc.title ?? '—')],
      ['Description', String(doc.description ?? '—')],
      ['Time zone', String(doc.timeZone ?? '—')],
      ['Meeting duration', doc.meetingDuration != null ? `${doc.meetingDuration} min` : C.muted('—')],
      ['Meeting interval', doc.meetingInterval != null ? `${doc.meetingInterval} min` : C.muted('—')],
      ['Owner', String(doc.owner ?? '—')],
      ['Created', doc.createdOn != null ? `${isoDate(doc.createdOn)} (${relTime(doc.createdOn as number | null)})` : C.muted('—')],
      ['Modified', doc.modifiedOn != null ? `${isoDate(doc.modifiedOn)} (${relTime(doc.modifiedOn as number | null)})` : C.muted('—')],
      ['_class', C.id(String(doc._class))]
    ])
    if (doc.description && doc.description !== '') {
      console.log()
      console.log(C.emphasis('Description'))
      console.log(C.muted('─'.repeat(20)))
      console.log(String(doc.description))
    }
  } finally { await client.close() }
}

export async function createSchedule(opts: {
  title?: string
  description?: string
  owner?: string
  timeZone?: string
  duration?: number
  interval?: number
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (!opts.owner) throw new CliError(ExitCode.Validation, 'missing --owner (person uuid)')
  if (!opts.timeZone) throw new CliError(ExitCode.Validation, 'missing --time-zone (e.g. UTC)')

  const data: Record<string, unknown> = {
    title: opts.title,
    description: opts.description ?? '',
    owner: opts.owner,
    meetingDuration: opts.duration ?? 30,
    meetingInterval: opts.interval ?? 15,
    availability: {},
    timeZone: opts.timeZone
  }
  if (opts.dryRun) {
    console.log('would create schedule:')
    console.log(JSON.stringify({ _class: CLASS.Schedule, space: '<self>', data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner(
      'Creating schedule…',
      () => client.createDoc(
        CLASS.Schedule as Ref<Class<Schedule>>,
        client.getHierarchy().getDomain(CLASS.Schedule as Ref<Class<Doc>>) as unknown as Ref<Space>,
        data as any
      ),
      opts
    )
    invalidateIndex(client, CLASS.Schedule)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, ...data })
    } else {
      success(`created schedule`, opts.title, id)
    }
  } finally { await client.close() }
}

export async function updateSchedule(ref: string, opts: {
  title?: string
  description?: string
  timeZone?: string
  duration?: number
  interval?: number
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Schedule as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Schedule as Ref<Class<Schedule>>, { _id: id as Ref<Schedule> })
    if (!doc) throw new CliError(ExitCode.NotFound, `schedule ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.description !== undefined) ops.description = opts.description
    if (opts.timeZone) ops.timeZone = opts.timeZone
    if (opts.duration !== undefined) ops.meetingDuration = opts.duration
    if (opts.interval !== undefined) ops.meetingInterval = opts.interval
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --title, --time-zone, --duration, --interval, or --description')
    if (opts.dryRun) {
      console.log(`would update schedule ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.Schedule, objectId: id, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CLASS.Schedule as Ref<Class<Schedule>>, doc.space as unknown as Ref<Space>, id as Ref<Schedule>, ops as any),
      opts
    )
    updated(`updated schedule`, id)
  } finally { await client.close() }
}

export async function deleteSchedules(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Schedule as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} schedules requires --yes`, 're-run with --yes to confirm')
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.Schedule as Ref<Class<Schedule>>, { _id: id as Ref<Schedule> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Schedule as Ref<Class<Schedule>>, doc.space as unknown as Ref<Space>, id as Ref<Schedule>, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    bulkRemoved(deleted, skipped)
  } finally { await client.close() }
}

// ---- events (existing surface, now expanded with --calendar-id, --rrule) ----

export async function listEvents(opts: {
  calendar?: string
  start?: string
  end?: string
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.start) query.startDate = { $gte: parseDate(opts.start, '--start') }
    if (opts.end) query.dueDate = { $lte: parseDate(opts.end, '--end') }
    if (opts.calendar) {
      query.calendar = await resolveCalendarId(client, opts.calendar)
    }
    const docs = (await withSpinner(
      'Loading events…',
      () => client.findAll(CLASS.Event as Ref<Class<Event>>, query as any),
      opts
    )) as Event[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.event(), { count: true, title: 'events' })
  } finally { await client.close() }
}

export async function getEvent(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; rawMarkup?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Event as Ref<Class<Doc>>,
    })
    let doc = await client.findOne(CLASS.Event as Ref<Class<Event>>, { _id: id as Ref<Event> })
    if (!doc) {
      doc = await client.findOne(CLASS.ReccuringEvent as Ref<Class<Event>>, { _id: id as Ref<Event> })
    }
    if (!doc) throw new CliError(ExitCode.NotFound, `event ${ref} not found`)
    if ((opts.markdown || opts.rawMarkup) && doc.description) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(CLASS.Event as Ref<Class<Doc>>, doc._id, 'description', doc.description as any, opts.rawMarkup ? 'markup' : 'markdown'),
          5000,
          '(body fetch timed out)'
        )
        const bodyStr = String(body ?? '')
        if (opts.markdown && looksLikeRawMarkup(bodyStr)) {
          warnMarkdownFallback()
        }
        console.log(bodyStr)
        return
      } catch { console.log(String(doc.description)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }

    const start = typeof doc.date === 'number' ? isoDate(doc.date) : (doc.date ? String(doc.date) : '—')
    const dur = (doc.dueDate as number | undefined) != null && (doc.date as number | undefined) != null
      ? `${Math.round(((doc.dueDate as number) - (doc.date as number)) / 60000)} min`
      : '—'
    header(`Event — ${doc.title ?? '(untitled)'}`, { subtitle: `${start}${dur !== '—' ? ' · ' + dur : ''}` })
    kv([
      ['ID', C.emphasis(String(doc._id))],
      ['Title', String(doc.title ?? '—')],
      ['Calendar', String(doc.calendar ?? '—')],
      ['Start', start],
      ['Duration', dur],
      ['All-day', doc.allDay ? C.warn('yes') : C.muted('no')],
      ['Recurring', doc.recurring ? 'yes' : C.muted('no')],
      ['Visibility', doc.visibility ?? C.muted('default')],
      ['Status', String(doc.status ?? '—')],
      ['Location', String(doc.location ?? '—')],
      ['Participants', Array.isArray(doc.participants) && (doc.participants as unknown[]).length > 0 ? C.muted(`${(doc.participants as unknown[]).length} people`) : C.muted('none')],
      ['External', Array.isArray(doc.externalParticipants) && (doc.externalParticipants as unknown[]).length > 0 ? C.muted(`${(doc.externalParticipants as unknown[]).length} external`) : C.muted('none')],
      ['Created', doc.createdOn != null ? `${isoDate(doc.createdOn)} (${relTime(doc.createdOn as number | null)})` : C.muted('—')]
    ])
    if (doc.description && doc.description !== '' && !opts.markdown) {
      console.log()
      console.log(C.emphasis('Description'))
      console.log(C.muted('─'.repeat(20)))
      const desc = String(doc.description)
      console.log(desc.length > 500 ? desc.slice(0, 500) + '…' : desc)
    }
  } finally { await client.close() }
}

export async function createEvent(opts: {
  title?: string
  start?: string
  end?: string
  allDay?: boolean
  location?: string
  attendee?: string
  description?: string
  body?: string
  calendarId?: string
  rrule?: string
  attachedTo?: string
  attachedToClass?: string
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (!opts.start) throw new CliError(ExitCode.Validation, 'missing --start (ISO)')
  if (!opts.end) throw new CliError(ExitCode.Validation, 'missing --end (ISO)')

  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const calendarId = await resolveCalendarId(client, opts.calendarId)
    const startDate = parseDate(opts.start, '--start')
    const dueDate = parseDate(opts.end, '--end')
    const eventId = generateEventId()
    const isRecurring = Boolean(opts.rrule)
    const account = await client.getAccount()

    // Pick attachedTo / attachedToClass: explicit arg → current user (by uuid).
    let attachedTo: Ref<Doc>
    let attachedToClass: Ref<Class<Doc>>
    if (opts.attachedTo && opts.attachedToClass) {
      attachedTo = await resolveRef(opts.attachedTo, {
        client,
        classId: opts.attachedToClass as Ref<Class<Doc>>,
      })
      attachedToClass = opts.attachedToClass as Ref<Class<Doc>>
    } else {
      // Default: the current user (so the event shows in their calendar).
      attachedTo = account.uuid as Ref<Doc>
      attachedToClass = CLASS.Person
    }

    const data: Record<string, unknown> = {
      title: opts.title,
      description: opts.description ?? opts.body ?? '',
      date: startDate,
      startDate,
      dueDate,
      allDay: !!opts.allDay,
      participants: opts.attendee ? [opts.attendee] : [],
      location: opts.location ?? '',
      calendar: calendarId,
      eventId,
      access: 'owner',
      visibility: 'public',
      blockTime: false,
      user: account.primarySocialId
    }

    if (isRecurring) {
      data.rules = [parseRRule(opts.rrule!)]
      data.exdate = []
      data.rdate = []
      data.originalStartTime = startDate
      data.timeZone = (opts as { timeZone?: string }).timeZone ?? 'UTC'
    }

    const classId = isRecurring ? CLASS.ReccuringEvent : CLASS.Event

    if (opts.dryRun) {
      console.log(`would create ${isRecurring ? 'recurring event' : 'event'}:`)
      console.log(JSON.stringify({ _class: classId, space: 'calendar:space:Calendar', attachedTo, attachedToClass, collection: 'events', data }, null, 2))
      return
    }
    const id = await withSpinner(
      `Creating ${isRecurring ? 'recurring event' : 'event'}…`,
      () => client.addCollection(
        classId as Ref<Class<Event>>,
        'calendar:space:Calendar' as Ref<Space>,
        attachedTo,
        attachedToClass,
        'events',
        data as any
      ),
      opts
    )
    invalidateIndex(client, CLASS.Event)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, recurring: isRecurring, attachedTo, ...data })
    } else {
      success(`created ${isRecurring ? `recurring event` : `event`}`, opts.title, id)
    }
  } finally { await client.close() }
}

export async function updateEvent(ref: string, opts: {
  title?: string
  description?: string
  start?: string
  end?: string
  allDay?: boolean
  location?: string
  attendee?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Event as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Event as Ref<Class<Event>>, { _id: id as Ref<Event> })
    if (!doc) throw new CliError(ExitCode.NotFound, `event ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.description !== undefined) ops.description = opts.description
    if (opts.start) {
      const sd = parseDate(opts.start, '--start')
      ops.startDate = sd
      // CLI-16: the model stores BOTH `date` (display field) and `startDate`.
      // Create writes both; update previously only wrote startDate. Keep them
      // in sync so `calendar get`/`calendar list` show the updated start.
      ops.date = sd
    }
    if (opts.end) ops.dueDate = parseDate(opts.end, '--end')
    if (opts.allDay !== undefined) ops.allDay = opts.allDay
    if (opts.location !== undefined) ops.location = opts.location
    if (opts.attendee) ops.participants = [opts.attendee]
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --title/--description/--start/--end/--all-day/--location/--attendee')
    if (opts.dryRun) {
      console.log(`would update event ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.Event, objectId: id, space: doc.space, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CLASS.Event as Ref<Class<Event>>, doc.space as unknown as Ref<Space>, id as Ref<Event>, ops as any),
      opts
    )
    updated(`updated event`, id)
  } finally { await client.close() }
}

export async function deleteEvents(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    if (!opts.yes && refs.length > 1) {
      throw new CliError(ExitCode.Validation, `destructive: deleting ${refs.length} events requires --yes`, 're-run with --yes to confirm')
    }
    let deleted = 0, skipped = 0
    for (const ref of refs) {
      // CLI-15: a CLI-created recurring event lives in CLASS.ReccuringEvent,
      // not CLASS.Event. Try Event first, then fall back to ReccuringEvent.
      const id = await resolveRef(ref, {
        client,
        classId: CLASS.Event as Ref<Class<Doc>>,
      })
      let doc = await client.findOne(CLASS.Event as Ref<Class<Event>>, { _id: id as Ref<Event> })
      let classId: Ref<Class<Event>> = CLASS.Event as Ref<Class<Event>>
      if (!doc) {
        doc = await client.findOne(CLASS.ReccuringEvent as Ref<Class<Event>>, { _id: id as Ref<Event> })
        classId = CLASS.ReccuringEvent as Ref<Class<Event>>
      }
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, classId, doc.space as unknown as Ref<Space>, id as Ref<Event>, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    bulkRemoved(deleted, skipped)
  } finally { await client.close() }
}

// ---- recurring events ----

export async function listRecurringEvents(opts: { limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner(
      'Loading recurring events…',
      () => client.findAll(CLASS.ReccuringEvent as Ref<Class<Event>>, {}),
      opts
    )) as Event[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE', format: (r) => C.emphasis(String((r as Event).title ?? '').slice(0, 60)) },
      { key: 'date', header: 'START', width: 17, format: (r) => {
        const d = (r as Event).date ?? (r as Event).startDate
        return d != null ? isoDate(d) : C.muted('—')
      } },
      { key: 'dueDate', header: 'END', width: 17, format: (r) => {
        const d = (r as Event).dueDate
        return d != null ? isoDate(d) : C.muted('—')
      } },
      { key: 'rules', header: 'RULES', format: (r) => {
        const r2 = (r as Event).rules as unknown
        if (r2 == null) return C.muted('—')
        if (typeof r2 === 'string') return C.muted(r2.slice(0, 50))
        return C.muted(JSON.stringify(r2).slice(0, 50))
      } },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as Event)._id).slice(-12)) }
    ], { count: true, title: 'reminders' })
  } finally { await client.close() }
}

export async function listRecurringInstances(ref: string, opts: { start?: string; end?: string; limit?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.ReccuringEvent as Ref<Class<Doc>>,
    })
    const query: Record<string, unknown> = { recurringEventId: id as string }
    if (opts.start || opts.end) {
      const range: Record<string, number> = {}
      if (opts.start) range.$gte = parseDate(opts.start, '--start')
      if (opts.end) range.$lte = parseDate(opts.end, '--end')
      query.date = range
    }
    const instances = (await client.findAll(CLASS.ReccuringInstance as Ref<Class<Event>>, query as any)) as Event[]
    let r = instances
    if (opts.limit) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'date', header: 'DATE', width: 17, format: (r) => {
        const d = (r as Event).date
        return d != null ? isoDate(d) : C.muted('—')
      } },
      { key: 'originalStartTime', header: 'ORIGINAL', width: 17, format: (r) => {
        const d = (r as Event).originalStartTime
        return d != null ? isoDate(d) : C.muted('—')
      } },
      { key: 'virtual', header: 'VIRTUAL', width: 10, align: 'center', format: (r) => (r as Event).virtual ? C.cyan('yes') : C.muted('no') },
      { key: 'isCancelled', header: 'STATE', width: 11, align: 'center', format: (r) => (r as Event).isCancelled ? C.red('cancelled') : C.green('scheduled') },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as Event)._id).slice(-12)) }
    ], { count: true, title: 'instances' })
  } finally { await client.close() }
}

// ---- helpers ----

async function resolveCalendarId(client: PlatformClient, arg?: string): Promise<Ref<Doc>> {
  if (arg !== undefined) {
    // Accept an id, an idx ref, or a calendar name.
    if (arg.includes(':')) {
      try {
        return (await resolveRef(arg, {
          client,
          classId: CLASS.Calendar as Ref<Class<Doc>>,
        })) as Ref<Doc>
      } catch {
        // fall through to name lookup
      }
    }
    const all = (await client.findAll(CLASS.Calendar as Ref<Class<CalendarDoc>>, {})) as CalendarDoc[]
    const hit = all.find((c) => String(c.name ?? '').toLowerCase() === arg.toLowerCase())
    if (!hit) throw new CliError(ExitCode.NotFound, `calendar ${arg} not found`)
    return hit._id as Ref<Doc>
  }
  const primary = (await client.findAll('calendar:class:PrimaryCalendar' as Ref<Class<Doc>>, {}, { limit: 1 }))[0] as Doc | undefined
  if (primary) return (primary as unknown as { attachedTo: Ref<Doc> }).attachedTo
  const all = (await client.findAll(CLASS.Calendar as Ref<Class<CalendarDoc>>, { hidden: false }, { limit: 1 })) as CalendarDoc[]
  if (all.length === 0) throw new CliError(ExitCode.NotFound, 'no calendars available — pass --calendar-id')
  return all[0]._id as Ref<Doc>
}

function generateEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parseRRule(rule: string): Record<string, unknown> {
  // Accept "FREQ=DAILY;COUNT=3" or "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"
  const out: Record<string, unknown> = {}
  for (const part of rule.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const val = part.slice(eq + 1).trim()
    if (key === 'BYDAY' || key === 'BYMONTH' || key === 'BYHOUR' || key === 'BYMINUTE' || key === 'BYSECOND' ||
        key === 'BYMONTHDAY' || key === 'BYYEARDAY' || key === 'BYWEEKNO' || key === 'BYSETPOS') {
      out[key] = val.split(',').map((s) => isNaN(Number(s)) ? s : Number(s))
    } else if (key === 'COUNT' || key === 'INTERVAL') {
      out[key] = Number(val)
    } else if (key === 'UNTIL') {
      out[key] = parseDate(val, 'UNTIL')
    } else {
      out[key] = val
    }
  }
  return out
}
