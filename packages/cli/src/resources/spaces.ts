import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import { CLASS } from '../transport/identifiers.js'
import { connectCli } from '../transport/sdk.js'
import { resolveRef, resolveRefs, invalidateIndex } from '../transport/ref-resolver.js'
import { shouldJson, json, table, header, kv, COLUMNS, C, success, updated, bulkRemoved } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'

type SpaceDoc = Doc & {
  name: string
  description?: string
  private?: boolean
  archived?: boolean
  members?: Ref<Doc>[]
  owners?: Ref<Doc>[]
  type?: Ref<Doc>
  [k: string]: unknown
}

type SpaceType = Doc & {
  name?: string
  shortDescription?: string
  descriptor?: string
  [k: string]: unknown
}

type Permission = Doc & {
  objectId: Ref<Doc>
  objectClass: Ref<Class<Doc>>
  role: Ref<Doc>
  [k: string]: unknown
}

type Role = Doc & {
  name: string
  [k: string]: unknown
}

type Person = Doc & {
  name: string
  email?: string
  [k: string]: unknown
}

// ---- Spaces ----

export interface ListSpacesOpts {
  type?: string
  archived?: boolean
  private?: boolean
  limit?: number
  offset?: number
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listSpaces(opts: ListSpacesOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const query: Record<string, unknown> = {}
    if (opts.type) query.type = opts.type as Ref<Doc>
    if (opts.archived === true) query.archived = true
    else if (opts.archived === false) query.archived = { $ne: true }
    if (opts.private === true) query.private = true
    else if (opts.private === false) query.private = { $ne: true }
    const docs = (await withSpinner(
      'Loading spaces…',
      () => client.findAll(CLASS.Space as Ref<Class<SpaceDoc>>, query as any),
      opts
    )) as SpaceDoc[]
    let r = docs
    if (opts.offset && opts.offset > 0) r = r.slice(opts.offset)
    if (opts.limit && opts.limit > 0) r = r.slice(0, opts.limit)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(r); return }
    table(r as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME', format: (r) => C.emphasis(String((r as SpaceDoc).name ?? '—')) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as SpaceDoc)._id).slice(-16)) },
      { key: 'private', header: 'PRIVATE', align: 'center', format: (r) => (r as SpaceDoc).private ? C.warn('yes') : C.muted('—') },
      { key: 'archived', header: 'ARCHIVED', align: 'center', format: (r) => (r as SpaceDoc).archived ? C.muted('yes') : C.ok('—') },
      { key: 'members', header: 'MEMBERS', align: 'right', format: (r) => String(((r as SpaceDoc).members ?? []).length) }
    ], { count: true, title: 'spaces' })
  } finally { await client.close() }
}

