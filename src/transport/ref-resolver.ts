import type { PlatformClient } from '@hcengineering/api-client'
import type { Doc, Ref, Class } from '@hcengineering/core'
import { CliError, ExitCode } from '../output/errors.js'

const REFS = new Map<string, Map<string, Ref<Doc>>>()

function cacheKey(workspaceId: string, classId: string): string {
  return `${workspaceId}|${classId}`
}

function looksLikeId(s: string): boolean {
  return /^[a-z0-9]+:[a-z0-9]+:[A-Za-z0-9_-]+$/.test(s) || /^[A-Za-z0-9_-]{16,}$/.test(s)
}

function looksLikePrefixed(s: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/.test(s)
}

export interface IndexEntry {
  id: Ref<Doc>
  title?: string
}

export interface BuildIndexOpts<T extends Doc> {
  client: PlatformClient
  classId: Ref<Class<T>>
  workspaceId: string
  identifierField?: keyof T
  titleField?: keyof T
}

export async function buildIndex<T extends Doc>(
  client: PlatformClient,
  classId: Ref<Class<T>>,
  workspaceId: string,
  identifierField: keyof T | string = 'identifier'
): Promise<Map<string, Ref<Doc>>> {
  const key = cacheKey(workspaceId, classId)
  const cached = REFS.get(key)
  if (cached) return cached

  const docs = (await client.findAll(classId, {})) as unknown as T[]
  const map = new Map<string, Ref<Doc>>()
  for (const d of docs) {
    const id = d._id
    const rec = d as Record<string, unknown>
    const ident = identifierField as string
    if (rec[ident] != null) map.set(String(rec[ident]), id)
    if (rec.title != null) map.set(`title:${String(rec.title).toLowerCase()}`, id)
    map.set(id, id)
  }
  REFS.set(key, map)
  return map
}

/** Force a rebuild on next access — useful after writes. */
export function invalidateIndex(workspaceId?: string, classId?: string): void {
  if (workspaceId === undefined) {
    REFS.clear()
    return
  }
  if (classId === undefined) {
    for (const k of [...REFS.keys()]) if (k.startsWith(`${workspaceId}|`)) REFS.delete(k)
    return
  }
  REFS.delete(cacheKey(workspaceId, classId))
}

export interface ResolveOpts {
  client: PlatformClient
  classId: Ref<Class<Doc>>
  workspaceId: string
  identifierField?: string
  titleField?: string
  defaultProjectIdentifier?: string
  fallbackId?: string
}

export async function resolveRef(ref: string, opts: ResolveOpts): Promise<Ref<Doc>> {
  const trimmed = ref.trim()
  if (!trimmed) {
    throw new CliError(ExitCode.Validation, 'empty ref')
  }

  if (looksLikeId(trimmed)) return trimmed as Ref<Doc>

  const ident = opts.identifierField ?? 'identifier'
  const idx = await buildIndex(opts.client, opts.classId, opts.workspaceId, ident)

  if (idx.has(trimmed)) return idx.get(trimmed)!

  if (looksLikePrefixed(trimmed)) {
    if (idx.has(trimmed)) return idx.get(trimmed)!
  }

  if (/^\d+$/.test(trimmed)) {
    const prefix = opts.defaultProjectIdentifier
    if (prefix) {
      const candidate = `${prefix}-${trimmed}`
      if (idx.has(candidate)) return idx.get(candidate)!
    }
  }

  // Title-based lookup
  const titleKey = `title:${trimmed.toLowerCase()}`
  if (idx.has(titleKey)) return idx.get(titleKey)!

  throw new CliError(
    ExitCode.NotFound,
    `ref not found: ${trimmed}`,
    `hint: candidates ${Array.from(idx.keys()).slice(0, 10).join(', ')}${idx.size > 10 ? '…' : ''}`
  )
}

export async function resolveRefs(refs: string[], opts: ResolveOpts): Promise<Ref<Doc>[]> {
  return await Promise.all(refs.map((r) => resolveRef(r, opts)))
}

export function clearResolverCache(): void {
  REFS.clear()
}
