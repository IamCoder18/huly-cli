import { describe, expect, it, vi } from 'vitest'
import { connectCli, connectAccountCli, resolveWorkspace } from './sdk.js'

vi.mock('../auth/env.js', () => ({
  readEnv: () => ({ url: 'https://host', workspace: 'env-ws' }),
  requireUrl: (u: string) => u,
  skipBootstrap: () => true,
}))
vi.mock('../auth/client.js', () => ({
  connectPlatform: vi.fn().mockResolvedValue({}),
  resolveToken: vi.fn().mockResolvedValue('token'),
  accountClient: vi.fn().mockResolvedValue({}),
}))
vi.mock('../auth/cache.js', () => ({
  readActiveWorkspace: vi.fn().mockResolvedValue('active-ws'),
  readActiveAccount: vi.fn().mockResolvedValue(undefined),
  getCachedWorkspaceToken: vi.fn().mockResolvedValue(undefined),
  setCachedWorkspaceToken: vi.fn(),
}))

describe('transport SDK glue', () => {
  it('resolves workspace by option, env, then active cache', async () => {
    await expect(resolveWorkspace({ workspace: 'option' })).resolves.toBe('option')
    await expect(resolveWorkspace({})).resolves.toBe('env-ws')
  })

  it('connects a platform client', async () => {
    await expect(connectCli({ workspace: 'ws', url: 'https://host', token: 't' })).resolves.toEqual({})
  })

  it('connects an account client with resolved token', async () => {
    await expect(connectAccountCli({ url: 'https://host' })).resolves.toEqual({})
  })
})
