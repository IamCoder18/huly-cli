import type { Doc, Ref, Space, Class } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, COLUMNS, withTimeout, success, updated, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { deleteDoc } from '../commands/dry-run.js'
import { CliError, ExitCode } from '../output/errors.js'
import { isOpinionated } from '../auth/env.js'
import { generateId, uploadMarkup, updateMarkup, looksLikeRawMarkup, warnMarkdownFallback, readBodyText } from './_helpers.js'

type CardDoc = Doc & {
  title: string
  content?: string
  blobs?: Record<string, unknown>
  parentInfo?: unknown[]
  parent?: Ref<Doc> | null
  rank?: string
  _class: Ref<MasterTag>
  space: Ref<Space>
}

type MasterTag = Doc & {
  label?: string
  name?: string
  background?: number
  [k: string]: unknown
}

type CardSpace = Doc & {
  name: string
  description?: string
  private?: boolean
  archived?: boolean
  types?: Ref<MasterTag>[]
}

export async function listCardSpaces(opts: { limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner(
      'Loading card spaces…',
      () => client.findAll(CLASS.CardSpace as Ref<Class<CardSpace>>, {}),
      opts
    )) as CardSpace[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME' },
      { key: 'description', header: 'DESCRIPTION', format: (r) => String((r as CardSpace).description ?? '').slice(0, 60) },
      { key: 'private', header: 'PRIVATE' },
      { key: 'archived', header: 'ARCHIVED' },
      { key: '_id', header: '_ID', format: (r) => String((r as CardSpace)._id).slice(-12) }
    ], { count: true, title: 'card-spaces' })
  } finally { await client.close() }
}

export async function getCardSpace(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.CardSpace as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.CardSpace as Ref<Class<CardSpace>>, { _id: id as Ref<CardSpace> })
    if (!doc) throw new CliError(ExitCode.NotFound, `card-space ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    table([doc as unknown as Record<string, unknown>], [
      { key: 'name', header: 'NAME' },
      { key: 'description', header: 'DESCRIPTION' },
      { key: '_id', header: '_ID' }
    ])
  } finally { await client.close() }
}

export async function createCardSpace(opts: {
  name?: string
  description?: string
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.name) throw new CliError(ExitCode.Validation, 'missing --name')
  // CardSpace.description is a plain string field, not collaborative
  // content — leave it as-is.
  const data: Record<string, unknown> = {
    name: opts.name,
    description: opts.description ?? '',
    private: false,
    archived: false,
    types: []
  }
  if (opts.dryRun) {
    console.log('would create card-space:')
    console.log(JSON.stringify({ _class: CLASS.CardSpace, space: '<self>', data }, null, 2))
    return
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await withSpinner(
      'Creating card-space…',
      () => client.createDoc(CLASS.CardSpace as Ref<Class<CardSpace>>, 'core:space:Workspace' as Ref<Space>, data as any),
      opts
    )
    invalidateIndex(client, CLASS.CardSpace)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }) }
    else success(`created card-space`, opts.name, id)
  } finally { await client.close() }
}

export async function deleteCardSpaces(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.CardSpace as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} card-spaces requires --yes`, 're-run with --yes to confirm')
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.CardSpace as Ref<Class<CardSpace>>, { _id: id as Ref<CardSpace> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.CardSpace as Ref<Class<CardSpace>>, 'core:space:Workspace' as Ref<Space>, id as Ref<CardSpace>, { dryRun: opts.dryRun })
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    bulkRemoved(deleted, skipped)
  } finally { await client.close() }
}

export async function listMasterTags(opts: { cardSpace?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.cardSpace) {
      const spaceId = await resolveRef(opts.cardSpace, {
        client,
        classId: CLASS.CardSpace as Ref<Class<Doc>>,
      })
      query.space = spaceId
    }
    const docs = (await withSpinner(
      'Loading master tags…',
      () => client.findAll(CLASS.MasterTag as Ref<Class<MasterTag>>, query as any),
      opts
    )) as MasterTag[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'label', header: 'LABEL' },
      { key: 'name', header: 'NAME' },
      { key: 'background', header: 'BG' },
      { key: '_id', header: '_ID', format: (r) => String((r as MasterTag)._id).split(':').slice(-1)[0] ?? String((r as MasterTag)._id) }
    ], { count: true, title: 'master-tags' })
  } finally { await client.close() }
}

export async function listCards(opts: { cardSpace?: string; masterTag?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.cardSpace) {
      const spaceId = await resolveRef(opts.cardSpace, {
        client,
        classId: CLASS.CardSpace as Ref<Class<Doc>>,
      })
      query.space = spaceId
    }
    if (opts.masterTag) {
      const tagId = await resolveRef(opts.masterTag, {
        client,
        classId: CLASS.MasterTag as Ref<Class<Doc>>,
      })
      query._class = tagId
    }
    const docs = (await withSpinner('Loading cards…', () =>
      client.findAll(CLASS.Card as Ref<Class<CardDoc>>, query as any), opts
    )) as CardDoc[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], COLUMNS.card(), { count: true, title: 'cards' })
  } finally { await client.close() }
}

