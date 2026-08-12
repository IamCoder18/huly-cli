import { describe, expect, it, vi } from 'vitest'
import { resolveToken } from './client.js'

vi.mock('./env.js', () => ({
  readEnv: () => ({ url: 'https://host', token: 'env-token' }),
  requireUrl: (u: string) => u,
  insecureTLS: () => false,
}))
vi.mock('./cache.js', () => ({ getCachedCreds: vi.fn(), findAnyCachedToken: vi.fn() }))

describe('auth client', () => {
  it('prefers explicit token, then environment token', async () => {
    await expect(resolveToken({ url: 'https://host', token: 'explicit' })).resolves.toBe('explicit')
    await expect(resolveToken({ url: 'https://host' })).resolves.toBe('env-token')
  })
})
