import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'
import { pickProject } from '../auth/prompts.js'

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

type RelatedDoc = { _id: string; _class?: string; [k: string]: unknown }

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
  taskType?: string
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
  if (all.length === 0) throw new CliError(ExitCode.NotFound, 'no projects in workspace')
  return await pickProject(all, 'Project:')
}

async function firstStatus(client: PlatformClient, project: Project): Promise<Ref<Doc>> {
  const statuses = (await client.findAll(CLASS.IssueStatus as Ref<Class<Doc>>, { space: project._id })) as Doc[]
  if (statuses.length === 0) throw new CliError(ExitCode.NotFound, `no IssueStatus in project ${project.identifier} — run \`huly project create\` via template first`)
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

async function resolveTaskType(client: PlatformClient, name: string, project: Project): Promise<Ref<Doc>> {
  const taskTypes = (await client.findAll(CLASS.TaskType as Ref<Class<Doc>>, { space: project._id })) as Array<Doc & { label?: string; name?: string }>
  const hit = taskTypes.find((t) =>
    (t.label?.toLowerCase() === name.toLowerCase()) ||
    (t.name?.toLowerCase() === name.toLowerCase()) ||
    String(t._id) === name
  )
  if (!hit) {
    throw new CliError(ExitCode.NotFound,
      `task type ${name} not found in project ${project.identifier}`,
      `available: ${taskTypes.map((t) => t.label ?? t.name ?? t._id).join(', ') || '(none)'}`)
  }
  return hit._id
}

export async function listIssues(opts: {
  project?: string
  status?: string
  statusCategory?: string
  descriptionSearch?: string
  parent?: string
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
    if (opts.assignee) query.assignee = opts.assignee
    if (opts.label && opts.label.length > 0) query.labels = { $in: opts.label }

    // Status filter — either direct name or by category
    if (opts.status) {
      query.status = opts.status
    } else if (opts.statusCategory) {
      const wanted = String(opts.statusCategory)
      const valid = ['UnStarted', 'ToDo', 'Active', 'Won', 'Lost']
      if (!valid.includes(wanted)) {
        throw new CliError(ExitCode.Validation, `invalid --status-category: ${wanted}`, `expected one of ${valid.join(' | ')}`)
      }
      const statusQuery: Record<string, unknown> = { space: project?._id }
      const statuses = (await client.findAll(
        CLASS.IssueStatus as Ref<Class<Doc>>,
        statusQuery as any
      )) as Array<Doc & { category?: string; label?: string; name?: string }>
      const matchingIds = statuses
        .filter((s) => String(s.category ?? '').toLowerCase() === wanted.toLowerCase())
        .map((s) => s._id)
      if (matchingIds.length === 0) {
        console.log('(no statuses in that category)')
        return
      }
      query.status = { $in: matchingIds }
    }

    // Description search — best-effort full-text via the REST API. The
    // PlatformClient (websocket) doesn't expose searchFulltext, so we use
    // a regex match on the description field (which is a markup blob) when
    // possible. If the server doesn't support that pattern, results will be
    // an empty set, which is no worse than not searching.
    if (opts.descriptionSearch) {
      query.description = { $regex: opts.descriptionSearch, $options: 'i' }
    }

    // Parent filter
    if (opts.parent !== undefined) {
      const parentRef = opts.parent === 'null' || opts.parent === '-'
        ? null
        : await resolveRef(opts.parent, {
          client,
          classId: CLASS.Issue as Ref<Class<Doc>>,
          workspaceId: (await client.getAccount()).uuid,
          defaultProjectIdentifier: readEnv().project
        })
      query.parent = parentRef
    }

    const result = (await withSpinner('Loading issues…', () =>
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
  } finally { await client.close() }
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
      try {
        const body = await client.fetchMarkup(CLASS.Issue as Ref<Class<Doc>>, issue._id, 'description', issue.description as any, 'markdown')
        console.log(body)
        return
      } catch { console.log(String(issue.description)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(issue); return }
    console.log(`${issue.identifier} ${issue.title}`)
    console.log(JSON.stringify(issue, null, 2))
  } finally { await client.close() }
}

export async function createIssue(opts: IssueCreateOpts): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProject(client, opts.project)
    const title = opts.title
    if (!title) throw new CliError(ExitCode.Validation, 'missing --title')

    const status = await resolveStatus(client, project, opts.status)
    const priority = await resolvePriority(client, opts.priority)
    const body = await readBody(opts)
    const dueDate = opts.due ? parseDate(opts.due, '--due') : null

    const data: Record<string, unknown> = {
      title,
      description: opts.description ?? '',
      status,
      priority,
      labels: opts.label ?? [],
      dueDate
    }

    if (opts.taskType) {
      data.kind = await resolveTaskType(client, opts.taskType, project)
    } else {
      data.kind = 'tracker:issue:default' as Ref<Doc>
    }

    if (opts.parent) {
      const parentAccount = await client.getAccount()
      data.parent = await resolveRef(opts.parent, {
        client,
        classId: CLASS.Issue as Ref<Class<Doc>>,
        workspaceId: parentAccount.uuid,
        defaultProjectIdentifier: readEnv().project
      }) as Ref<Doc>
    } else if (!opts.minimal) {
      data.parent = (project._id as unknown) as Ref<Doc>
    }

    if (!opts.minimal) {
      data.project = (project._id as unknown) as Ref<Project>
    }

    if (body) data.description = new MarkupContent(body, 'markdown')

    if (opts.dryRun) {
      console.log('would create issue:')
      console.log(JSON.stringify({ _class: CLASS.Issue, space: project._id, data }, null, 2))
      return
    }

    let id: Ref<Doc>
    try {
      id = await withSpinner('Creating issue…', () =>
        client.createDoc(CLASS.Issue as Ref<Class<Issue>>, project._id as unknown as Ref<Space>, data as any)
      )
    } catch (err: unknown) {
      // Idempotency: if an issue with the same title already exists in this project, return it.
      const msg = err instanceof Error ? err.message : String(err)
      if (/duplicate|exists|already/i.test(msg)) {
        const existing = (await client.findAll(CLASS.Issue as Ref<Class<Issue>>, {
          space: project._id,
          title
        })) as Issue[]
        if (existing.length > 0) {
          const found = existing[0]
          if (shouldJson({ json: opts.json, ci: opts.ci })) {
            json({ _id: found._id, identifier: found.identifier, title, created: false })
          } else {
            console.log(`issue exists: ${found.identifier ?? found._id} (${found.title})`)
          }
          return
        }
      }
      throw err
    }

    invalidateIndex((await client.getAccount()).uuid, CLASS.Issue)

    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, identifier: '?', title, created: true, ...data })
      return
    }
    console.log(`created issue: ${title} (${id})`)
  } finally { await client.close() }
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
    taskType?: string
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
    if (opts.title) ops.title = opts.title
    if (opts.taskType) ops.kind = await resolveTaskType(client, opts.taskType, project)

    if (opts.dryRun) {
      console.log(`would update issue ${issue.identifier} (${issue._id}):`)
      console.log(JSON.stringify({ _class: CLASS.Issue, objectId: issue._id, space: issue.space, ops }, null, 2))
      return
    }

    await withSpinner('Updating…', () =>
      client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, ops as any)
    )
    console.log(`updated issue: ${issue.identifier} (${issue._id})`)
  } finally { await client.close() }
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
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: id as Ref<Issue> })
      if (!issue) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

