import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv, header, COLUMNS, C, success, updated, relTime, isoDate, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'
import { resolveProjectForCommand } from './_project-resolve.js'

type Component = Doc & {
  label: string
  description?: string
  lead?: Ref<Doc> | null
  space: Ref<Doc>
}

export async function listComponents(opts: { project?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    const docs = (await withSpinner(
      `Loading components for ${project.identifier}…`,
      () => client.findAll(CLASS.Component as Ref<Class<Component>>, { space: project._id }),
      opts
    )) as Component[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.component(), { count: true, title: 'components' })
  } finally { await client.close() }
}

export async function getComponent(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Component as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Component as Ref<Class<Component>>, { _id: id as Ref<Component> })
    if (!doc) throw new CliError(ExitCode.NotFound, `component ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }

    header(`Component — ${doc.label ?? '(unnamed)'}`, { subtitle: `created ${relTime(doc.createdOn as number | null)}` })
    kv([
      ['ID', C.emphasis(String(doc._id))],
      ['Label', String(doc.label ?? '—')],
      ['Description', String(doc.description ?? '—')],
      ['Project', String(doc.space ?? '—')],
      ['Created', doc.createdOn != null ? `${isoDate(doc.createdOn)} (${relTime(doc.createdOn as number | null)})` : C.muted('—')],
      ['Modified', doc.modifiedOn != null ? `${isoDate(doc.modifiedOn)} (${relTime(doc.modifiedOn as number | null)})` : C.muted('—')],
      ['_class', C.id(String(doc._class))]
    ])
  } finally { await client.close() }
}
export async function createComponent(opts: {
  project?: string
  label?: string
  description?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.label) throw new CliError(ExitCode.Validation, 'missing --label')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    const data: Record<string, unknown> = {
      label: opts.label,
      description: opts.description ? opts.description : '',
      lead: null,
      space: project._id
    }
    if (opts.dryRun) {
      console.log('would create component:')
      console.log(JSON.stringify({ _class: CLASS.Component, space: project._id, data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating component…',
      () => client.createDoc(CLASS.Component as Ref<Class<Component>>, project._id as unknown as Ref<Space>, data as any),
      opts
    )
    invalidateIndex(client, CLASS.Component)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }) }
    else success(`created component`, opts.label, id)
  } finally { await client.close() }
}

export async function updateComponent(ref: string, opts: { label?: string; description?: string; json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Component as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Component as Ref<Class<Component>>, { _id: id as Ref<Component> })
    if (!doc) throw new CliError(ExitCode.NotFound, `component ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.label) ops.label = opts.label
    if (opts.description !== undefined) ops.description = opts.description ? opts.description : ''
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --label or --description')
    if (opts.dryRun) {
      console.log(`would update component ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.Component, objectId: id, space: doc.space, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CLASS.Component as Ref<Class<Component>>, doc.space as unknown as Ref<Space>, id as Ref<Component>, ops as any),
      opts
    )
    updated(`updated component`, id)
  } finally { await client.close() }
}

export async function deleteComponents(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Component as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} components requires --yes`, 're-run with --yes to confirm')
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.Component as Ref<Class<Component>>, { _id: id as Ref<Component> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Component as Ref<Class<Component>>, doc.space as unknown as Ref<Space>, id as Ref<Component>, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    bulkRemoved(deleted, skipped)
  } finally { await client.close() }
}
