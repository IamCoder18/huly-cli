import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listMilestones,
  getMilestone,
  createMilestone,
  updateMilestone,
  deleteMilestones,
} from './milestone.js'
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
  mockClient.current.state.docs.push({ _id: 'p-1', name: 'Project', identifier: 'PROJ' } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('listMilestones', () => {
  it('returns milestones for the project space', async () => {
    mockClient.current!.state.docs.push({ _id: 'm-1', label: 'v1', space: 'p-1' } as never)
    await listMilestones({ project: 'PROJ', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})

describe('getMilestone', () => {
  it('throws NotFound when missing', async () => {
    await expect(getMilestone('missing')).rejects.toBeInstanceOf(CliError)
  })
  it('returns milestone JSON', async () => {
    mockClient.current!.state.docs.push({
      _id: 'm-1',
      label: 'v1',
      space: 'p-1',
      status: 'planned',
      targetDate: Date.now(),
    } as never)
    await getMilestone('m-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('m-1')
  })
})

describe('createMilestone', () => {
  it('throws Validation when --label missing', async () => {
    await expect(createMilestone({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation on invalid --target-date', async () => {
    await expect(
      createMilestone({ label: 'M', project: 'PROJ', targetDate: 'not-a-date' }),
    ).rejects.toMatchObject({
      code: ExitCode.Validation,
      message: /invalid --target-date/,
    })
  })
  it('uses +30d default when no --target-date is supplied', async () => {
    await createMilestone({ label: 'M', project: 'PROJ' })
    const c = mockClient.current!
    const targetDate = c.state.createCalls[0]!.attrs.targetDate as number
    expect(targetDate).toBeGreaterThan(Date.now() + 25 * 24 * 3600 * 1000)
  })
  it('creates with parsed targetDate when supplied', async () => {
    const iso = '2030-01-15T00:00:00.000Z'
    await createMilestone({ label: 'M', project: 'PROJ', targetDate: iso })
    expect(mockClient.current!.state.createCalls[0]!.attrs.targetDate).toBe(new Date(iso).getTime())
  })
})

describe('updateMilestone', () => {
  it('throws Validation on invalid --target-date', async () => {
    mockClient.current!.state.docs.push({ _id: 'm-1', label: 'X', space: 'p-1' } as never)
    await expect(updateMilestone('m-1', { targetDate: 'bad' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('throws Validation when no fields provided', async () => {
    mockClient.current!.state.docs.push({ _id: 'm-1', label: 'X', space: 'p-1' } as never)
    await expect(updateMilestone('m-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updates status and label', async () => {
    mockClient.current!.state.docs.push({ _id: 'm-1', label: 'X', space: 'p-1', status: 'planned' } as never)
    await updateMilestone('m-1', { label: 'New', status: 'completed' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ label: 'New', status: 'completed' })
  })
})

describe('deleteMilestones', () => {
  it('requires --yes for multi-delete', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'm-1', space: 'p-1' } as never,
      { _id: 'm-2', space: 'p-1' } as never,
    )
    await expect(deleteMilestones(['m-1', 'm-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})
