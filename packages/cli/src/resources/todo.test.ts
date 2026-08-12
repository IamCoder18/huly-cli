import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listActions,
  getAction,
  createAction,
  updateAction,
  completeAction,
  reopenAction,
  deleteActions,
  scheduleAction,
  unscheduleAction,
} from './todo.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({
    getSocialIds: vi.fn(async () => [{ isPrimary: true, value: 'me@example.com' }]),
    getPerson: vi.fn(async () => ({ uuid: 'me-uuid', primarySocialId: 'social-1' })),
    findSocialIdBySocialKey: vi.fn(async () => undefined),
    findPersonBySocialId: vi.fn(async () => undefined),
  })),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({ project: 'PROJ' }) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient({
    account: { uuid: 'me-uuid', primarySocialId: 'social-1', email: 'me@example.com' },
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const seedPerson = () => {
  mockClient.current!.state.docs.push({
    _id: 'p-me',
    _class: 'contact:class:Person',
    personUuid: 'me-uuid',
    name: 'Me',
    email: 'me@example.com',
    space: 'contacts',
  } as never)
}

describe('listActions', () => {
  it('returns todos as JSON', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      _class: 'time:class:ToDo',
      title: 'Task',
      user: 'me-uuid',
      space: 'time:space:ToDos',
      doneOn: null,
    } as never)
    await listActions({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('throws Validation on invalid --priority', async () => {
    seedPerson()
    await expect(listActions({ priority: 'Bogus' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation on invalid --visibility', async () => {
    seedPerson()
    await expect(listActions({ visibility: 'Bogus' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation on invalid --due-from', async () => {
    seedPerson()
    await expect(listActions({ dueFrom: 'bad' })).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('filters by --completed true', async () => {
    seedPerson()
    await listActions({ completed: true, json: true })
    expect(mockClient.current!.findAll).toHaveBeenCalled()
  })
})

describe('getAction', () => {
  it('throws NotFound when missing', async () => {
    await expect(getAction('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('returns action JSON', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      title: 'T',
      user: 'me-uuid',
      space: 'time:space:ToDos',
    } as never)
    await getAction('t-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('t-1')
  })
})

describe('createAction', () => {
  it('throws Validation when --title missing', async () => {
    seedPerson()
    await expect(createAction({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation when both --body and --body-file', async () => {
    await expect(createAction({ title: 'T', body: 'a', bodyFile: '/tmp/x' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('throws Validation on invalid --priority', async () => {
    seedPerson()
    await expect(createAction({ title: 'T', priority: 'Bogus' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('throws Validation on invalid --visibility', async () => {
    seedPerson()
    await expect(createAction({ title: 'T', visibility: 'Bogus' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('creates action with defaults and a WorkSlot', async () => {
    seedPerson()
    await createAction({ title: 'T', description: 'd' })
    const c = mockClient.current!
    expect(c.state.collectionAdds.length).toBe(1)
    expect(c.state.collectionAdds[0]!.attrs).toMatchObject({
      title: 'T',
      description: 'd',
      priority: 'NoPriority',
      visibility: 'public',
    })
  })
  it('dry-run skips SDK', async () => {
    seedPerson()
    await createAction({ title: 'T', dryRun: true })
    expect(mockClient.current!.state.collectionAdds.length).toBe(0)
  })
})

describe('updateAction', () => {
  it('rejects --attached-to early (no SDK call)', async () => {
    await expect(updateAction('t-1', { attachedTo: 'p-1' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('throws NotFound when ref missing', async () => {
    await expect(updateAction('nope', { title: 'X' })).rejects.toBeInstanceOf(CliError)
  })
  it('throws Validation when no fields provided', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      title: 'T',
      space: 'time:space:ToDos',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
      user: 'me-uuid',
    } as never)
    await expect(updateAction('t-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updates title', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      title: 'Old',
      space: 'time:space:ToDos',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
      user: 'me-uuid',
    } as never)
    await updateAction('t-1', { title: 'New' })
    expect(mockClient.current!.state.collectionUpdates[0]!.ops).toMatchObject({ title: 'New' })
  })
})

describe('completeAction / reopenAction', () => {
  it('completeAction sets doneOn', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      space: 'time:space:ToDos',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
      doneOn: null,
    } as never)
    await completeAction('t-1', {})
    expect(mockClient.current!.state.collectionUpdates[0]!.ops).toHaveProperty('doneOn')
  })
  it('reopenAction clears doneOn', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      space: 'time:space:ToDos',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
      doneOn: 100,
    } as never)
    await reopenAction('t-1', {})
    expect(mockClient.current!.state.collectionUpdates[0]!.ops.doneOn).toBeNull()
  })
})

describe('deleteActions', () => {
  it('requires --yes for multi-delete', async () => {
    mockClient.current!.state.docs.push(
      { _id: 't-1', space: 'ts', attachedTo: 'p', collection: 'todos' } as never,
      { _id: 't-2', space: 'ts', attachedTo: 'p', collection: 'todos' } as never,
    )
    await expect(deleteActions(['t-1', 't-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})

describe('scheduleAction / unscheduleAction', () => {
  it('scheduleAction throws Validation when --start missing', async () => {
    await expect(scheduleAction('t-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('scheduleAction throws Validation when --duration missing', async () => {
    await expect(scheduleAction('t-1', { start: '2030-01-15T10:00:00Z' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('scheduleAction creates a WorkSlot', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      space: 'time:space:ToDos',
      title: 'T',
      user: 'me-uuid',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
      visibility: 'public',
    } as never)
    await scheduleAction('t-1', { start: '2030-01-15T10:00:00Z', duration: 30 })
    const c = mockClient.current!
    const ws = c.state.collectionAdds.find((a) => a._class === 'time:class:WorkSlot')
    expect(ws).toBeDefined()
  })
  it('scheduleAction dry-run skips SDK', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      space: 'time:space:ToDos',
      title: 'T',
      user: 'me-uuid',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
    } as never)
    await scheduleAction('t-1', { start: '2030-01-15T10:00:00Z', duration: 30, dryRun: true })
    expect(mockClient.current!.state.collectionAdds.length).toBe(0)
  })
  it('unscheduleAction requires --yes for multi', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      space: 'ts',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'ws-1',
      space: 'cal-space',
      attachedTo: 't-1',
      attachedToClass: 'time:class:ToDo',
      collection: 'workslots',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'ws-2',
      space: 'cal-space',
      attachedTo: 't-1',
      attachedToClass: 'time:class:ToDo',
      collection: 'workslots',
    } as never)
    await expect(unscheduleAction('t-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('unscheduleAction removes a single slot', async () => {
    seedPerson()
    mockClient.current!.state.docs.push({
      _id: 't-1',
      space: 'ts',
      attachedTo: 'me-uuid',
      attachedToClass: 'contact:class:Person',
      collection: 'todos',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'ws-1',
      space: 'cal-space',
      attachedTo: 't-1',
      attachedToClass: 'time:class:ToDo',
      collection: 'workslots',
    } as never)
    await unscheduleAction('t-1', {})
    expect(mockClient.current!.state.collectionRemoves.length).toBe(1)
  })
})
