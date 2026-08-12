import { describe, expect, it, vi } from 'vitest'
import { whoamiCommand } from './whoami.js'

vi.mock('../auth/env.js', () => ({
  readEnv: () => ({ url: 'https://host', email: 'a@b' }),
  requireUrl: (u: string) => u,
}))
vi.mock('../auth/client.js', () => ({
  resolveToken: vi.fn().mockResolvedValue('token'),
  accountClient: vi.fn().mockResolvedValue({
    getSocialIds: vi.fn().mockResolvedValue([{ key: 'email:a@b', isPrimary: true }]),
    getUserWorkspaces: vi
      .fn()
      .mockResolvedValue([{ name: 'Main', url: 'main', uuid: 'uuid', mode: 'active' }]),
  }),
  connectPlatform: vi.fn(),
}))
vi.mock('../auth/cache.js', () => ({
  readActiveWorkspace: vi.fn().mockResolvedValue('main'),
  findAnyCachedCreds: vi.fn().mockResolvedValue(undefined),
}))

describe('whoami command', () => {
  it('prints account information as JSON', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await whoamiCommand({ json: true })
    expect(log.mock.calls.flat().join('\n')).toContain('email:a@b')
    log.mockRestore()
  })
})
