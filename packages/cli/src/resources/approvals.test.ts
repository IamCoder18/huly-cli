import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listApprovals,
  getApproval,
  createApproval,
  commentOnApproval,
  approveRequest,
  rejectRequest,
  cancelRequest,
  deleteApprovals,
} from './approvals.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({
    getSocialIds: vi.fn(async () => [{ isPrimary: true, value: 'me@example.com' }]),
    getPerson: vi.fn(async () => ({ uuid: 'me-uuid', email: 'me@example.com' })),
    findSocialIdBySocialKey: vi.fn(async () => undefined),
    findPersonBySocialId: vi.fn(async () => undefined),
  })),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({}) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient({
    account: { uuid: 'me-uuid', primarySocialId: 'social-1', email: 'me@example.com' },
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const seedIssue = () => {
  mockClient.current!.state.docs.push({ _id: 'issue-1', space: 'p-1', title: 'X' } as never)
}

const seedRequest = () => {
  mockClient.current!.state.docs.push({
    _id: 'req-1',
    _class: 'request:class:Request',
    status: 'Active',
    attachedTo: 'issue-1',
    attachedToClass: 'tracker:class:Issue',
    requested: ['me-uuid'],
    approved: [],
    requiredApprovesCount: 1,
    space: 'p-1',
  } as never)
}

describe('listApprovals', () => {
  it('returns approvals as JSON', async () => {
    seedRequest()
    await listApprovals({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('prints "(no approval requests)" when empty', async () => {
    await listApprovals({})
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    )
    expect(logs.some((l) => /no approval requests/.test(l))).toBe(true)
  })
})

describe('getApproval', () => {
  it('throws NotFound when missing', async () => {
    await expect(getApproval('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('returns request JSON', async () => {
    seedRequest()
    await getApproval('req-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('req-1')
  })
})

describe('createApproval', () => {
  it('throws Validation when --attached-to missing', async () => {
    await expect(createApproval({ attachedTo: '', requested: ['p'] })).rejects.toBeInstanceOf(CliError)
  })
  it('throws Validation when --requested missing', async () => {
    await expect(createApproval({ attachedTo: 'issue-1', requested: [] })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('creates approval with parsed txJson', async () => {
    seedIssue()
    await createApproval({
      attachedTo: 'issue-1',
      requested: ['me@example.com'],
      requiredCount: 2,
      txJson: '{"op":"close"}',
    })
    const c = mockClient.current!
    expect(c.state.collectionAdds.length).toBe(1)
    const attrs = c.state.collectionAdds[0]!.attrs
    expect(attrs.requiredApprovesCount).toBe(2)
    expect(attrs.tx).toEqual({ op: 'close' })
  })
  it('throws Validation on invalid txJson', async () => {
    seedIssue()
    await expect(
      createApproval({ attachedTo: 'issue-1', requested: ['me@example.com'], txJson: 'not-json' }),
    ).rejects.toThrow()
  })
})

describe('commentOnApproval / approveRequest / rejectRequest / cancelRequest', () => {
  it('commentOnApproval throws Validation on missing message', async () => {
    await expect(commentOnApproval({ ref: 'r', body: '' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('commentOnApproval posts a comment via addCollection', async () => {
    seedRequest()
    await commentOnApproval({ ref: 'req-1', body: 'hi' })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
  })
  it('approveRequest appends to approved[]', async () => {
    seedRequest()
    await approveRequest({ ref: 'req-1' })
    expect(mockClient.current!.state.collectionUpdates.length).toBe(1)
  })
  it('rejectRequest sets rejected and status=Rejected', async () => {
    seedRequest()
    await rejectRequest({ ref: 'req-1', comment: 'no' })
    expect(mockClient.current!.state.collectionUpdates[0]!.ops.status).toBe('Rejected')
  })
  it('cancelRequest sets status=Cancelled', async () => {
    seedRequest()
    await cancelRequest({ ref: 'req-1' })
    expect(mockClient.current!.state.collectionUpdates[0]!.ops.status).toBe('Cancelled')
  })
})

describe('deleteApprovals', () => {
  it('requires --yes for multi-delete', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'r-1', space: 'p-1' } as never,
      { _id: 'r-2', space: 'p-1' } as never,
    )
    await expect(deleteApprovals(['r-1', 'r-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})
