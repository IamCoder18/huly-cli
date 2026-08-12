import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldShow, spinner, withSpinner } from './progress.js'

vi.mock('ora', () => ({
  default: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn(), fail: vi.fn() })),
}))

describe('progress', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('hides progress for CI, JSON, noninteractive, env flags, and non-TTY', () => {
    expect(shouldShow({ ci: true })).toBe(false)
    expect(shouldShow({ json: true })).toBe(false)
    expect(shouldShow({ nonInteractive: true })).toBe(false)
    vi.stubEnv('CI', '1')
    expect(shouldShow()).toBe(false)
    vi.unstubAllEnvs()
    vi.stubEnv('HULY_NONINTERACTIVE', '1')
    expect(shouldShow()).toBe(false)
  })

  it('returns no spinner when progress is disabled', () => {
    expect(spinner('Loading', { json: true })).toBeNull()
  })

  it('stops on success and fails on rejection', async () => {
    const s = spinner('Loading')
    if (!s) return
    await expect(withSpinner('Loading', async () => 'ok')).resolves.toBe('ok')
    await expect(
      withSpinner('Loading', async () => {
        throw new Error('bad')
      }),
    ).rejects.toThrow('bad')
  })
})
