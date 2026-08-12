import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './cli.js'

const mocks = vi.hoisted(() => {
  const state = {
    failIssueList: false,
    issueList: vi.fn(async (opts: Record<string, unknown>) => {
      if (state.failIssueList) throw new Error('issue list failed')
      console.log(JSON.stringify({ command: 'issue list', opts }))
    }),
    issueGet: vi.fn(async (ref: string, opts: Record<string, unknown>) => {
      console.log(JSON.stringify({ command: 'issue get', ref, opts }))
    }),
    login: vi.fn(async (opts: Record<string, unknown>) => {
      console.log(JSON.stringify({ command: 'login', opts }))
    }),
    whoami: vi.fn(async (opts: Record<string, unknown>) => {
      console.log(JSON.stringify({ command: 'whoami', opts }))
    }),
    useWorkspace: vi.fn(async (name: string) => {
      const { writeActiveWorkspace } = await import('./auth/cache.js')
      await writeActiveWorkspace(name)
      console.log(`active workspace: ${name}`)
    }),
  }
  return state
})

vi.mock('./commands/login.js', () => ({ loginCommand: mocks.login }))
vi.mock('./commands/signup.js', () => ({}))
vi.mock('./commands/whoami.js', () => ({ whoamiCommand: mocks.whoami }))
vi.mock('./resources/workspace.js', () => ({ useWorkspace: mocks.useWorkspace }))
vi.mock('./resources/user.js', () => ({}))
vi.mock('./resources/project.js', () => ({}))
vi.mock('./resources/issue.js', () => ({ listIssues: mocks.issueList, getIssue: mocks.issueGet }))
vi.mock('./resources/component.js', () => ({}))
vi.mock('./resources/milestone.js', () => ({}))
vi.mock('./resources/issue-template.js', () => ({}))
vi.mock('./resources/comment.js', () => ({}))
vi.mock('./resources/calendar.js', () => ({}))
vi.mock('./resources/time.js', () => ({}))
vi.mock('./resources/card.js', () => ({}))
vi.mock('./resources/document.js', () => ({}))
vi.mock('./resources/todo.js', () => ({}))
vi.mock('./resources/channel.js', () => ({}))
vi.mock('./resources/spaces.js', () => ({}))
vi.mock('./resources/activity.js', () => ({}))
vi.mock('./resources/notifications.js', () => ({}))
vi.mock('./resources/approvals.js', () => ({}))
vi.mock('./raw/api.js', () => ({}))
vi.mock('./raw/ws.js', () => ({}))

function asArgv(args: string[]): string[] {
  return ['node', 'huly', ...args]
}

describe('CLI registration', () => {
  let configHome = ''
  const originalEnv = new Map<string, string | undefined>()
  const envKeys = ['XDG_CONFIG_HOME', 'HULY_NONINTERACTIVE', '__HULY_NONINTERACTIVE', 'CI']
  let exits: Array<number | string | null | undefined> = []

  beforeEach(async () => {
    for (const key of envKeys) originalEnv.set(key, process.env[key])
    configHome = await mkdtemp(join(tmpdir(), 'huly-cli-'))
    process.env.XDG_CONFIG_HOME = configHome
    delete process.env.HULY_NONINTERACTIVE
    delete process.env.__HULY_NONINTERACTIVE
    delete process.env.CI
    mocks.failIssueList = false
    mocks.issueList.mockClear()
    mocks.issueGet.mockClear()
    mocks.login.mockClear()
    mocks.whoami.mockClear()
    mocks.useWorkspace.mockClear()
    exits = []
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      exits.push(code)
      return undefined as never
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const key of envKeys) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(configHome, { recursive: true, force: true })
  })

  it('writes help and exits 0 for --help', async () => {
    await run(asArgv(['--help']))
    expect(exits).toContain(0)
  })

  it('prints help when invoked without arguments (commander v15 calls process.exit)', async () => {
    await run(asArgv([]))
    expect(exits.length).toBeGreaterThan(0)
  })

  it('passes --json through to the registered issue list action', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run(asArgv(['issue', 'list', '--json']))
    expect(mocks.issueList).toHaveBeenCalledTimes(1)
    const opts = mocks.issueList.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.json).toBe(true)
    expect(log.mock.calls.flat().join('\n')).toContain('"command":"issue list"')
  })

  it('passes prefixed issue refs and JSON output through the get action', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run(asArgv(['issue', 'get', 'PROJ-12', '--json']))
    expect(mocks.issueGet).toHaveBeenCalledTimes(1)
    const getCall = mocks.issueGet.mock.calls[0]
    expect(getCall).toBeDefined()
    if (getCall === undefined) throw new Error('Missing issue get call')
    expect(getCall[0]).toBe('PROJ-12')
    expect((getCall[1] as Record<string, unknown>).json).toBe(true)
    expect(log.mock.calls.flat().join('\n')).toContain('"ref":"PROJ-12"')
  })

  it('writes the active workspace through workspace use registration', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await run(asArgv(['workspace', 'use', 'myws']))
    expect(mocks.useWorkspace).toHaveBeenCalledTimes(1)
    await expect(readFile(join(configHome, 'huly', 'active-workspace'), 'utf8')).resolves.toBe('myws\n')
  })

  it('passes headless through to loginCommand', async () => {
    await run(asArgv(['login', '--headless']))
    expect(mocks.login).toHaveBeenCalledTimes(1)
    const loginCall = mocks.login.mock.calls[0]
    expect(loginCall).toBeDefined()
    if (loginCall === undefined) throw new Error('Missing login call')
    expect((loginCall[0] as Record<string, unknown>).headless).toBe(true)
  })

  it('marks the process non-interactive and propagates the explicit flag', async () => {
    await run(asArgv(['issue', 'list', '--non-interactive']))
    expect(mocks.issueList).toHaveBeenCalledTimes(1)
    const opts = mocks.issueList.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.nonInteractive).toBe(true)
    expect(process.env.__HULY_NONINTERACTIVE).toBe('1')
  })

  it('honours HULY_NONINTERACTIVE through the pre-action hook', async () => {
    process.env.HULY_NONINTERACTIVE = '1'
    await run(asArgv(['issue', 'list']))
    expect(process.env.__HULY_NONINTERACTIVE).toBe('1')
  })

  it('propagates URL, workspace, JSON, and CI globals through issue list', async () => {
    await run(
      asArgv([
        'issue',
        'list',
        '--url',
        'https://huly.example.test',
        '--workspace',
        'myws',
        '--json',
        '--ci',
      ]),
    )
    expect(mocks.issueList).toHaveBeenCalledTimes(1)
    const opts = mocks.issueList.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts).toMatchObject({
      url: 'https://huly.example.test',
      workspace: 'myws',
      json: true,
      ci: true,
    })
  })

  it('maps action failures through handleError and process.exit', async () => {
    mocks.failIssueList = true
    const errors: unknown[][] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })
    await run(asArgv(['issue', 'list']))
    expect(errors.flat().join(' ')).toContain('issue list failed')
    expect(exits).toContain(1)
  })

  it('invokes whoamiCommand with global url/workspace/json', async () => {
    await run(asArgv(['whoami', '--url', 'https://huly.example.test', '--workspace', 'myws', '--json']))
    expect(mocks.whoami).toHaveBeenCalledTimes(1)
    expect(mocks.whoami.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://huly.example.test',
      workspace: 'myws',
      json: true,
    })
  })
})
