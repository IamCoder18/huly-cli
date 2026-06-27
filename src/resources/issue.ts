import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'
import { pickProject } from '../auth/prompts.js'
import { connectAccountCli } from '../transport/sdk.js'

type Issue = Doc & {
  identifier: string
  title: string
  description?: string
  status: Ref<Doc>
  priority: Ref<Doc>
  assignee?: Ref<Doc> | null
  labels?: string[]
  dueDate?: number | null
  parent?: Ref<Doc>
  project: Ref<Project>
  kind: Ref<Doc>
}

type Project = Doc & { name: string; identifier: string }

interface IssueCreateOpts {
  project?: string
  title?: string
  description?: string
  body?: string
  bodyFile?: string
  status?: string
  priority?: string
  assignee?: string
  label?: string[]
  due?: string
  parent?: string
  minimal?: boolean
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

function parseDate(value: string, field: string): number {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) throw new CliError(ExitCode.Validation, `invalid ${field}: ${value} (expected ISO date)`)
  return t
}

async function readBody(opts: { body?: string; bodyFile?: string }): Promise<string | undefined> {
  if (opts.body && opts.bodyFile) {
    throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  }
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    return (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  if (opts.body) return opts.body
  return undefined
}

async function resolveProject(client: PlatformClient, identifier?: string): Promise<Project> {
  const env = readEnv()
  const candidate = identifier ?? env.project
  const account = await client.getAccount()
  const idx = await buildIndex<Project>(client, CLASS.Project as Ref<Class<Project>>, account.uuid)
  if (candidate) {
    const hit = idx.get(candidate)
    if (hit) {
      const doc = await client.findOne(CLASS.Project as Ref<Class<Project>>, { _id: hit as Ref<Project> })
      if (doc) return doc
    }
    throw new CliError(ExitCode.NotFound, `project ${candidate} not found`)
  }
  const all = (await client.findAll(CLASS.Project as Ref<Class<Project>>, {})) as unknown as Project[]
  return await pickProject(all, 'Project:')
}

async function firstStatus(client: PlatformClient, project: Project): Promise<Ref<Doc>> {
  const statuses = (await client.findAll(CLASS.IssueStatus as Ref<Class<Doc>>, { space: project._id })) as Doc[]
  if (statuses.length === 0) throw new CliError(ExitCode.NotFound, `no IssueStatus in project ${project.identifier}`)
  return statuses.sort((a, b) => ((a as { rank?: number }).rank ?? 0) - ((b as { rank?: number }).rank ?? 0))[0]._id
}

async function resolveStatus(client: PlatformClient, project: Project, name?: string): Promise<Ref<Doc>> {
  if (!name) return await firstStatus(client, project)
  const all = (await client.findAll(CLASS.IssueStatus as Ref<Class<Doc>>, { space: project._id })) as Array<Doc & { label?: string; name?: string }>
  const hit = all.find((s) => s.label?.toLowerCase() === name.toLowerCase() || s.name?.toLowerCase() === name.toLowerCase())
  if (!hit) throw new CliError(ExitCode.NotFound, `status ${name} not found in project ${project.identifier}; available: ${all.map((s) => s.label ?? s.name).join(', ')}`)
  return hit._id
}

async function resolvePriority(client: PlatformClient, name?: string): Promise<Ref<Doc>> {
  if (name) {
    const all = (await client.findAll(CLASS.TypeIssuePriority as Ref<Class<Doc>>, {})) as Array<Doc & { label?: string; name?: string }>
    const hit = all.find((p) => p.label?.toLowerCase() === name.toLowerCase() || p.name?.toLowerCase() === name.toLowerCase())
    if (!hit) throw new CliError(ExitCode.NotFound, `priority ${name} not found; available: ${all.map((p) => p.label ?? p.name).join(', ')}`)
    return hit._id
  }
  const all = (await client.findAll(CLASS.TypeIssuePriority as Ref<Class<Doc>>, {})) as Array<Doc & { label?: string }>
  const normal = all.find((p) => p.label === 'Normal')
  if (normal) return normal._id
  if (all.length === 0) throw new CliError(ExitCode.NotFound, 'no priorities defined')
  return all[0]._id
}

async function resolveAssignee(email: string): Promise<Ref<Doc>> {
  const ac = await connectAccountCli()
  const personId = await ac.findPersonBySocialKey(email)
  if (!personId) throw new CliError(ExitCode.NotFound, `no person with email ${email}`)
  return personId as Ref<Doc>
}

export async function listIssues(opts: {
  project?: string
  status?: string
  assignee?: string
  label?: string[]
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = opts.project ? await resolveProject(client, opts.project) : null
    const query: Record<string, unknown> = {}
    if (project) query.space = project._id
    if (opts.status) query.status = opts.status
    if (opts.assignee) query.assignee = opts.assignee
    if (opts.label && opts.label.length > 0) query.labels = { $in: opts.label }
    const result = (await withSpinner('Loading workspace model…', () =>
      client.findAll(CLASS.Issue as Ref<Class<Issue>>, query as any), opts
    )) as unknown as Issue[]

    let docs = result
    if (opts.offset && opts.offset > 0) docs = docs.slice(opts.offset)
    if (opts.limit && opts.limit > 0) docs = docs.slice(0, opts.limit)

    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'identifier', header: 'ID' },
      { key: 'title', header: 'TITLE', format: (r) => ((r as Issue).title ?? '').slice(0, 60) },
      { key: 'status', header: 'STATUS' },
      { key: 'priority', header: 'PRIORITY' },
      { key: '_id', header: '_ID', format: (r) => String((r as Issue)._id).slice(-12) }
    ])
  } finally {
    await client.close()
  }
}

