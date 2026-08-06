import { describe, expect, it, vi } from 'vitest'
import { buildWsUrl, isHelloFailure, wsCommand } from './ws.js'

const wsMock = vi.hoisted(() => ({ current: null as any }))

vi.mock('ws', () => {
  class FakeWebSocket {
    static OPEN = 1
    readyState = 1
    send = vi.fn()
    close = vi.fn()
    onopen: (() => void) | null = null
    onmessage: ((data: { toString(): string }) => void) | null = null
    onerror: ((error: unknown) => void) | null = null
    onclose: ((code: number, reason: Buffer) => void) | null = null

    on(event: string, callback: (...args: unknown[]) => void): void {
      if (event === 'open') this.onopen = callback as () => void
      if (event === 'message') this.onmessage = callback as (data: { toString(): string }) => void
      if (event === 'error') this.onerror = callback as (error: unknown) => void
      if (event === 'close') this.onclose = callback as (code: number, reason: Buffer) => void
    }

    constructor(public url: string, public options?: unknown) {
      wsMock.current = this
      setTimeout(() => this.onopen?.(), 0)
    }
  }
  return { default: FakeWebSocket }
})

describe('buildWsUrl', () => {
  it('does not append /_transactor twice for self-hosted endpoints', () => {
    expect(buildWsUrl('wss://huly.example/_transactor', 'token', 'abc123')).toBe(
      'wss://huly.example/_transactor/token?sessionId=abc123'
    )
  })

  it('adds /_transactor for plain self-hosted endpoints', () => {
    expect(buildWsUrl('wss://huly.example', 'token', 'abc123')).toBe(
      'wss://huly.example/_transactor/token?sessionId=abc123'
    )
  })

  it('derives wss from an https endpoint', () => {
    expect(buildWsUrl('https://huly.example', 'token', 'abc123')).toBe(
      'wss://huly.example/_transactor/token?sessionId=abc123'
    )
  })

  it('derives ws from an http endpoint', () => {
    expect(buildWsUrl('http://huly.example', 'token', 'abc123')).toBe(
      'ws://huly.example/_transactor/token?sessionId=abc123'
    )
  })

  it('strips a trailing slash from the host', () => {
    expect(buildWsUrl('wss://huly.example/', 'token', 'abc123')).toBe(
      'wss://huly.example/_transactor/token?sessionId=abc123'
    )
  })

  it('encodes token and session id', () => {
    expect(buildWsUrl('wss://huly.example', 'a/b?c', 'x/y')).toBe(
      'wss://huly.example/_transactor/a%2Fb%3Fc?sessionId=x%2Fy'
    )
  })
})

describe('isHelloFailure', () => {
  it('rejects a hello response with an error', () => {
    expect(isHelloFailure({ id: -1, error: { message: 'bad token' } }, false)).toBe(true)
  })

  it('does not treat a null error as a hello failure', () => {
    expect(isHelloFailure({ id: -1, error: null }, false)).toBe(false)
  })

  it('accepts a successful hello response', () => {
    expect(isHelloFailure({ id: -1, result: 'hello' }, false)).toBe(false)
  })

  it('does not treat a later message as a hello failure', () => {
    expect(isHelloFailure({ id: -1, error: {} }, true)).toBe(false)
  })
})

describe('wsCommand', () => {
  it('rejects a hello error fast and closes the socket', async () => {
    const promise = wsCommand('test.method', '[]', {
      url: 'wss://huly.example',
      token: 'tok'
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wsMock.current.url).toContain('/_transactor/tok?')
    wsMock.current.onmessage?.({
      toString: () => JSON.stringify({ id: -1, error: { message: 'bad token' } })
    })

    await expect(promise).rejects.toMatchObject({
      code: 7,
      message: /hello failed/
    })
    expect(wsMock.current.close).toHaveBeenCalled()
  })
})
