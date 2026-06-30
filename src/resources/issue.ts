import type { Doc, Ref, Space, Class, DocumentQuery, FindResult } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv, header, withTimeout, COLUMNS, C, colorizeStatus, colorizePriority, statusGlyph, priorityGlyph, relTime, isoDate, isoDay, success, updated, bulkRemoved } from "../output/format.js"
import { resolveAssignee } from "./_helpers.js"
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
  const idx = await buildIndex<Project>(client, CLASS.Project as Ref<Class<Project>>)
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
  const ofAttribute = 'tracker:attribute:IssueStatus' as Ref<Doc>
  const statuses = (await client.findAll(CLASS.IssueStatus as Ref<Class<Doc>>, { ofAttribute })) as Doc[]
  if (statuses.length === 0) {
    await ensureDefaultStatuses(client, project)
    const rechecked = (await client.findAll(CLASS.IssueStatus as Ref<Class<Doc>>, { ofAttribute })) as Doc[]
    if (rechecked.length === 0) {
      throw new CliError(ExitCode.NotFound,
        `no IssueStatus in workspace; tried to auto-seed but the workspace model may be missing tracker attributes`,
        'try running: huly issue create with --status in another workspace, then come back')
    }
    return rechecked.sort((a, b) => ((a as { rank?: number }).rank ?? 0) - ((b as { rank?: number }).rank ?? 0))[0]._id
  }
  return statuses.sort((a, b) => ((a as { rank?: number }).rank ?? 0) - ((b as { rank?: number }).rank ?? 0))[0]._id
}

/**
 * Auto-seed a default set of IssueStatus records into a project that has none.
 * Models after the model-tracker migration's classicStatuses:
 *   Backlog / To do / In progress / Done / Canceled
 * The space is the model space (core:space:Model) per the platform
 * pattern — IssueStatus is a model entity, not a per-project entity.
 */
async function ensureDefaultStatuses(client: PlatformClient, project: Project): Promise<void> {
  const ofAttribute = 'tracker:attribute:IssueStatus' as Ref<Doc>
  const defaults = [
    { name: 'Backlog', color: 0, rank: '0|aaaaa:' },
    { name: 'To do', color: 0, rank: '1|aaaaa:' },
    { name: 'In progress', color: 0, rank: '2|aaaaa:' },
    { name: 'Done', color: 0, rank: '3|aaaaa:' },
    { name: 'Canceled', color: 0, rank: '4|aaaaa:' }
  ]
  // The CLI's local model believes IssueStatus inherits AttachedDoc (false).
  // createDoc refuses to create AttachedDoc instances, so seeding fails.
  // The workspace pod's model-upgrade txes may have already created these
  // statuses — firstStatus will detect that on the second try.
  for (const s of defaults) {
    try {
      await client.createDoc(
        CLASS.IssueStatus as Ref<Class<Doc>>,
        'core:space:Model' as Ref<Space>,
        {
          ofAttribute,
          name: s.name,
          color: s.color,
          rank: s.rank,
          space: project._id
        } as any
      )
    } catch {
      // ignore — local model routing failure or already-exists
    }
  }
}

async function resolveStatus(client: PlatformClient, project: Project, name?: string): Promise<Ref<Doc>> {
  if (!name) return await firstStatus(client, project)
  const ofAttribute = 'tracker:attribute:IssueStatus' as Ref<Doc>
  const all = (await client.findAll(CLASS.IssueStatus as Ref<Class<Doc>>, { ofAttribute })) as Array<Doc & { label?: string; name?: string }>
  const hit = all.find((s) => s.label?.toLowerCase() === name.toLowerCase() || s.name?.toLowerCase() === name.toLowerCase())
  if (!hit) throw new CliError(ExitCode.NotFound, `status ${name} not found in workspace; available: ${all.map((s) => s.label ?? s.name).join(', ')}`)
  return hit._id
}

