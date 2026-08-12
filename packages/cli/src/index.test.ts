import { afterEach, describe, expect, it, vi } from 'vitest'

const applyInsecureTLS = vi.fn()
const run = vi.fn().mockResolvedValue(undefined)

vi.mock('./auth/env.js', () => ({ applyInsecureTLS }))
vi.mock('./cli.js', () => ({ run }))

const g = globalThis as unknown as Record<string, unknown>

describe('index entry shim', () => {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    info: console.info,
    error: console.error,
  }
  const originalEmit = process.emit
  const originalWindow = g.window
  const originalWebSocket = g.WebSocket

  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    console.log = originalConsole.log
    console.warn = originalConsole.warn
    console.info = originalConsole.info
    console.error = originalConsole.error
    process.emit = originalEmit
    if (originalWindow === undefined) delete g.window
    else g.window = originalWindow
    if (originalWebSocket === undefined) delete g.WebSocket
    else g.WebSocket = originalWebSocket
  })

  it('applies insecure TLS configuration at import time', async () => {
    await import('./index.js')

    expect(applyInsecureTLS).toHaveBeenCalledTimes(1)
  })

  it('filters SDK noise from all console levels while preserving normal output', async () => {
    const log = vi.fn()
    const warn = vi.fn()
    const info = vi.fn()
    const error = vi.fn()
    console.log = log
    console.warn = warn
    console.info = info
    console.error = error

    await import('./index.js')

    console.log('Generate new SessionId 1')
    console.warn('no document found, failed to apply model transaction, skipping')
    console.info('Connected to server: https://huly.example.test')
    console.error('findfull model missing')
    console.log('normal output')
    console.warn('normal warning')
    console.info('normal info')
    console.error('normal error')

    expect(log).toHaveBeenCalledWith('normal output')
    expect(warn).toHaveBeenCalledWith('normal warning')
    expect(info).toHaveBeenCalledWith('normal info')
    expect(error).toHaveBeenCalledWith('normal error')
    expect(log).not.toHaveBeenCalledWith('Generate new SessionId 1')
    expect(warn).not.toHaveBeenCalledWith('no document found, failed to apply model transaction, skipping')
    expect(info).not.toHaveBeenCalledWith('Connected to server: https://huly.example.test')
    expect(error).not.toHaveBeenCalledWith('findfull model missing')
  })

  it('sets window and WebSocket polyfills when they are absent', async () => {
    delete g.window
    delete g.WebSocket

    await import('./index.js')

    expect(g.window).toMatchObject({ location: { href: '' } })
    expect(g.WebSocket).toBeDefined()
  })
})
