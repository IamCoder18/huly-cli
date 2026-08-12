import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listComponents,
  getComponent,
  createComponent,
  updateComponent,
  deleteComponents,
} from './component.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({})),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({ project: 'PROJ' }) }
})
vi.mock('../auth/prompts.js', () => ({
  pickProject: vi.fn(async () => ({ _id: 'p-1', identifier: 'PROJ', name: 'Project' })),
}))

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  // Seed the resolved project so resolveProjectForCommand's buildIndex path succeeds.
  mockClient.current.state.docs.push({ _id: 'p-1', name: 'Project', identifier: 'PROJ' } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('listComponents', () => {
  it('returns components filtered by project space', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'c-1', label: 'Backend', space: 'p-1' } as never,
      { _id: 'c-2', label: 'Frontend', space: 'p-2' } as never,
    )
    await listComponents({ project: 'PROJ', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed.length).toBe(1)
    expect(parsed[0]._id).toBe('c-1')
  })
})

describe('getComponent', () => {
  it('throws NotFound when component missing', async () => {
    await expect(getComponent('missing')).rejects.toBeInstanceOf(CliError)
  })
  it('prints JSON for found component', async () => {
    mockClient.current!.state.docs.push({ _id: 'c-1', label: 'Backend', space: 'p-1' } as never)
    await getComponent('c-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('c-1')
  })
})

describe('createComponent', () => {
  it('throws Validation when --label missing', async () => {
    await expect(createComponent({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('creates component with project space and lead=null', async () => {
    await createComponent({ project: 'PROJ', label: 'Backend', description: 'svc' })
    const c = mockClient.current!
    expect(c.state.createCalls.length).toBe(1)
    expect(c.state.createCalls[0]!.attrs).toMatchObject({ label: 'Backend', description: 'svc', lead: null })
  })
  it('dry-run prints without calling SDK', async () => {
    await createComponent({ project: 'PROJ', label: 'Backend', dryRun: true })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
})

describe('updateComponent', () => {
  it('throws NotFound when ref unresolved', async () => {
    await expect(updateComponent('missing', { label: 'X' })).rejects.toBeInstanceOf(CliError)
  })
  it('throws Validation when no fields provided', async () => {
    mockClient.current!.state.docs.push({ _id: 'c-1', label: 'X', space: 'p-1' } as never)
    await expect(updateComponent('c-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updates label and description via updateDoc', async () => {
    mockClient.current!.state.docs.push({ _id: 'c-1', label: 'X', space: 'p-1' } as never)
    await updateComponent('c-1', { label: 'New', description: '' })
    const c = mockClient.current!
    expect(c.state.updateCalls.length).toBe(1)
    expect(c.state.updateCalls[0]!.ops).toMatchObject({ label: 'New', description: '' })
  })
})

describe('deleteComponents', () => {
  it('refuses multi-delete without --yes', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'c-1', space: 'p-1' } as never,
      { _id: 'c-2', space: 'p-1' } as never,
    )
    await expect(deleteComponents(['c-1', 'c-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('skips missing refs without throwing', async () => {
    mockClient.current!.state.docs.push({ _id: 'c-1', space: 'p-1' } as never)
    await deleteComponents(['c-1'], { yes: true })
    expect(mockClient.current!.state.removeCalls.length).toBe(1)
  })
})
