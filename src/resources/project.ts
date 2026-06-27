import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { pickProject } from '../auth/prompts.js'
import { readEnv } from '../auth/env.js'
import type { GlobalOpts } from '../cli.js'

type Project = Doc & { name: string; identifier: string; description?: string; private?: boolean; archived?: boolean }

export async function listProjects(opts: { json?: boolean; ci?: boolean; limit?: number; offset?: number; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const result = (await withSpinner('Loading…', () => client.findAll(CLASS.Project as Ref<Class<Project>>, {}), opts)) as unknown as Project[]
    let docs = result
    if (opts.offset && opts.offset > 0) docs = docs.slice(opts.offset)
    if (opts.limit && opts.limit > 0) docs = docs.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'identifier', header: 'ID' },
      { key: 'name', header: 'NAME' },
      { key: 'description', header: 'DESCRIPTION', format: (r) => ((r as Project).description ?? '').slice(0, 60) },
      { key: '_id', header: '_ID', format: (r) => String((r as Project)._id).slice(-12) }
    ])
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
    kv([
      ['ID', doc.identifier],
      ['Name', doc.name],
      ['Description', doc.description ?? '(none)'],
      ['_id', doc._id],
      ['Space', doc._id]
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
  const data: Record<string, unknown> = {
    name: opts.name,
    identifier: opts.identifier,
    description: opts.description ?? '',
    private: opts.private ?? false,
    archived: false,
    members: [],
    sequence: 0
  }
  if (opts.minimal) {
    delete data.description
    delete data.members
  }
  if (opts.dryRun) {
    console.log('would create project:')
    console.log(JSON.stringify({ _class: CLASS.Project, space: '<self>', data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner('Creating project…', () =>
      client.createDoc(CLASS.Project as Ref<Class<Project>>, client.getHierarchy().getDomain(CLASS.Project as Ref<Class<Doc>>) as unknown as Ref<Space>, data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) {
      json({ _id: id, ...data })
    } else {
      console.log(`created project: ${opts.identifier} (${id})`)
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
      )
    )
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
      console.error(`warning: deleting ${ids.length} projects; pass --yes to confirm`)
    }
    let deleted = 0
    let skipped = 0
    for (const id of ids) {
      const r = await deleteDoc(client, CLASS.Project as Ref<Class<Project>>, id as unknown as Ref<Space>, id as Ref<Project>, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally {
    await client.close()
  }
}

export function parseSet(items: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const item of items) {
    const eq = item.indexOf('=')
    if (eq < 0) {
      throw new CliError(ExitCode.Validation, `invalid --set entry (expected key=value): ${item}`)
    }
    const k = item.slice(0, eq).trim()
    let v: unknown = item.slice(eq + 1).trim()
    if (v === 'true') v = true
    else if (v === 'false') v = false
    else if (/^-?\d+(\.\d+)?$/.test(String(v))) v = Number(v)
    out[k] = v
  }
  return out
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