import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import {
  listIssueTemplates,
  getIssueTemplate,
  createIssueTemplate,
  updateIssueTemplate,
  deleteIssueTemplates,
  addTemplateChild,
  removeTemplateChild,
} from './issue-template.js'
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
vi.mock('../auth/prompts.js', () => ({
  pickProject: vi.fn(async () => ({ _id: 'p-1', identifier: 'PROJ', name: 'Project' })),
}))

beforeEach(() => {
  mockClient.current = fakePlatformClient()
  mockClient.current.state.docs.push({ _id: 'p-1', name: 'Project', identifier: 'PROJ' } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('listIssueTemplates', () => {
  it('returns templates for project', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', title: 'Bug', space: 'p-1' } as never)
    await listIssueTemplates({ project: 'PROJ', json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out)).length).toBe(1)
  })
})

describe('getIssueTemplate', () => {
  it('throws NotFound when missing', async () => {
    await expect(getIssueTemplate('missing')).rejects.toBeInstanceOf(CliError)
  })
  it('returns template JSON', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', title: 'Bug', space: 'p-1', description: '' } as never)
    await getIssueTemplate('t-1', { json: true })
    const out = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]
    expect(JSON.parse(String(out))._id).toBe('t-1')
  })
})

describe('createIssueTemplate', () => {
  it('throws Validation when --title missing', async () => {
    await expect(createIssueTemplate({})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('throws Validation when both --body and --body-file', async () => {
    await expect(createIssueTemplate({ title: 'Bug', body: 'a', bodyFile: '/tmp/x' })).rejects.toMatchObject({
      code: ExitCode.Validation,
      message: /ambiguous body input/,
    })
  })
  it('creates with empty description and children=[]', async () => {
    await createIssueTemplate({ project: 'PROJ', title: 'Bug' })
    const c = mockClient.current!
    expect(c.state.createCalls[0]!.attrs).toMatchObject({ title: 'Bug', description: '', children: [] })
  })
})

describe('updateIssueTemplate', () => {
  it('throws NotFound when ref missing', async () => {
    await expect(updateTemplateTitle('missing', 'x')).rejects.toBeInstanceOf(CliError)
  })
  it('throws Validation when no fields provided', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', title: 'Bug', space: 'p-1' } as never)
    await expect(updateIssueTemplate('t-1', {})).rejects.toMatchObject({ code: ExitCode.Validation })
  })
  it('updates title', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', title: 'Bug', space: 'p-1' } as never)
    await updateIssueTemplate('t-1', { title: 'New' })
    expect(mockClient.current!.state.updateCalls[0]!.ops).toEqual({ title: 'New' })
  })
})

describe('deleteIssueTemplates', () => {
  it('requires --yes for multi-delete', async () => {
    mockClient.current!.state.docs.push(
      { _id: 't-1', space: 'p-1' } as never,
      { _id: 't-2', space: 'p-1' } as never,
    )
    await expect(deleteIssueTemplates(['t-1', 't-2'], {})).rejects.toMatchObject({
      code: ExitCode.Validation,
    })
  })
})

describe('addTemplateChild / removeTemplateChild', () => {
  it('adds a child id to the children array', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', space: 'p-1', title: 'P', children: [] } as never)
    mockClient.current!.state.docs.push({ _id: 't-child', title: 'C' } as never)
    await addTemplateChild('t-1', 't-child', {})
    const c = mockClient.current!
    expect(c.state.updateCalls.length).toBe(1)
    const children = c.state.updateCalls[0]!.ops.children as Array<{ id: string }>
    expect(children.length).toBe(1)
    expect(children[0]!.id).toBe('t-child')
  })

  it('removes a child id from the children array', async () => {
    mockClient.current!.state.docs.push({
      _id: 't-1',
      _class: 'tracker:class:IssueTemplate',
      space: 'p-1',
      title: 'P',
      children: [{ id: 't-child' }, { id: 't-other' }],
    } as never)
    mockClient.current!.state.docs.push({
      _id: 't-child',
      _class: 'tracker:class:IssueTemplate',
      title: 'C',
    } as never)
    await removeTemplateChild('t-1', 't-child', {})
    const c = mockClient.current!
    const children = c.state.updateCalls[0]!.ops.children as Array<{ id: string }>
    expect(children.length).toBe(1)
    expect(children[0]!.id).toBe('t-other')
  })

  it('dry-run on add prints and skips SDK', async () => {
    mockClient.current!.state.docs.push({ _id: 't-1', space: 'p-1', children: [] } as never)
    mockClient.current!.state.docs.push({ _id: 't-child' } as never)
    await addTemplateChild('t-1', 't-child', { dryRun: true })
    expect(mockClient.current!.state.updateCalls.length).toBe(0)
  })
})

async function updateTemplateTitle(ref: string, title: string) {
  return updateIssueTemplate(ref, { title })
}
