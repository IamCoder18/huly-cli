import type { Doc, Ref, Space, Class, Account } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv, header, COLUMNS, C, success, relTime, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { pickProject } from '../auth/prompts.js'
import { readEnv } from '../auth/env.js'
import type { GlobalOpts } from '../cli.js'
import { parseSet } from './project.parse.js'
import { resolveProjectForCommand } from './_project-resolve.js'

type Project = Doc & {
  name: string
  identifier: string
  description?: string
  private?: boolean
  archived?: boolean
}

type IssueStatus = Doc & {
  label?: string
  name?: string
  category?: string
  rank?: number
}

type ProjectTargetPreference = Doc & {
  attachedTo: Ref<Project>
  props?: { key: string, value: unknown }[]
}

export async function listProjects(opts: { json?: boolean; ci?: boolean; limit?: number; offset?: number; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const result = (await withSpinner('Loading…', () => client.findAll(CLASS.Project as Ref<Class<Project>>, {}), opts)) as unknown as Project[]
    let docs = result
    if (opts.offset && opts.offset > 0) docs = docs.slice(opts.offset)
    if (opts.limit && opts.limit > 0) docs = docs.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], COLUMNS.project(), { count: true, title: 'projects' })
  } finally {
    await client.close()
  }
}

export async function getProject(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Project as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Project as Ref<Class<Project>>, { _id: id as Ref<Project> })
    if (!doc) throw new CliError(ExitCode.NotFound, `project ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`Project — ${doc.name ?? '(unnamed)'}`, { subtitle: `created ${relTime(doc.createdOn as number | null)}` })
    kv([
      ['ID', C.emphasis(doc.identifier ?? '—')],
      ['Name', String(doc.name ?? '—')],
      ['Description', doc.description ? String(doc.description) : C.muted('(none)')],
      ['Archived', doc.archived ? C.warn('yes') : C.muted('no')],
      ['Private', doc.private ? C.warn('yes') : C.muted('no')],
      ['Members', doc.members != null ? C.muted(`${(doc.members as unknown[]).length}`) : C.muted('—')],
      ['_id', C.id(String(doc._id))],
      ['Space', C.id(String(doc._id))]
    ])
  } finally {
    await client.close()
  }
}

export async function createProject(opts: {
  name?: string
  identifier?: string
  description?: string
  private?: boolean
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  minimal?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.name) throw new CliError(ExitCode.Validation, 'missing --name')
  if (!opts.identifier) throw new CliError(ExitCode.Validation, 'missing --identifier (e.g. HULY)')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  let currentAccountUuid: string
  try {
    currentAccountUuid = (await client.getAccount()).uuid
  } catch {
    // No account / no workspace — fall through; data.members will be empty
    currentAccountUuid = ''
  }
  const data: Record<string, unknown> = {
    name: opts.name,
    identifier: opts.identifier,
    description: opts.description ?? '',
    private: opts.private ?? false,
    archived: false,
    // Add the current user as a member so SpaceSecurityMiddleware allows
    // findAll on this project. Without this, list/get returns 0 because
    // the security filter restricts the query to spaces the user is in.
    members: currentAccountUuid !== '' ? [currentAccountUuid] : [],
    sequence: 0
  }
  if (opts.minimal) {
    delete data.description
    // Note: members MUST stay set to the current user UUID, otherwise
    // SpaceSecurityMiddleware.mergeQuery returns { $in: [] } and the
    // creator can never findAll the project. --minimal only controls
    // user-facing description, not security-critical fields.
  }
  if (opts.dryRun) {
    console.log('would create project:')
    console.log(JSON.stringify({ _class: CLASS.Project, space: '<self>', data }, null, 2))
    return
  }
  try {
    // Idempotency: if a project with this identifier already exists, return it
    // without creating a duplicate. The Huly selfhost does not enforce
    // identifier uniqueness at the DB level.
    const existing = (await client.findAll(
      CLASS.Project as Ref<Class<Project>>,
      { identifier: opts.identifier }
    )) as Project[]
    if (existing.length > 0) {
      const found = existing[0]
      if (shouldJson({ json: opts.json, ci: opts.ci })) {
        json({ _id: found._id, identifier: found.identifier, name: found.name, created: false })
      } else {
        console.log(`project exists: ${found.identifier} (${found._id})`)
      }
      return
    }
    const domain = client.getHierarchy().getDomain(CLASS.Project as Ref<Class<Doc>>) as unknown as Ref<Space>
    let id: Ref<Project>
    try {
      id = await withSpinner(
        'Creating project…',
        () => client.createDoc(CLASS.Project as Ref<Class<Project>>, domain, data as any),
        opts
      )
    } catch (err: unknown) {
      // Idempotency: if project with this identifier already exists, return it.
      const msg = err instanceof Error ? err.message : String(err)
      if (/already exists|duplicate|exists/i.test(msg)) {
        const existing = (await client.findAll(CLASS.Project as Ref<Class<Project>>, {
          identifier: opts.identifier!
        })) as Project[]
        if (existing.length > 0) {
          const existingDoc = existing[0]
          if (shouldJson({ json: opts.json, ci: opts.ci })) {
            json({ _id: existingDoc._id, identifier: existingDoc.identifier, ...data, created: false })
          } else {
            console.log(`project exists: ${existingDoc.identifier} (${existingDoc._id})`)
          }
          return
        }
      }
      throw err
    }
    invalidateIndex(client, CLASS.Project)
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, ...data, created: true })
    } else {
      success(`created project`, opts.identifier ?? id, id)
    }
  } finally {
    await client.close()
  }
}

export async function updateProject(
  ref: string,
  opts: { set?: string[]; unset?: string[]; json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string }
): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Project as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const setOps = parseSet(opts.set ?? [])
    const unsetOps = opts.unset ?? []
    // `--set field=null` is an explicit clear (we already coerce null in parseSet).
    if (Object.keys(setOps).length === 0 && unsetOps.length === 0) {
      throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --set key=value or --unset key')
    }
    if (opts.dryRun) {
      console.log(`would update ${id}: set=${JSON.stringify(setOps)} unset=${JSON.stringify(unsetOps)}`)
      return
    }
    await withSpinner('Updating…', () =>
      client.updateDoc(
        CLASS.Project as Ref<Class<Project>>,
        id as unknown as Ref<Space>,
        id as Ref<Project>,
        { ...setOps, ...Object.fromEntries(unsetOps.map((k) => [k, null])) }
      ),
      opts
    )
    invalidateIndex(client, CLASS.Project)
    console.log(`updated project: ${id}`)
  } finally {
    await client.close()
  }
}

export async function deleteProjects(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Project as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) {
      throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} projects requires --yes`, 're-run with --yes to confirm')
    }
    let deleted = 0
    let skipped = 0
    for (const id of ids) {
      const r = await deleteDoc(client, CLASS.Project as Ref<Class<Project>>, id as unknown as Ref<Space>, id as Ref<Project>, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    invalidateIndex(client, CLASS.Project)
    bulkRemoved(deleted, skipped)
  } finally {
    await client.close()
  }
}

