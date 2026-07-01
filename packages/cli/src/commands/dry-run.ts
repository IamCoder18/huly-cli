import type { PlatformClient } from '@hcengineering/api-client'
import type { Doc, Ref, Space, Class, Data, WithLookup } from '@hcengineering/core'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
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
  await withSpinner('Deleting…', () => client.removeDoc(classId, space, objectId))
  return { id: objectId, skipped: false }
}

export function wrapBody(body: string | undefined): InstanceType<typeof MarkupContent> | undefined {
  if (!body) return undefined
  return new MarkupContent(body, 'markdown')
}