import { describe, expect, it, vi } from 'vitest'
import { bootstrapEmployee } from './bootstrap.js'

describe('bootstrap employee', () => {
  it('returns no-account when account identity is unavailable', async () => {
    const client = { getAccount: vi.fn().mockResolvedValue(undefined) } as never
    await expect(bootstrapEmployee({ url: 'https://host', workspace: 'ws', client })).resolves.toEqual({
      state: 'no-account',
    })
  })

  it('returns skipped when account lookup fails', async () => {
    const client = { getAccount: vi.fn().mockRejectedValue(new Error('offline')) } as never
    await expect(bootstrapEmployee({ url: 'https://host', workspace: 'ws', client })).resolves.toMatchObject({
      state: 'skipped',
      reason: 'getAccount failed: offline',
    })
  })
})
