import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, COLUMNS, withTimeout } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { readEnv } from '../auth/env.js'

type Teamspace = Doc & {
  name: string
  description?: string
  type?: string
  private?: boolean
  archived?: boolean
  [k: string]: unknown
}

type Document = Doc & {
  title: string
  content?: string | null
  parent?: Ref<Doc>
  space: Ref<Teamspace>
  snapshots?: number
  comments?: number
  embeddings?: number
  references?: number
  archived?: boolean
  lockedBy?: Ref<Doc> | null
  rank?: string
}

type DocumentSnapshot = Doc & {
  title: string
  content?: string
  parent: Ref<Document>
  space?: Ref<Doc>
  [k: string]: unknown
}

type InlineComment = Doc & {
  attachedTo: Ref<Doc>
  attachedToClass: Ref<Class<Doc>>
  parent: Ref<Doc>
  parentClass: Ref<Class<Doc>>
  collection: string
  message?: string
  createdBy?: Ref<Doc>
  createdOn?: number
}

const TEAMSPACE_CLASS = CLASS.Teamspace as Ref<Class<Teamspace>>
const DOCUMENT_CLASS = CLASS.Document as Ref<Class<Document>>
const SNAPSHOT_CLASS = CLASS.DocumentSnapshot as Ref<Class<DocumentSnapshot>>
const DOCUMENT_SPACE = 'document:space:Document' as Ref<Space>
const TEAMSPACE_DEFAULT = 'document:space:Default' as Ref<Space>

