import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, kv, header, COLUMNS, C, relTime, isoDate, withTimeout, success, updated, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { generateId, uploadMarkup, updateMarkup, looksLikeRawMarkup, warnMarkdownFallback } from './_helpers.js'
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
    const idx = await buildIndex<Teamspace>(client, TEAMSPACE_CLASS)
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
      { key: 'private', header: 'PRIVATE', format: (r) => r != null ? ((r as Teamspace).private ? C.red('private') : C.green('shared')) : C.muted('—') },
      { key: 'archived', header: 'STATE', format: (r) => r != null ? ((r as Teamspace).archived ? C.red('archived') : C.green('active')) : C.muted('—') },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as Teamspace)._id).slice(-12)) }
    ], { count: true, title: 'teamspaces' })
  } finally { await client.close() }
}

export async function getTeamspace(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: TEAMSPACE_CLASS as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(TEAMSPACE_CLASS, { _id: id as Ref<Teamspace> })
    if (!doc) throw new CliError(ExitCode.NotFound, `teamspace ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    kv([
      ['name', doc.name],
      ['description', doc.description ? doc.description : '(no description)'],
      ['type', doc.type],
      ['state', doc.archived ? 'archived' : 'active'],
      ['_id', doc._id]
    ], { title: `teamspace ${doc.name ?? doc._id}` })
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
  // Teamspace.description is a plain string field, not collaborative content.
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
    invalidateIndex(client, TEAMSPACE_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success(`created teamspace`, opts.name, id)
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
    const id = await resolveRef(ref, {
      client,
      classId: TEAMSPACE_CLASS as Ref<Class<Doc>>,
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
    updated(`updated teamspace`, id)
  } finally { await client.close() }
}

export async function deleteTeamspaces(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: TEAMSPACE_CLASS as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} teamspaces requires --yes`, 're-run with --yes to confirm')
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
    bulkRemoved(deleted, skipped)
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
    const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (opts.titleSearch) query.title = { $regex: escapeRegex(opts.titleSearch), $options: 'i' }
    if (opts.contentSearch) {
      // Best-effort: best to use searchFulltext on REST, but websocket
      // client doesn't expose it. Use regex on the content field.
      query.content = { $regex: escapeRegex(opts.contentSearch), $options: 'i' }
    }
    const docs = (await withSpinner('Loading documents…', () =>
      client.findAll(DOCUMENT_CLASS, query as any), opts
    )) as Document[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.document(), { count: true })
  } finally { await client.close() }
}

