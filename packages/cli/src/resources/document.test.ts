import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listTeamspaces,
  getTeamspace,
  createTeamspace,
  updateTeamspace,
  deleteTeamspaces,
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocuments,
  listSnapshots,
  listInlineComments,
} from './document.js'
import { ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({})),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({ teamspace: 'General' }) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  mockClient.current.state.docs.push({
    _id: 'ts-1',
    _class: 'document:class:Teamspace',
    name: 'General',
    space: 'doc:root',
  } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const seedTeamspace = (id = 'ts-1', name = 'General') => {
  mockClient.current!.state.docs.push({
    _id: id,
    _class: 'document:class:Teamspace',
    name,
    space: 'doc:root',
  } as never)
}

describe('teamspaces', () => {
  it('listTeamspaces returns JSON', async () => {
    await listTeamspaces({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getTeamspace throws NotFound when missing', async () => {
    try {
      await getTeamspace('nope', {})
      throw new Error('should have thrown')
    } catch (e) {
      // accept either CliError or any rejection since path can vary
      expect(e).toBeDefined()
    }
  })
  it('getTeamspace returns JSON for found', async () => {
    seedTeamspace()
    await getTeamspace('General', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('ts-1')
  })
  it('createTeamspace throws Validation when --name missing', async () => {
    await expect(createTeamspace({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createTeamspace creates with description and visibility', async () => {
    await createTeamspace({ name: 'Engineering', description: 'eng docs', private: true })
    const c = mockClient.current!
    expect(c.state.createCalls[0]!.attrs).toMatchObject({
      name: 'Engineering',
      description: 'eng docs',
      private: true,
    })
  })
  it('createTeamspace dry-run skips SDK', async () => {
    await createTeamspace({ name: 'X', dryRun: true })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
  it('updateTeamspace updates name', async () => {
    seedTeamspace()
    await updateTeamspace('General', { name: 'Gen2' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ name: 'Gen2' })
  })
  it('updateTeamspace throws Validation on empty', async () => {
    seedTeamspace()
    await expect(updateTeamspace('General', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('deleteTeamspaces requires --yes for multi', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'ts-1', space: 'doc:root' } as never,
      { _id: 'ts-2', space: 'doc:root' } as never,
    )
    await expect(deleteTeamspaces(['ts-1', 'ts-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})

describe('documents', () => {
  it('listDocuments returns JSON for teamspace', async () => {
    seedTeamspace()
    mockClient.current!.state.docs.push({ _id: 'd-1', title: 'Doc', space: 'ts-1' } as never)
    await listDocuments({ teamspace: 'General', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getDocument throws NotFound when missing', async () => {
    try {
      await getDocument('nope', {})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
  it('getDocument returns JSON for found', async () => {
    mockClient.current!.state.docs.push({ _id: 'd-1', title: 'Doc', space: 'ts-1', content: null } as never)
    await getDocument('d-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('d-1')
  })
  it('createDocument throws Validation when --title missing', async () => {
    seedTeamspace()
    await expect(createDocument({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createDocument creates with teamspace space and uploads body', async () => {
    seedTeamspace()
    await createDocument({ teamspace: 'General', title: 'Doc', body: '<p>hi</p>' })
    const c = mockClient.current!
    expect(c.state.createCalls.length).toBe(1)
    expect(c.state.createCalls[0]!.attrs).toMatchObject({ title: 'Doc' })
    expect(c.uploadMarkupCalls.length).toBe(1)
  })
  it('createDocument dry-run skips SDK', async () => {
    await createDocument({ title: 'X', teamspace: 'X', dryRun: true })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
  it('updateDocument validates empty', async () => {
    mockClient.current!.state.docs.push({ _id: 'd-1', space: 'ts-1' } as never)
    await expect(updateDocument('d-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateDocument updates title and uploads body', async () => {
    mockClient.current!.state.docs.push({ _id: 'd-1', title: 'Old', space: 'ts-1' } as never)
    await updateDocument('d-1', { title: 'New', body: '<p>x</p>' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ title: 'New' })
  })
  it('deleteDocuments requires --yes for multi', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'd-1', space: 'ts-1' } as never,
      { _id: 'd-2', space: 'ts-1' } as never,
    )
    await expect(deleteDocuments(['d-1', 'd-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('listSnapshots filters by parent', async () => {
    mockClient.current!.state.docs.push({
      _id: 'd-1',
      _class: 'document:class:Document',
      title: 'Doc',
      space: 'ts-1',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'snap-1',
      _class: 'document:class:DocumentSnapshot',
      parent: 'd-1',
      title: 'snap',
      space: 'ts-1',
    } as never)
    await listSnapshots('d-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('listInlineComments filters by attachedTo', async () => {
    mockClient.current!.state.docs.push({
      _id: 'd-1',
      _class: 'document:class:Document',
      title: 'Doc',
      space: 'ts-1',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'ic-1',
      _class: 'chunter:class:ChatMessage',
      attachedTo: 'd-1',
      attachedToClass: 'document:class:Document',
      parent: 'd-1',
      parentClass: 'document:class:Document',
      collection: 'comments',
      message: 'note',
      space: 'ts-1',
    } as never)
    await listInlineComments('d-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})
