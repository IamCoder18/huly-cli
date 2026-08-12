import { describe, expect, it, vi } from 'vitest'
import { signupCommand } from './signup.js'

vi.mock('../auth/env.js', () => ({
  readEnv: () => ({ url: 'https://host' }),
  requireUrl: (u: string) => u,
  isNonInteractive: () => true,
}))
vi.mock('../auth/client.js', () => ({
  signUpAndCache: vi.fn().mockResolvedValue({ token: 't', account: 'a' }),
  createWorkspace: vi.fn().mockResolvedValue({ workspaceId: 'w' }),
}))
vi.mock('../auth/cache.js', () => ({ writeActiveWorkspace: vi.fn().mockResolvedValue(undefined) }))

describe('signup command', () => {
  it('rejects incomplete headless credentials', async () => {
    await expect(signupCommand({ headless: true })).rejects.toMatchObject({ code: 4 })
  })

  it('signs up and creates an explicit workspace', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await signupCommand({
      headless: true,
      email: 'a@b',
      password: 'pw',
      firstName: 'A',
      lastName: 'B',
      workspace: 'main',
      json: true,
    })
    expect(log.mock.calls.flat().join('\n')).toContain('main')
    log.mockRestore()
  })
})
