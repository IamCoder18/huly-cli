import type { Doc, Ref, Space, Class, Data } from '@hcengineering/core'
import corePkg from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import textPkg from '@hcengineering/text'
import textCorePkg from '@hcengineering/text-core'
import textMarkdownPkg from '@hcengineering/text-markdown'
import type { PlatformClientWithMarkup } from '../types/markup-operations.js'

const { htmlToJSON, htmlToMarkup: textHtmlToMarkup } = textPkg
const { jsonToMarkup } = textCorePkg
const { markdownToMarkup } = textMarkdownPkg

const platformGenerateId: () => Ref<Doc> =
  (corePkg as unknown as { generateId: (join?: string) => string }).generateId

import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, type TableColumn, success, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { deleteDoc } from '../commands/dry-run.js'

/**
 * Sanitize HTML input before converting to prosemirror markup. The
 * prosemirror HTML parser uses `preserveWhitespace: 'full'`, so any literal
 * newline *between tags* becomes a phantom empty paragraph in the doc tree.
 * Newlines *inside* a text node (e.g. inside `<p>hello\nworld</p>`) are
 * preserved so the round-trip keeps the word boundary.
 */
export function normalizeMarkupInput (html: string): string {
  return html
    .replace(/\r\n?/g, '\n')
    // Match whitespace that includes a newline only when it sits between
    // a `>` (end of one tag) and a `<` (start of the next). Removing the
    // whitespace entirely (not collapsing to a single space) prevents the
    // prosemirror parser from creating a text node of `" "` between the
    // two block elements, which would otherwise render as a phantom gap.
    .replace(/>\s*\n\s*</g, '><')
}

/**
 * Convert raw HTML markup (what users pass to `--body`) to the prosemirror-JSON
 * markup format the collaborator actually expects. Without this conversion,
 * `markupToJSON` on the read side falls back to wrapping the raw HTML in a
 * single text node inside one paragraph — every `<h1>`, `<strong>`, etc.
 * shows up as visible text, not a rendered element.
 */
export function htmlToMarkup (html: string): string {
  const json = htmlToJSON(normalizeMarkupInput(html))
  return jsonToMarkup(json)
}

/**
 * Convert markdown text to the prosemirror-JSON markup format.
 */
export function mdToMarkup (md: string): string {
  return markdownToMarkup(md)
}

/**
 * Convert HTML to markup using the `@hcengineering/text` package's
 * `htmlToMarkup` (single-call alternative to htmlToJSON + jsonToMarkup).
 */
export function rawHtmlToMarkup (html: string): string {
  return textHtmlToMarkup(normalizeMarkupInput(html))
}

export function generateId (): Ref<Doc> {
  return platformGenerateId() as Ref<Doc>
}

/**
 * Convert user-provided body text to the prosemirror-JSON markup format the
 * collaborator expects. Pass-through dispatch by `kind`:
 *
 *   - 'markup'   (default) : input is HTML; goes through htmlToJSON → jsonToMarkup.
 *   - 'html'             : same path, kept as alias for clarity at call sites.
 *   - 'markdown'         : input is GitHub-flavored Markdown; goes through
 *                         text-markdown's markdownToMarkup.
 *
 * Empty / undefined body short-circuits to '' — uploading an empty blob
 * wastes MinIO storage and the prosemirror conversion would otherwise
 * produce an empty doc that the server round-trips as a phantom paragraph.
 */
function convertMarkup (body: string | undefined, kind: 'markup' | 'markdown' | 'html'): string {
  if (body === undefined || body.length === 0) return ''
  if (kind === 'markdown') return mdToMarkup(body)
  if (kind === 'html') return rawHtmlToMarkup(body)
  return htmlToMarkup(body)
}

/**
 * Upload body content via the SDK's `MarkupOperations.uploadMarkup` and
 * return the resulting MarkupBlobRef. The body is converted to
 * prosemirror-JSON before being sent.
 */
