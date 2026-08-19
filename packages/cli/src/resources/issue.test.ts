import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Doc } from '@hcengineering/core'
import {
  findPriorityHit,
  normalizePriorityInput,
  resolvePriority,
  seedDefaultPriorities,
  validateRelationType,
  previewDelete,
  removeIssueLabel,
} from './issue.js'
import { CliError, ExitCode } from '../output/errors.js'
import { fakePlatformClient } from '../__tests__/fakePlatformClient.js'

type FakeDoc = { _id: string; label?: string; name?: string }
type PriorityLike = Doc & { label?: string; name?: string }

function asPriority(d: FakeDoc): PriorityLike {
  return d as unknown as PriorityLike
}

// Mutable flag read by the isOpinionated mock below — tests flip it to
// `false` to exercise the `canSeed = false` branch in resolvePriority.
const opinionatedState = vi.hoisted(() => ({ on: true }))

vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return {
    ...actual,
    isOpinionated: () => opinionatedState.on,
    readEnv: () => ({ project: 'PROJ' }),
  }
})

const mockClient = vi.hoisted(() => ({ current: null as ReturnType<typeof fakePlatformClient> | null }))
vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({})),
}))

function makeClient(
  opts: {
    findAll?: FakeDoc[]
    onCreate?: (cls: string, space: string, attrs: Record<string, unknown>, objectId?: string) => unknown
  } = {},
): any {
  const state: {
    docs: PriorityLike[]
    createCalls: Array<{ cls: string; space: string; attrs: Record<string, unknown>; objectId?: string }>
  } = {
    docs: opts.findAll === undefined ? [] : opts.findAll.map(asPriority),
    createCalls: [],
  }
  return {
    state,
    findAll: vi.fn(async () => state.docs),
    createDoc: vi.fn(
      async (cls: string, space: string, attrs: Record<string, unknown>, objectId?: string) => {
        state.createCalls.push({ cls, space, attrs, objectId })
        const existing = state.docs.find((d) => d._id === objectId)
        if (existing !== undefined) {
          // mimic platform duplicate-id rejection
          throw new Error('duplicate id')
        }
        const newDoc: PriorityLike = asPriority({
          _id: (objectId as string | undefined) ?? `generated:${state.createCalls.length}`,
          label: attrs.label as string | undefined,
          name: attrs.name as string | undefined,
        })
        state.docs.push(newDoc)
        opts.onCreate?.(cls, space, attrs, objectId)
        return newDoc._id
      },
    ),
  }
}

describe('normalizePriorityInput', () => {
  it('passes through canonical labels unchanged', () => {
    expect(normalizePriorityInput('Urgent')).toBe('Urgent')
    expect(normalizePriorityInput('High')).toBe('High')
    expect(normalizePriorityInput('Medium')).toBe('Medium')
    expect(normalizePriorityInput('Low')).toBe('Low')
    expect(normalizePriorityInput('NoPriority')).toBe('NoPriority')
  })

  it('aliases `Normal` to `Medium`', () => {
    expect(normalizePriorityInput('Normal')).toBe('Medium')
    expect(normalizePriorityInput('normal')).toBe('Medium')
  })

  it('aliases `None` to `NoPriority`', () => {
    expect(normalizePriorityInput('None')).toBe('NoPriority')
    expect(normalizePriorityInput('none')).toBe('NoPriority')
  })

  it('passes unknown labels through unchanged so CLI-13 can name them', () => {
    expect(normalizePriorityInput('Bogus')).toBe('Bogus')
  })
})

describe('findPriorityHit', () => {
  const all: PriorityLike[] = [
    asPriority({ _id: 'a', label: 'Urgent', name: 'Urgent' }),
    asPriority({ _id: 'b', label: 'High', name: 'High' }),
    asPriority({ _id: 'c', label: 'Medium', name: 'Medium' }),
  ]

  it('matches by label (case-insensitive)', () => {
    expect(findPriorityHit(all, 'urgent')?._id).toBe('a')
    expect(findPriorityHit(all, 'HIGH')?._id).toBe('b')
  })

  it('falls back to matching by name', () => {
    expect(findPriorityHit(all, 'medium')?._id).toBe('c')
  })

  it('returns undefined when no match', () => {
    expect(findPriorityHit(all, 'Bogus')).toBeUndefined()
  })

  it('handles records that only have a `name` (no `label`)', () => {
    expect(findPriorityHit([asPriority({ _id: 'x', name: 'Medium' })], 'medium')?._id).toBe('x')
  })

  it('handles records that only have a `label` (no `name`)', () => {
    expect(findPriorityHit([asPriority({ _id: 'x', label: 'Medium' })], 'medium')?._id).toBe('x')
  })
})

