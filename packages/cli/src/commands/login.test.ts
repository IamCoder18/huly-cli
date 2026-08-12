import { describe, expect, it, vi } from 'vitest'
import { loginCommand } from './login.js'

vi.mock('../auth/env.js', () => ({
  readEnv: () => ({ url: 'https://host', email: 'a@b', password: 'pw' }),
  requireUrl: (u: string) => u,
  isNonInteractive: () => true,
}))
vi.mock('../auth/client.js', () => ({
  loginAndCache: vi.fn().mockResolvedValue({ token: 't', account: 'a' }),
  listWorkspaces: vi.fn().mockResolvedValue([{ name: 'Main', url: 'main', uuid: 'u' }]),
  accountClient: vi.fn().mockResolvedValue({ selectWorkspace: vi.fn().mockResolvedValue({ token: 'w' }) }),
}))
vi.mock('../auth/cache.js', () => ({
  writeActiveWorkspace: vi.fn().mockResolvedValue(undefined),
  setCachedWorkspaceToken: vi.fn().mockResolvedValue(undefined),
}))

describe('login command', () => {
  it('logs in and prints JSON workspace details', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await loginCommand({ json: true })
    expect(log.mock.calls.flat().join('\n')).toContain('"workspace"')
    log.mockRestore()
  })
})