export async function getSpace(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CLASS.Space as Ref<Class<Doc>> })
    const doc = await client.findOne(CLASS.Space as Ref<Class<SpaceDoc>>, { _id: id as Ref<SpaceDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `space ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`Space — ${doc.name ?? '(unnamed)'}`, { subtitle: doc._id })
    kv([
      ['ID', C.id(String(doc._id))],
      ['Name', C.emphasis(String(doc.name ?? '—'))],
      ['Private', doc.private ? C.warn('yes') : C.muted('no')],
      ['Archived', doc.archived ? C.muted('yes') : C.ok('no')],
      ['Members', String((doc.members ?? []).length)],
      ['Owners', String((doc.owners ?? []).length)],
      ['Description', doc.description ? String(doc.description) : C.muted('—')],
      ['Type', doc.type ? C.id(String(doc.type)) : C.muted('—')],
      ['Created', doc.createdOn != null ? new Date(Number(doc.createdOn)).toISOString() : C.muted('—')],
      ['_class', C.id(String(doc._class))]
    ])
  } finally { await client.close() }
}

export async function updateSpace(ref: string, opts: {
  name?: string
  description?: string
  private?: boolean
  archived?: boolean
  dryRun?: boolean
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CLASS.Space as Ref<Class<Doc>> })
    const doc = await client.findOne(CLASS.Space as Ref<Class<SpaceDoc>>, { _id: id as Ref<SpaceDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `space ${ref} not found`)
    const ops: Record<string, unknown> = {}
    if (opts.name !== undefined) ops.name = opts.name
    if (opts.description !== undefined) ops.description = opts.description
    if (opts.private !== undefined) ops.private = opts.private
    if (opts.archived !== undefined) ops.archived = opts.archived
    if (Object.keys(ops).length === 0) throw new CliError(ExitCode.Validation, 'nothing to update')
    if (opts.dryRun) {
      console.log(`would update space ${id}:`)
      console.log(JSON.stringify(ops, null, 2))
      return
    }
    await withSpinner('Updating space…', () => client.updateDoc(CLASS.Space as Ref<Class<SpaceDoc>>, doc._id as unknown as Ref<Space>, id as Ref<Doc>, ops as any), opts)
    updated('updated space', id as unknown as string)
  } finally { await client.close() }
}

// ---- Space Types ----

export async function listSpaceTypes(opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner('Loading space types…', () => client.findAll(CLASS.SpaceType as Ref<Class<SpaceType>>, {}), opts)) as SpaceType[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME' },
      { key: 'shortDescription', header: 'DESCRIPTION', format: (r) => String((r as SpaceType).shortDescription ?? '').slice(0, 50) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as SpaceType)._id).slice(-16)) }
    ], { count: true, title: 'space-types' })
  } finally { await client.close() }
}

export async function getSpaceType(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CLASS.SpaceType as Ref<Class<Doc>> })
    const doc = await client.findOne(CLASS.SpaceType as Ref<Class<SpaceType>>, { _id: id as Ref<SpaceType> })
    if (!doc) throw new CliError(ExitCode.NotFound, `space-type ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`SpaceType — ${doc.name ?? '(unnamed)'}`)
    kv([
      ['ID', C.id(String(doc._id))],
      ['Name', C.emphasis(String(doc.name ?? '—'))],
      ['Description', String(doc.shortDescription ?? '—')],
      ['_class', C.id(String(doc._class))]
    ])
  } finally { await client.close() }
}

// ---- Space Permissions ----

export async function listSpacePermissions(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const spaceId = await resolveRef(ref, { client, classId: CLASS.Space as Ref<Class<Doc>> })
    const perms = (await client.findAll(CLASS.Permission as Ref<Class<Permission>>, { objectId: spaceId })) as Permission[]
    // Augment role names for output
    const roleIds = Array.from(new Set(perms.map((p) => String(p.role))))
    const roles = roleIds.length > 0
      ? ((await client.findAll('core:class:Role' as Ref<Class<Role>>, { _id: { $in: roleIds as Ref<Doc>[] } })) as Role[])
      : []
    const roleMap = new Map(roles.map((r) => [String(r._id), r.name]))
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(perms); return }
    if (perms.length === 0) {
      console.log(C.muted('(no permissions)'))
      return
    }
    table(perms as unknown as Record<string, unknown>[], [
      { key: 'role', header: 'ROLE', format: (r) => C.emphasis(roleMap.get(String((r as Permission).role)) ?? String((r as Permission).role)) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as Permission)._id).slice(-16)) }
    ], { count: true, title: 'space-permissions' })
  } finally { await client.close() }
}

async function resolvePersonIds(client: Awaited<ReturnType<typeof connectCli>>, emails: string[]): Promise<Ref<Doc>[]> {
  const persons = (await client.findAll(CLASS.Person as Ref<Class<Person>>, {}, { limit: 500 })) as Person[]
  const map = new Map<string, Person>()
  for (const p of persons) {
    if (p.name) map.set(p.name.toLowerCase(), p)
    if (p.email) map.set(p.email.toLowerCase(), p)
  }
  const account = await client.getAccount()
  const myEmail = (account as any).email as string | undefined
  const myPersonFallback: Ref<Doc> = account.uuid as Ref<Doc>
  const ids: Ref<Doc>[] = []
  for (const e of emails) {
    if (e === 'me' || (myEmail && e.toLowerCase() === myEmail.toLowerCase())) {
      ids.push(myPersonFallback)
      continue
    }
    const hit = map.get(e.toLowerCase())
    if (!hit) throw new CliError(ExitCode.NotFound, `person not found: ${e} (use 'me' for current user)`)
    ids.push(hit._id as Ref<Doc>)
  }
  return ids
}

