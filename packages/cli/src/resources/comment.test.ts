import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import { listComments, addComment, updateComment, deleteComments } from './comment.js'
import { CliError, ExitCode } from '../output/errors.js'

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

describe('listComments', () => {
  it('throws Validation when --issue missing', async () => {
    await expect(listComments({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws NotFound when the issue ref does not resolve', async () => {
    await expect(listComments({ issue: 'PROJ-1' })).rejects.toBeInstanceOf(CliError)
  })
  it('filters comments by attachedTo + collection when issue exists', async () => {
    mockClient.current!.state.docs.push({ _id: 'issue-1', space: 'p-1' } as never)
    mockClient.current!.state.docs.push({
      _id: 'c-1',
      attachedTo: 'issue-1',
      attachedToClass: 'tracker:class:Issue',
      collection: 'comments',
      message: 'hi',
      space: 'p-1',
    } as never)
    await listComments({ issue: 'issue-1', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed.length).toBe(1)
    expect(parsed[0]._id).toBe('c-1')
  })
})

describe('addComment', () => {
  it('throws Validation when --issue missing', async () => {
    await expect(addComment({ body: 'hi' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation when body and bodyFile both supplied', async () => {
    await expect(addComment({ issue: 'PROJ-1', body: 'a', bodyFile: '/tmp/x' })).rejects.toMatchObject({
      code: ExitCode.Validation,
      message: /ambiguous body input/,
    })
  })
  it('throws Validation when no body supplied', async () => {
    mockClient.current!.state.docs.push({ _id: 'issue-1' } as never)
    await expect(addComment({ issue: 'issue-1' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('converts HTML body to prosemirror-JSON before adding the collection', async () => {
    mockClient.current!.state.docs.push({ _id: 'issue-1', space: 'p-1' } as never)
    await addComment({ issue: 'issue-1', body: '<p>hi</p>' })
    const c = mockClient.current!
    expect(c.state.collectionAdds.length).toBe(1)
    const message = (c.state.collectionAdds[0] as { attrs?: { message?: string } })?.attrs?.message
    expect(message).toContain('"type":"doc"')
  })
})

describe('updateComment', () => {
  it('throws Validation when no body', async () => {
    await expect(updateComment('c-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation when both body and bodyFile', async () => {
    await expect(updateComment('c-1', { body: 'x', bodyFile: '/tmp/x' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('updates message + editedOn', async () => {
    mockClient.current!.state.docs.push({
      _id: 'c-1',
      space: 'p-1',
      message: 'old',
      attachedTo: 'i-1',
    } as never)
    await updateComment('c-1', { body: '<p>new</p>' })
    const c = mockClient.current!
    expect(c.state.updateCalls.length).toBe(1)
    expect(c.state.updateCalls[0]!.ops).toHaveProperty('editedOn')
    expect(c.state.updateCalls[0]!.ops.message).toContain('"type":"doc"')
  })
})

describe('deleteComments', () => {
  it('refuses multi-delete without --yes', async () => {
    mockClient.current!.state.docs.push(
      {
        _id: 'c-1',
        space: 'p-1',
        attachedTo: 'i-1',
        attachedToClass: 'tracker:class:Issue',
        collection: 'comments',
      } as never,
      {
        _id: 'c-2',
        space: 'p-1',
        attachedTo: 'i-1',
        attachedToClass: 'tracker:class:Issue',
        collection: 'comments',
      } as never,
    )
    await expect(deleteComments(['c-1', 'c-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('skips missing comments and removes present ones', async () => {
    mockClient.current!.state.docs.push({
      _id: 'c-1',
      space: 'p-1',
      attachedTo: 'i-1',
      attachedToClass: 'tracker:class:Issue',
      collection: 'comments',
    } as never)
    await deleteComments(['c-1'], { yes: true })
    expect(mockClient.current!.state.collectionRemoves.length).toBe(1)
  })
})
