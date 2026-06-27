import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, COLUMNS } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { resolveProjectForCommand } from './_project-resolve.js'

type IssueTemplate = Doc & {
  title: string
  description?: string
  space: Ref<Doc>
  children?: Array<Record<string, unknown>>
}

export async function listIssueTemplates(opts: { project?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    const docs = (await withSpinner(
      `Loading templates for ${project.identifier}…`,
      () => client.findAll(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, { space: project._id }),
      opts
    )) as IssueTemplate[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.issueTemplate())
  } finally { await client.close() }
}

export async function getIssueTemplate(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.IssueTemplate as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, { _id: id as Ref<IssueTemplate> })
    if (!doc) throw new CliError(ExitCode.NotFound, `issue-template ${ref} not found`)
    if (opts.markdown && doc.description) {
      try {
        const body = await client.fetchMarkup(CLASS.IssueTemplate as Ref<Class<Doc>>, doc._id, 'description', doc.description as any, 'markdown')
        console.log(body)
        return
      } catch { console.log(String(doc.description)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    table([doc as unknown as Record<string, unknown>], COLUMNS.issueTemplate())
  } finally { await client.close() }
}

export async function createIssueTemplate(opts: {
  project?: string
  title?: string
  description?: string
  body?: string
  bodyFile?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const project = await resolveProjectForCommand(client, opts.project)
    let description = opts.description ?? ''
    if (opts.body && opts.bodyFile) throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
    if (opts.bodyFile) {
      const fs = await import('node:fs/promises')
      description = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
    } else if (opts.body) {
      description = opts.body
    }
    const data: Record<string, unknown> = {
      title: opts.title,
      description: description ? new MarkupContent(description, 'markdown') : '',
      space: project._id,
      children: []
    }
    if (opts.dryRun) {
      console.log('would create issue-template:')
      console.log(JSON.stringify({ _class: CLASS.IssueTemplate, space: project._id, data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating template…',
      () => client.createDoc(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, project._id as unknown as Ref<Space>, data as any),
      opts
    )
    invalidateIndex((await client.getAccount()).uuid, CLASS.IssueTemplate)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }) }
    else console.log(`created template: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function updateIssueTemplate(ref: string, opts: { title?: string; description?: string; body?: string; json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.IssueTemplate as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, { _id: id as Ref<IssueTemplate> })
    if (!doc) throw new CliError(ExitCode.NotFound, `issue-template ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.body) ops.description = new MarkupContent(opts.body, 'markdown')
    else if (opts.description !== undefined) ops.description = opts.description ? new MarkupContent(opts.description, 'markdown') : ''
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --title, --description, or --body')
    if (opts.dryRun) {
      console.log(`would update issue-template ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.IssueTemplate, objectId: id, space: doc.space, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, doc.space as unknown as Ref<Space>, id as Ref<IssueTemplate>, ops as any),
      opts
    )
    console.log(`updated issue-template: ${id}`)
  } finally { await client.close() }
}

export async function deleteIssueTemplates(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.IssueTemplate as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} templates; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, { _id: id as Ref<IssueTemplate> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, doc.space as unknown as Ref<Space>, id as Ref<IssueTemplate>, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

export async function addTemplateChild(templateRef: string, childRef: string, opts: { json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const templateId = await resolveRef(templateRef, { client, classId: CLASS.IssueTemplate as Ref<Class<Doc>>, workspaceId: account.uuid })
    const childId = await resolveRef(childRef, { client, classId: CLASS.IssueTemplate as Ref<Class<Doc>>, workspaceId: account.uuid })
    const doc = await client.findOne(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, { _id: templateId as Ref<IssueTemplate> })
    if (!doc) throw new CliError(ExitCode.NotFound, `template ${templateRef} not found`)
    const children = [...(doc.children ?? []), { id: childId }]
    if (opts.dryRun) {
      console.log(`would add child ${childId} to template ${templateId}`)
      return
    }
    await withSpinner(
      'Adding template child…',
      () => client.updateDoc(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, doc.space as unknown as Ref<Space>, templateId as Ref<IssueTemplate>, { children } as any),
      opts
    )
    console.log(`added template child: ${childId}`)
  } finally { await client.close() }
}

export async function removeTemplateChild(templateRef: string, childRef: string, opts: { json?: boolean; ci?: boolean; dryRun?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const templateId = await resolveRef(templateRef, { client, classId: CLASS.IssueTemplate as Ref<Class<Doc>>, workspaceId: account.uuid })
    const childId = await resolveRef(childRef, { client, classId: CLASS.IssueTemplate as Ref<Class<Doc>>, workspaceId: account.uuid })
    const doc = await client.findOne(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, { _id: templateId as Ref<IssueTemplate> })
    if (!doc) throw new CliError(ExitCode.NotFound, `template ${templateRef} not found`)
    const children = (doc.children ?? []).filter((c: Record<string, unknown>) => (c as { id?: string }).id !== childId)
    if (opts.dryRun) {
      console.log(`would remove child ${childId} from template ${templateId}`)
      return
    }
    await withSpinner(
      'Removing template child…',
      () => client.updateDoc(CLASS.IssueTemplate as Ref<Class<IssueTemplate>>, doc.space as unknown as Ref<Space>, templateId as Ref<IssueTemplate>, { children } as any),
      opts
    )
    console.log(`removed template child: ${childId}`)
  } finally { await client.close() }
}
