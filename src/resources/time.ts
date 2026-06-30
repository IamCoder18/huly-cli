import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, COLUMNS, success, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'

type TimeSpendReport = Doc & {
  attachedTo: Ref<Doc>
  attachedToClass: Ref<Class<Doc>>
  value: number
  description: string
  date: number | null
  employee: Ref<Doc> | null
  collection: string
}

export async function listTimeEntries(opts: {
  issue?: string
  start?: string
  end?: string
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
} = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {
      attachedToClass: CLASS.Issue,
      collection: 'reports'
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
    }
    if (opts.start || opts.end) {
      const range: Record<string, number> = {}
      if (opts.start) range.$gte = new Date(opts.start).getTime()
      if (opts.end) range.$lte = new Date(opts.end).getTime()
      query.date = range
    }
    const docs = (await withSpinner('Loading time entries…', () =>
      client.findAll(CLASS.TimeSpendReport as Ref<Class<TimeSpendReport>>, query as any), opts
    )) as TimeSpendReport[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.timeReport(), { count: true, title: 'time-entries' })
  } finally { await client.close() }
}

export async function logTime(opts: {
  issue?: string
  minutes?: number
  hours?: number
  description?: string
  date?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.issue) throw new CliError(ExitCode.Validation, 'missing --issue')
  const totalMinutes = opts.minutes ?? (opts.hours !== undefined ? Math.round(opts.hours * 60) : 0)
  if (totalMinutes <= 0) throw new CliError(ExitCode.Validation, 'missing --minutes (or --hours)', 'pass one of --minutes or --hours')
  const description = opts.description ?? ''
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const issueId = await resolveRef(opts.issue, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Doc>>, { _id: issueId })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${opts.issue} not found`)
    const data: Record<string, unknown> = {
      value: totalMinutes / 60, // TimeSpendReport stores man hours
      description,
      date: opts.date ? new Date(opts.date).getTime() : Date.now(),
      employee: account.uuid,
      space: (issue as Doc).space
    }
    const id = await withSpinner(
      `Logging ${totalMinutes}min on ${opts.issue}…`,
      () => client.addCollection(
        CLASS.TimeSpendReport as Ref<Class<TimeSpendReport>>,
        (issue as Doc).space as Ref<Space>,
        issueId,
        CLASS.Issue,
        'reports',
        data as any
      ),
      opts
    )
    invalidateIndex(account.uuid, CLASS.TimeSpendReport)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, attachedTo: issueId, ...data })
    } else {
      success('logged time', `${totalMinutes}min on ${opts.issue}`, id)
    }
  } finally { await client.close() }
}

export async function deleteTimeEntries(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.TimeSpendReport as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) {
      console.error(`warning: deleting ${ids.length} time entries; pass --yes to confirm`)
    }
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const entry = await client.findOne(CLASS.TimeSpendReport as Ref<Class<TimeSpendReport>>, { _id: id as Ref<TimeSpendReport> })
      if (!entry) { skipped++; continue }
      try {
        await client.removeCollection(
          CLASS.TimeSpendReport as Ref<Class<Doc>>,
          (entry as Doc).space as Ref<Doc>,
          id as Ref<Doc>,
          (entry as TimeSpendReport).attachedTo as Ref<Doc>,
          CLASS.Issue,
          (entry as TimeSpendReport).collection ?? 'reports'
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

export async function timeReport(issueRef: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  return listTimeEntries({ ...opts, issue: issueRef })
}