export async function getDocument(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; rawMarkup?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(DOCUMENT_CLASS, { _id: id as Ref<Document> })
    if (!doc) throw new CliError(ExitCode.NotFound, `document ${ref} not found`)
    if ((opts.markdown || opts.rawMarkup) && doc.content) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(DOCUMENT_CLASS as Ref<Class<Doc>>, doc._id, 'content', doc.content as any, opts.rawMarkup ? 'markup' : 'markdown'),
          5000,
          '(body fetch timed out)'
        )
        const bodyStr = String(body ?? '')
        if (opts.markdown && looksLikeRawMarkup(bodyStr)) {
          warnMarkdownFallback()
        }
        console.log(bodyStr)
        return
      } catch { console.log(String(doc.content)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }

    // Resolve teamspace name
    let teamspaceName: string | null = null
    if (doc.space) {
      const t = await client.findOne(TEAMSPACE_CLASS, { _id: doc.space as Ref<Doc> })
      if (t) teamspaceName = String((t as Doc & { name?: string }).name ?? '')
    }

    header(`Document — ${doc.title ?? '(untitled)'}`, { subtitle: `created ${relTime(doc.createdOn as number | null)} · updated ${relTime(doc.modifiedOn as number | null)}` })
    kv([
      ['ID', C.emphasis(String(doc._id))],
      ['Title', String(doc.title ?? '—')],
      ['Teamspace', teamspaceName != null ? C.emphasis(teamspaceName) : C.muted('—')],
      ['Author', String(doc.createdBy ?? '—').slice(-8)],
      ['Last editor', String(doc.modifiedBy ?? '—').slice(-8)],
      ['Created', doc.createdOn != null ? `${isoDate(doc.createdOn)} (${relTime(doc.createdOn as number | null)})` : C.muted('—')],
      ['Modified', doc.modifiedOn != null ? `${isoDate(doc.modifiedOn)} (${relTime(doc.modifiedOn as number | null)})` : C.muted('—')],
      ['Content-type', String((doc.content as { type?: string } | undefined)?.type ?? '—')],
      ['_class', C.id(String(doc._class))]
    ])
    if (doc.content && (doc.content as { text?: string }).text !== undefined) {
      console.log()
      console.log(C.emphasis('Content'))
      console.log(C.muted('─'.repeat(20)))
      const body = (doc.content as { text: string }).text
      console.log(body.length > 500 ? body.slice(0, 500) + '…' : body)
    }
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
    const teamspace = await resolveTeamspace(client, opts.teamspace)
    let parent: Ref<Doc> | null = null
    if (opts.parent) {
      try {
        parent = await resolveRef(opts.parent, {
          client,
          classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
        })
      } catch {
        // try by title
        const found = await resolveDocumentByTitle(client, teamspace._id as unknown as Ref<Teamspace>, opts.parent)
        parent = found._id
      }
    }
    // Upload content markup first so the content field gets a proper blob ref
    // (not raw markup text). Raw markup in `content` silently breaks every
    // later `fetchMarkup` because the platform can't resolve it as a blob.
    const newDocId = generateId()
    const contentRef = body !== undefined && body.length > 0
      ? await uploadMarkup(client, DOCUMENT_CLASS, newDocId, 'content', body, 'markup')
      : ''

    const data: Record<string, unknown> = {
      title: opts.title,
      content: contentRef,
      parent: parent as Ref<Doc>,
      space: teamspace._id,
      archived: opts.archived ?? false,
      rank: '0|aaaaa:'
    }
    if (opts.dryRun) {
      console.log('would create document:')
      console.log(JSON.stringify({ _class: DOCUMENT_CLASS, _id: newDocId, space: teamspace._id, data }, null, 2))
      return
    }
    const id = await withSpinner(
      `Creating document in ${teamspace.name}…`,
      () => client.createDoc(DOCUMENT_CLASS, teamspace._id, data as any, newDocId),
      opts
    )
    invalidateIndex(client, DOCUMENT_CLASS)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success(`created document`, opts.title, id)
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
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(DOCUMENT_CLASS, { _id: id as Ref<Document> })
    if (!doc) throw new CliError(ExitCode.NotFound, `document ${ref} not found`)

    let body: string | undefined
    if (opts.body && opts.bodyFile) {
      throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
    }
    if (opts.bodyFile) {
      const fs = await import('node:fs/promises')
      body = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
    } else if (opts.body) {
      body = opts.body
    }

    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.archived !== undefined) ops.archived = opts.archived

    let markupUpdated = false
    if (body !== undefined) {
      if (opts.oldText && opts.newText !== undefined) {
        throw new CliError(ExitCode.Validation, 'ambiguous: pass either --body (full replace) OR --old-text/--new-text (targeted), not both')
      }
      // Update only the ydoc (issue #3). The ydoc is the source of truth
      // for collaborative content; uploading a new JSON blob would leave
      // orphans in MinIO and risk partial-write failures (issue #12).
      if (body.length > 0) {
        await updateMarkup(client, DOCUMENT_CLASS as Ref<Class<Doc>>, id as Ref<Doc>, 'content', body, 'markup')
      }
      markupUpdated = true
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
      if (newText.length > 0) {
        await updateMarkup(client, DOCUMENT_CLASS as Ref<Class<Doc>>, id as Ref<Doc>, 'content', newText, 'markup')
      }
      markupUpdated = true
    }

    if (Object.keys(ops).length === 0 && !markupUpdated) {
      throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --body, --title, --archived, or --old-text/--new-text')
    }
    if (opts.dryRun) {
      console.log(`would update document ${id}:`)
      console.log(JSON.stringify({ _class: DOCUMENT_CLASS, objectId: id, space: doc.space, ops, markupUpdated }, null, 2))
      return
    }
    if (Object.keys(ops).length > 0) {
      await withSpinner(
        'Updating…',
        () => client.updateDoc(DOCUMENT_CLASS, doc.space as unknown as Ref<Space>, id as Ref<Document>, ops as any),
        opts
      )
    }
    updated(`updated document`, id)
  } finally { await client.close() }
}

