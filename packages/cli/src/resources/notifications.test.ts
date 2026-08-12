import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listProviders,
  listTypes,
  listInbox,
  getInbox,
  markRead,
  markUnread,
  markAllRead,
  archive,
  unarchive,
  archiveAll,
  deleteInbox,
  unreadCount,
  listContexts,
  getContext,
  pinContext,
  hideContext,
  subscribe,
  unsubscribe,
  listSettings,
  updateSetting,
} from './notifications.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({
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
  mockClient.current = fakePlatformClient({
    account: { uuid: 'me-uuid', primarySocialId: 'social-1', person: 'p-me' },
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('listProviders / listTypes', () => {
  it('listProviders returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'p-1', label: 'Email', canDisable: true } as never)
    await listProviders({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('listTypes returns JSON', async () => {
    mockClient.current!.state.docs.push({
      _id: 't-1',
      label: 'Mention',
      group: 'g',
      objectClass: 'tracker:class:Issue',
      defaultEnabled: true,
    } as never)
    await listTypes({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})

describe('Inbox', () => {
  const seedInboxItem = () => {
    mockClient.current!.state.docs.push({
      _id: 'inb-1',
      user: 'me-uuid',
      isRead: false,
      archived: false,
      title: 'T',
      space: 'inbox',
    } as never)
  }
  it('listInbox returns JSON', async () => {
    seedInboxItem()
    await listInbox({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getInbox throws NotFound', async () => {
    await expect(getInbox('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('getInbox returns JSON', async () => {
    seedInboxItem()
    await getInbox('inb-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('inb-1')
  })
  it('markRead sets isRead=true', async () => {
    seedInboxItem()
    await markRead(['inb-1'], {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ isViewed: true })
  })
  it('markUnread sets isRead=false', async () => {
    mockClient.current!.state.docs.push({
      _id: 'inb-1',
      user: 'me-uuid',
      isRead: true,
      space: 'inbox',
    } as never)
    await markUnread(['inb-1'], {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ isViewed: false })
  })
  it('markAllRead updates all unread items', async () => {
    mockClient.current!.state.docs.push({
      _id: 'inb-1',
      _class: 'notification:class:InboxNotification',
      user: 'me-uuid',
      isViewed: false,
      archived: false,
      title: 'T',
      space: 'inbox',
    } as never)
    await markAllRead({})
    expect(mockClient.current!.state.updateCalls.length).toBeGreaterThanOrEqual(1)
  })
  it('archive sets archived=true', async () => {
    seedInboxItem()
    await archive(['inb-1'], {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ archived: true })
  })
  it('unarchive sets archived=false', async () => {
    mockClient.current!.state.docs.push({
      _id: 'inb-1',
      user: 'me-uuid',
      archived: true,
      space: 'inbox',
    } as never)
    await unarchive(['inb-1'], {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ archived: false })
  })
  it('archiveAll updates all archived=false items', async () => {
    mockClient.current!.state.docs.push({
      _id: 'inb-1',
      _class: 'notification:class:InboxNotification',
      user: 'me-uuid',
      archived: false,
      space: 'inbox',
    } as never)
    await archiveAll({ yes: true })
    expect(mockClient.current!.state.updateCalls.length).toBeGreaterThanOrEqual(1)
  })
  it('deleteInbox removes item', async () => {
    seedInboxItem()
    await deleteInbox(['inb-1'], {})
    expect(mockClient.current!.state.removeCalls.length).toBe(1)
  })
  it('unreadCount prints the count', async () => {
    mockClient.current!.state.docs.push({
      _id: 'inb-1',
      _class: 'notification:class:InboxNotification',
      user: 'me-uuid',
      isViewed: false,
      space: 'inbox',
    } as never)
    await unreadCount({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(out))
    expect(parsed.count).toBe(1)
  })
})

describe('Contexts', () => {
  const seedContext = () => {
    mockClient.current!.state.docs.push({
      _id: 'ctx-1',
      _class: 'notification:class:DocNotifyContext',
      user: 'me-uuid',
      type: 'tracker:class:Issue',
      attachedTo: 'i-1',
      hidden: false,
      pinned: false,
      isPinned: false,
      space: 'ctx',
    } as never)
  }
  it('listContexts returns JSON', async () => {
    seedContext()
    await listContexts({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getContext throws NotFound', async () => {
    await expect(getContext('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('pinContext sets pinned=true', async () => {
    seedContext()
    await pinContext('ctx-1', {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ isPinned: true })
  })
  it('hideContext sets hidden=true', async () => {
    seedContext()
    await hideContext('ctx-1', {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ hidden: true })
  })
})

describe('Subscriptions / Settings', () => {
  it('subscribe throws Validation on missing --target', async () => {
    await expect(subscribe({ target: '' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('subscribe creates a subscription doc', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', _class: 'core:class:Doc', space: 'p-1' } as never)
    await subscribe({ target: 't-1' })
    const c = mockClient.current!
    expect(c.state.collectionAdds.length).toBe(1)
  })
  it('unsubscribe removes the matching subscription', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', _class: 'core:class:Doc', space: 'p-1' } as never)
    mockClient.current!.state.docs.push({
      _id: 'sub-1',
      _class: 'notification:class:DocNotifyContext',
      user: 'me-uuid',
      objectId: 't-1',
      objectClass: 'core:class:Doc',
      collection: 'contexts',
      space: 'ctx',
    } as never)
    await unsubscribe({ target: 't-1' })
    expect(mockClient.current!.state.collectionRemoves.length).toBe(1)
  })
  it('listSettings returns JSON', async () => {
    mockClient.current!.state.docs.push({
      _id: 's-1',
      _class: 'notification:class:NotificationTypeSetting',
      type: 't-1',
      enabled: true,
      modifiedBy: 'me-uuid',
      space: 'ctx',
    } as never)
    await listSettings({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('updateSetting throws Validation on missing --type', async () => {
    await expect(updateSetting({ provider: 'p', type: '', enabled: false })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('updateSetting creates a setting when none exists', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-1',
      _class: 'notification:class:NotificationProvider',
      label: 'P',
      space: 'core:space:Workspace',
    } as never)
    await updateSetting({ provider: 'p-1', type: 't-1', enabled: false })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
  })
})
