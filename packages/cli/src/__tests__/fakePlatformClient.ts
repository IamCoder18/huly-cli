import { vi } from 'vitest'
import type { Doc, Ref, Class, Space } from '@hcengineering/core'
import type { PlatformClient } from '@hcengineering/api-client'

type AnyFn = (...args: unknown[]) => unknown

export interface FakeDoc {
  _id: string
  _class?: string
  space?: Ref<Space>
  [k: string]: unknown
}

export interface FakePlatformOptions {
  docs?: FakeDoc[]
  /** Returned by getAccount(); defaults to a stub with uuid `acc-1`. */
  account?: { uuid: string; primarySocialId?: string; email?: string; person?: string }
  hierarchy?: {
    getDomain?: (cls: Ref<Class<Doc>>) => string
  }
  connection?: { findAll?: (cls: Ref<Class<Doc>>, q?: unknown) => Promise<FakeDoc[]> }
}

export interface FakePlatformClient {
  state: {
    docs: FakeDoc[]
    createCalls: Array<{
      _class: Ref<Class<Doc>>
      space: Ref<Space>
      attrs: Record<string, unknown>
      objectId?: string
    }>
    updateCalls: Array<{
      _class: Ref<Class<Doc>>
      space: Ref<Space>
      id: Ref<Doc>
      ops: Record<string, unknown>
    }>
    removeCalls: Array<{ _class: Ref<Class<Doc>>; space: Ref<Space>; id: Ref<Doc> }>
    collectionAdds: Array<{
      _class: Ref<Class<Doc>>
      space: Ref<Space>
      id: Ref<Doc>
      parent: Ref<Doc>
      parentClass: Ref<Class<Doc>>
      collection: string
      attrs: Record<string, unknown>
    }>
    collectionRemoves: Array<{
      _class: Ref<Class<Doc>>
      space: Ref<Space>
      id: Ref<Doc>
      parent: Ref<Doc>
      parentClass: Ref<Class<Doc>>
      collection: string
    }>
    collectionUpdates: Array<{
      _class: Ref<Class<Doc>>
      space: Ref<Space>
      id: Ref<Doc>
      parent: Ref<Doc>
      parentClass: Ref<Class<Doc>>
      collection: string
      ops: Record<string, unknown>
    }>
    txCalls: Array<{ tx: unknown }>
  }
  getHierarchy: AnyFn
  findAll: AnyFn
  findOne: AnyFn
  createDoc: AnyFn
  updateDoc: AnyFn
  removeDoc: AnyFn
  addCollection: AnyFn
  updateCollection: AnyFn
  removeCollection: AnyFn
  getAccount: AnyFn
  fetchMarkup: AnyFn
  close: AnyFn
  tx: AnyFn
  uploadMarkupCalls: Array<{
    objectClass: Ref<Class<Doc>>
    objectId: Ref<Doc>
    objectAttr: string
    content: string
    kind: string
  }>
  markup: {
    uploadMarkup: AnyFn
    collaborator: { updateMarkup: AnyFn }
  }
  connection: { findAll: AnyFn }
}

/**
 * Build a stateful in-memory fake of `PlatformClient`. Behaves like the real
 * SDK: filters findAll by query, returns cloned docs on findOne, mutates state
 * on createDoc/updateDoc/removeDoc/addCollection/removeCollection/updateCollection,
 * and tracks all calls so tests can assert orchestration order.
 */
