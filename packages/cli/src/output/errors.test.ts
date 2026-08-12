import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CliError, ExitCode, handleError, retry } from './errors.js'

describe('CliError and handleError', () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`)
  }) as never)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    exit.mockClear()
    error.mockClear()
  })

  afterEach(() => vi.clearAllMocks())

  it('preserves code, message, hint, and name', () => {
    const err = new CliError(ExitCode.NotFound, 'missing', 'try again')
    expect(err).toMatchObject({ code: 2, message: 'missing', hint: 'try again', name: 'CliError' })
  })

  it.each([
    ['PLATFORM_ALREADY_EXISTS', ExitCode.Conflict],
    ['PLATFORM_NOT_FOUND', ExitCode.NotFound],
    ['PLATFORM_UNAUTHORIZED', ExitCode.Auth],
    ['PLATFORM_FORBIDDEN', ExitCode.Auth],
    ['PLATFORM_RATE_LIMITED', ExitCode.RateLimited],
    ['PLATFORM_VALIDATION', ExitCode.Validation],
  ])('maps %s to exit %s', (code, expected) => {
    expect(() => handleError({ code, message: 'failure' })).toThrow(`exit:${expected}`)
    expect(exit).toHaveBeenCalledWith(expected)
    expect(error).toHaveBeenCalled()
  })

  it('maps numeric server errors and unknown errors', () => {
    expect(() => handleError({ code: 503, message: 'down' })).toThrow('exit:7')
    expect(() => handleError(new Error('plain'))).toThrow('exit:1')
  })

  it('maps CliError directly', () => {
    expect(() => handleError(new CliError(ExitCode.Ambiguous, 'many'))).toThrow('exit:8')
  })
})

describe('retry', () => {
  it('returns on the first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries rate limits and eventually succeeds', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockRejectedValueOnce({ code: 429 }).mockResolvedValue('ok')
    const promise = retry(fn, { maxAttempts: 2 })
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('stops at maxAttempts and does not retry other errors', async () => {
    const err = { code: 400 }
    const fn = vi.fn().mockRejectedValue(err)
    await expect(retry(fn, { maxAttempts: 3 })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