export async function pickProjectInteractive(client: PlatformClient): Promise<Project> {
  const env = readEnv()
  if (env.project) {
    const account = await client.getAccount()
    const idx = await buildIndex<Project>(client, CLASS.Project as Ref<Class<Project>>, account.uuid)
    const hit = idx.get(env.project)
    if (hit) {
      const doc = await client.findOne(CLASS.Project as Ref<Class<Project>>, { _id: hit as Ref<Project> })
      if (doc) return doc
    }
  }
  const all = await client.findAll(CLASS.Project as Ref<Class<Project>>, {})
  return await pickProject<Project>(all as unknown as Project[], 'Project:')
}

// ---- Phase 2 additions: statuses + target preferences ----

export async function listStatuses(opts: { project?: string; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    const statuses = (await withSpinner(
      `Loading statuses for ${project.identifier}…`,
      () => client.findAll(CLASS.IssueStatus as Ref<Class<IssueStatus>>, { ofAttribute: 'tracker:attribute:IssueStatus' as Ref<Doc> }),
      opts
    )) as IssueStatus[]
    const sorted = statuses.slice().sort((a, b) => ((a as { rank?: number }).rank ?? 0) - ((b as { rank?: number }).rank ?? 0))
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(sorted); return }
    table(sorted as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME' },
      { key: 'category', header: 'CATEGORY', format: (r) => String((r as { category?: string }).category ?? '').replace(/^task:statusCategory:/, '') },
      { key: 'rank', header: 'RANK' },
      { key: '_id', header: '_ID', format: (r) => String((r as { _id: string })._id).split(':').pop() ?? String((r as { _id: string })._id) }
    ], { count: true, title: 'statuses' })
  } finally {
    await client.close()
  }
}

