import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listActivity,
  getActivity,
  pinActivity,
  addReaction,
  removeReaction,
  listReactions,
  listReplies,
  addReply,
  updateReply,
  deleteReplies,
  listSaved,
  saveMessage,
  unsaveMessage,
  listMentions,
} from './activity.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({
    getPerson: vi.fn(async () => ({ uuid: 'me-uuid' })),
  })),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({}) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  vi.stubEnv('CI', '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const seedActivity = () => {
  mockClient.current!.state.docs.push({
    _id: 'act-1',
    _class: 'activity:class:ActivityMessage',
    message: 'hi',
    attachedTo: 't-1',
    isPinned: false,
    reactions: {},
    space: 'p-1',
  } as never)
}

describe('listActivity / getActivity / pinActivity', () => {
  it('listActivity returns JSON', async () => {
    seedActivity()
    await listActivity({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('listActivity prints "(no activity)" when empty', async () => {
    await listActivity({})
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    )
    expect(logs.some((l) => /no activity/.test(l))).toBe(true)
  })
  it('getActivity throws NotFound', async () => {
    await expect(getActivity('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('getActivity returns JSON', async () => {
    seedActivity()
    await getActivity('act-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('act-1')
  })
  it('pinActivity sets isPinned=true', async () => {
    seedActivity()
    await pinActivity('act-1', {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ isPinned: true })
  })
  it('pinActivity with --unpin clears the pin', async () => {
    mockClient.current!.state.docs.push({
      _id: 'act-1',
      _class: 'activity:class:ActivityMessage',
      message: 'hi',
      attachedTo: 't-1',
      isPinned: true,
      space: 'p-1',
    } as never)
    await pinActivity('act-1', { unpin: true })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ isPinned: false })
  })
})

describe('Reactions', () => {
  it('addReaction throws Validation on missing flags', async () => {
    await expect(addReaction({ target: '', emoji: '' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('addReaction appends to reactions[emoji] array', async () => {
    seedActivity()
    await addReaction({ target: 'act-1', emoji: '👍' })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
    expect(mockClient.current!.state.collectionAdds[0]!.attrs.emoji).toBe('👍')
  })
  it('removeReaction pulls self from reactions[emoji]', async () => {
    mockClient.current!.state.docs.push({
      _id: 'act-1',
      _class: 'activity:class:ActivityMessage',
      message: 'hi',
      attachedTo: 't-1',
      reactions: { '👍': ['me-uuid', 'p-2'] },
      space: 'p-1',
    } as never)
    // seed a reaction row to be removed
    mockClient.current!.state.docs.push({
      _id: 'r-1',
      _class: 'activity:class:Reaction',
      attachedTo: 'act-1',
      attachedToClass: 'activity:class:ActivityMessage',
      collection: 'reactions',
      emoji: '👍',
      createBy: 'social-1',
      space: 'p-1',
    } as never)
    await removeReaction({ target: 'act-1', emoji: '👍' })
    expect(mockClient.current!.state.collectionRemoves.length).toBe(1)
  })
  it('listReactions returns reactions as JSON', async () => {
    seedActivity()
    await listReactions('act-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(out).toBeDefined()
  })
})

describe('Replies', () => {
  it('listReplies returns JSON', async () => {
    seedActivity()
    mockClient.current!.state.docs.push({
      _id: 'rep-1',
      attachedTo: 'act-1',
      attachedToClass: 'activity:class:ActivityMessage',
      collection: 'replies',
      message: 'reply',
      space: 'p-1',
    } as never)
    await listReplies('act-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('addReply throws Validation on missing body', async () => {
    await expect(addReply({ target: 'act-1', body: '' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('addReply attaches to the activity', async () => {
    seedActivity()
    await addReply({ target: 'act-1', body: 'r' })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
  })
  it('updateReply validates empty', async () => {
    mockClient.current!.state.docs.push({
      _id: 'rep-1',
      _class: 'activity:class:ActivityMessage',
      space: 'p-1',
      message: 'old',
    } as never)
    await expect(updateReply('rep-1', { body: '' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateReply updates message', async () => {
    mockClient.current!.state.docs.push({
      _id: 'rep-1',
      _class: 'activity:class:ActivityMessage',
      space: 'p-1',
      message: 'old',
    } as never)
    await updateReply('rep-1', { body: 'new' })
    expect(mockClient.current!.state.updateCalls[0]!.ops.message).toContain('"type":"doc"')
  })
  it('deleteReplies requires --yes for multi', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'rep-1', space: 'p-1' } as never,
      { _id: 'rep-2', space: 'p-1' } as never,
    )
    await expect(deleteReplies(['rep-1', 'rep-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})

describe('Saved / Mentions', () => {
  it('listSaved returns JSON', async () => {
    seedActivity()
    await listSaved({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(out).toBeDefined()
  })
  it('saveMessage throws Validation on missing target', async () => {
    await expect(saveMessage({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('saveMessage creates a SavedMessage', async () => {
    seedActivity()
    await saveMessage({ target: 'act-1' })
    expect(mockClient.current!.state.createCalls.length).toBe(1)
  })
  it('unsaveMessage removes the SavedMessage', async () => {
    seedActivity()
    mockClient.current!.state.docs.push({
      _id: 'sv-1',
      _class: 'activity:class:SavedMessage',
      attachedTo: 'act-1',
      modifiedBy: 'acc-1',
      space: 'core:space:Workspace',
    } as never)
    await unsaveMessage({ target: 'act-1' })
    expect(mockClient.current!.state.removeCalls.length).toBeGreaterThanOrEqual(1)
  })
  it('listMentions returns JSON', async () => {
    seedActivity()
    await listMentions({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(out).toBeDefined()
  })
})
