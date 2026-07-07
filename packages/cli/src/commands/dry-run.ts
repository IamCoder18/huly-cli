import type { PlatformClient } from '@hcengineering/api-client'
import type { Doc, Ref, Space, Class, Data, WithLookup } from '@hcengineering/core'
import { shouldJson, json } from '../output/format.js'
import { withSpinner } from '../output/progress.js'

export interface ResourceModule<T extends Doc> {
  classId: Ref<Class<T>>
  label: string
  defaults?: (workspaceId: string) => Promise<Partial<Data<T>>>
  resolveSpace?: (client: PlatformClient, opts: any) => Promise<Ref<Space>>
  applyBody?: (attrs: Record<string, unknown>) => Record<string, unknown>
}

export interface ListOpts {
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  project?: string
  space?: string
}

export async function listDocs<T extends Doc>(
  client: PlatformClient,
  classId: Ref<Class<T>>,
  query: Record<string, unknown> = {},
  opts: ListOpts = {}
): Promise<T[]> {
  const result = await withSpinner(`Listing ${classId.split(':')[1] ?? classId}…`, () =>
    client.findAll(classId, query)
  )
  let docs = result as unknown as T[]

  if (opts.offset && opts.offset > 0) docs = docs.slice(opts.offset)
  if (opts.limit && opts.limit > 0) docs = docs.slice(0, opts.limit)

  if (shouldJson({ json: opts.json, ci: opts.ci })) {
    json(docs)
    return docs
  }
  return docs
}

export async function getDoc<T extends Doc>(
  client: PlatformClient,
  classId: Ref<Class<T>>,
  objectId: Ref<T>,
  space: Ref<Space>,
  opts: { json?: boolean; ci?: boolean } = {}
): Promise<WithLookup<T> | undefined> {
  const doc = await withSpinner('Fetching…', () => client.findOne(classId, { _id: objectId }))
  if (!doc) return undefined
  if (shouldJson(opts)) json(doc)
  return doc
}

export async function deleteDoc<T extends Doc>(
  client: PlatformClient,
  classId: Ref<Class<T>>,
  space: Ref<Space>,
  objectId: Ref<T>,
  opts: { dryRun?: boolean } = {}
): Promise<{ id: Ref<T>; skipped: boolean }> {
  if (opts.dryRun) {
    console.log(`would remove ${objectId} (${classId})`)
    return { id: objectId, skipped: true }
  }
  // Issue #20: best-effort collaborative-state cleanup before removeDoc.
  // For known markup-bearing classes, write an empty markup to the
  // collaborator so the ydoc is dropped server-side. Without this, the
  // ydoc binary and any JSON snapshots live in MinIO indefinitely.
  const markupAttrs = await getCollaborativeAttrs(client, classId)
  for (const attr of markupAttrs) {
    try {
      const collabId = { objectClass: classId as Ref<Class<Doc>>, objectId: objectId as Ref<Doc>, objectAttr: attr }
      const ops = (client as unknown as {
        markup: { collaborator: { updateMarkup: (id: typeof collabId, markup: string) => Promise<void> } }
      }).markup
      if (ops?.collaborator?.updateMarkup !== undefined) {
        await ops.collaborator.updateMarkup(collabId, '{"type":"doc","content":[{"type":"paragraph"}]}')
      }
    } catch {
      // best-effort; failures here don't block the delete
    }
  }
  await withSpinner('Deleting…', () => client.removeDoc(classId, space, objectId))
  return { id: objectId, skipped: false }
}

/**
 * Discover which attributes on `classId` are collaborative markup.
 * Used by deleteDoc to know which ydocs to clear before removal.
 */
async function getCollaborativeAttrs (client: PlatformClient, classId: Ref<Class<Doc>>): Promise<string[]> {
  const cacheKey = String(classId)
  if (_collaborativeAttrCache.has(cacheKey)) return _collaborativeAttrCache.get(cacheKey) ?? []
  try {
    const hidden = await (client as unknown as {
      connection: { findAll: <T extends Doc>(_class: Ref<Class<T>>, query: unknown) => Promise<{ _id: string; attribute: string; type: string }[]> }
    }).connection.findAll('core:class:Attribute' as Ref<Class<Doc>>, {})
    const attrs = hidden
      .filter((a) => a._id.startsWith(`${classId}:`) && a.type?.includes('Markup'))
      .map((a) => a.attribute)
    _collaborativeAttrCache.set(cacheKey, attrs)
    return attrs
  } catch {
    // Unknown — fall back to the well-known markup attrs for the tracked classes
    return defaultCollaborativeAttrs.get(String(classId)) ?? []
  }
}

const _collaborativeAttrCache = new Map<string, string[]>()
const defaultCollaborativeAttrs = new Map<string, string[]>([
  ['card:class:Card', ['content']],
  ['tracker:class:Issue', ['description']],
  ['document:class:Document', ['content']]
])