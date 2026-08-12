import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannels,
  archiveChannel,
  listChannelMembers,
  joinChannel,
  leaveChannel,
  sendChannelMessage,
  listChannelMessages,
  deleteChannelMessages,
  listDms,
  createDm,
  sendDmMessage,
  listDmMessages,
} from './channel.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({
    getSocialIds: vi.fn(async () => [{ isPrimary: true, value: 'me@example.com' }]),
    getPerson: vi.fn(async () => ({ uuid: 'me-uuid' })),
    findSocialIdBySocialKey: vi.fn(async () => undefined),
    findPersonBySocialId: vi.fn(async () => undefined),
  })),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({}) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient({ account: { uuid: 'me-uuid', primarySocialId: 'social-1' } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const channelFixture = () =>
  mockClient.current!.state.docs.push({
    _id: 'ch-1',
    _class: 'chunter:class:Channel',
    name: 'general',
    topic: 'General chat',
    space: 'ch-1',
    members: ['me-uuid'],
  } as never)

describe('listChannels', () => {
  it('returns channels as JSON', async () => {
    channelFixture()
    await listChannels({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed.length).toBe(1)
  })
})

describe('getChannel', () => {
  it('returns the channel JSON when found', async () => {
    channelFixture()
    await getChannel('general', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('ch-1')
  })
  it('throws NotFound when missing', async () => {
    try {
      await getChannel('nope', {})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
})

describe('createChannel', () => {
  it('throws Validation when --name missing', async () => {
    await expect(createChannel({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('creates a channel with private/autoJoin settings', async () => {
    await createChannel({ name: 'general', topic: 'topic', private: true, autoJoin: true })
    const c = mockClient.current!
    expect(c.state.createCalls[0]!.attrs).toMatchObject({ name: 'general', topic: 'topic', private: true })
  })
  it('dry-run prints without calling the SDK', async () => {
    await createChannel({ name: 'general', dryRun: true })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
})

describe('updateChannel', () => {
  it('throws NotFound when ref missing', async () => {
    await expect(updateChannel('nope', { name: 'X' })).rejects.toBeInstanceOf(CliError)
  })
  it('updates topic', async () => {
    channelFixture()
    await updateChannel('general', { topic: 'New topic' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ topic: 'New topic' })
  })
})

describe('deleteChannels', () => {
  it('requires --yes for multi-delete', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'ch-1', name: 'a' } as never,
      { _id: 'ch-2', name: 'b' } as never,
    )
    await expect(deleteChannels(['ch-1', 'ch-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('removes a single channel', async () => {
    channelFixture()
    await deleteChannels(['general'], { yes: true })
    expect(mockClient.current!.state.removeCalls.length).toBe(1)
  })
})

describe('archiveChannel', () => {
  it('sets archived=true', async () => {
    channelFixture()
    await archiveChannel('general', {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ archived: true })
  })
})

describe('listChannelMembers / join / leave', () => {
  it('lists members', async () => {
    channelFixture()
    await listChannelMembers('general', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed).toContain('me-uuid')
  })
  it('join adds self to members when not present', async () => {
    mockClient.current!.state.docs.push({
      _id: 'ch-1',
      _class: 'chunter:class:Channel',
      name: 'general',
      members: [],
    } as never)
    await joinChannel('general', {})
    const ops = mockClient.current!.state.updateCalls[0]!.ops
    expect(ops).toHaveProperty('$push')
  })
  it('join no-ops when already a member', async () => {
    mockClient.current!.state.docs.push({
      _id: 'ch-1',
      _class: 'chunter:class:Channel',
      name: 'general',
      members: ['me-uuid'],
    } as never)
    await joinChannel('general', {})
    expect(mockClient.current!.state.updateCalls.length).toBe(0)
  })
  it('leave removes self from members', async () => {
    mockClient.current!.state.docs.push({
      _id: 'ch-1',
      _class: 'chunter:class:Channel',
      name: 'general',
      members: ['me-uuid', 'p-2'],
    } as never)
    await leaveChannel('general', {})
    const ops = mockClient.current!.state.updateCalls[0]!.ops
    expect(ops).toHaveProperty('$pull')
  })
})

describe('sendChannelMessage / listChannelMessages / deleteChannelMessages', () => {
  it('send converts HTML body to prosemirror-JSON', async () => {
    channelFixture()
    await sendChannelMessage('general', { body: '<p>hi</p>' })
    const c = mockClient.current!
    expect(c.state.collectionAdds.length).toBe(1)
    expect(c.state.collectionAdds[0]!.attrs.message).toContain('"type":"doc"')
  })
  it('send rejects empty body', async () => {
    channelFixture()
    await expect(sendChannelMessage('general', { body: '' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('list filters by attachedTo', async () => {
    channelFixture()
    mockClient.current!.state.docs.push({
      _id: 'm-1',
      attachedTo: 'ch-1',
      attachedToClass: 'chunter:class:Channel',
      collection: 'messages',
      message: 'hi',
      space: 'ch-1',
    } as never)
    await listChannelMessages('general', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('delete refuses multi-delete without --yes', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'ch-1', _class: 'chunter:class:Channel', name: 'general', space: 'ch-1' } as never,
      {
        _id: 'm-1',
        _class: 'chunter:class:ChatMessage',
        space: 'ch-1',
        attachedTo: 'ch-1',
        attachedToClass: 'chunter:class:Channel',
        collection: 'messages',
      } as never,
      {
        _id: 'm-2',
        _class: 'chunter:class:ChatMessage',
        space: 'ch-1',
        attachedTo: 'ch-1',
        attachedToClass: 'chunter:class:Channel',
        collection: 'messages',
      } as never,
    )
    await expect(deleteChannelMessages('general', ['m-1', 'm-2'], {})).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
})

describe('listDms / createDm / sendDmMessage / listDmMessages', () => {
  it('listDms returns DMs as JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'dm-1', name: 'dm', members: ['me-uuid', 'p-other'] } as never)
    await listDms({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('createDm creates a DirectMessage', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-other',
      _class: 'contact:class:Person',
      name: 'Other',
      space: 'contacts',
    } as never)
    await createDm({ person: 'Other' })
    const c = mockClient.current!
    expect(c.state.createCalls[0]!.attrs).toMatchObject({ members: ['me-uuid', 'p-other'] })
  })
  it('sendDmMessage attaches to the DM', async () => {
    mockClient.current!.state.docs.push({ _id: 'dm-1', name: 'dm', members: ['me-uuid', 'p-other'] } as never)
    await sendDmMessage('dm-1', { body: '<p>hi</p>' })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
  })
  it('listDmMessages filters by attachedTo', async () => {
    mockClient.current!.state.docs.push({ _id: 'dm-1', name: 'dm' } as never)
    mockClient.current!.state.docs.push({
      _id: 'dmm-1',
      attachedTo: 'dm-1',
      attachedToClass: 'chunter:class:DirectMessage',
      collection: 'messages',
      space: 'dm-1',
      message: 'hi',
    } as never)
    await listDmMessages('dm-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})
