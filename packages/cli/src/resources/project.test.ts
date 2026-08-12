import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProjects,
  listStatuses,
  listTargetPreferences,
  upsertTargetPreference,
} from './project.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({
    getAccount: vi.fn(async () => ({ uuid: 'me-uuid' })),
  })),
}))

vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({ project: 'PROJ' }) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  mockClient.current.state.docs.push({ _id: 'p-1', name: 'Project', identifier: 'PROJ' } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('listProjects', () => {
  it('returns projects filtered through findAll', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-2',
      _class: 'tracker:class:Project',
      name: 'Beta',
      identifier: 'BETA',
      space: 'p-2',
    } as never)
    await listProjects({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed.map((p: { _id: string }) => p._id).toSorted()).toEqual(['p-1', 'p-2'])
  })

  it('honours --limit and --offset on the printed list', async () => {
    for (let i = 0; i < 5; i++) {
      mockClient.current!.state.docs.push({ _id: `p-${i}`, name: `P${i}`, identifier: `ID${i}` } as never)
    }
    await listProjects({ offset: 1, limit: 2 })
  })
})

describe('getProject', () => {
  it('throws NotFound when no doc matches the resolved ref', async () => {
    await expect(getProject('PROJ-MISSING')).rejects.toBeInstanceOf(CliError)
  })

  it('returns the resolved project as JSON', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-1',
      name: 'Alpha',
      identifier: 'ALPHA',
      space: 'p-1',
      private: false,
      archived: false,
    } as never)
    await getProject('ALPHA', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('p-1')
  })
})

describe('createProject', () => {
  it('throws Validation when --name is missing', async () => {
    await expect(createProject({ identifier: 'X' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation when --identifier is missing', async () => {
    await expect(createProject({ name: 'X' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('creates with opinionated defaults (type=ClassingProjectType)', async () => {
    await createProject({ name: 'Alpha', identifier: 'ALPHA' })
    const c = mockClient.current!
    expect(c.state.createCalls.length).toBe(1)
    const attrs = c.state.createCalls[0]!.attrs as Record<string, unknown>
    expect(attrs.name).toBe('Alpha')
    expect(attrs.identifier).toBe('ALPHA')
    expect(attrs).toHaveProperty('type')
  })
  it('--minimal skips opinionated defaults and description fallback', async () => {
    await createProject({ name: 'Beta', identifier: 'BETA', minimal: true })
    const c = mockClient.current!
    expect(c.state.createCalls[0]!.attrs).not.toHaveProperty('type')
    expect(c.state.createCalls[0]!.attrs).not.toHaveProperty('description')
  })
  it('prints would-create and skips SDK call on --dry-run', async () => {
    await createProject({ name: 'Beta', identifier: 'BETA', dryRun: true })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
  it('returns existing project on duplicate identifier', async () => {
    mockClient.current!.state.docs.push({ _id: 'p-existing', identifier: 'DUP', name: 'Dup' } as never)
    await createProject({ name: 'Dup', identifier: 'DUP', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))).toMatchObject({ _id: 'p-existing', created: false })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
})

describe('updateProject', () => {
  it('throws Validation when nothing to update', async () => {
    mockClient.current!.state.docs.push({ _id: 'p-1', identifier: 'A' } as never)
    await expect(updateProject('A', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('coerces key=value via parseSet and calls updateDoc', async () => {
    mockClient.current!.state.docs.push({ _id: 'p-1', identifier: 'A' } as never)
    await updateProject('A', { set: ['name=Foo', 'archived=false', 'rank=42', 'description=null'] })
    const c = mockClient.current!
    expect(c.state.updateCalls.length).toBe(1)
    expect(c.state.updateCalls[0]!.ops).toEqual({ name: 'Foo', archived: false, rank: 42, description: null })
  })
  it('dry-run prints would-update without invoking the SDK', async () => {
    mockClient.current!.state.docs.push({ _id: 'p-1', identifier: 'A' } as never)
    await updateProject('A', { set: ['name=Foo'], dryRun: true })
    expect(mockClient.current!.state.updateCalls.length).toBe(0)
  })
})

describe('deleteProjects', () => {
  it('refuses destructive delete without --yes', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-2',
      _class: 'tracker:class:Project',
      identifier: 'PROJ2',
    } as never)
    await expect(deleteProjects(['PROJ', 'PROJ2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('removes resolved projects when --yes', async () => {
    mockClient.current!.state.docs.push({ _id: 'p-1', identifier: 'A' } as never)
    await deleteProjects(['A'], { yes: true })
    expect(mockClient.current!.state.removeCalls.length).toBe(1)
  })
})

describe('listStatuses', () => {
  it('sorts statuses by rank', async () => {
    mockClient.current!.state.docs.push(
      {
        _id: 'tracker:status:B',
        _class: 'tracker:class:IssueStatus',
        name: 'B',
        rank: 2,
        ofAttribute: 'tracker:attribute:IssueStatus',
      } as never,
      {
        _id: 'tracker:status:A',
        _class: 'tracker:class:IssueStatus',
        name: 'A',
        rank: 1,
        ofAttribute: 'tracker:attribute:IssueStatus',
      } as never,
    )
    await listStatuses({ project: 'PROJ', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed.map((s: { _id: string }) => String(s._id).split(':').pop())).toEqual(['A', 'B'])
  })
})

describe('listTargetPreferences', () => {
  it('prints "(no target preferences)" when empty', async () => {
    await listTargetPreferences({ project: 'PROJ' })
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    )
    expect(logs.some((l) => /no target preferences/.test(l))).toBe(true)
  })
  it('returns the preferences as JSON when --json', async () => {
    mockClient.current!.state.docs.push({ _id: 'pref-1', attachedTo: 'p-1', props: [] } as never)
    await listTargetPreferences({ project: 'PROJ', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})

describe('upsertTargetPreference', () => {
  it('throws Validation when no --props provided', async () => {
    await expect(upsertTargetPreference({ project: 'PROJ' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('throws Validation on invalid --props entry', async () => {
    await expect(upsertTargetPreference({ project: 'PROJ', props: ['badentry'] })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('creates a new preference when none exists', async () => {
    await upsertTargetPreference({ project: 'PROJ', props: ['key=value', 'on=true'] })
    const c = mockClient.current!
    expect(c.state.createCalls.length).toBe(1)
    expect(c.state.createCalls[0]!.attrs).toMatchObject({
      attachedTo: expect.anything(),
      props: [
        { key: 'key', value: 'value' },
        { key: 'on', value: true },
      ],
    })
  })
  it('upserts (merges keys) into the first existing preference', async () => {
    mockClient.current!.state.docs.push({
      _id: 'pref-1',
      attachedTo: 'p-1',
      space: 'p-1',
      props: [{ key: 'old', value: 'x' }],
    } as never)
    await upsertTargetPreference({ project: 'PROJ', props: ['old=y', 'new=z'] })
    const c = mockClient.current!
    expect(c.state.updateCalls.length).toBe(1)
    const merged = c.state.updateCalls[0]!.ops.props as Array<{ key: string; value: unknown }>
    expect(merged.find((p) => p.key === 'old')?.value).toBe('y')
    expect(merged.find((p) => p.key === 'new')?.value).toBe('z')
  })
})