export async function uploadMarkup (
  client: PlatformClient,
  objectClass: Ref<Class<Doc>>,
  objectId: Ref<Doc>,
  objectAttr: string,
  body: string | undefined,
  kind: 'markup' | 'markdown' | 'html' = 'markup'
): Promise<string> {
  const converted = convertMarkup(body, kind)
  // Skip the round-trip entirely when there's no body. The ydoc gets
  // created lazily on first read or update; without a blob there is
  // nothing to upload and no ref to record.
  if (converted.length === 0) return ''
  // The PlatformClient interface doesn't expose `markup`, but PlatformClientImpl
  // does (set in its constructor). Cast for the runtime access.
  const ops = (client as unknown as PlatformClientWithMarkup).markup
  if (ops === undefined) {
    throw new CliError(ExitCode.Server, 'client.markup is not available on this PlatformClient', 'ensure you are connected to a recent Huly platform that exposes MarkupOperations')
  }
  return await ops.uploadMarkup(objectClass, objectId, objectAttr, converted, 'markup')
}

/**
 * Update the ydoc binary for a collaborative field via the SDK's
 * underlying `CollaboratorClient.updateMarkup` (which calls `updateContent`
 * RPC). The ydoc is the source of truth for collaborative content once
 * it exists.
 *
 * On the first call (no ydoc exists yet) the collaborator auto-creates the
 * ydoc from the supplied markup. Passing an empty body clears the existing
 * ydoc contents; `body === undefined` is treated as "no-op" so callers
 * that pass through optional flag values don't accidentally clear.
 */
export async function updateMarkup (
  client: PlatformClient,
  objectClass: Ref<Class<Doc>>,
  objectId: Ref<Doc>,
  objectAttr: string,
  body: string | undefined,
  kind: 'markup' | 'markdown' | 'html' = 'markup'
): Promise<void> {
  if (body === undefined) return
  const converted = convertMarkup(body, kind)
  const ops = (client as unknown as PlatformClientWithMarkup).markup
  if (ops === undefined) {
    throw new CliError(ExitCode.Server, 'client.markup is not available on this PlatformClient', 'ensure you are connected to a recent Huly platform that exposes MarkupOperations')
  }
  await ops.collaborator.updateMarkup({ objectClass, objectId, objectAttr }, converted)
}

const DELETE_GAP_MS = 100

/**
 * Heuristic for detecting that the server returned raw prosemirror-JSON
 * markup instead of converted Markdown. Used to warn the user when the
 * `markupToMarkdown` step fails silently (fix for #19).
 *
 * The prosemirror JSON form always starts with `{"type":"doc"` (the JSON
 * object literal begins with `{`, `"type":"doc"` follows on the same or
 * next line, with arbitrary whitespace between them depending on the
 * pretty-printer). Markdown output never begins with `{` for normal Huly
 * content. Empty strings are not raw markup (treated as "no body").
 */
