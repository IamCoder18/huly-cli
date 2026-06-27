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
    ])
  } finally { await client.close() }
}

export async function getCardSpace(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.CardSpace as Ref<Class<Doc>>,
      workspaceId: account.uuid
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
    invalidateIndex((await client.getAccount()).uuid, CLASS.CardSpace)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }) }
    else console.log(`created card-space: ${opts.name} (${id})`)
  } finally { await client.close() }
}

export async function deleteCardSpaces(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.CardSpace as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${ids.length} card-spaces; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.CardSpace as Ref<Class<CardSpace>>, { _id: id as Ref<CardSpace> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.CardSpace as Ref<Class<CardSpace>>, 'core:space:Workspace' as Ref<Space>, id as Ref<CardSpace>, { dryRun: opts.dryRun })
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}

export async function listMasterTags(opts: { cardSpace?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.cardSpace) {
      const account = await client.getAccount()
      const spaceId = await resolveRef(opts.cardSpace, {
        client,
        classId: CLASS.CardSpace as Ref<Class<Doc>>,
        workspaceId: account.uuid
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
      { key: '_id', header: '_ID', format: (r) => String((r as MasterTag)._id).slice(-12) }
    ])
  } finally { await client.close() }
}

export async function listCards(opts: { cardSpace?: string; masterTag?: string; limit?: number; offset?: number; json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.cardSpace) {
      const account = await client.getAccount()
      const spaceId = await resolveRef(opts.cardSpace, {
        client,
        classId: CLASS.CardSpace as Ref<Class<Doc>>,
        workspaceId: account.uuid
      })
      query.space = spaceId
    }
    if (opts.masterTag) {
      const account = await client.getAccount()
      const tagId = await resolveRef(opts.masterTag, {
        client,
        classId: CLASS.MasterTag as Ref<Class<Doc>>,
        workspaceId: account.uuid
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
    table(r as unknown as Record<string, unknown>[], COLUMNS.card())
  } finally { await client.close() }
}

export async function getCard(ref: string, opts: { json?: boolean; ci?: boolean; markdown?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const id = await resolveRef(ref, {
      client,
      classId: CLASS.Card as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Card as Ref<Class<CardDoc>>, { _id: id as Ref<CardDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `card ${ref} not found`)
    if (opts.markdown && doc.content) {
      try {
        const body = await client.fetchMarkup(CLASS.Card as Ref<Class<Doc>>, doc._id, 'content', doc.content as any, 'markdown')
        console.log(body)
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
    const account = await client.getAccount()
    const tagId = await resolveRef(opts.masterTag, {
      client,
      classId: CLASS.MasterTag as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const space = opts.cardSpace
      ? await resolveRef(opts.cardSpace, {
        client,
        classId: CLASS.CardSpace as Ref<Class<Doc>>,
        workspaceId: account.uuid
      })
      : ('card:space:Default' as Ref<Space>)

    let body = opts.description ?? ''
    if (opts.body && opts.bodyFile) throw new CliError(ExitCode.Validation, 'ambiguous body input')
    if (opts.bodyFile) {
      const fs = await import('node:fs/promises')
      body = (await fs.readFile(opts.bodyFile, 'utf8')).trim()
    } else if (opts.body) {
      body = opts.body
    }

    const data: Record<string, unknown> = {
      title: opts.title,
      content: body ? new MarkupContent(body, 'markdown') : '',
      parentInfo: [],
      rank: '0|aaaaa:',
      blobs: {},
      _class: tagId
    }
    if (opts.dryRun) {
      console.log('would create card:')
      console.log(JSON.stringify({ _class: tagId, space, data }, null, 2))
      return
    }
    const id = await withSpinner(
      'Creating card…',
      () => client.createDoc(CLASS.Card as Ref<Class<CardDoc>>, space as Ref<Space>, data as any),
      opts
    )
    invalidateIndex(account.uuid, CLASS.Card)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }) }
    else console.log(`created card: ${opts.title} (${id})`)
  } finally { await client.close() }
}

export async function updateCard(ref: string, opts: {
  title?: string
  description?: string
  body?: string
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
      classId: CLASS.Card as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    const doc = await client.findOne(CLASS.Card as Ref<Class<CardDoc>>, { _id: id as Ref<CardDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `card ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.title) ops.title = opts.title
    if (opts.body) ops.content = new MarkupContent(opts.body, 'markdown')
    else if (opts.description !== undefined) ops.content = opts.description ? new MarkupContent(opts.description, 'markdown') : ''
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update', 'pass --title, --description, or --body')
    if (opts.dryRun) {
      console.log(`would update card ${id}:`)
      console.log(JSON.stringify({ _class: CLASS.Card, objectId: id, space: doc.space, ops }, null, 2))
      return
    }
    await withSpinner(
      'Updating…',
      () => client.updateDoc(CLASS.Card as Ref<Class<CardDoc>>, doc.space, id as Ref<CardDoc>, ops as any),
      opts
    )
    console.log(`updated card: ${id}`)
  } finally { await client.close() }
}

export async function deleteCards(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const account = await client.getAccount()
    const ids = await resolveRefs(refs, {
      client,
      classId: CLASS.Card as Ref<Class<Doc>>,
      workspaceId: account.uuid
    })
    if (!opts.yes && ids.length > 1) console.error(`warning: deleting ${refs.length} cards; pass --yes to confirm`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = await client.findOne(CLASS.Card as Ref<Class<CardDoc>>, { _id: id as Ref<CardDoc> })
      if (!doc) { skipped++; continue }
      const r = await deleteDoc(client, CLASS.Card as Ref<Class<CardDoc>>, doc.space, id as Ref<CardDoc>, { dryRun: opts.dryRun })
      if (r.skipped) skipped++
      else { deleted++; await new Promise((res) => setTimeout(res, 100)) }
    }
    console.log(`deleted: ${deleted}, skipped: ${skipped}`)
  } finally { await client.close() }
}