// ---- Phase 3 additions ----

export async function addIssueLabel(ref: string, labelName: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const issueId = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: issueId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)
    // Find or create the TagElement (label).
    const tagClass = 'tags:class:TagElement' as Ref<Class<Doc>>
    const existingTags = (await client.findAll(tagClass, { title: labelName })) as Array<Doc & { targetClass?: Ref<Class<Doc>> }>
    let tagId: Ref<Doc>
    const targetClass = CLASS.Issue
    const matchingTag = existingTags.find((t) => t.targetClass === targetClass || t.targetClass === undefined)
    if (matchingTag) {
      tagId = matchingTag._id
    } else {
      // Find a category for tags
      const categories = (await client.findAll('tags:class:TagCategory' as Ref<Class<Doc>>, {})) as Doc[]
      const category = categories[0]?._id as Ref<Doc> | undefined
      tagId = await withSpinner(
        'Creating label…',
        () => client.createDoc(tagClass, 'tags:space:Tag' as Ref<Space>, {
          title: labelName,
          targetClass,
          description: '',
          color: 0,
          category
        } as any),
        opts
      )
    }
    // Add as TagReference collection.
    await withSpinner(
      'Adding label…',
      () => client.addCollection(
        'tags:class:TagReference' as Ref<Class<Doc>>,
        issue.space as Ref<Space>,
        issue._id,
        CLASS.Issue,
        'labels',
        { tag: tagId, title: labelName, color: 0 } as any
      ),
      opts
    )
    invalidateIndex(account.uuid, CLASS.Issue)
    console.log(`added label: ${labelName}`)
  } finally { await client.close() }
}