export function fakePlatformClient(options: FakePlatformOptions = {}): FakePlatformClient {
  const initial = options.docs ?? []
  const account = options.account ?? { uuid: 'acc-1', primarySocialId: 'social-1' }
  const state = {
    docs: initial.map((d) => ({ ...d })),
    createCalls: [] as FakePlatformClient['state']['createCalls'],
    updateCalls: [] as FakePlatformClient['state']['updateCalls'],
    removeCalls: [] as FakePlatformClient['state']['removeCalls'],
    collectionAdds: [] as FakePlatformClient['state']['collectionAdds'],
    collectionRemoves: [] as FakePlatformClient['state']['collectionRemoves'],
    collectionUpdates: [] as FakePlatformClient['state']['collectionUpdates'],
    txCalls: [] as FakePlatformClient['state']['txCalls'],
  }

  function matchesQuery(doc: Record<string, unknown>, query: Record<string, unknown> | undefined): boolean {
    if (!query) return true
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue
      if (v === null) {
        if (doc[k] != null) return false
        continue
      }
      if (
        typeof v === 'object' &&
        v !== null &&
        !Array.isArray(v) &&
        Object.keys(v as object).some((kk) => kk.startsWith('$'))
      ) {
        const op = v as Record<string, unknown>
        const dv = doc[k]
        if ('$in' in op) {
          if (!(op.$in as unknown[]).includes(dv)) return false
          continue
        }
        if ('$ne' in op) {
          if (dv === op.$ne) return false
          continue
        }
        if ('$gte' in op || '$lte' in op || '$gt' in op || '$lt' in op) {
          const num = Number(dv)
          if (Number.isNaN(num)) return false
          if ('$gte' in op && num < Number(op.$gte)) return false
          if ('$lte' in op && num > Number(op.$lte)) return false
          if ('$gt' in op && num <= Number(op.$gt)) return false
          if ('$lt' in op && num >= Number(op.$lt)) return false
          continue
        }
        if ('$regex' in op) {
          const re = new RegExp(String(op.$regex), String(op.$options ?? '') || undefined)
          if (!re.test(String(dv ?? ''))) return false
          continue
        }
        continue
      }
      if (doc[k] !== v) return false
    }
    return true
  }

  const findAll = vi.fn(async (cls: Ref<Class<Doc>>, query?: Record<string, unknown>, _opts?: unknown) => {
    const clsStr = String(cls)
    return state.docs.filter((d) => {
      const rec = d as Record<string, unknown>
      // Soft class filter: a doc counts as belonging to `cls` if its `_class`
      // matches exactly OR is missing (treat as "any").
      if (rec._class !== undefined && rec._class !== clsStr) return false
      return matchesQuery(rec, query)
    })
  })

  const findOne = vi.fn(async (cls: Ref<Class<Doc>>, query?: Record<string, unknown>) => {
    const clsStr = String(cls)
    const match = state.docs.find((d) => {
      const rec = d as Record<string, unknown>
      if (rec._class !== undefined && rec._class !== clsStr) return false
      return matchesQuery(rec, query)
    })
    return match ? ({ ...match } as Doc) : undefined
  })

  let createSeq = 0
  const createDoc = vi.fn(
    async (cls: Ref<Class<Doc>>, space: Ref<Space>, attrs: Record<string, unknown>, objectId?: string) => {
      const id = (objectId as string | undefined) ?? `generated-${++createSeq}`
      state.createCalls.push({ _class: cls, space, attrs, objectId })
      const newDoc: FakeDoc = { _id: id, _class: String(cls), space, ...attrs }
      state.docs.push(newDoc)
      return id as Ref<Doc>
    },
  )

  const updateDoc = vi.fn(
    async (cls: Ref<Class<Doc>>, space: Ref<Space>, id: Ref<Doc>, ops: Record<string, unknown>) => {
      state.updateCalls.push({ _class: cls, space, id, ops })
      const target = state.docs.find((d) => d._id === id)
      if (target) Object.assign(target, ops)
      return id
    },
  )

  const removeDoc = vi.fn(async (cls: Ref<Class<Doc>>, space: Ref<Space>, id: Ref<Doc>) => {
    state.removeCalls.push({ _class: cls, space, id })
    state.docs = state.docs.filter((d) => d._id !== id)
  })

  const addCollection = vi.fn(
    async (
      cls: Ref<Class<Doc>>,
      space: Ref<Space>,
      attachedTo: Ref<Doc>,
      attachedToClass: Ref<Class<Doc>>,
      collection: string,
      attrs: Record<string, unknown>,
    ) => {
      const newId = `coll-${++createSeq}`
      state.collectionAdds.push({
        _class: cls,
        space,
        parent: attachedTo,
        parentClass: attachedToClass,
        collection,
        attrs,
        id: newId as Ref<Doc>,
      })
      state.docs.push({
        _id: newId,
        _class: String(cls),
        space,
        attachedTo,
        attachedToClass: String(attachedToClass),
        collection,
        ...attrs,
      })
      return newId as Ref<Doc>
    },
  )

  const updateCollection = vi.fn(
    async (
      cls: Ref<Class<Doc>>,
      space: Ref<Space>,
      id: Ref<Doc>,
      attachedTo: Ref<Doc>,
      attachedToClass: Ref<Class<Doc>>,
      collection: string,
      ops: Record<string, unknown>,
    ) => {
      state.collectionUpdates.push({
        _class: cls,
        space,
        id,
        parent: attachedTo,
        parentClass: attachedToClass,
        collection,
        ops,
      })
      const target = state.docs.find((d) => d._id === id)
      if (target) Object.assign(target, ops)
    },
  )

  const removeCollection = vi.fn(
    async (
      cls: Ref<Class<Doc>>,
      space: Ref<Space>,
      id: Ref<Doc>,
      attachedTo: Ref<Doc>,
      attachedToClass: Ref<Class<Doc>>,
      collection: string,
    ) => {
      state.collectionRemoves.push({
        _class: cls,
        space,
        id,
        parent: attachedTo,
        parentClass: attachedToClass,
        collection,
      })
      state.docs = state.docs.filter((d) => d._id !== id)
    },
  )

  const getAccount = vi.fn(async () => ({ ...account }))

  const hierarchyGetDomain = options.hierarchy?.getDomain ?? (() => 'domain:tracker')
  const getHierarchy = vi.fn(() => ({ getDomain: vi.fn(hierarchyGetDomain) }))

  const fetchMarkup = vi.fn(
    async (_cls: Ref<Class<Doc>>, _id: Ref<Doc>, _attr: string, _ref: unknown, format: string) => {
      return format === 'markdown' ? '# markdown body\n' : '{"type":"doc","content":[]}'
    },
  )

  const uploadMarkupCalls: FakePlatformClient['uploadMarkupCalls'] = []
  const uploadMarkupMock = vi.fn(
    async (
      objectClass: Ref<Class<Doc>>,
      objectId: Ref<Doc>,
      objectAttr: string,
      content: string,
      kind: string,
    ) => {
      uploadMarkupCalls.push({ objectClass, objectId, objectAttr, content, kind })
      return `blob:${String(objectId)}:${objectAttr}`
    },
  )
  const collaboratorUpdate = vi.fn(async () => {})
  const close = vi.fn(async () => {})

  const tx = vi.fn(async (txOps: unknown) => {
    state.txCalls.push({ tx: txOps })
  })

  const connectionFindAll = vi.fn(async (_cls?: Ref<Class<Doc>>, q?: unknown) => {
    const docs = options.connection?.findAll
      ? await options.connection.findAll('core:class:Type' as Ref<Class<Doc>>, q)
      : []
    return docs
  })

  const client = {
    state,
    findAll,
    findOne,
    createDoc,
    updateDoc,
    removeDoc,
    addCollection,
    updateCollection,
    removeCollection,
    getAccount,
    getHierarchy,
    fetchMarkup,
    close,
    tx,
    uploadMarkupCalls,
    markup: {
      uploadMarkup: uploadMarkupMock,
      collaborator: { updateMarkup: collaboratorUpdate },
    },
    connection: { findAll: connectionFindAll },
  }

  return client as unknown as FakePlatformClient
}

export function asPlatformClient(c: FakePlatformClient): PlatformClient {
  return c as unknown as PlatformClient
}
