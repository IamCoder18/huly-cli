import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv, header, COLUMNS, C, isoDate, relTime, statusGlyph, colorizeStatus } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { resolveProjectForCommand } from './_project-resolve.js'

type Milestone = Doc & {
  label: string
  description?: string
  status?: string
  targetDate?: number
  space: Ref<Doc>
}

function parseDate(value: string, field: string): number {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) throw new CliError(ExitCode.Validation, `invalid ${field}: ${value} (expected ISO date)`)
  return t
}

export async function listMilestones(opts: { project?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    const docs = (await withSpinner(
      `Loading milestones for ${project.identifier}…`,
      () => client.findAll(CLASS.Milestone as Ref<Class<Milestone>>, { space: project._id }),
      opts
    )) as Milestone[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.milestone(), { count: true, title: 'milestones' })
  } finally { await client.close() }
}

export async function getMilestone(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Milestone as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Milestone as Ref<Class<Milestone>>, { _id: id as Ref<Milestone> })
    if (!doc) throw new CliError(ExitCode.NotFound, `milestone ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }

    const status = String(doc.status ?? 'planned')
    const progress = typeof doc.targetDate === 'number'
      ? Math.min(100, Math.max(0, Math.round(((Date.now() - (doc.createdOn as number ?? 0)) / ((doc.targetDate as number) - (doc.createdOn as number ?? 0))) * 100)))
      : 0
    header(`Milestone — ${doc.label ?? '(unnamed)'}`, { subtitle: `target ${relTime(doc.targetDate as number | null)}` })
    kv([
      ['ID', C.emphasis(String(doc._id))],
      ['Label', String(doc.label ?? '—')],
      ['Status', statusGlyph(status) + ' ' + colorizeStatus(status)],
      ['Project', String(doc.space ?? '—')],
      ['Target date', doc.targetDate != null ? `${isoDate(doc.targetDate)} (${relTime(doc.targetDate as number | null)})` : C.muted('—')],
      ['Created', doc.createdOn != null ? `${isoDate(doc.createdOn)} (${relTime(doc.createdOn as number | null)})` : C.muted('—')],
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

export async function createMilestone(opts: {
  project?: string
  label?: string
  description?: string
  targetDate?: string
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
    const targetDate = opts.targetDate ? parseDate(opts.targetDate, '--target-date') : Date.now() + 30 * 24 * 3600 * 1000
    const data: Record<string, unknown> = {
      label: opts.label,
      description: opts.description ? opts.description : '',
      status: 'planned',
      targetDate,
      space: project._id,
      comments: 0
    }
    if (opts.dryRun) {
      console.log('would create milestone:')
      console.log(JSON.stringify({ _class: CLASS.Milestone, space: project._id, data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating milestone…',
      () => client.createDoc(CLASS.Milestone as Ref<Class<Milestone>>, project._id as unknown as Ref<Space>, data as any),
      opts
    )
    invalidateIndex((await client.getAccount()).uuid, CLASS.Milestone)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }) }
    else console.log(`created milestone: ${opts.label} (${id})`)
  } finally { await client.close() }
}

export async function updateMilestone(ref: string, opts: {
  label?: string
  description?: string
  targetDate?: string
  status?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Milestone as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Milestone as Ref<Class<Milestone>>, { _id: id as Ref<Milestone> })
    if (!doc) throw new CliError(ExitCode.NotFound, `milestone ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.label) ops.label = opts.label
    if (opts.description !== undefined) ops.description = opts.description ? opts.description : ''
    if (opts.targetDate) ops.targetDate = parseDate(opts.targetDate, '--target-date')
    if (opts.status) ops.status = opts.status
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --label/--description/--target-date/--status')
    if (opts.dryRun) {
      console.log(`would update milestone ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.Milestone, objectId: id, space: doc.space, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CLASS.Milestone as Ref<Class<Milestone>>, doc.space as unknown as Ref<Space>, id as Ref<Milestone>, ops as any),
      opts
    )
    console.log(`updated milestone: ${id}`)
  } finally { await client.close() }
}

export async function deleteMilestones(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Milestone as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} milestones; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.Milestone as Ref<Class<Milestone>>, { _id: id as Ref<Milestone> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Milestone as Ref<Class<Milestone>>, doc.space as unknown as Ref<Space>, id as Ref<Milestone>, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}
