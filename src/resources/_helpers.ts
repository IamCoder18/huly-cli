import type { Doc, Ref, Space, Class, Data } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'
import pkg from '@hcengineering/api-client'
const { MarkupContent } = pkg
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, buildIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, type TableColumn, success, bulkRemoved } from "../output/format.js"
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { deleteDoc } from '../commands/dry-run.js'

const DELETE_GAP_MS = 100

export interface GlobalRunOpts {
  json?: boolean
  ci?: boolean
  markdown?: boolean
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
      const account = await client.getAccount()
      const id = await resolveRef(ref, {
        client,
        classId: opts.classId as Ref<Class<Doc>>,
        workspaceId: account.uuid,
        identifierField: opts.identifierField as string | undefined,
        defaultProjectIdentifier: runOpts.defaultProjectIdentifier
      })
      const doc = (await client.findOne(opts.classId, { _id: id as Ref<T> })) as T | undefined
      if (!doc) throw new CliError(ExitCode.NotFound, `${opts.label ?? 'record'} ${ref} not found`)

      if (runOpts.markdown && opts.markdownAttr) {
        const raw = (doc as Record<string, unknown>)[opts.markdownAttr as string]
        if (raw) {
          try {
            const body = await client.fetchMarkup(
              opts.classId as Ref<Class<Doc>>,
              doc._id,
              opts.markdownAttr as string,
              raw as any,
              'markdown'
            )
            console.log(body)
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
      const account = await client.getAccount()
      const id = await resolveRef(ref, {
        client,
        classId: opts.classId as Ref<Class<Doc>>,
        workspaceId: account.uuid,
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
        if (['set', 'unset', 'json', 'ci', 'markdown', 'dryRun', 'minimal', 'yes', 'workspace', 'url', 'defaultProjectIdentifier'].includes(k)) continue
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
      const account = await client.getAccount()
      const ids = await resolveRefs(refs, {
        client,
        classId: opts.classId as Ref<Class<Doc>>,
        workspaceId: account.uuid,
        identifierField: opts.identifierField as string | undefined,
        defaultProjectIdentifier: deleteOpts.defaultProjectIdentifier
      })
      if (!deleteOpts.yes && ids.length > 1) {
        console.error(`warning: deleting ${ids.length} ${opts.label ?? 'records'}; pass --yes to confirm`)
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

export function wrapBody(body: string | undefined): string | undefined {
  if (!body) return undefined
  return body
}

export async function resolveByTitle<T extends Doc>(
  client: PlatformClient,
  classId: Ref<Class<T>>,
  workspaceId: string,
  title: string,
  extraQuery: Record<string, unknown> = {}
): Promise<T | undefined> {
  const docs = (await client.findAll(classId, { ...extraQuery })) as unknown as T[]
  const lower = title.toLowerCase()
  return docs.find((d) => String((d as Record<string, unknown>).title ?? '').toLowerCase() === lower)
}

export { buildIndex, resolveRef, resolveRefs }