export async function addSpaceMembers(ref: string, members: string[], opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CLASS.Space as Ref<Class<Doc>> })
    const doc = await client.findOne(CLASS.Space as Ref<Class<SpaceDoc>>, { _id: id as Ref<SpaceDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `space ${ref} not found`)
    const ids = await resolvePersonIds(client, members)
    const existing = new Set((doc.members ?? []).map((m: any) => String(m)))
    const added = ids.filter((i) => !existing.has(String(i)))
    if (added.length === 0) { console.log(C.muted('(no new members)')); return }
    await withSpinner('Adding members…', () => client.updateDoc(CLASS.Space as Ref<Class<SpaceDoc>>, doc._id as unknown as Ref<Space>, id as Ref<Doc>, { $push: { members: { $each: added } } } as any), opts)
    invalidateIndex(client, CLASS.Space)
    success('added members', `${added.length} to ${doc.name}`, id as unknown as string)
  } finally { await client.close() }
}

export async function removeSpaceMembers(ref: string, members: string[], opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CLASS.Space as Ref<Class<Doc>> })
    const doc = await client.findOne(CLASS.Space as Ref<Class<SpaceDoc>>, { _id: id as Ref<SpaceDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `space ${ref} not found`)
    const ids = await resolvePersonIds(client, members)
    const toRemove = new Set(ids.map((i) => String(i)))
    const next = (doc.members ?? []).filter((m: any) => !toRemove.has(String(m)))
    await withSpinner('Removing members…', () => client.updateDoc(CLASS.Space as Ref<Class<SpaceDoc>>, doc._id as unknown as Ref<Space>, id as Ref<Doc>, { members: next } as any), opts)
    success('removed members', `${toRemove.size} from ${doc.name}`, id as unknown as string)
  } finally { await client.close() }
}

export async function setSpaceOwners(ref: string, members: string[], opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string }): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CLASS.Space as Ref<Class<Doc>> })
    const doc = await client.findOne(CLASS.Space as Ref<Class<SpaceDoc>>, { _id: id as Ref<SpaceDoc> })
    if (!doc) throw new CliError(ExitCode.NotFound, `space ${ref} not found`)
    const ids = await resolvePersonIds(client, members)
    await withSpinner('Setting owners…', () => client.updateDoc(CLASS.Space as Ref<Class<SpaceDoc>>, doc._id as unknown as Ref<Space>, id as Ref<Doc>, { owners: ids } as any), opts)
    success('set owners', `${ids.length} on ${doc.name}`, id as unknown as string)
  } finally { await client.close() }
}

// ---- Associations ----

type Association = Doc & {
  a: Ref<Doc>
  b: Ref<Doc>
  aClass: Ref<Class<Doc>>
  bClass: Ref<Class<Doc>>
  [k: string]: unknown
}

export interface ListAssociationsOpts {
  a?: string
  b?: string
  aClass?: string
  bClass?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listAssociations(opts: ListAssociationsOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const q: Record<string, unknown> = {}
    if (opts.a) q.a = await resolveRef(opts.a, { client, classId: (opts.aClass ?? 'core:class:Doc') as Ref<Class<Doc>> })
    if (opts.b) q.b = await resolveRef(opts.b, { client, classId: (opts.bClass ?? 'core:class:Doc') as Ref<Class<Doc>> })
    if (opts.aClass) q.aClass = opts.aClass
    if (opts.bClass) q.bClass = opts.bClass
    const docs = (await withSpinner('Loading associations…', () => client.findAll(CLASS.Association as Ref<Class<Association>>, q as any), opts)) as Association[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    if (docs.length === 0) { console.log(C.muted('(no associations)')); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'a', header: 'A', format: (r) => C.id(String((r as Association).a).slice(-12)) },
      { key: 'aClass', header: 'A CLASS', format: (r) => String((r as Association).aClass).split(':').pop() ?? '' },
      { key: 'b', header: 'B', format: (r) => C.id(String((r as Association).b).slice(-12)) },
      { key: 'bClass', header: 'B CLASS', format: (r) => String((r as Association).bClass).split(':').pop() ?? '' },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as Association)._id).slice(-12)) }
    ], { count: true, title: 'associations' })
  } finally { await client.close() }
}