export async function getCard(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; rawMarkup?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Card as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Card as Ref<Class<CardDoc>>, { _id: id as Ref<CardDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `card ${ref} not found`)
    if ((opts.markdown || opts.rawMarkup) && doc.content) {
      try {
        const body = await withTimeout(
          client.fetchMarkup(CLASS.Card as Ref<Class<Doc>>, doc._id, 'content', doc.content as any, opts.rawMarkup ? 'markup' : 'markdown'),
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
    console.log(`${doc.title} (${doc._id})`)
    console.log(JSON.stringify(doc, null, 2))
  } finally { await client.close() }
}

export async function createCard(opts: {
  cardSpace?: string
  masterTag?: string
  title?: string
  body?: string
  bodyFile?: string
  description?: string
  parent?: string
  minimal?: boolean
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  if (!opts.title) throw new CliError(ExitCode.Validation, 'missing --title')
  if (!opts.masterTag) throw new CliError(ExitCode.Validation, 'missing --master-tag')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const tagId = await resolveRef(opts.masterTag, {
      client,
      classId: CLASS.MasterTag as Ref<Class<Doc>>,
    })
    const opinionated = !opts.minimal && isOpinionated()
    // Opinionated default: pick the first available CardSpace instead of
    // the literal `card:space:Default`, which the SKILL.md flags as
    // usually-doesn't-exist. Falls back to the literal if the workspace
    // truly has zero CardSpaces (server will then reject the create with
    // a clear error message).
    let resolvedCardSpace: Ref<Space>
    if (opts.cardSpace) {
      resolvedCardSpace = await resolveRef(opts.cardSpace, {
        client,
        classId: CLASS.CardSpace as Ref<Class<Doc>>,
      })
    } else if (opinionated) {
      const spaces = (await client.findAll(CLASS.CardSpace as Ref<Class<Doc>>, {}, { limit: 1 })) as Array<Doc & { _id: Ref<Doc> }>
      resolvedCardSpace = spaces.length > 0
        ? (spaces[0]._id as unknown as Ref<Space>)
        : ('card:space:Default' as Ref<Space>)
    } else {
      resolvedCardSpace = 'card:space:Default' as Ref<Space>
    }
    const space = resolvedCardSpace

    let body = ''
    const bodyInput = await readBodyText(opts)
    if (bodyInput !== undefined) body = bodyInput
    // If only --description was given without --replace-content, body stays ''
    // here. That's intentional — we don't want to clobber the card's body in
    // create-with-description by treating description as body content.

    // Strip newlines/whitespace and decode HTML entities once before upload.
    // The prosemirror parser preserves whitespace, so newlines between tags
    // become phantom empty paragraphs (issue #2). Entity decoding prevents
    // double-escaping on round-trip (issue #5).
    // Upload only when there's actual body — empty cards should not create
    // an empty JSON blob in MinIO (issue #9).

    // Mirror card-resources/src/utils.ts:createChildCard — when a card has a
    // parent, parentInfo is the parent's parentInfo + the parent's own
    // ref/class/title. Without this, ancestor chain breaks and the
    // server-side rank/parent updates can't compute hierarchy.
    let parent: CardDoc | undefined = undefined
    let parentInfo: Array<{ _id: Ref<Doc>; _class: Ref<Class<Doc>>; title: string }> = []
    if (opts.parent) {
      const parentId = await resolveRef(opts.parent, {
        client,
        classId: CLASS.Card as Ref<Class<Doc>>,
      })
      parent = (await client.findOne(CLASS.Card as Ref<Class<CardDoc>>, { _id: parentId as Ref<CardDoc> })) as CardDoc | undefined
      if (parent === undefined || parent === null) {
        throw new CliError(ExitCode.NotFound, `parent card ${opts.parent} not found`)
      }
      // Validate parent's parentInfo entries — they come from older/migrated
      // cards and may be malformed. Drop any entry missing _id/_class/title
      // so the resulting parentInfo is well-formed.
      const safeParentInfo = ((parent.parentInfo ?? []) as unknown[]).flatMap((entry) => {
        if (entry === null || typeof entry !== 'object') return []
        const e = entry as Record<string, unknown>
        const id = e._id
        const cls = e._class
        const title = e.title
        if (typeof id !== 'string' || typeof cls !== 'string' || typeof title !== 'string') return []
        return [{ _id: id as Ref<Doc>, _class: cls as Ref<Class<Doc>>, title }]
      })
      parentInfo = [
        ...safeParentInfo,
        { _id: parent._id, _class: parent._class as Ref<Class<Doc>>, title: parent.title }
      ]
    }

    // Upload markup first so we have a real blob ref. The card content field
    // requires a MarkupBlobRef (e.g. "<cardId>-content-<ts>"), not raw markup
    // text — the latter silently breaks every later `fetchMarkup` call.
    const newCardId = generateId() as Ref<CardDoc>
    const initialBody = body && body.length > 0 ? body : ''
    // Skip the JSON-blob upload entirely when there's no body. An empty blob
    // is wasted storage; the ydoc will be created lazily on first update/read.
    const contentRef = initialBody.length > 0
      ? await uploadMarkup(client, CLASS.Card as Ref<Class<Doc>>, newCardId, 'content', initialBody, 'markup')
      : ''

    const data: Record<string, unknown> = {
      title: opts.title,
      content: contentRef,
      parentInfo,
      rank: '0|aaaaa:',
      blobs: {},
      _class: tagId
    }
    if (parent !== undefined && parent !== null) data.parent = parent._id as Ref<Doc>
    if (opts.dryRun) {
      console.log('would create card:')
      console.log(JSON.stringify({ _class: tagId, _id: newCardId, space, data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating card…',
      () => client.createDoc(CLASS.Card as Ref<Class<CardDoc>>, space as Ref<Space>, data as any, newCardId),
      opts
    )
    invalidateIndex(client, CLASS.Card)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }) }
    else success(`created card`, opts.title, id)
  } finally { await client.close() }
}

export async function updateCard(ref: string, opts: {
  title?: string
  description?: string
  body?: string
  bodyFile?: string
  replaceContent?: boolean
  json?: boolean
  ci?: boolean
  dryRun?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  // Validation: split into two clear single-purpose checks (issue #16).
  if (opts.body !== undefined && opts.bodyFile !== undefined) {
    throw new CliError(ExitCode.Validation,
      '--body and --body-file are mutually exclusive',
      'pass only one: --body "<html>" or --body-file <path>')
  }
  if (opts.description !== undefined &&
      (opts.body !== undefined || opts.bodyFile !== undefined)) {
    throw new CliError(ExitCode.Validation,
      '--description conflicts with --body/--body-file',
      'use --body or --body-file for the main content, OR --description with --replace-content to overwrite')
  }
  if (opts.description !== undefined && !opts.replaceContent) {
    throw new CliError(ExitCode.Validation,
      '--description overwrites the existing card body',
      're-run with --replace-content to confirm overwriting the existing body')
  }
  let bodyFromFile: string | undefined
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    bodyFromFile = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Card as Ref<Class<Doc>>,
    })
    const doc = await client.findOne(CLASS.Card as Ref<Class<CardDoc>>, { _id: id as Ref<CardDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `card ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.title !== undefined) ops.title = opts.title
    let markupUpdated = false
    if (opts.body !== undefined) {
      // Update only the ydoc (issue #3). The ydoc is the source of truth for
      // collaborative content — calling uploadMarkup would create an orphan
      // JSON blob in MinIO and risk partial-write failures (issue #12).
      await updateMarkup(client, CLASS.Card as Ref<Class<Doc>>, id as Ref<CardDoc>, 'content', opts.body, 'markup')
      markupUpdated = true
    } else if (bodyFromFile !== undefined) {
      await updateMarkup(client, CLASS.Card as Ref<Class<Doc>>, id as Ref<CardDoc>, 'content', bodyFromFile, 'markup')
      markupUpdated = true
    } else if (opts.description !== undefined && opts.replaceContent) {
      await updateMarkup(client, CLASS.Card as Ref<Class<Doc>>, id as Ref<CardDoc>, 'content', opts.description, 'markup')
      markupUpdated = true
    }
    if (Object.keys(ops).length === 0 && !markupUpdated) {
      throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --title, --body, --body-file, or --description (with --replace-content)')
    }
    if (opts.dryRun) {
      console.log(`would update card ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.Card, objectId: id, space: doc.space, ops, markupUpdated }, null, 2))
      return
    }
    if (Object.keys(ops).length > 0) {
      await withSpinner(
        'Updating…',
        () => client.updateDoc(CLASS.Card as Ref<Class<CardDoc>>, doc.space, id as Ref<CardDoc>, ops as any),
        opts
      )
    }
    updated(`updated card`, id)
  } finally { await client.close() }
}

export async function deleteCards(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Card as Ref<Class<Doc>>,
    })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${refs.length} cards requires --yes`, 're-run with --yes to confirm')
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.Card as Ref<Class<CardDoc>>, { _id: id as Ref<CardDoc> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Card as Ref<Class<CardDoc>>, doc.space, id as Ref<CardDoc>, { dryRun: opts.dryRun })
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    bulkRemoved(deleted, skipped)
  } finally { await client.close() }
}