export async function removeIssueLabel(ref: string, labelName: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const issueId = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: issueId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)
    const tagClass = 'tags:class:TagElement' as Ref<Class<Doc>>
    const tag = (await client.findAll(tagClass, { title: labelName }))[0] as (Doc & { _id: Ref<Doc> }) | undefined
    if (!tag) throw new CliError(ExitCode.NotFound, `label ${labelName} not found`)
    const refs = (await client.findAll('tags:class:TagReference' as Ref<Class<Doc>>, {
      attachedTo: issue._id,
      tag: tag._id
    })) as Doc[]
    if (refs.length === 0) throw new CliError(ExitCode.NotFound, `label ${labelName} not on issue ${ref}`)
    for (const r of refs) {
      await client.removeCollection(
        'tags:class:TagReference' as Ref<Class<Doc>>,
        issue.space as Ref<Space>,
        r._id,
        issue._id,
        CLASS.Issue,
        'labels'
      )
    }
    invalidateIndex(account.uuid, CLASS.Issue)
    console.log(`removed label: ${labelName}`)
  } finally { await client.close() }
}

export type RelationType = 'blocks' | 'isBlockedBy' | 'relatesTo'

function relationField(type: RelationType): 'relations' | 'blockedBy' {
  return type === 'isBlockedBy' ? 'blockedBy' : 'relations'
}

function relationTag(type: RelationType): string {
  if (type === 'blocks') return 'blocks'
  if (type === 'isBlockedBy') return 'isBlockedBy'
  return 'relatesTo'
}

export async function addIssueRelation(ref: string, type: RelationType, targetRef: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const sourceId = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const targetId = await resolveRef(targetRef, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: sourceId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)
    const field = relationField(type)
    const existing = (issue as unknown as Record<string, RelatedDoc[] | undefined>)[field] ?? []
    const updated = [...existing, { _id: targetId as string, _class: CLASS.Issue }]
    await withSpinner(
      `Adding ${type} → ${targetRef}…`,
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { [field]: updated } as any),
      opts
    )
    console.log(`added ${type}: ${ref} → ${targetRef}`)
  } finally { await client.close() }
}

export async function removeIssueRelation(ref: string, type: RelationType, targetRef: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const sourceId = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const targetId = await resolveRef(targetRef, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: sourceId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)
    const field = relationField(type)
    const existing = (issue as unknown as Record<string, RelatedDoc[] | undefined>)[field] ?? []
    const updated = existing.filter((r) => r._id !== targetId)
    await withSpinner(
      `Removing ${type} → ${targetRef}…`,
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { [field]: updated } as any),
      opts
    )
    console.log(`removed ${type}: ${ref} → ${targetRef}`)
  } finally { await client.close() }
}

export async function listIssueRelations(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const issueId = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: issueId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)
    const relations = (issue as unknown as { relations?: RelatedDoc[] }).relations ?? []
    const blockedBy = (issue as unknown as { blockedBy?: RelatedDoc[] }).blockedBy ?? []
    const rows = [
      ...relations.map((r) => ({ direction: 'relatesTo', _id: r._id })),
      ...blockedBy.map((r) => ({ direction: 'isBlockedBy', _id: r._id }))
    ]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(rows); return }
    table(rows as unknown as Record<string, unknown>[], [
      { key: 'direction', header: 'DIRECTION' },
      { key: '_id', header: '_ID' }
    ])
  } finally { await client.close() }
}