export interface CreateAssociationOpts {
  a: string
  b: string
  aClass?: string
  bClass?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function createAssociation(opts: CreateAssociationOpts): Promise<void> {
  if (!opts.a || !opts.b) throw new CliError(ExitCode.Validation, 'missing --a or --b')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const aClass = (opts.aClass ?? 'core:class:Doc') as Ref<Class<Doc>>
    const bClass = (opts.bClass ?? 'core:class:Doc') as Ref<Class<Doc>>
    const aId = await resolveRef(opts.a, { client, classId: aClass })
    const bId = await resolveRef(opts.b, { client, classId: bClass })
    const aDoc = await client.findOne(aClass, { _id: aId as Ref<Doc> })
    if (!aDoc) throw new CliError(ExitCode.NotFound, `a ${opts.a} not found`)
    const data: Record<string, unknown> = { a: aId, aClass, b: bId, bClass, association: { type: 'Association' as any } as any }
    const id = await withSpinner('Creating association…', () => client.addCollection(CLASS.Association as Ref<Class<Association>>, (aDoc as Doc).space as Ref<Doc>, aId, aClass, 'associations', data as any), opts)
    invalidateIndex(client, CLASS.Association)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, a: aId, b: bId }); return }
    success('created association', '', id as unknown as string)
  } finally { await client.close() }
}