async function readBodyText(opts: { body?: string; bodyFile?: string }): Promise<string | undefined> {
  if (opts.body && opts.bodyFile) {
    throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  }
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    return (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  return opts.body
}

async function resolveTeamspace(client: PlatformClient, ref?: string): Promise<Teamspace> {
  const env = readEnv()
  const candidate = ref ?? env.teamspace
  if (candidate) {
    const account = await client.getAccount()
    const idx = await buildIndex<Teamspace>(client, TEAMSPACE_CLASS, account.uuid)
    const hit = idx.get(candidate)
    if (hit) {
      const doc = await client.findOne(TEAMSPACE_CLASS, { _id: hit as Ref<Teamspace> })
      if (doc) return doc
    }
    // Fallback: try by name match
    const all = (await client.findAll(TEAMSPACE_CLASS, {})) as Teamspace[]
    const byName = all.find((t) => t.name === candidate)
    if (byName) return byName
  }
  const all = (await client.findAll(TEAMSPACE_CLASS, {})) as Teamspace[]
  if (all.length === 0) {
    // No teamspaces — auto-create a default 'General' teamspace so users can
    // create their first document without manual setup.
    const id = await client.createDoc(
      TEAMSPACE_CLASS,
      TEAMSPACE_DEFAULT,
      {
        name: 'General',
        description: 'Default teamspace (auto-created)',
        type: 'space-type:default' as Ref<Doc>,
        private: false,
        archived: false,
        members: [],
        rank: '0|aaaaa:'
      } as any
    )
    const created = await client.findOne(TEAMSPACE_CLASS, { _id: id as Ref<Teamspace> })
    if (!created) throw new CliError(ExitCode.NotFound, 'failed to auto-create default teamspace')
    return created
  }
  return all[0]
}

async function resolveDocumentByTitle(client: PlatformClient, space: Ref<Teamspace>, title: string): Promise<Document> {
  const docs = (await client.findAll(DOCUMENT_CLASS, { space })) as Document[]
  const lower = title.toLowerCase()
  const hits = docs.filter((d) => String(d.title ?? '').toLowerCase() === lower)
  if (hits.length === 0) {
    throw new CliError(ExitCode.NotFound, `document titled "${title}" not found in teamspace`)
  }
  if (hits.length > 1) {
    throw new CliError(ExitCode.Ambiguous, `multiple documents titled "${title}" — pass a _id ref instead`, `matches: ${hits.map((d) => d._id).join(', ')}`)
  }
  return hits[0]
}

// ---- teamspaces ----

export async function listTeamspaces(opts: { limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner(
      'Loading teamspaces…',
      () => client.findAll(TEAMSPACE_CLASS, {}),
      opts
    )) as Teamspace[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME' },
      { key: 'description', header: 'DESCRIPTION', format: (r) => String((r as Teamspace).description ?? '').slice(0, 60) },
      { key: 'type', header: 'TYPE' },
      { key: 'private', header: 'PRIVATE' },
      { key: 'archived', header: 'ARCHIVED' },
      { key: '_id', header: '_ID', format: (r) => String((r as Teamspace)._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function getTeamspace(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: TEAMSPACE_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(TEAMSPACE_CLASS, { _id: id as Ref<Teamspace> })
    if (!doc) throw new CliError(ExitCode.NotFound, `teamspace ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    table([doc as unknown as Record<string, unknown>], [
      { key: 'name', header: 'NAME' },
      { key: 'description', header: 'DESCRIPTION' },
      { key: '_id', header: '_ID' }
    ])
  } finally { await client.close() }
}

export async function createTeamspace(opts: {
  name?: string
  description?: string
  type?: string
  private?: boolean
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.name) throw new CliError(ExitCode.Validation, 'missing --name')
  const data: Record<string, unknown> = {
    name: opts.name,
    description: opts.description ?? '',
    type: opts.type ?? 'public',
    private: opts.private ?? false,
    archived: false,
    members: [],
    owners: []
  }
  if (opts.dryRun) {
    console.log('would create teamspace:')
    console.log(JSON.stringify({ _class: TEAMSPACE_CLASS, space: TEAMSPACE_DEFAULT, data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner(
      'Creating teamspace…',
      () => client.createDoc(TEAMSPACE_CLASS, TEAMSPACE_DEFAULT, data as any),
      opts
    )
    invalidateIndex((await client.getAccount()).uuid, TEAMSPACE_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created teamspace: ${opts.name} (${id})`)
  } finally { await client.close() }
}

export async function updateTeamspace(ref: string, opts: {
  name?: string
  description?: string
  archived?: boolean
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
      classId: TEAMSPACE_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(TEAMSPACE_CLASS, { _id: id as Ref<Teamspace> })
    if (!doc) throw new CliError(ExitCode.NotFound, `teamspace ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.name) ops.name = opts.name
    if (opts.description !== undefined) ops.description = opts.description
    if (opts.archived !== undefined) ops.archived = opts.archived
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --name, --description, or --archived')
    if (opts.dryRun) {
      console.log(`would update teamspace ${id}:`)
      console.log(JSON.stringify({ _class: TEAMSPACE_CLASS, objectId: id, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(TEAMSPACE_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Teamspace>, ops as any),
      opts
    )
    console.log(`updated teamspace: ${id}`)
  } finally { await client.close() }
}

export async function deleteTeamspaces(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: TEAMSPACE_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} teamspaces; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(TEAMSPACE_CLASS, { _id: id as Ref<Teamspace> })
      if (!doc) { skipped++; continue }
      try {
        await client.removeDoc(TEAMSPACE_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Teamspace>)
        deleted++
      } catch (e) {
        console.error(`failed to delete ${id}: ${(e as Error).message}`)
        skipped++
      }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

// ---- documents (expanded) ----

export async function listDocuments(opts: {
  teamspace?: string
  titleSearch?: string
  contentSearch?: string
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
} = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.teamspace) {
      const ts = await resolveTeamspace(client, opts.teamspace)
      query.space = ts._id
    }
    if (opts.titleSearch) query.title = { $regex: opts.titleSearch, $options: 'i' }
    if (opts.contentSearch) {
      // Best-effort: best to use searchFulltext on REST, but websocket
      // client doesn't expose it. Use regex on the content field.
      query.content = { $regex: opts.contentSearch, $options: 'i' }
    }
    const docs = (await withSpinner('Loading documents…', () =>
      client.findAll(DOCUMENT_CLASS, query as any), opts
    )) as Document[]
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
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(DOCUMENT_CLASS, { _id: id as Ref<Document> })
    if (!doc) throw new CliError(ExitCode.NotFound, `document ${ref} not found`)
    if (opts.markdown && doc.content) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(DOCUMENT_CLASS as Ref<Class<Doc>>, doc._id, 'content', doc.content as any, 'markdown'),
          5000,
          '(body fetch timed out)'
        )
        console.log(body)
        return
      } catch { console.log(String(doc.content)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    table([doc as unknown as Record<string, unknown>], COLUMNS.document())
  } finally { await client.close() }
}

export async function createDocument(opts: {
  teamspace?: string
  title?: string
  body?: string
  bodyFile?: string
  parent?: string
  description?: string
  archived?: boolean
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (opts.body && opts.bodyFile) throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  const body = await readBodyText(opts)
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const teamspace = await resolveTeamspace(client, opts.teamspace)
    let parent: Ref<Doc> | null = null
    if (opts.parent) {
      try {
        parent = await resolveRef(opts.parent, {
          client,
          classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
          workspaceId: account.uuid
        })
      } catch {
        // try by title
        const found = await resolveDocumentByTitle(client, teamspace._id as unknown as Ref<Teamspace>, opts.parent)
        parent = found._id
      }
    }
    // The SDK's processMarkup tries to upload MarkupContent bodies to the
    // collaborator service. If the collaborator is unhealthy the upload
    // throws and the whole createDoc fails — leaving the CLI unable to
    // create any document. We store the body as a plain string instead.
    // The platform treats string content as already-rendered markup; the
    // get --markdown path returns the body directly (see Fix #2 withTimeout).
    const data: Record<string, unknown> = {
      title: opts.title,
      content: body ?? '',
      parent: parent as Ref<Doc>,
      space: teamspace._id,
      archived: opts.archived ?? false,
      rank: '0|aaaaa:'
    }
    if (opts.dryRun) {
      console.log('would create document:')
      console.log(JSON.stringify({ _class: DOCUMENT_CLASS, space: teamspace._id, data }, null, 2))
      return
    }
    const id = await withSpinner(
      `Creating document in ${teamspace.name}…`,
      () => client.createDoc(DOCUMENT_CLASS, teamspace._id, data as any),
      opts
    )
    invalidateIndex(account.uuid, DOCUMENT_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    console.log(`created document: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export interface UpdateDocumentOpts {
  body?: string
  bodyFile?: string
  oldText?: string
  newText?: string
  replaceAll?: boolean
  title?: string
  archived?: boolean
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function updateDocument(ref: string, opts: UpdateDocumentOpts): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(DOCUMENT_CLASS, { _id: id as Ref<Document> })
    if (!doc) throw new CliError(ExitCode.NotFound, `document ${ref} not found`)

    let body: string | undefined
    if (opts.bodyFile) {
      const fs = await import('node:fs/promises')
      body = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
    } else if (opts.body) {
      body = opts.body
    }

    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.archived !== undefined) ops.archived = opts.archived

    if (body !== undefined) {
      if (opts.oldText && opts.newText !== undefined) {
        throw new CliError(ExitCode.Validation, 'ambiguous: pass either --body (full replace) OR --old-text/--new-text (targeted), not both')
      }
      // See createDocument for why we pass the raw string instead of
      // new MarkupContent(...): the SDK's processMarkup tries to upload
      // MarkupContent to the collaborator, which throws on this selfhost.
      ops.content = body
    } else if (opts.oldText && opts.newText !== undefined) {
      // Targeted replace — fetch current content, perform substitution.
      const currentContent = doc.content
      const currentText = currentContent
        ? await withTimeout(
            client.fetchMarkup(DOCUMENT_CLASS as Ref<Class<Doc>>, doc._id, 'content', currentContent as any, 'markdown'),
            5000,
            String(currentContent)
          ).catch(() => String(currentContent))
        : ''
      const replaceAll = !!opts.replaceAll
      const occurrences = currentText.split(opts.oldText).length - 1
      if (occurrences === 0) {
        throw new CliError(ExitCode.NotFound, `old-text not found in document`, 'pass --dry-run to inspect, or check the source body')
      }
      if (occurrences > 1 && !replaceAll) {
        throw new CliError(ExitCode.Ambiguous,
          `${occurrences} occurrences of --old-text — pass --replace-all to replace all`,
          `otherwise narrow your --old-text to a unique substring`)
      }
      const newText = currentText.split(opts.oldText).join(opts.newText)
      ops.content = newText
    }

    if (Object.keys(ops).length === 0) {
      throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --body, --title, --archived, or --old-text/--new-text')
    }
    if (opts.dryRun) {
      console.log(`would update document ${id}:`)
      console.log(JSON.stringify({ _class: DOCUMENT_CLASS, objectId: id, space: doc.space, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(DOCUMENT_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Document>, ops as any),
      opts
    )
    console.log(`updated document: ${id}`)
  } finally { await client.close() }
}

export async function deleteDocuments(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} documents; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const d = await client.findOne(DOCUMENT_CLASS, { _id: id as Ref<Document> })
      if (!d) { skipped++; continue }
      try {
        await client.removeDoc(DOCUMENT_CLASS, d.space, id as Ref<Document>)
        deleted++
      } catch (e) {
        console.error(`failed to delete ${id}: ${(e as Error).message}`)
        skipped++
      }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

// ---- snapshots ----

export async function listSnapshots(ref: string, opts: { limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const snapshots = (await client.findAll(SNAPSHOT_CLASS, { parent: id as Ref<Doc> })) as DocumentSnapshot[]
    let r = snapshots
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE' },
      { key: '_id', header: '_ID', format: (r) => String((r as DocumentSnapshot)._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function getSnapshot(ref: string, opts: { snapshotId?: string; json?: boolean; ci?: boolean; markdown?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.snapshotId) throw new CliError(ExitCode.Validation, 'missing --snapshot-id')
    const snapId = await resolveRef(opts.snapshotId, {
      client,
      classId: SNAPSHOT_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const snap = await client.findOne(SNAPSHOT_CLASS, { _id: snapId as Ref<DocumentSnapshot> })
    if (!snap) throw new CliError(ExitCode.NotFound, `snapshot ${opts.snapshotId} not found`)
    if (snap.parent !== id) {
      throw new CliError(ExitCode.Validation, `snapshot ${opts.snapshotId} is not a child of document ${ref}`)
    }
    if (opts.markdown && snap.content) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(SNAPSHOT_CLASS as Ref<Class<Doc>>, snap._id, 'content', snap.content as any, 'markdown'),
          5000,
          '(body fetch timed out)'
        )
        console.log(body)
        return
      } catch { console.log(String(snap.content)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(snap); return }
    console.log(`${snap.title} (${snap._id})`)
    console.log(JSON.stringify(snap, null, 2))
  } finally { await client.close() }
}

// ---- inline comments ----

export async function listInlineComments(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const comments = (await client.findAll(
      'chunter:class:ChatMessage' as Ref<Class<InlineComment>>,
      { attachedTo: id as Ref<Doc>, attachedToClass: DOCUMENT_CLASS, collection: 'comments' }
    )) as InlineComment[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(comments); return }
    table(comments as unknown as Record<string, unknown>[], COLUMNS.comment())
  } finally { await client.close() }
}
