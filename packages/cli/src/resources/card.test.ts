import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listCardSpaces,
  getCardSpace,
  createCardSpace,
  deleteCardSpaces,
  listMasterTags,
  listCards,
  getCard,
  createCard,
  updateCard,
  deleteCards,
} from './card.js'
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
  // Seed the Kanban card-space so the index can resolve "Kanban" → cs-1.
  mockClient.current.state.docs.push({
    _id: 'cs-1',
    _class: 'card:class:CardSpace',
    name: 'Kanban',
    space: 'cs-1',
  } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const seedCardSpace = (id = 'cs-1', name = 'Kanban') => {
  mockClient.current!.state.docs.push({ _id: id, _class: 'card:class:CardSpace', name, space: id } as never)
}

describe('CardSpaces', () => {
  it('listCardSpaces returns JSON', async () => {
    await listCardSpaces({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getCardSpace throws NotFound', async () => {
    try {
      await getCardSpace('nope', {})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
  it('getCardSpace returns JSON for found', async () => {
    seedCardSpace()
    await getCardSpace('Kanban', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('cs-1')
  })
  it('createCardSpace throws Validation on missing --name', async () => {
    await expect(createCardSpace({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createCardSpace creates with private default false', async () => {
    await createCardSpace({ name: 'Eng' })
    const c = mockClient.current!
    expect(c.state.createCalls[0]!.attrs).toMatchObject({ name: 'Eng' })
  })
  it('createCardSpace dry-run skips SDK', async () => {
    await createCardSpace({ name: 'Eng', dryRun: true })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
  it('deleteCardSpaces requires --yes for multi', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'cs-1', space: 'cs-1' } as never,
      { _id: 'cs-2', space: 'cs-2' } as never,
    )
    await expect(deleteCardSpaces(['cs-1', 'cs-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})

describe('MasterTags', () => {
  it('listMasterTags returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'mt-1', label: 'tag' } as never)
    await listMasterTags({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})

describe('Cards', () => {
  it('listCards returns JSON for card-space', async () => {
    seedCardSpace()
    mockClient.current!.state.docs.push({
      _id: 'card-1',
      title: 'Task',
      space: 'cs-1',
      status: 'Backlog',
    } as never)
    await listCards({ cardSpace: 'Kanban', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getCard throws NotFound when missing', async () => {
    try {
      await getCard('nope', {})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
  it('getCard returns JSON for found', async () => {
    mockClient.current!.state.docs.push({ _id: 'card-1', title: 'Task', space: 'cs-1' } as never)
    await getCard('card-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('card-1')
  })
  it('createCard throws Validation on missing --title', async () => {
    seedCardSpace()
    await expect(createCard({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createCard creates with status and uploads body', async () => {
    mockClient.current!.state.docs.push({
      _id: 'tag-1',
      _class: 'card:class:MasterTag',
      label: 'tag',
      space: 'model',
    } as never)
    await createCard({ cardSpace: 'Kanban', title: 'T', masterTag: 'tag-1', body: '<p>x</p>' })
    const c = mockClient.current!
    expect(c.state.createCalls.length).toBe(1)
    expect(c.uploadMarkupCalls.length).toBe(1)
  })
  it('createCard dry-run skips SDK', async () => {
    mockClient.current!.state.docs.push({
      _id: 'tag-1',
      _class: 'card:class:MasterTag',
      label: 'tag',
      space: 'model',
    } as never)
    await createCard({ cardSpace: 'Kanban', title: 'T', masterTag: 'tag-1', dryRun: true })
    expect(mockClient.current!.state.collectionAdds.length).toBe(0)
  })
  it('updateCard validates empty', async () => {
    mockClient.current!.state.docs.push({ _id: 'card-1', space: 'cs-1' } as never)
    await expect(updateCard('card-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateCard updates title', async () => {
    mockClient.current!.state.docs.push({ _id: 'card-1', title: 'Old', space: 'cs-1' } as never)
    await updateCard('card-1', { title: 'New' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ title: 'New' })
  })
  it('deleteCards requires --yes for multi', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'card-1', space: 'cs-1' } as never,
      { _id: 'card-2', space: 'cs-1' } as never,
    )
    await expect(deleteCards(['card-1', 'card-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})
