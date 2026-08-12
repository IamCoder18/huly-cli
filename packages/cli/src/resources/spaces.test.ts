import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listSpaces,
  getSpace,
  updateSpace,
  listSpaceTypes,
  getSpaceType,
  listSpacePermissions,
  addSpaceMembers,
  removeSpaceMembers,
  setSpaceOwners,
  listAssociations,
  createAssociation,
  deleteAssociations,
  listRelations,
  createRelation,
  deleteRelations,
  listProjectTypes,
  getProjectType,
  listTaskTypes,
  createTaskType,
  createIssueStatus,
} from './spaces.js'
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
  mockClient.current.state.docs.push({
    _id: 'sp-1',
    _class: 'core:class:Space',
    name: 'General',
    private: false,
    archived: false,
    members: [],
    space: 'core:space:Space',
  } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const seedSpace = () => {
  mockClient.current!.state.docs.push({
    _id: 'sp-1',
    _class: 'core:class:Space',
    name: 'General',
    private: false,
    archived: false,
    members: [],
    space: 'core:space:Space',
  } as never)
}

describe('listSpaces / getSpace / updateSpace', () => {
  it('listSpaces returns JSON', async () => {
    await listSpaces({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('listSpaces builds query for --type/--archived/--private', async () => {
    await listSpaces({ type: 'core:class:SpaceType', archived: false, private: false, json: true })
    expect(mockClient.current!.findAll).toHaveBeenCalled()
  })
  it('getSpace throws NotFound when missing', async () => {
    await expect(getSpace('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('getSpace returns JSON', async () => {
    seedSpace()
    await getSpace('General', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('sp-1')
  })
  it('updateSpace throws Validation on empty', async () => {
    seedSpace()
    await expect(updateSpace('General', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateSpace updates name', async () => {
    seedSpace()
    await updateSpace('General', { name: 'New' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ name: 'New' })
  })
  it('updateSpace dry-run skips SDK', async () => {
    seedSpace()
    await updateSpace('General', { name: 'New', dryRun: true })
    expect(mockClient.current!.state.updateCalls.length).toBe(0)
  })
})

describe('Space types', () => {
  it('listSpaceTypes returns JSON', async () => {
    mockClient.current!.state.docs.push({
      _id: 'st-1',
      name: 'Default',
      descriptor: 'core.space.Default',
    } as never)
    await listSpaceTypes({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getSpaceType throws NotFound when missing', async () => {
    await expect(getSpaceType('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('getSpaceType returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'st-1', name: 'Default' } as never)
    await getSpaceType('st-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('st-1')
  })
})

describe('Permissions / members / owners', () => {
  it('listSpacePermissions returns JSON', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-1',
      _class: 'core:class:Permission',
      objectId: 'sp-1',
      objectClass: 'core:class:Space',
      role: 'r-1',
      space: 'core:space:Space',
    } as never)
    await listSpacePermissions('General', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('addSpaceMembers pushes into members via $push', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-1',
      _class: 'contact:class:Person',
      name: 'p-1',
      space: 'contacts',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'p-2',
      _class: 'contact:class:Person',
      name: 'p-2',
      space: 'contacts',
    } as never)
    await addSpaceMembers('General', ['p-1', 'p-2'], {})
    const c = mockClient.current!
    expect(c.state.updateCalls.length).toBe(1)
    expect(c.state.updateCalls[0]!.ops).toHaveProperty('$push')
  })
  it('removeSpaceMembers removes matching permission docs', async () => {
    mockClient.current!.state.docs.push({
      _id: 'pm-1',
      _class: 'contact:class:Person',
      name: 'pm-1',
      space: 'contacts',
    } as never)
    await removeSpaceMembers('General', ['pm-1'], {})
    expect(mockClient.current!.state.updateCalls.length).toBe(1)
  })
  it('setSpaceOwners updates owners array', async () => {
    mockClient.current!.state.docs.push({
      _id: 'p-1',
      _class: 'contact:class:Person',
      name: 'p-1',
      space: 'contacts',
    } as never)
    await setSpaceOwners('General', ['p-1'], {})
    expect(mockClient.current!.state.updateCalls[0]!.ops).toHaveProperty('owners')
  })
})

describe('Associations / Relations', () => {
  it('listAssociations returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'a-1', name: 'A1' } as never)
    await listAssociations({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('createAssociation throws Validation when --a or --b missing', async () => {
    await expect(createAssociation({ a: '', b: '' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createAssociation creates with name', async () => {
    mockClient.current!.state.docs.push({
      _id: 'sp-2',
      _class: 'core:class:Space',
      name: 'Other',
      space: 'core:space:Space',
    } as never)
    await createAssociation({ a: 'sp-1', b: 'sp-2', aClass: 'core:class:Space', bClass: 'core:class:Space' })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
  })
  it('deleteAssociations requires --yes for multi', async () => {
    mockClient.current!.state.docs.push({ _id: 'a-1' } as never, { _id: 'a-2' } as never)
    await expect(deleteAssociations(['a-1', 'a-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('listRelations returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'r-1', name: 'R' } as never)
    await listRelations({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('createRelation throws Validation when --source or --target missing', async () => {
    await expect(createRelation({ source: '', target: '' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('deleteRelations requires --yes for multi', async () => {
    mockClient.current!.state.docs.push({ _id: 'r-1' } as never, { _id: 'r-2' } as never)
    await expect(deleteRelations(['r-1', 'r-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})

describe('Project types / Task types / Issue statuses', () => {
  it('listProjectTypes returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'pt-1', name: 'Classic' } as never)
    await listProjectTypes({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getProjectType throws NotFound', async () => {
    await expect(getProjectType('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('getProjectType returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'pt-1', name: 'Classic' } as never)
    await getProjectType('pt-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('pt-1')
  })
  it('listTaskTypes returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'tt-1', name: 'Task' } as never)
    await listTaskTypes({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('createTaskType throws Validation when --project-type or --label missing', async () => {
    await expect(createTaskType({ projectType: '', label: '' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('createTaskType creates with status model', async () => {
    mockClient.current!.state.docs.push({
      _id: 'pt-1',
      _class: 'task:class:ProjectType',
      name: 'PT',
      space: 'model',
    } as never)
    await createTaskType({ projectType: 'pt-1', label: 'T' })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
  })
  it('createIssueStatus throws Validation when --name missing', async () => {
    await expect(
      createIssueStatus({ name: '', category: 'UnStarted', projectType: 'pt-1' }),
    ).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createIssueStatus creates with category', async () => {
    mockClient.current!.state.docs.push({
      _id: 'pt-1',
      _class: 'task:class:ProjectType',
      name: 'PT',
      space: 'model',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'tt-1',
      _class: 'task:class:TaskType',
      name: 'TT',
      parent: 'pt-1',
      space: 'model',
    } as never)
    await createIssueStatus({ name: 'Backlog', category: 'UnStarted', rank: '0', projectType: 'pt-1' })
    expect(mockClient.current!.state.collectionAdds.length).toBe(1)
    const attrs = mockClient.current!.state.collectionAdds[0]!.attrs
    expect(attrs).toMatchObject({ name: 'Backlog', category: 'UnStarted' })
  })
})