export async function deleteAssociations(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, { client, classId: CLASS.Association as Ref<Class<Doc>> })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} associations requires --yes`, 're-run with --yes')
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = (await client.findOne(CLASS.Association as Ref<Class<Association>>, { _id: id as Ref<Association> })) as Association | undefined
      if (!doc) { skipped++; continue }
      try {
        await client.removeCollection(CLASS.Association as Ref<Class<Association>>, doc.space as Ref<Doc>, id as Ref<Doc>, doc.a, doc.aClass, 'associations')
        deleted++
      } catch { skipped++ }
    }
    bulkRemoved(deleted, skipped, 'associations')
  } finally { await client.close() }
}

// ---- Relations ----
// Relations are pairs (source, target) attached to a source document. They
// differ from Associations in that they're collections on a source doc.

type Relation = Doc & {
  _id: Ref<Doc>
  sourceDoc: Ref<Doc>
  targetDoc: Ref<Doc>
  sourceDocClass: Ref<Class<Doc>>
  targetDocClass: Ref<Class<Doc>>
  attachedTo: Ref<Doc>
  [k: string]: unknown
}

export interface ListRelationsOpts {
  source?: string
  sourceClass?: string
  target?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listRelations(opts: ListRelationsOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const q: Record<string, unknown> = {}
    if (opts.source) {
      const sClass = (opts.sourceClass ?? 'core:class:Doc') as Ref<Class<Doc>>
      const sId = await resolveRef(opts.source, { client, classId: sClass })
      q.attachedTo = sId
      q.sourceDoc = sId
    }
    if (opts.target) {
      const tId = await resolveRef(opts.target, { client, classId: 'core:class:Doc' as Ref<Class<Doc>> })
      q.targetDoc = tId
    }
    const docs = (await client.findAll(CLASS.Relation as Ref<Class<Relation>>, q as any)) as Relation[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    if (docs.length === 0) { console.log(C.muted('(no relations)')); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'sourceDoc', header: 'SOURCE', format: (r) => C.id(String((r as Relation).sourceDoc).slice(-12)) },
      { key: 'targetDoc', header: 'TARGET', format: (r) => C.id(String((r as Relation).targetDoc).slice(-12)) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as Relation)._id).slice(-12)) }
    ], { count: true, title: 'relations' })
  } finally { await client.close() }
}

export interface CreateRelationOpts {
  source: string
  sourceClass?: string
  target: string
  targetClass?: string
  name?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function createRelation(opts: CreateRelationOpts): Promise<void> {
  if (!opts.source || !opts.target) throw new CliError(ExitCode.Validation, 'missing --source or --target')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const sClass = (opts.sourceClass ?? 'core:class:Doc') as Ref<Class<Doc>>
    const tClass = (opts.targetClass ?? 'core:class:Doc') as Ref<Class<Doc>>
    const sId = await resolveRef(opts.source, { client, classId: sClass })
    const tId = await resolveRef(opts.target, { client, classId: tClass })
    const sourceDoc = await client.findOne(sClass, { _id: sId as Ref<Doc> })
    if (!sourceDoc) throw new CliError(ExitCode.NotFound, `source ${opts.source} not found`)
    const data: Record<string, unknown> = {
      sourceDoc: sId,
      sourceDocClass: sClass,
      targetDoc: tId,
      targetDocClass: tClass,
      name: opts.name ?? 'relation',
      type: 'Relation' as any
    }
    const id = await withSpinner('Creating relation…', () => client.addCollection(CLASS.Relation as Ref<Class<Relation>>, (sourceDoc as Doc).space as Ref<Doc>, sId, sClass, 'relations', data as any), opts)
    invalidateIndex(client, CLASS.Relation)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, source: sId, target: tId }); return }
    success('created relation', '', id as unknown as string)
  } finally { await client.close() }
}

export async function deleteRelations(refs: string[], opts: { workspace?: string; url?: string; yes?: boolean } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ids = await resolveRefs(refs, { client, classId: CLASS.Relation as Ref<Class<Doc>> })
    if (!opts.yes && ids.length > 1) throw new CliError(ExitCode.Validation, `destructive: deleting ${ids.length} relations requires --yes`)
    let deleted = 0, skipped = 0
    for (const id of ids) {
      const doc = (await client.findOne(CLASS.Relation as Ref<Class<Relation>>, { _id: id as Ref<Relation> })) as Relation | undefined
      if (!doc) { skipped++; continue }
      try {
        await client.removeCollection(CLASS.Relation as Ref<Class<Relation>>, doc.space as Ref<Doc>, id as Ref<Doc>, doc.sourceDoc, doc.sourceDocClass, 'relations')
        deleted++
      } catch { skipped++ }
    }
    bulkRemoved(deleted, skipped, 'relations')
  } finally { await client.close() }
}

// ---- Project types / Task types / IssueStatus (Phase 11 Task Management) ----

type ProjectType = Doc & {
  name: string
  shortDescription?: string
  descriptor?: string
  [k: string]: unknown
}

type TaskType = Doc & {
  name: string
  description?: string
  parent?: Ref<Doc>
  [k: string]: unknown
}

export async function listProjectTypes(opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const docs = (await withSpinner('Loading project types…', () => client.findAll(CLASS.ProjectType as Ref<Class<ProjectType>>, {}), opts)) as ProjectType[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME' },
      { key: 'shortDescription', header: 'DESCRIPTION', format: (r) => String((r as ProjectType).shortDescription ?? '').slice(0, 50) },
      { key: 'descriptor', header: 'DESCRIPTOR', align: 'right' },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as ProjectType)._id).slice(-16)) }
    ], { count: true, title: 'project-types' })
  } finally { await client.close() }
}

export async function getProjectType(ref: string, opts: { json?: boolean; ci?: boolean; workspace?: string; url?: string } = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const id = await resolveRef(ref, { client, classId: CLASS.ProjectType as Ref<Class<Doc>> })
    const doc = await client.findOne(CLASS.ProjectType as Ref<Class<ProjectType>>, { _id: id as Ref<ProjectType> })
    if (!doc) throw new CliError(ExitCode.NotFound, `project-type ${ref} not found`)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(doc); return }
    header(`ProjectType — ${doc.name ?? '(unnamed)'}`)
    kv([
      ['ID', C.id(String(doc._id))],
      ['Name', C.emphasis(String(doc.name ?? '—'))],
      ['Descriptor', String(doc.descriptor ?? '—')],
      ['Description', String(doc.shortDescription ?? '—')],
      ['_class', C.id(String(doc._class))]
    ])
  } finally { await client.close() }
}

export interface ListTaskTypesOpts {
  projectType?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function listTaskTypes(opts: ListTaskTypesOpts = {}): Promise<void> {
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const q: Record<string, unknown> = {}
    if (opts.projectType) q.parent = await resolveRef(opts.projectType, { client, classId: CLASS.ProjectType as Ref<Class<Doc>> })
    const docs = (await withSpinner('Loading task types…', () => client.findAll(CLASS.TaskType as Ref<Class<TaskType>>, q as any), opts)) as TaskType[]
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json(docs); return }
    table(docs as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME' },
      { key: 'description', header: 'DESCRIPTION', format: (r) => String((r as TaskType).description ?? '').slice(0, 50) },
      { key: 'parent', header: 'PARENT', format: (r) => C.id(String((r as TaskType).parent ?? '').slice(-12)) },
      { key: '_id', header: '_ID', format: (r) => C.id(String((r as TaskType)._id).slice(-16)) }
    ], { count: true, title: 'task-types' })
  } finally { await client.close() }
}

export interface CreateTaskTypeOpts {
  projectType: string
  label: string
  description?: string
  icon?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function createTaskType(opts: CreateTaskTypeOpts): Promise<void> {
  if (!opts.projectType || !opts.label) throw new CliError(ExitCode.Validation, 'missing --project-type or --label')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ptId = await resolveRef(opts.projectType, { client, classId: CLASS.ProjectType as Ref<Class<Doc>> })
    const pt = await client.findOne(CLASS.ProjectType as Ref<Class<ProjectType>>, { _id: ptId as Ref<ProjectType> })
    if (!pt) throw new CliError(ExitCode.NotFound, `project-type ${opts.projectType} not found`)
    const data: Record<string, unknown> = {
      name: opts.label,
      description: opts.description ?? '',
      parent: ptId,
      rank: '0|aaaaa:',
      icon: opts.icon ?? 'task'
    }
    const id = await withSpinner('Creating task type…', () => client.addCollection(CLASS.TaskType as Ref<Class<TaskType>>, (pt as Doc).space as Ref<Doc>, ptId, CLASS.ProjectType as Ref<Class<Doc>>, 'taskTypes', data as any), opts)
    invalidateIndex(client, CLASS.TaskType)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success('created task type', opts.label, id as unknown as string)
  } finally { await client.close() }
}

type IssueStatus = Doc & {
  name: string
  category: string
  rank: string
  description?: string
  [k: string]: unknown
}

export interface CreateIssueStatusOpts {
  projectType: string
  taskType?: string
  name: string
  category: 'UnStarted' | 'ToDo' | 'Active' | 'Won' | 'Lost'
  rank?: string
  description?: string
  json?: boolean
  ci?: boolean
  workspace?: string
  url?: string
}

export async function createIssueStatus(opts: CreateIssueStatusOpts): Promise<void> {
  if (!opts.projectType || !opts.name) throw new CliError(ExitCode.Validation, 'missing --project-type or --name')
  const client = await connectCli({ url: opts.url, workspace: opts.workspace })
  try {
    const ptId = await resolveRef(opts.projectType, { client, classId: CLASS.ProjectType as Ref<Class<Doc>> })
    const pt = await client.findOne(CLASS.ProjectType as Ref<Class<ProjectType>>, { _id: ptId as Ref<ProjectType> })
    if (!pt) throw new CliError(ExitCode.NotFound, `project-type ${opts.projectType} not found`)
    let taskTypeId: Ref<Doc> | undefined
    if (opts.taskType) {
      taskTypeId = (await resolveRef(opts.taskType, { client, classId: CLASS.TaskType as Ref<Class<Doc>> })) as Ref<Doc>
    } else {
      // Default: first task type for the project type
      const tts = (await client.findAll(CLASS.TaskType as Ref<Class<TaskType>>, { projectType: ptId })) as TaskType[]
      if (tts.length === 0) throw new CliError(ExitCode.NotFound, `no task types for project-type ${opts.projectType}; pass --task-type`)
      taskTypeId = tts[0]._id as Ref<Doc>
    }
    const data: Record<string, unknown> = {
      name: opts.name,
      description: opts.description ?? '',
      category: opts.category,
      rank: opts.rank ?? '0|aaaaa:',
      projectType: ptId,
      taskType: taskTypeId
    }
    const id = await withSpinner('Creating issue status…', () => client.addCollection(CLASS.IssueStatus as Ref<Class<IssueStatus>>, (pt as Doc).space as Ref<Doc>, ptId, CLASS.ProjectType as Ref<Class<Doc>>, 'statuses', data as any), opts)
    invalidateIndex(client, CLASS.IssueStatus)
    if (shouldJson({ json: opts.json, ci: opts.ci })) { json({ _id: id, ...data }); return }
    success('created issue status', `${opts.name} (${opts.category})`, id as unknown as string)
  } finally { await client.close() }
}