export async function linkDocument(issueRef: string, docRef: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const issueId = await resolveRef(issueRef, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const docId = await resolveRef(docRef, {
      client,
      classId: CLASS.Document as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: issueId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${issueRef} not found`)
    const relations = ((issue as unknown as { relations?: RelatedDoc[] }).relations ?? [])
    if (relations.some((r) => r._id === docId)) {
      console.log(`document already linked`)
      return
    }
    const updated = [...relations, { _id: docId as string, _class: CLASS.Document }]
    await withSpinner(
      'Linking document…',
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { relations: updated } as any),
      opts
    )
    console.log(`linked document: ${docRef} → ${issueRef}`)
  } finally { await client.close() }
}

export async function unlinkDocument(issueRef: string, docRef: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const issueId = await resolveRef(issueRef, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const docId = await resolveRef(docRef, {
      client,
      classId: CLASS.Document as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: issueId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${issueRef} not found`)
    const relations = ((issue as unknown as { relations?: RelatedDoc[] }).relations ?? [])
    const updated = relations.filter((r) => r._id !== docId)
    await withSpinner(
      'Unlinking document…',
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { relations: updated } as any),
      opts
    )
    console.log(`unlinked document: ${docRef}`)
  } finally { await client.close() }
}

export async function moveIssue(ref: string, parentRef: string | null, opts: { json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const issueId = await resolveRef(ref, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: issueId as Ref<Issue> })
    if (!issue) throw new CliError(ExitCode.NotFound, `issue ${ref} not found`)

    let newParent: Ref<Doc> | null = null
    if (parentRef && parentRef !== 'null' && parentRef !== '-') {
      newParent = await resolveRef(parentRef, {
        client,
        classId: CLASS.Issue as Ref<Class<Doc>>,
        workspaceId: account.uuid,
        defaultProjectIdentifier: readEnv().project
      }) as Ref<Doc>
    }
    if (opts.dryRun) {
      console.log(`would move ${ref} → parent=${newParent ?? 'null'}`)
      return
    }
    await withSpinner(
      'Moving…',
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { parent: newParent } as any),
      opts
    )
    console.log(`moved ${ref} → ${parentRef ?? 'null'}`)
  } finally { await client.close() }
}

export async function previewDelete(refs: string[], opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Issue as Ref<Class<Doc>>,
      workspaceId: account.uuid,
      defaultProjectIdentifier: readEnv().project
    })
    const preview: Array<{ ref: string; subIssues: number; comments: number; relations: number }> = []
    for (const id of ids) {
      const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: id as Ref<Issue> })
      if (!issue) continue
      const subIssues = (await client.findAll(CLASS.Issue as Ref<Class<Issue>>, { parent: id as Ref<Doc> })).length
      const relations = ((issue as unknown as { relations?: unknown[] }).relations ?? []).length +
        ((issue as unknown as { blockedBy?: unknown[] }).blockedBy ?? []).length
      preview.push({
        ref: id,
        subIssues,
        comments: 0,
        relations
      })
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(preview); return }
    table(preview as unknown as Record<string, unknown>[], [
      { key: 'ref', header: 'REF' },
      { key: 'subIssues', header: 'SUB-ISSUES' },
      { key: 'relations', header: 'RELATIONS' }
    ])
  } finally { await client.close() }
}

export async function relatedTargets(ref: string, opts: { project?: string; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProject(client, opts.project)
    const targets = (await client.findAll(CLASS.RelatedIssueTarget as Ref<Class<Doc>>, { space: project._id })) as Doc[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(targets); return }
    table(targets as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE' },
      { key: '_id', header: '_ID', format: (r) => String((r as { _id: string })._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function setRelatedTarget(opts: { project?: string; source?: string; target?: string; json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string }): Promise<void> {
  if (!opts.source) throw new CliError(ExitCode.Validation, 'missing --source')
  if (!opts.target) throw new CliError(ExitCode.Validation, 'missing --target')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProject(client, opts.project)
    const data = { source: opts.source, target: opts.target, space: project._id }
    if (opts.dryRun) {
      console.log('would set related-issue-target:')
      console.log(JSON.stringify({ _class: CLASS.RelatedIssueTarget, space: project._id, data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating related-issue-target…',
      () => client.createDoc(CLASS.RelatedIssueTarget as Ref<Class<Doc>>, project._id as unknown as Ref<Space>, data as any),
      opts
    )
    console.log(`created related-issue-target: ${id}`)
  } finally { await client.close() }
}