async function resolvePriority(client: PlatformClient, name?: string): Promise<Ref<Doc> | undefined> {
  // TypeIssuePriority lives in DOMAIN_MODEL. The CLI's local model is incomplete
  // so both client.findAll (local model) and conn.findAll (server may not have
  // tracker migration applied) can return 0. As a last resort, fall back to the
  // well-known classic tracker priority IDs which are deterministic across
  // workspaces (derived from the rank value).
  const conn = (client as unknown as { connection?: { findAll: <T extends Doc>(_class: Ref<Class<T>>, query: DocumentQuery<T>) => Promise<FindResult<T>> } }).connection
  const queryAll = async (): Promise<Array<Doc & { label?: string; name?: string }>> => {
    if (conn !== undefined) {
      const r = await conn.findAll(CLASS.TypeIssuePriority as Ref<Class<Doc>>, {})
      return (r as unknown as Array<Doc & { label?: string; name?: string }>)
    }
    const r = await client.findAll(CLASS.TypeIssuePriority as Ref<Class<Doc>>, {})
    return (r as unknown as Array<Doc & { label?: string; name?: string }>)
  }
  if (name) {
    const all = await queryAll()
    const hit = all.find((p) => p.label?.toLowerCase() === name.toLowerCase() || p.name?.toLowerCase() === name.toLowerCase())
    if (hit) return hit._id
    // CLI-13: explicit --priority with no matching priority must throw
    // rather than silently dropping the user input.
    const available = all.map((p) => p.label ?? p.name ?? '').filter(Boolean)
    throw new CliError(
      ExitCode.Validation,
      `priority "${name}" not found in this workspace`,
      `available priorities: ${available.length > 0 ? available.join(', ') : '(none — workspace may not have tracker migration applied)'}`
    )
  }
  const all = await queryAll()
  const normal = all.find((p) => p.label === 'Normal')
  if (normal) return normal._id
  if (all.length > 0) return all[0]._id
  // No priorities and no migration. Skip priority — the issue will be created
  // without a priority field (workspaces without migration have no priorities
  // but can still create issues via direct tx).
  return undefined
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
    if (opts.assignee) query.assignee = await resolveAssignee(client, opts.assignee)
    if (opts.label && opts.label.length > 0) query.labels = { $in: opts.label }

    // Status filter — either direct name or by category
    if (opts.status) {
      let proj = project
      if (!proj) {
        // Try workspace env var first, then pick the first project
        const env = readEnv()
        if (env.project) proj = await resolveProject(client, env.project)
        else {
          const all = (await client.findAll(CLASS.Project as Ref<Class<Project>>, {})) as Project[]
          proj = all[0] ?? null
        }
      }
      if (!proj) throw new CliError(ExitCode.Validation, '--status requires a project (use --project)')
      query.status = await resolveStatus(client, proj, opts.status)
    } else if (opts.statusCategory) {
      const wanted = String(opts.statusCategory)
      const valid = ['UnStarted', 'ToDo', 'Active', 'Won', 'Lost']
      if (!valid.includes(wanted)) {
        throw new CliError(ExitCode.Validation, `invalid --status-category: ${wanted}`, `expected one of ${valid.join(' | ')}`)
      }
      // CLI-11: statusCategory values are stored as "task:statusCategory:Active".
      // Strip the prefix before comparing. Also resolve a project when one
      // wasn't supplied (statuses are not workspace-global).
      let proj = project
      if (!proj) {
        const all = (await client.findAll(CLASS.Project as Ref<Class<Project>>, {})) as Project[]
        proj = all[0] ?? null
      }
      if (!proj) throw new CliError(ExitCode.Validation, '--status-category requires a project (use --project)')
      const statuses = (await client.findAll(
        CLASS.IssueStatus as Ref<Class<Doc>>,
        { space: proj._id } as any
      )) as Array<Doc & { category?: string; label?: string; name?: string }>
      const stripPrefix = (cat: string): string => cat.replace(/^task:statusCategory:/, '')
      const matchingIds = statuses
        .filter((s) => stripPrefix(String(s.category ?? '')).toLowerCase() === wanted.toLowerCase())
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
      query.description = { $regex: opts.descriptionSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
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
    table(docs as unknown as Record<string, unknown>[], COLUMNS.issue(), { count: true, title: 'issues' })
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
        const body = await withTimeout(
          client.fetchMarkup(CLASS.Issue as Ref<Class<Doc>>, issue._id, 'description', issue.description as any, 'markdown'),
          5000,
          '(body fetch timed out)'
        )
        console.log(body)
        return
      } catch { console.log(String(issue.description)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(issue); return }

    const status = String(issue.status ?? '')
    const priority = String(issue.priority ?? '')
    const identifier = String(issue.identifier ?? '') || '—'
    const title = String(issue.title ?? '(untitled)')

    // Resolve project and parent to friendly names
    let projectName: string | null = null
    if (issue.space) {
      const p = await client.findOne(CLASS.Project as Ref<Class<Project>>, { _id: issue.space as Ref<Project> })
      projectName = p ? String((p as Project).identifier ?? (p as Project).name ?? '') : null
    }
    let parentRef: string | null = null
    if (issue.parent) {
      const p = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: issue.parent as Ref<Issue> })
      parentRef = p ? String((p as Issue).identifier ?? (p as Issue).title ?? (p as Issue)._id) : null
    }
    // Resolve assignee to email from cache
    let assigneeLabel: string | null = null
    if (issue.assignee) {
      const a = await client.findOne(CLASS.Account as Ref<Class<Doc>>, { _id: issue.assignee as Ref<Doc> })
      if (a) {
        const a2 = a as { email?: string; name?: string }
        assigneeLabel = a2.email ?? a2.name ?? null
      }
    }

    const headerTitle = identifier !== '—' ? `Issue ${identifier} — ${title}` : `Issue · ${title}`
    header(headerTitle, { subtitle: `created ${relTime(issue.createdOn as number | null)} · updated ${relTime(issue.modifiedOn as number | null)}` })

    kv([
      ['ID', identifier !== '—' ? C.emphasis(identifier) : C.muted('—')],
      ['Status', `${statusGlyph(status)} ${colorizeStatus(status)}`],
      ['Priority', priorityGlyph(priority)],
      ['Kind', String(issue.kind ?? '—').replace(/^tracker:issue:/, '')],
      ['Project', projectName != null ? C.emphasis(projectName) : C.muted('—')],
      ['Parent', parentRef != null ? C.emphasis(parentRef) : C.muted('—')],
      ['Due', issue.dueDate != null ? isoDay(issue.dueDate) : C.muted('none')],
      ['Labels', Array.isArray(issue.labels) && (issue.labels as unknown[]).length > 0 ? (issue.labels as string[]).join(', ') : C.muted('none')],
      ['Assignee', assigneeLabel != null ? assigneeLabel : C.muted('unassigned')],
      ['Created', issue.createdOn != null ? `${isoDate(issue.createdOn)} (${relTime(issue.createdOn as number | null)})` : C.muted('—')],
      ['Modified', issue.modifiedOn != null ? `${isoDate(issue.modifiedOn)} (${relTime(issue.modifiedOn as number | null)})` : C.muted('—')],
      ['_id', C.id(String(issue._id))]
    ])

    if (issue.description !== '' && issue.description !== undefined && !opts.markdown) {
      console.log()
      console.log(C.emphasis('Description'))
      console.log(C.muted('─'.repeat(20)))
      const desc = String(issue.description)
      console.log(desc.length > 500 ? desc.slice(0, 500) + '…\n' + C.muted('(truncated — use --markdown for full)') : desc)
    }
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
      labels: opts.label ?? [],
      dueDate,
      space: project._id
    }
    if (priority !== undefined) data.priority = priority

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
      // CLI-12: top-level issues must have parent=null so that
      // `issue list --parent null` matches them. Setting parent=project._id
      // would create a phantom parent and break the CLI's own filter.
      data.parent = null
    }

    if (!opts.minimal) {
      data.project = (project._id as unknown) as Ref<Project>
    }

    if (opts.assignee) {
      data.assignee = await resolveAssignee(client, opts.assignee) as Ref<Doc>
    }

    if (body) data.description = body

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
      // Workaround for C3: SDK's local model has incomplete inheritance info and
      // thinks tracker:class:Issue inherits from AttachedDoc. TxOperations.createDoc
      // refuses to create AttachedDoc instances. Bypass by building the TxCreateDoc
      // manually and applying via the raw connection.tx RPC.
      const msg = err instanceof Error ? err.message : String(err)
      if (/createDoc cannot be used for objects inherited from AttachedDoc/i.test(msg)) {
        const conn = (client as unknown as {
          connection?: { tx: (tx: unknown) => Promise<unknown> }
        }).connection
        const txFactory = (client as unknown as {
          client?: {
            txFactory?: {
              createTxCreateDoc: (
                _class: Ref<Class<Doc>>,
                space: Ref<Space>,
                attributes: Record<string, unknown>,
                objectId?: Ref<Doc>
              ) => { _id: string }
            }
          }
        }).client?.txFactory
        if (conn !== undefined && txFactory !== undefined) {
          id = await withSpinner('Creating issue (bypass AttachedDoc check)…', async () => {
            const tx = txFactory.createTxCreateDoc(
              CLASS.Issue as Ref<Class<Doc>>,
              project._id as unknown as Ref<Space>,
              data,
              undefined
            )
            await conn.tx(tx)
            return tx._id as Ref<Doc>
          }) as Ref<Doc>
          if (id === undefined) throw err
        } else {
          throw err
        }
      } else if (/duplicate|exists|already/i.test(msg)) {
        // Idempotency: if an issue with the same title already exists in this project, return it.
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
        throw err
      } else {
        throw err
      }
    }

    invalidateIndex(client, CLASS.Issue)

    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, identifier: '?', title, created: true, ...data })
      return
    }
    // Verify the create succeeded by looking the issue up by the returned _id.
    // We query by _id (not title, which is not unique) so this is race-free
    // even on the bypass path. Note: if the server's stored _id differs from
    // the locally-computed tx._id returned by the bypass path (a known issue
    // when tracker:class:Issue inherits from AttachedDoc), findOne returns
    // null and we silently fall back to the id createDoc returned — that id
    // may not match a server query but is the best signal we have.
    let actualId = id as string
    try {
      const fresh = (await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: id as Ref<Issue> })) as { _id?: string } | null
      if (fresh?._id != null) actualId = fresh._id
    } catch { /* fall through with the local id */ }
    console.log(C.ok('created issue') + C.muted('  ') + C.emphasis(title) + C.muted('  ') + C.id(`(${actualId})`))
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
    description?: string
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
      if (v === 'null') v = null
      else if (v === 'true') v = true
      else if (v === 'false') v = false
      else if (/^-?\d+(\.\d+)?$/.test(String(v))) v = Number(v)
      ops[k] = v
    }
    for (const k of opts.unset ?? []) ops[k] = null

    if (opts.status) ops.status = await resolveStatus(client, project, opts.status)
    if (opts.priority) {
      const p = await resolvePriority(client, opts.priority)
      if (p !== undefined) ops.priority = p
    }
    if (opts.assignee) ops.assignee = await resolveAssignee(client, opts.assignee) as Ref<Doc>
    if (opts.title) ops.title = opts.title
    if (opts.description) ops.description = opts.description
    if (opts.taskType) ops.kind = await resolveTaskType(client, opts.taskType, project)

    if (opts.dryRun) {
      console.log(`would update issue ${issue.identifier} (${issue._id}):`)
      console.log(JSON.stringify({ _class: CLASS.Issue, objectId: issue._id, space: issue.space, ops }, null, 2))
      return
    }

    await withSpinner('Updating…', () =>
      client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, ops as any)
    )
    updated(`updated issue`, issue._id)
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
      throw new CliError(
        ExitCode.Validation,
        `destructive: deleting ${ids.length} issues requires --yes`,
        're-run with --yes to confirm'
      )
    }
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const issue = await client.findOne(CLASS.Issue as Ref<Class<Issue>>, { _id: id as Ref<Issue> })
      if (!issue) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    bulkRemoved(deleted, skipped)
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
    invalidateIndex(client, CLASS.Issue)
    success(`added label`, labelName)
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
    invalidateIndex(client, CLASS.Issue)
    success(`removed label`, labelName)
  } finally { await client.close() }
}

