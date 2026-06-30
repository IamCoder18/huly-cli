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

/**
 * Identity-bearing field names that CLI commands advertise as accepting
 * refs (e.g. "name", "label", "title"). Index them alongside the configured
 * `identifierField` so callers don't have to specify which field they used.
 */
const COMMON_IDENTITY_KEYS = ['identifier', 'name', 'label'] as const

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
    // CLI-02: index the configured identifier plus common identity fields.
    // We only set the bare key (no `title:` prefix) so callers can look up
    // by either "name" or "label" interchangeably, matching what help text
    // advertises.
    const indexed = new Set<string>()
    const fields = [identifierField as string, ...COMMON_IDENTITY_KEYS]
    for (const f of fields) {
      if (rec[f] != null) {
        const v = String(rec[f])
        if (!indexed.has(v)) {
          map.set(v, id)
          indexed.add(v)
        }
      }
    }
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

/** Invalidate every cache entry for a given workspaceId, including entries
 *  keyed by the legacy account-uuid alias. */
export function invalidateIndexForWorkspace(workspaceId: string): void {
  for (const k of [...REFS.keys()]) if (k.startsWith(`${workspaceId}|`)) REFS.delete(k)
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