export async function listTargetPreferences(opts: { project?: string; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    const prefs = (await client.findAll(CLASS.ProjectTargetPreference as Ref<Class<ProjectTargetPreference>>, {
      attachedTo: project._id
    })) as ProjectTargetPreference[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(prefs); return }
    if (prefs.length === 0) {
      console.log('(no target preferences)')
      return
    }
    for (const p of prefs) {
      kv([
        ['_id', p._id],
        ['attachedTo', p.attachedTo],
        ['usedOn', p.usedOn ? new Date(p.usedOn).toISOString() : '—'],
        ['props', String(p.props?.length ?? 0)]
      ])
    }
  } finally {
    await client.close()
  }
}

export async function upsertTargetPreference(opts: {
  project?: string
  props?: string[]
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.props || opts.props.length === 0) {
    throw new CliError(ExitCode.Validation, 'missing --props key=value (repeatable)')
  }
  const props: { key: string; value: unknown }[] = []
  for (const item of opts.props) {
    const eq = item.indexOf('=')
    if (eq < 0) throw new CliError(ExitCode.Validation, `invalid --props entry: ${item}`)
    const key = item.slice(0, eq).trim()
    let value: unknown = item.slice(eq + 1).trim()
    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (/^-?\d+(\.\d+)?$/.test(String(value))) value = Number(value)
    props.push({ key, value })
  }

  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    const existing = (await client.findAll(CLASS.ProjectTargetPreference as Ref<Class<ProjectTargetPreference>>, {
      attachedTo: project._id
    })) as ProjectTargetPreference[]

    if (existing.length === 0) {
      if (opts.dryRun) {
        console.log('would create target preference:')
        console.log(JSON.stringify({
          _class: CLASS.ProjectTargetPreference,
          attachedTo: project._id,
          usedOn: Date.now(),
          props
        }, null, 2))
        return
      }
      const id = await withSpinner(
        'Creating target preference…',
        () => client.createDoc(
          CLASS.ProjectTargetPreference as Ref<Class<ProjectTargetPreference>>,
          project._id as unknown as Ref<Space>,
          { attachedTo: project._id, usedOn: Date.now(), props } as any,
        ),
        opts
      )
      if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, attachedTo: project._id, props }) }
      else success('created target preference', id)
      return
    }

    // Upsert: merge props into the first existing preference.
    const first = existing[0]
    const merged: { key: string; value: unknown }[] = [
      ...(first.props ?? []).filter((p) => !props.some((np) => np.key === p.key)),
      ...props
    ]
    if (opts.dryRun) {
      console.log(`would update target preference ${first._id}:`)
      console.log(JSON.stringify({ _class: CLASS.ProjectTargetPreference, ops: { props: merged, usedOn: Date.now() } }, null, 2))
      return
    }
    await withSpinner(
      'Updating target preference…',
      () => client.updateDoc(
        CLASS.ProjectTargetPreference as Ref<Class<ProjectTargetPreference>>,
        first.space as unknown as Ref<Space>,
        first._id as Ref<ProjectTargetPreference>,
        { props: merged, usedOn: Date.now() } as any,
      ),
      opts
    )
    console.log(`updated target preference: ${first._id}`)
  } finally {
    await client.close()
  }
}

// ---- helpers ----
// resolveProjectForCommand lives in _project-resolve.ts and is imported above.

// Re-export for backwards compatibility
export { parseSet }
