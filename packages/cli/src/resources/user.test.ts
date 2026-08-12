import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import { getUser, updateUser, findUser } from './user.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({
    getSocialIds: vi.fn(async () => [{ isPrimary: true, value: 'me@example.com' }]),
    getPerson: vi.fn(async () => ({ uuid: 'me-uuid', primarySocialId: 'social-1', email: 'me@example.com' })),
    findSocialIdBySocialKey: vi.fn(async () => undefined),
    findPersonBySocialKey: vi.fn(async () => undefined),
    findPersonBySocialId: vi.fn(async () => undefined),
  })),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({ url: 'http://localhost', email: 'me@example.com' }) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('getUser', () => {
  it('returns current user kv when no --ref', async () => {
    await getUser({})
    expect(console.log).toHaveBeenCalled()
  })
  it('returns person doc when --ref given', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-1',
      name: 'Alice',
      city: 'NYC',
      country: 'US',
      space: 'contacts',
    } as never)
    await getUser({ ref: 'Alice', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('p-1')
  })
  it('throws NotFound when --ref does not resolve', async () => {
    await expect(getUser({ ref: 'nope' })).rejects.toBeInstanceOf(CliError)
  })
})

describe('updateUser', () => {
  it('throws Validation on empty', async () => {
    await expect(updateUser({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws NotFound when person is not in workspace', async () => {
    await expect(updateUser({ name: 'X' })).rejects.toMatchObject({ code: ExitCode.NotFound })
  })
  it('updates the workspace-local person', async () => {
    mockClient.current!.state.docs.push({
      _id: 'me-uuid',
      _class: 'contact:class:Person',
      name: 'Me',
      space: 'contacts',
    } as never)
    await updateUser({ name: 'New' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ name: 'New' })
  })
  it('dry-run skips SDK', async () => {
    mockClient.current!.state.docs.push({ _id: 'me-uuid', space: 'contacts' } as never)
    await updateUser({ name: 'X', dryRun: true })
    expect(mockClient.current!.state.updateCalls.length).toBe(0)
  })
})

describe('findUser', () => {
  it('falls through to workspace scan when account service misses', async () => {
    mockClient.current!.state.docs.push({ _id: 'p-1', name: 'alice@example.com' } as never)
    await findUser('alice@example.com', {})
    expect(console.log).toHaveBeenCalled()
  })
  it('throws NotFound when nothing matches', async () => {
    await expect(findUser('nobody@nowhere.com', {})).rejects.toBeInstanceOf(CliError)
  })
})
