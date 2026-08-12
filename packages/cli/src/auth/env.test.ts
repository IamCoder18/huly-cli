import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configDir,
  insecureTLS,
  isHttp,
  isNonInteractive,
  isOpinionated,
  noColor,
  readEnv,
  requireUrl,
  skipBootstrap,
} from './env.js'
import { CliError, ExitCode } from '../output/errors.js'

describe('auth environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.HULY_ENV_FILE
    delete process.env.HULY_URL
    delete process.env.HULY_INSECURE_TLS
    delete process.env.HULY_SKIP_BOOTSTRAP
    delete process.env.__HULY_NONINTERACTIVE
  })

  it('reads explicit environment values', () => {
    vi.stubEnv('HULY_URL', 'https://example.test')
    vi.stubEnv('HULY_EMAIL', 'a@example.test')
    expect(readEnv()).toMatchObject({ url: 'https://example.test', email: 'a@example.test' })
  })

  it('parses dotenv values with export, quotes, and comments', () => {
    vi.stubEnv('HULY_ENV_FILE', '/definitely/missing')
    expect(readEnv()).toMatchObject({ url: expect.any(String) })
  })

  it('requires a non-empty URL', () => {
    expect(() => requireUrl('')).toThrow(CliError)
    expect(() => requireUrl('')).toThrow(expect.objectContaining({ code: ExitCode.Validation }))
  })

  it('handles interaction and opinionated flags', () => {
    expect(isNonInteractive({ CI: '1' })).toBe(true)
    expect(isOpinionated({ HULY_OPINIONATED: 'off' })).toBe(false)
    expect(isOpinionated({ HULY_OPINIONATED: 'yes' })).toBe(true)
    expect(skipBootstrap({ HULY_SKIP_BOOTSTRAP: '1' })).toBe(true)
    expect(insecureTLS({ HULY_INSECURE_TLS: '1' })).toBe(true)
    expect(isHttp({ HULY_URL: 'http://x' })).toBe(true)
    expect(isHttp({ HULY_URL: 'https://x' })).toBe(false)
  })

  it('honours config and color settings', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/tmp/config')
    expect(configDir()).toBe('/tmp/config/huly')
    expect(noColor({ NO_COLOR: '1' })).toBe(true)
    expect(noColor({})).toBe(false)
  })
})
