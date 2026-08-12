import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import { listTimeEntries, logTime, deleteTimeEntries, timeReport } from './time.js'
import { ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({})),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({}) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('listTimeEntries', () => {
  it('lists entries attached to issue with collection filter', async () => {
    mockClient.current!.state.docs.push({ _id: 'i-1', space: 'p-1' } as never)
    mockClient.current!.state.docs.push({
      _id: 'ts-1',
      attachedTo: 'i-1',
      attachedToClass: 'tracker:class:Issue',
      collection: 'reports',
      value: 1.5,
      description: 'work',
      date: Date.now(),
      space: 'p-1',
    } as never)
    await listTimeEntries({ issue: 'i-1', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('throws Validation on invalid --start', async () => {
    await expect(listTimeEntries({ start: 'bad' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation on invalid --end', async () => {
    await expect(listTimeEntries({ end: 'bad' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})

describe('logTime', () => {
  it('throws Validation when --issue missing', async () => {
    await expect(logTime({ minutes: 30 })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation when both --minutes and --hours supplied', async () => {
    await expect(logTime({ issue: 'i-1', minutes: 30, hours: 0.5 })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('throws Validation when neither duration supplied', async () => {
    await expect(logTime({ issue: 'i-1' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation when minutes is negative', async () => {
    await expect(logTime({ issue: 'i-1', minutes: -5 })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('logs --hours by converting to minutes', async () => {
    mockClient.current!.state.docs.push({ _id: 'i-1', space: 'p-1' } as never)
    await logTime({ issue: 'i-1', hours: 0.5 })
    const c = mockClient.current!
    expect(c.state.collectionAdds.length).toBe(1)
    expect(c.state.collectionAdds[0]!.attrs.value).toBeCloseTo(0.5, 2)
  })
  it('throws Validation on invalid --date', async () => {
    mockClient.current!.state.docs.push({ _id: 'i-1', space: 'p-1' } as never)
    await expect(logTime({ issue: 'i-1', minutes: 30, date: 'bad' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('dry-run prints without SDK call', async () => {
    await logTime({ issue: 'i-1', minutes: 30, dryRun: true })
    expect(mockClient.current!.state.collectionAdds.length).toBe(0)
  })
})

describe('deleteTimeEntries', () => {
  it('requires --yes for multi-delete', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'ts-1', space: 'p-1', attachedTo: 'i-1', collection: 'reports' } as never,
      { _id: 'ts-2', space: 'p-1', attachedTo: 'i-1', collection: 'reports' } as never,
    )
    await expect(deleteTimeEntries(['ts-1', 'ts-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('removes an entry', async () => {
    mockClient.current!.state.docs.push({
      _id: 'ts-1',
      space: 'p-1',
      attachedTo: 'i-1',
      attachedToClass: 'tracker:class:Issue',
      collection: 'reports',
    } as never)
    await deleteTimeEntries(['ts-1'], { yes: true })
    expect(mockClient.current!.state.collectionRemoves.length).toBe(1)
  })
})

describe('timeReport', () => {
  it('is an alias for listTimeEntries with --issue', async () => {
    mockClient.current!.state.docs.push({ _id: 'i-1', space: 'p-1' } as never)
    await expect(timeReport('i-1', { json: true })).resolves.toBeUndefined()
  })
})