export type RelationType = 'blocks' | 'isBlockedBy' | 'relatesTo'

const RELATION_TYPES: ReadonlyArray<RelationType> = ['blocks', 'isBlockedBy', 'relatesTo']

export function validateRelationType(type: string): RelationType {
  if (!(RELATION_TYPES as ReadonlyArray<string>).includes(type)) {
    throw new CliError(ExitCode.Validation, `invalid --type: ${type}`, `expected one of ${RELATION_TYPES.join(' | ')}`)
  }
  return type as RelationType
}

function relationField(type: RelationType): 'relations' | 'blockedBy' {
  return type === 'isBlockedBy' ? 'blockedBy' : 'relations'
}

function relationTag(type: RelationType): string {
  if (type === 'blocks') return 'blocks'
  if (type === 'isBlockedBy') return 'isBlockedBy'
  return 'relatesTo'
}

export async function addIssueRelation(ref: string, type: string, targetRef: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const rel = validateRelationType(type)
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
    const field = relationField(rel)
    const existing = (issue as unknown as Record<string, RelatedDoc[] | undefined>)[field] ?? []
    const updated = [...existing, { _id: targetId as string, _class: CLASS.Issue }]
    await withSpinner(
      `Adding ${rel} → ${targetRef}…`,
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { [field]: updated } as any),
      opts
    )
    success(`added ${rel}`, ref + ' → ' + targetRef)
  } finally { await client.close() }
}