export async function deleteDocuments(refs: string[], opts: { dryRun?: boolean; workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} documents requires --yes`, 're-run with --yes to confirm')
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
    bulkRemoved(deleted, skipped)
  } finally { await client.close() }
}

// ---- snapshots ----

export async function listSnapshots(ref: string, opts: { limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
    })
    const snapshots = (await client.findAll(SNAPSHOT_CLASS, { parent: id as Ref<Doc> })) as DocumentSnapshot[]
    let r = snapshots
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'title', header: 'TITLE', format: (r) => C.emphasis(String((r as DocumentSnapshot).title ?? '')) },
      { key: 'createdOn', header: 'CREATED', format: (r) => r != null ? relTime((r as DocumentSnapshot).createdOn) : C.muted('—') },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as DocumentSnapshot)._id).slice(-12)) }
    ], { count: true, title: 'snapshots' })
  } finally { await client.close() }
}

export async function getSnapshot(ref: string, opts: { snapshotId?: string; json?: boolean; ci?: boolean; markdown?: boolean; rawMarkup?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
    })
    if (!opts.snapshotId) throw new CliError(ExitCode.Validation, 'missing --snapshot-id')
    const snapId = await resolveRef(opts.snapshotId, {
      client,
      classId: SNAPSHOT_CLASS as Ref<Class<Doc>>,
    })
    const snap = await client.findOne(SNAPSHOT_CLASS, { _id: snapId as Ref<DocumentSnapshot> })
    if (!snap) throw new CliError(ExitCode.NotFound, `snapshot ${opts.snapshotId} not found`)
    if (snap.parent !== id) {
      throw new CliError(ExitCode.Validation, `snapshot ${opts.snapshotId} is not a child of document ${ref}`)
    }
    if ((opts.markdown || opts.rawMarkup) && snap.content) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(SNAPSHOT_CLASS as Ref<Class<Doc>>, snap._id, 'content', snap.content as any, opts.rawMarkup ? 'markup' : 'markdown'),
          5000,
          '(body fetch timed out)'
        )
        const bodyStr = String(body ?? '')
        if (opts.markdown && looksLikeRawMarkup(bodyStr)) {
          warnMarkdownFallback()
        }
        console.log(bodyStr)
        return
      } catch { console.log(String(snap.content)); return }
    }
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(snap); return }

    header(`Snapshot — ${snap.title ?? '(untitled)'}`, { subtitle: `created ${relTime(snap.createdOn as number | null)}` })
    kv([
      ['ID', C.emphasis(String(snap._id))],
      ['Document', String(snap.parent ?? '—')],
      ['Author', String(snap.createdBy ?? '—')],
      ['Content-type', String(snap.content?.type ?? '—')],
      ['Size', C.muted(`${String(snap.content ?? '').length} chars`)],
      ['Created', snap.createdOn != null ? `${isoDate(snap.createdOn)} (${relTime(snap.createdOn as number | null)})` : C.muted('—')]
    ])
    if (snap.content && snap.content !== '') {
      console.log()
      console.log(C.emphasis('Content'))
      console.log(C.muted('─'.repeat(20)))
      const body = String(snap.content)
      console.log(body.length > 500 ? body.slice(0, 500) + '…' : body)
    }
  } finally { await client.close() }
}

// ---- inline comments ----

export async function listInlineComments(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: DOCUMENT_CLASS as Ref<Class<Doc>>,
    })
    const comments = (await client.findAll(
      'chunter:class:ChatMessage' as Ref<Class<InlineComment>>,
      { attachedTo: id as Ref<Doc>, attachedToClass: DOCUMENT_CLASS, collection: 'comments' }
    )) as InlineComment[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(comments); return }
    table(comments as unknown as Record<string, unknown>[], COLUMNS.comment(), { count: true, title: 'inline-comments' })
  } finally { await client.close() }
}