const RAW_MARKUP_PREFIX = /^\{\s*"type"\s*:\s*"doc"/

export function looksLikeRawMarkup (s: string | null | undefined): boolean {
  if (s === null || s === undefined || s.length === 0) return false
  return RAW_MARKUP_PREFIX.test(s.trimStart())
}

/**
 * Surface a markdown-conversion fallback to the user. Prints a warning to
 * stderr and exits non-zero if `HULY_MARKDOWN_FALLBACK_FAIL=1` is set.
 * Centralized here so the wording stays consistent across every
 * `* get --markdown` path.
 */
export function warnMarkdownFallback (): void {
  console.error('warning: markdown conversion unavailable — server returned raw prosemirror markup')
  console.error('hint: pass --raw-markup to see the stored markup, or retry once the converter is restored')
  if (process.env.HULY_MARKDOWN_FALLBACK_FAIL === '1') process.exit(ExitCode.Server)
}

export interface GlobalRunOpts {
  json?: boolean
  ci?: boolean
  markdown?: boolean
  rawMarkup?: boolean
  dryRun?: boolean
  minimal?: boolean
  yes?: boolean
  workspace?: string
  url?: string
}

export interface ListRunOpts extends GlobalRunOpts {
  limit?: number
  offset?: number
}

export interface ListOpts<T extends Doc> {
  classId: Ref<Class<T>>
  query?: (opts: ListRunOpts) => Record<string, unknown>
  columns: () => Array<TableColumn<Record<string, unknown>>>
  label?: string
}

export function makeList<T extends Doc>(opts: ListOpts<T>) {
  return async function runList(listOpts: ListRunOpts = {}): Promise<void> {
    const client = await connectCli({ url: listOpts.url, workspace: listOpts.workspace })
    try {
      const query = (opts.query ?? (() => ({})))(listOpts)
      const docs = (await withSpinner(
        `Loading ${opts.label ?? 'records'}…`,
        () => client.findAll(opts.classId, query as any),
        listOpts
      )) as unknown as T[]
      let r = docs
      if (listOpts.offset && listOpts.offset > 0) r = r.slice(listOpts.offset)
      if (listOpts.limit && listOpts.limit > 0) r = r.slice(0, listOpts.limit)
      if (shouldJson({ json: listOpts.json, ci: listOpts.ci })) {
        json(r)
        return
      }
      table(r as unknown as Record<string, unknown>[], opts.columns())
    } finally {
      await client.close()
    }
  }
}

export interface GetOpts<T extends Doc> {
  classId: Ref<Class<T>>
  identifierField?: keyof T
  defaultProjectIdentifier?: string
  markdownAttr?: keyof T
  columns?: () => Array<TableColumn<Record<string, unknown>>>
  label?: string
}

export function makeGet<T extends Doc>(opts: GetOpts<T>) {
  return async function runGet(ref: string, runOpts: GlobalRunOpts & { defaultProjectIdentifier?: string } = {}): Promise<void> {
    const client = await connectCli({ url: runOpts.url, workspace: runOpts.workspace })
    try {
      const id = await resolveRef(ref, {
        client,
        classId: opts.classId as Ref<Class<Doc>>,
        identifierField: opts.identifierField as string | undefined,
        defaultProjectIdentifier: runOpts.defaultProjectIdentifier
      })
      const doc = (await client.findOne(opts.classId, { _id: id as Ref<T> })) as T | undefined
      if (!doc) throw new CliError(ExitCode.NotFound, `${opts.label ?? 'record'} ${ref} not found`)

      if ((runOpts.markdown || runOpts.rawMarkup) && opts.markdownAttr) {
        const raw = (doc as Record<string, unknown>)[opts.markdownAttr as string]
        if (raw) {
          try {
            const body = await client.fetchMarkup(
              opts.classId as Ref<Class<Doc>>,
              doc._id,
              opts.markdownAttr as string,
              raw as any,
              runOpts.rawMarkup ? 'markup' : 'markdown'
            )
            const bodyStr = String(body ?? '')
            if (runOpts.markdown && looksLikeRawMarkup(bodyStr)) {
              warnMarkdownFallback()
            }
            console.log(bodyStr)
            return
          } catch {
            console.log(String(raw))
            return
          }
        }
      }
      if (shouldJson({ json: runOpts.json, ci: runOpts.ci })) {
        json(doc)
        return
      }
      if (opts.columns) {
        table([doc as unknown as Record<string, unknown>], opts.columns())
      } else {
        console.log(`${(doc as Record<string, unknown>)._id}\n${JSON.stringify(doc, null, 2)}`)
      }
    } finally {
      await client.close()
    }
  }
}

export interface CreateOpts<T extends Doc> {
  classId: Ref<Class<T>>
  resolveSpace?: (client: PlatformClient, createOpts: any) => Promise<Ref<Space>>
  defaults?: (client: PlatformClient, createOpts: any) => Promise<Partial<Data<T>>>
  applyBody?: (attrs: Record<string, unknown>, createOpts: any) => Record<string, unknown>
  label?: string
}

export function makeCreate<T extends Doc>(opts: CreateOpts<T>) {
  return async function runCreate(
    createOpts: GlobalRunOpts & Record<string, unknown> & { title?: string }
  ): Promise<Ref<T>> {
    const client = await connectCli({ url: createOpts.url, workspace: createOpts.workspace })
    try {
      const space = await (opts.resolveSpace
        ? opts.resolveSpace(client, createOpts)
        : (createOpts.space as Ref<Space> | undefined) ?? Promise.reject(new CliError(ExitCode.Validation, 'missing --space')))
      const data: Record<string, unknown> = {}
      if (opts.defaults) Object.assign(data, await opts.defaults(client, createOpts))
      for (const [k, v] of Object.entries(createOpts)) {
        if (['json', 'ci', 'markdown', 'dryRun', 'minimal', 'yes', 'workspace', 'url', 'space'].includes(k)) continue
        if (v === undefined) continue
        data[k] = v
      }
      const finalData = opts.applyBody ? opts.applyBody(data, createOpts) : data
      if (createOpts.dryRun) {
        console.log(`would create ${opts.label ?? 'record'}:`)
        console.log(JSON.stringify({ _class: opts.classId, space, data: finalData }, null, 2))
        return '' as Ref<T>
      }
      const id = await withSpinner(
        `Creating ${opts.label ?? 'record'}…`,
        () => client.createDoc(opts.classId, space as Ref<Space>, finalData as any),
        createOpts
      )
      if (shouldJson({ json: createOpts.json, ci: createOpts.ci })) {
        json({ _id: id, ...finalData })
      } else {
        success('created', id)
      }
      return id
    } finally {
      await client.close()
    }
  }
}

export interface UpdateOpts<T extends Doc> {
  classId: Ref<Class<T>>
  resolveSpace?: (client: PlatformClient, doc: T, updateOpts: any) => Promise<Ref<Space>>
  identifierField?: keyof T
  defaultProjectIdentifier?: string
  label?: string
}

export function makeUpdate<T extends Doc>(opts: UpdateOpts<T>) {
  return async function runUpdate(
    ref: string,
    updateOpts: GlobalRunOpts & {
      set?: string[]
      unset?: string[]
      defaultProjectIdentifier?: string
      [k: string]: unknown
    }
  ): Promise<void> {
    const client = await connectCli({ url: updateOpts.url, workspace: updateOpts.workspace })
    try {
      const id = await resolveRef(ref, {
        client,
        classId: opts.classId as Ref<Class<Doc>>,
        identifierField: opts.identifierField as string | undefined,
        defaultProjectIdentifier: updateOpts.defaultProjectIdentifier
      })
      const doc = (await client.findOne(opts.classId, { _id: id as Ref<T> })) as T | undefined
      if (!doc) throw new CliError(ExitCode.NotFound, `${opts.label ?? 'record'} ${ref} not found`)

      const ops: Record<string, unknown> = {}
      for (const item of updateOpts.set ?? []) {
        const eq = item.indexOf('=')
        if (eq < 0) throw new CliError(ExitCode.Validation, `invalid --set entry (expected key=value): ${item}`)
        const k = item.slice(0, eq).trim()
        let v: unknown = item.slice(eq + 1).trim()
        if (v === 'true') v = true
        else if (v === 'false') v = false
        else if (/^-?\d+(\.\d+)?$/.test(String(v))) v = Number(v)
        ops[k] = v
      }
      for (const k of updateOpts.unset ?? []) ops[k] = null
      for (const [k, v] of Object.entries(updateOpts)) {
        if (['set', 'unset', 'json', 'ci', 'markdown', 'rawMarkup', 'dryRun', 'minimal', 'yes', 'workspace', 'url', 'defaultProjectIdentifier'].includes(k)) continue
        if (v === undefined) continue
        ops[k] = v
      }

      if (Object.keys(ops).length === 0) {
        throw new CliError(ExitCode.Validation, 'no update fields provided', 'pass --set key=value, --unset key, or a typed flag')
      }

      const space = opts.resolveSpace
        ? await opts.resolveSpace(client, doc, updateOpts)
        : ((doc as unknown as { space: Ref<Space> }).space)

      if (updateOpts.dryRun) {
        console.log(`would update ${opts.label ?? 'record'} ${id}:`)
        console.log(JSON.stringify({ _class: opts.classId, objectId: id, space, ops }, null, 2))
        return
      }
      await withSpinner(
        'Updating…',
        () => client.updateDoc(opts.classId, space as Ref<Space>, id as Ref<T>, ops as any),
        updateOpts
      )
      console.log(`updated ${opts.label ?? 'record'}: ${id}`)
    } finally {
      await client.close()
    }
  }
}

export interface DeleteOpts<T extends Doc> {
  classId: Ref<Class<T>>
  identifierField?: keyof T
  defaultProjectIdentifier?: string
  label?: string
}

export function makeDelete<T extends Doc>(opts: DeleteOpts<T>) {
  return async function runDelete(refs: string[], deleteOpts: GlobalRunOpts & { defaultProjectIdentifier?: string } = {}): Promise<void> {
    const client = await connectCli({ url: deleteOpts.url, workspace: deleteOpts.workspace })
    try {
      const ids = await resolveRefs(refs, {
        client,
        classId: opts.classId as Ref<Class<Doc>>,
        identifierField: opts.identifierField as string | undefined,
        defaultProjectIdentifier: deleteOpts.defaultProjectIdentifier
      })
      if (!deleteOpts.yes && ids.length > 1) {
        throw new CliError(
          ExitCode.Validation,
          `destructive: deleting ${ids.length} ${opts.label ?? 'records'} requires --yes`,
          're-run with --yes to confirm'
        )
      }
      let deleted = 0
      let skipped = 0
      for (const id of ids) {
        const doc = (await client.findOne(opts.classId, { _id: id as Ref<T> })) as T | undefined
        if (!doc) { skipped++; continue }
        const space = (doc as unknown as { space: Ref<Space> }).space
        const r = await deleteDoc(client, opts.classId, space, id as Ref<T>, deleteOpts)
        if (r.skipped) skipped++
        else { deleted++; await new Promise((res) => setTimeout(res, DELETE_GAP_MS)) }
      }
      bulkRemoved(deleted, skipped)
    } finally {
      await client.close()
    }
  }
}

export async function readBodyText(opts: { body?: string; bodyFile?: string }): Promise<string | undefined> {
  if (opts.body && opts.bodyFile) {
    throw new CliError(ExitCode.Validation, 'ambiguous body input', 'pass only one of --body or --body-file')
  }
  if (opts.bodyFile) {
    const fs = await import('node:fs/promises')
    return (await fs.readFile(opts.bodyFile, 'utf8')).trim()
  }
  return opts.body
}

/**
 * Resolve an assignee (email or name) to a contact:class:Person _id by scanning
 * workspace-local Persons. Falls back to the current account's own _id if the
 * input is empty or matches the current user.
 */
export async function resolveAssignee(client: PlatformClient, ref: string): Promise<Ref<Doc>> {
  const trimmed = ref.trim()
  if (trimmed === '' || trimmed === 'me') {
    const me = await client.getAccount()
    return me.uuid as Ref<Doc>
  }
  // Already a ref-like id?
  if (/^[a-z0-9]+:[a-z0-9]+:[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed as Ref<Doc>
  }
  const lower = trimmed.toLowerCase()
  const persons = (await client.findAll(
    'contact:class:Person' as Ref<Class<Doc>>, {}, { limit: 500 }
  )) as Array<Doc & { name?: string; email?: string }>
  const hit = persons.find(
    (p) => (p.email ?? '').toLowerCase() === lower || (p.name ?? '').toLowerCase() === lower
  )
  if (hit) return hit._id
  // Loose contains match
  const fuzzy = persons.find(
    (p) => (p.name ?? '').toLowerCase().includes(lower) || (p.email ?? '').toLowerCase().includes(lower)
  )
  if (fuzzy) return fuzzy._id
  throw new CliError(ExitCode.NotFound, `assignee ${ref} not found in workspace`)
}

export { buildIndex, resolveRef, resolveRefs }
