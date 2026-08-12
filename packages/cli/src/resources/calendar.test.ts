import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listCalendars,
  createCalendar,
  deleteCalendar,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedules,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvents,
  listRecurringEvents,
  listRecurringInstances,
} from './calendar.js'
import { CliError, ExitCode } from '../output/errors.js'

const mockClient = vi.hoisted(() => ({ current: null as FakePlatformClient | null }))

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(async () => mockClient.current),
  connectAccountCli: vi.fn(async () => ({})),
}))
vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({ project: 'PROJ' }) }
})

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const seedCalendar = () => {
  mockClient.current!.state.docs.push({
    _id: 'cal-1',
    name: 'Personal',
    hidden: false,
    visibility: 'public',
    access: 'owner',
    space: 'ws',
  } as never)
}

describe('listCalendars / createCalendar / deleteCalendar', () => {
  it('returns JSON', async () => {
    seedCalendar()
    await listCalendars({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('createCalendar throws Validation on missing --name', async () => {
    await expect(createCalendar({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createCalendar creates with defaults', async () => {
    await createCalendar({ name: 'Work' })
    const c = mockClient.current!
    expect(c.state.createCalls[0]!.attrs).toMatchObject({
      name: 'Work',
      visibility: 'public',
      access: 'owner',
      private: false,
      hidden: false,
    })
  })
  it('createCalendar dry-run skips SDK', async () => {
    await createCalendar({ name: 'Work', dryRun: true })
    expect(mockClient.current!.state.createCalls.length).toBe(0)
  })
  it('deleteCalendar throws NotFound when missing', async () => {
    await expect(deleteCalendar('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('deleteCalendar removes a calendar', async () => {
    seedCalendar()
    await deleteCalendar('cal-1', { yes: true })
    expect(mockClient.current!.state.removeCalls.length).toBe(1)
  })
})

describe('Schedules', () => {
  it('listSchedules returns JSON', async () => {
    mockClient.current!.state.docs.push({
      _id: 'sch-1',
      title: 'Avail',
      owner: 'me-uuid',
      meetingDuration: 30,
      meetingInterval: 15,
      availability: {},
      timeZone: 'UTC',
    } as never)
    await listSchedules({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('createSchedule throws Validation when --title missing', async () => {
    await expect(createSchedule({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createSchedule creates', async () => {
    await createSchedule({ title: 'Avail', owner: 'me-uuid', duration: 30, interval: 15, timeZone: 'UTC' })
    const c = mockClient.current!
    expect(c.state.createCalls.length).toBe(1)
  })
  it('updateSchedule throws Validation on empty', async () => {
    mockClient.current!.state.docs.push({ _id: 'sch-1', space: 'ws' } as never)
    await expect(updateSchedule('sch-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateSchedule updates title', async () => {
    mockClient.current!.state.docs.push({ _id: 'sch-1', title: 'Old', space: 'ws' } as never)
    await updateSchedule('sch-1', { title: 'New' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ title: 'New' })
  })
  it('deleteSchedules requires --yes for multi', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'sch-1', space: 'ws' } as never,
      { _id: 'sch-2', space: 'ws' } as never,
    )
    await expect(deleteSchedules(['sch-1', 'sch-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
})

describe('Events', () => {
  const eventFixture = () => {
    mockClient.current!.state.docs.push({
      _id: 'ev-1',
      title: 'Standup',
      startDate: Date.now(),
      dueDate: Date.now() + 3600000,
      allDay: false,
      calendar: 'cal-1',
      space: 'ws',
    } as never)
  }
  it('listEvents returns JSON', async () => {
    eventFixture()
    await listEvents({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('getEvent throws NotFound when missing', async () => {
    await expect(getEvent('nope')).rejects.toBeInstanceOf(CliError)
  })
  it('getEvent returns JSON for found', async () => {
    eventFixture()
    await getEvent('ev-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('ev-1')
  })
  it('createEvent throws Validation on missing --title', async () => {
    await expect(createEvent({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('createEvent throws Validation on invalid --start', async () => {
    await expect(createEvent({ title: 'X', start: 'bad' })).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
  it('createEvent creates with parsed dates', async () => {
    mockClient.current!.state.docs.push({
      _id: 'cal-1',
      _class: 'calendar:class:Calendar',
      name: 'Personal',
      hidden: false,
      visibility: 'public',
      access: 'owner',
      space: 'ws',
    } as never)
    await createEvent({
      title: 'Standup',
      start: '2030-01-15T10:00:00Z',
      end: '2030-01-15T10:30:00Z',
      calendarId: 'Personal',
    })
    const c = mockClient.current!
    expect(c.state.collectionAdds.length).toBe(1)
    expect(c.state.collectionAdds[0]!.attrs.title).toBe('Standup')
    expect(typeof c.state.collectionAdds[0]!.attrs.startDate).toBe('number')
  })
  it('updateEvent validates empty', async () => {
    eventFixture()
    await expect(updateEvent('ev-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updateEvent updates title', async () => {
    eventFixture()
    await updateEvent('ev-1', { title: 'New' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toMatchObject({ title: 'New' })
  })
  it('deleteEvents requires --yes for multi', async () => {
    mockClient.current!.state.docs.push(
      { _id: 'ev-1', space: 'ws' } as never,
      { _id: 'ev-2', space: 'ws' } as never,
    )
    await expect(deleteEvents(['ev-1', 'ev-2'], {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('listRecurringEvents returns JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 'rec-1', title: 'Daily' } as never)
    await listRecurringEvents({ json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
  it('listRecurringInstances filters by eventId', async () => {
    mockClient.current!.state.docs.push({
      _id: 'rec-1',
      _class: 'calendar:class:ReccuringEvent',
      title: 'Daily',
    } as never)
    mockClient.current!.state.docs.push({
      _id: 'inst-1',
      _class: 'calendar:class:ReccuringInstance',
      recurringEventId: 'rec-1',
    } as never)
    await listRecurringInstances('rec-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})