export async function removeIssueRelation(ref: string, type: string, targetRef: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const rel = validateRelationType(type)
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
    const field = relationField(rel)
    const existing = (issue as unknown as Record<string, RelatedDoc[] | undefined>)[field] ?? []
    const updated = existing.filter((r) => r._id !== targetId)
    await withSpinner(
      `Removing ${rel} → ${targetRef}…`,
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { [field]: updated } as any),
      opts
    )
    success(`removed ${rel}`, ref + ' → ' + targetRef)
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
      { key: 'direction', header: 'DIRECTION', format: (r) => {
        const d = String((r as { direction: string }).direction)
        return d === 'isBlockedBy' ? C.yellow('⛔ is blocked by') : C.muted('↔ relates to')
      } },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as { _id: string })._id).slice(-12)) }
    ], { count: true, title: 'related-issues' })
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
      console.log(C.warn('⚠ document already linked'))
      return
    }
    const updated = [...relations, { _id: docId as string, _class: CLASS.Document }]
    await withSpinner(
      'Linking document…',
      () => client.updateDoc(CLASS.Issue as Ref<Class<Issue>>, issue.space as unknown as Ref<Space>, issue._id, { relations: updated } as any),
      opts
    )
    console.log(C.ok('linked document') + C.muted('  ') + C.emphasis(docRef) + C.muted('  →  ') + C.emphasis(issueRef))
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
    success(`unlinked document`, docRef)
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
      { key: 'ref', header: 'REF', format: (r) => C.emphasis(String((r as { ref: string }).ref)) },
      { key: 'subIssues', header: 'SUB-ISSUES', align: 'right', format: (r) => {
        const n = (r as { subIssues: number }).subIssues
        return n > 0 ? String(n) : C.muted('0')
      } },
      { key: 'relations', header: 'RELATIONS', align: 'right', format: (r) => {
        const n = (r as { relations: number }).relations
        return n > 0 ? String(n) : C.muted('0')
      } }
    ], { count: true, title: 'delete-preview' })
  } finally { await client.close() }
}

export async function relatedTargets(ref: string, opts: { project?: string; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProject(client, opts.project)
    const targets = (await client.findAll(CLASS.RelatedIssueTarget as Ref<Class<Doc>>, { space: project._id })) as Doc[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(targets); return }
    table(targets as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE', format: (r) => C.emphasis(String((r as { title: string }).title ?? '')) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as { _id: string })._id).slice(-12)) }
    ], { count: true, title: 'related-targets' })
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