export async function getIssue(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: id as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)

    if (opts.markdown && issue.description) {
      const markup = String(issue.description)
      try {
        const body = await client.fetchMarkup(CLASS.Issue as Ref<Class<Doc>>, issue._id, 'description', markup as any, 'markdown')
        console.log(body)
        return
      } catch {
        console.log(markup)
        return
      }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(issue); return }
    console.log(`${issue.identifier} ${issue.title}`)
    console.log(JSON.stringify(issue, null, 2))
  } finally {
    await client.close()
  }
}

export async function createIssue(opts: IssueCreateOpts): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProject(client, opts.project)
    const title = opts.title
    if (!title) throw new CliError(ExitCode.Validation, 'missing --title')

    const status = await resolveStatus(client, project, opts.status)
    const priority = await resolvePriority(client, opts.priority)
    const assignee = opts.assignee ? await resolveAssignee(opts.assignee) : null
    const body = await readBody(opts)
    const dueDate = opts.due ? parseDate(opts.due, '--due') : null

    const data: Record<string, unknown> = {
      title,
      description: opts.description ?? '',
      status,
      priority,
      assignee,
      labels: opts.label ?? [],
      dueDate,
      kind: 'tracker:issue:default' as Ref<Doc>
    }

    if (!opts.minimal) {
      data.parent = (project._id as unknown) as Ref<Doc>
      data.project = (project._id as unknown) as Ref<Project>
    }

    if (body) data.description = new MarkupContent(body, 'markdown')

    if (opts.dryRun) {
      console.log('would create issue:')
      console.log(JSON.stringify({ _class: CLASS.Issue, space: project._id, data }, null, 2))
      return
    }

    const id = await withSpinner('Creating issue…', () =>
      client.createDoc(CLASS.Issue as Ref<Class<Issue>>, project._id as unknown as Ref<Space>, data as any)
    )

    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, identifier: '?', title, ...data })
      return
    }
    console.log(`created issue: ${title} (${id})`)
  } finally {
    await client.close()
  }
}

export async function updateIssue(
  ref: string,
  opts: {
    set?: string[]
    unset?: string[]
    status?: string
    priority?: string
    assignee?: string
    title?: string
    dryRun?: boolean
    minimal?: boolean
    workspace?: string
    url?: string
  }
): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: id as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)

    const project = await client.findOne(CLASS.Project as Ref<Class<Project>>, { _id: issue.space as Ref<Project> })
    if (!project) throw new CliError(ExitCode.NotFound, 'project space not found')

    const ops: Record<string, unknown> = {}
    for (const item of opts.set ?? []) {
      const eq = item.indexOf('=')
      if (eq < 0) throw new CliError(ExitCode.Validation, `invalid --set entry (expected key=value): ${item}`)
      const k = item.slice(0, eq).trim()
      let v: unknown = item.slice(eq + 1).trim()
      if (v === 'true') v = true
      else if (v === 'false') v = false
      else if (/^-?\d+(\.\d+)?$/.test(String(v))) v = Number(v)
      ops[k] = v
    }
    for (const k of opts.unset ?? []) ops[k] = null

    if (opts.status) ops.status = await resolveStatus(client, project, opts.status)
    if (opts.priority) ops.priority = await resolvePriority(client, opts.priority)
    if (opts.assignee) ops.assignee = await resolveAssignee(opts.assignee)
    if (opts.title) ops.title = opts.title

    if (opts.dryRun) {
      console.log(`would update issue ${issue.identifier} (${issue._id}):`)
      console.log(JSON.stringify({ _class: CLASS.Issue, objectId: issue._id, space: issue.space, ops }, null, 2))
      return
    }

    await withSpinner('Updating…', () =>
      client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, ops as any)
    )
    console.log(`updated issue: ${issue.identifier} (${issue._id})`)
  } finally {
    await client.close()
  }
}

export async function deleteIssues(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    if (!opts.yes && ids.length > 1) {
      console.error(`warning: deleting ${ids.length} issues; pass --yes to confirm`)
    }
    let deleted = 0
    let skipped = 0
    for (const id of ids) {
      const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: id as Ref<Issue> })
      if (!issue) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally {
    await client.close()
  }
}