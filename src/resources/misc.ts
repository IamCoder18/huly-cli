import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs } from '../transport/ref-resolver.js'
import { shouldJson, json, table, COLUMNS } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'

// ----------------------------------------------------------------------------
// Documents — Phase 6 builds on these. Keep the basic CRUD as the seed.
// ----------------------------------------------------------------------------

type Document = Doc & {
  title: string
  content?: string
  parent?: Ref<Doc>
  description?: string
  archived?: boolean
}

export async function listDocuments(opts: { limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner('Loading documents…', () =>
      client.findAll(CLASS.Document as Ref<Class<Document>>, {}), opts
    )) as unknown as Document[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.document())
  } finally { await client.close() }
}

export async function getDocument(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Document as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Document as Ref<Class<Document>>, { _id: id as Ref<Document> })
    if (!doc) throw new CliError(ExitCode.NotFound, `document ${ref} not found`)
    if (opts.markdown && doc.content) {
      try {
        const body = await client.fetchMarkup(CLASS.Document as Ref<Class<Doc>>, doc._id, 'content', doc.content as any, 'markdown')
        console.log(body)
        return
      } catch { console.log(String(doc.content)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    table([doc as unknown as Record<string, unknown>], COLUMNS.document())
  } finally { await client.close() }
}

export async function createDocument(opts: {
  title?: string
  body?: string
  bodyFile?: string
  description?: string
  parent?: string
  archived?: boolean
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (opts.body && opts.bodyFile) throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  let body = opts.body
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    body = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  const data: Record<string, unknown> = {
    title: opts.title,
    content: body ? new MarkupContent(body, 'markdown') : '',
    parent: opts.parent ?? null,
    archived: opts.archived ?? false
  }
  if (opts.dryRun) {
    console.log('would create document:')
    console.log(JSON.stringify({ _class: CLASS.Document, data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner('Creating document…', () =>
      client.createDoc(CLASS.Document as Ref<Class<Document>>, 'document:space:Document' as Ref<Space>, data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created document: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function updateDocument(ref: string, opts: {
  title?: string
  body?: string
  bodyFile?: string
  archived?: boolean
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string; url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Document as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Document as Ref<Class<Document>>, { _id: id as Ref<Document> })
    if (!doc) throw new CliError(ExitCode.NotFound, `document ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.body) ops.content = new MarkupContent(opts.body, 'markdown')
    if (opts.archived !== undefined) ops.archived = opts.archived
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --title, --body, or --archived')
    if (opts.dryRun) {
      console.log(`would update document ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.Document, objectId: id, space: doc.space, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CLASS.Document as Ref<Class<Document>>, doc.space as unknown as Ref<Space>, doc._id, ops as any),
      opts
    )
    console.log(`updated document: ${id}`)
  } finally { await client.close() }
}

export async function deleteDocuments(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, { client, classId: CLASS.Document as Ref<Class<Doc>>, workspaceId: account.uuid })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} documents; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const d = await client.findOne(CLASS.Document as Ref<Class<Document>>, { _id: id as Ref<Document> })
      if (!d) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Document as Ref<Class<Document>>, d.space as unknown as Ref<Space>, d._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

// ----------------------------------------------------------------------------
// Action items (top-level ToDos). Phase 13 builds on these.
// ----------------------------------------------------------------------------

type Action = Doc & {
  title: string
  description?: string
  status: Ref<Doc>
  dueDate?: number | null
  assignee?: Ref<Doc> | null
}

export async function listActions(opts: { assignee?: string; status?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.assignee) query.assignee = opts.assignee
    if (opts.status) query.status = opts.status
    const docs = (await withSpinner('Loading…', () =>
      client.findAll('task:class:Task' as Ref<Class<Action>>, query as any), opts
    )) as unknown as Action[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.task())
  } finally { await client.close() }
}

export async function getAction(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: 'task:class:Task' as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne('task:class:Task' as Ref<Class<Action>>, { _id: id as Ref<Action> })
    if (!doc) throw new CliError(ExitCode.NotFound, `action ${ref} not found`)
    if (opts.markdown && doc.description) {
      try {
        const body = await client.fetchMarkup('task:class:Task' as Ref<Class<Doc>>, doc._id, 'description', doc.description as any, 'markdown')
        console.log(body)
        return
      } catch { console.log(String(doc.description)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    table([doc as unknown as Record<string, unknown>], COLUMNS.task())
  } finally { await client.close() }
}

export async function createAction(opts: {
  title?: string
  description?: string
  body?: string
  bodyFile?: string
  due?: string
  assignee?: string
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (opts.body && opts.bodyFile) throw new CliError(ExitCode.Validation, 'ambiguous body input')
  let body = opts.body
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    body = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  const data: Record<string, unknown> = {
    title: opts.title,
    description: body ? new MarkupContent(body, 'markdown') : (opts.description ?? '')
  }
  if (opts.due) {
    const t = new Date(opts.due).getTime()
    if (Number.isNaN(t)) throw new CliError(ExitCode.Validation, 'invalid --due (ISO date)')
    data.dueDate = t
  } else {
    data.dueDate = null
  }
  if (opts.dryRun) {
    console.log('would create action:')
    console.log(JSON.stringify({ _class: 'task:class:Task', space: 'task:space:MyTasks', data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner('Creating action…', () =>
      client.createDoc('task:class:Task' as Ref<Class<Action>>, 'task:space:MyTasks' as Ref<Space>, data as any)
    )
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created action: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function deleteActions(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, { client, classId: 'task:class:Task' as Ref<Class<Doc>>, workspaceId: account.uuid })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} actions; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const a = await client.findOne('task:class:Task' as Ref<Class<Action>>, { _id: id as Ref<Action> })
      if (!a) { skipped++; continue }
      const r = await deleteDoc(client, 'task:class:Task' as Ref<Class<Action>>, a.space as unknown as Ref<Space>, a._id, opts)
      if (r.skipped) skipped++
      else { deleted++; await new Promise((r) => setTimeout(r, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}