describe('resolvePriority — explicit --priority', () => {
  it('returns the matching _id when the enum already has it', async () => {
    const client = makeClient({
      findAll: [
        { _id: 'tracker:priority:Urgent', label: 'Urgent', name: 'Urgent' },
        { _id: 'tracker:priority:High', label: 'High', name: 'High' },
      ],
    })
    const id = await resolvePriority(client, 'High')
    expect(id).toBe('tracker:priority:High')
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('seeds the 5 defaults then resolves when the enum is empty and opinionated', async () => {
    const client = makeClient()
    const id = await resolvePriority(client, 'High')
    expect(id).toBe('tracker:priority:High')
    expect(client.state.createCalls.length).toBe(5)
    expect(client.state.createCalls.map((c: { objectId?: string }) => c.objectId)).toEqual([
      'tracker:priority:Urgent',
      'tracker:priority:High',
      'tracker:priority:Medium',
      'tracker:priority:Low',
      'tracker:priority:NoPriority',
    ])
  })

  it('resolves the alias `Normal` to the Medium record', async () => {
    const client = makeClient()
    const id = await resolvePriority(client, 'Normal')
    expect(id).toBe('tracker:priority:Medium')
  })

  it('resolves the alias `None` to the NoPriority record', async () => {
    const client = makeClient()
    const id = await resolvePriority(client, 'None')
    expect(id).toBe('tracker:priority:NoPriority')
  })

  it('does not seed and throws CLI-13 when --minimal is set (even if enum is empty)', async () => {
    const client = makeClient()
    await expect(resolvePriority(client, 'High', { minimal: true })).rejects.toMatchObject({
      code: 4,
      message: /priority "High" not found/,
    })
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('does not seed and throws CLI-13 when --dry-run is set', async () => {
    const client = makeClient()
    await expect(resolvePriority(client, 'High', { dryRun: true })).rejects.toMatchObject({
      code: 4,
      message: /priority "High" not found/,
    })
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('does not seed a second time when the enum is non-empty but missing the requested label', async () => {
    const client = makeClient({
      findAll: [{ _id: 'tracker:priority:Low', label: 'Low', name: 'Low' }],
    })
    await expect(resolvePriority(client, 'High')).rejects.toMatchObject({
      code: 4,
      message: /priority "High" not found/,
    })
    // Only the Low record existed; do not auto-seed to add High — that is
    // only safe when the workspace has zero priorities (CLI-13 still throws
    // otherwise so the user notices the partial migration).
    expect(client.createDoc).not.toHaveBeenCalled()
  })
})

describe('resolvePriority — implicit (no --priority)', () => {
  it('returns Medium when the enum has it', async () => {
    const client = makeClient({
      findAll: [
        { _id: 'tracker:priority:Urgent', label: 'Urgent', name: 'Urgent' },
        { _id: 'tracker:priority:Medium', label: 'Medium', name: 'Medium' },
        { _id: 'tracker:priority:NoPriority', label: 'NoPriority', name: 'NoPriority' },
      ],
    })
    const id = await resolvePriority(client)
    expect(id).toBe('tracker:priority:Medium')
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('matches a `name: Medium` record via findPriorityHit (case-insensitive)', async () => {
    const client = makeClient({
      findAll: [{ _id: 'm', name: 'Medium' }],
    })
    const id = await resolvePriority(client)
    expect(id).toBe('m')
  })

  it('seeds and returns Medium when the enum is empty and opinionated', async () => {
    const client = makeClient()
    const id = await resolvePriority(client)
    expect(id).toBe('tracker:priority:Medium')
    expect(client.state.createCalls.length).toBe(5)
  })

  it('returns undefined (omit priority) when --minimal is set and the enum is empty', async () => {
    const client = makeClient()
    const id = await resolvePriority(client, undefined, { minimal: true })
    expect(id).toBeUndefined()
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('returns undefined (omit priority) when --dry-run is set and the enum is empty', async () => {
    const client = makeClient()
    const id = await resolvePriority(client, undefined, { dryRun: true })
    expect(id).toBeUndefined()
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('falls back to the first available priority when no Medium exists', async () => {
    const client = makeClient({
      findAll: [
        { _id: 'tracker:priority:Urgent', label: 'Urgent', name: 'Urgent' },
        { _id: 'tracker:priority:Low', label: 'Low', name: 'Low' },
      ],
    })
    const id = await resolvePriority(client)
    expect(id).toBe('tracker:priority:Urgent')
  })
})

describe('seedDefaultPriorities', () => {
  it('passes deterministic _ids to createDoc (idempotent re-seed)', async () => {
    const client = makeClient()
    await seedDefaultPriorities(client)
    for (const call of client.state.createCalls) {
      expect(call.objectId).toMatch(/^tracker:priority:/)
    }
  })

  it('swallows duplicate-id errors from the platform', async () => {
    const client = makeClient({
      findAll: [
        { _id: 'tracker:priority:Urgent', label: 'Urgent', name: 'Urgent' },
        { _id: 'tracker:priority:High', label: 'High', name: 'High' },
        { _id: 'tracker:priority:Medium', label: 'Medium', name: 'Medium' },
        { _id: 'tracker:priority:Low', label: 'Low', name: 'Low' },
        { _id: 'tracker:priority:NoPriority', label: 'NoPriority', name: 'NoPriority' },
      ],
    })
    // Re-seeding should be a no-op: every createDoc throws, every catch
    // swallows, no new records land.
    await seedDefaultPriorities(client)
    expect(client.state.docs.length).toBe(5)
  })

  it('seeds into core:space:Model', async () => {
    const client = makeClient()
    await seedDefaultPriorities(client)
    for (const call of client.state.createCalls) {
      expect(call.space).toBe('core:space:Model')
    }
  })
})

describe('resolvePriority — opinionated defaults OFF', () => {
  it.beforeAll(() => {
    opinionatedState.on = false
  })
  it.afterAll(() => {
    opinionatedState.on = true
  })

  it('does NOT seed and throws CLI-13 when explicit --priority is given against an empty enum', async () => {
    const client = makeClient()
    await expect(resolvePriority(client, 'High')).rejects.toMatchObject({
      code: 4,
      message: /priority "High" not found/,
    })
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('returns undefined (omit priority) for implicit resolution against an empty enum', async () => {
    const client = makeClient()
    const id = await resolvePriority(client)
    expect(id).toBeUndefined()
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('still resolves an explicit --priority against a populated enum', async () => {
    const client = makeClient({
      findAll: [{ _id: 'tracker:priority:Urgent', label: 'Urgent', name: 'Urgent' }],
    })
    const id = await resolvePriority(client, 'Urgent')
    expect(id).toBe('tracker:priority:Urgent')
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('still resolves an implicit priority against a populated enum (prefers Medium)', async () => {
    const client = makeClient({
      findAll: [
        { _id: 'tracker:priority:Urgent', label: 'Urgent', name: 'Urgent' },
        { _id: 'tracker:priority:Medium', label: 'Medium', name: 'Medium' },
      ],
    })
    const id = await resolvePriority(client)
    expect(id).toBe('tracker:priority:Medium')
    expect(client.createDoc).not.toHaveBeenCalled()
  })
})

describe('validateRelationType', () => {
  it('accepts the three canonical types', () => {
    expect(validateRelationType('blocks')).toBe('blocks')
    expect(validateRelationType('isBlockedBy')).toBe('isBlockedBy')
    expect(validateRelationType('relatesTo')).toBe('relatesTo')
  })
  it('throws Validation on unknown type', () => {
    expect(() => validateRelationType('dupes')).toThrow(CliError)
    try {
      validateRelationType('dupes')
    } catch (e) {
      expect(e).toBeInstanceOf(CliError)
      expect((e as CliError).code).toBe(ExitCode.Validation)
    }
  })
})

describe('previewDelete', () => {
  beforeEach(() => {
    mockClient.current = fakePlatformClient()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns preview as JSON with sub-issues and relation counts', async () => {
    mockClient.current!.state.docs.push({
      _id: 'issue-1',
      _class: 'tracker:class:Issue',
      space: 'p-1',
      relations: [{ _id: 'x', _class: 'tracker:class:Issue' }],
      blockedBy: [],
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'sub-1',
      _class: 'tracker:class:Issue',
      parent: 'issue-1',
      space: 'p-1',
    } as never)
    await previewDelete(['issue-1'], { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed[0].subIssues).toBe(1)
    expect(parsed[0].relations).toBe(1)
  })
})

describe('removeIssueLabel', () => {
  beforeEach(() => {
    mockClient.current = fakePlatformClient()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('removes a label that is attached to the issue, even if the workspace TagElement catalog is empty (issue #48)', async () => {
    mockClient.current!.state.docs.push({
      _id: 'HULY-4',
      _class: 'tracker:class:Issue',
      space: 'p-1',
      title: 'demo',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'tag-ref-1',
      _class: 'tags:class:TagReference',
      space: 'p-1',
      attachedTo: 'HULY-4',
      attachedToClass: 'tracker:class:Issue',
      collection: 'labels',
      tag: 'tag-el-1',
      title: 'publication',
      color: 0,
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'tag-ref-2',
      _class: 'tags:class:TagReference',
      space: 'p-1',
      attachedTo: 'HULY-4',
      attachedToClass: 'tracker:class:Issue',
      collection: 'labels',
      tag: 'tag-el-2',
      title: 'security',
      color: 0,
    } as never)
    await removeIssueLabel('HULY-4', 'publication', { json: true })
    expect(mockClient.current!.state.collectionRemoves).toEqual([
      expect.objectContaining({
        id: 'tag-ref-1',
        collection: 'labels',
        parent: 'HULY-4',
      }),
    ])
    const remaining = mockClient.current!.state.docs.filter(
      (d) => d._class === 'tags:class:TagReference' && (d as Record<string, unknown>).attachedTo === 'HULY-4',
    )
    expect(remaining.map((d) => (d as Record<string, unknown>).title)).toEqual(['security'])
  })

  it('still removes the label even when no matching TagElement exists in the workspace catalog', async () => {
    mockClient.current!.state.docs.push({
      _id: 'HULY-5',
      _class: 'tracker:class:Issue',
      space: 'p-1',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'tag-ref-9',
      _class: 'tags:class:TagReference',
      space: 'p-1',
      attachedTo: 'HULY-5',
      attachedToClass: 'tracker:class:Issue',
      collection: 'labels',
      tag: 'ghost-tag-id',
      title: 'orphan-label',
      color: 0,
    } as never)
    await removeIssueLabel('HULY-5', 'orphan-label', { json: true })
    expect(mockClient.current!.state.collectionRemoves).toHaveLength(1)
    expect(mockClient.current!.state.collectionRemoves[0].id).toBe('tag-ref-9')
  })

  it('throws NotFound with a clear message when the label is not attached to the issue', async () => {
    mockClient.current!.state.docs.push({
      _id: 'HULY-6',
      _class: 'tracker:class:Issue',
      space: 'p-1',
    } as never)
    await expect(removeIssueLabel('HULY-6', 'ghost', { json: true })).rejects.toMatchObject({
      code: ExitCode.NotFound,
      message: /label ghost not on issue HULY-6/,
    })
    expect(mockClient.current!.state.collectionRemoves).toHaveLength(0)
  })

  it('throws NotFound when the issue itself does not exist', async () => {
    await expect(removeIssueLabel('HULY-999', 'whatever', { json: true })).rejects.toMatchObject({
      code: ExitCode.NotFound,
      message: /issue HULY-999 not found/,
    })
  })

  it('only removes references from the labels collection, not other collections sharing the same title', async () => {
    mockClient.current!.state.docs.push({
      _id: 'HULY-7',
      _class: 'tracker:class:Issue',
      space: 'p-1',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'tag-ref-labels',
      _class: 'tags:class:TagReference',
      space: 'p-1',
      attachedTo: 'HULY-7',
      attachedToClass: 'tracker:class:Issue',
      collection: 'labels',
      tag: 'tag-1',
      title: 'shared-title',
      color: 0,
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'tag-ref-components',
      _class: 'tags:class:TagReference',
      space: 'p-1',
      attachedTo: 'HULY-7',
      attachedToClass: 'tracker:class:Issue',
      collection: 'components',
      tag: 'tag-2',
      title: 'shared-title',
      color: 0,
    } as never)
    await removeIssueLabel('HULY-7', 'shared-title', { json: true })
    expect(mockClient.current!.state.collectionRemoves).toEqual([
      expect.objectContaining({ id: 'tag-ref-labels', collection: 'labels' }),
    ])
    const componentsRef = mockClient.current!.state.docs.find((d) => d._id === 'tag-ref-components')
    expect(componentsRef).toBeDefined()
  })
})
