import { describe, expect, it } from 'vitest'
import { buildWsUrl, isHelloFailure } from './ws.js'

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
})

describe('isHelloFailure', () => {
  it('rejects a hello response with an error', () => {
    expect(isHelloFailure({ id: -1, error: { message: 'bad token' } }, false)).toBe(true)
  })

  it('accepts a successful hello response', () => {
    expect(isHelloFailure({ id: -1, result: 'hello' }, false)).toBe(false)
  })

  it('does not treat a later message as a hello failure', () => {
    expect(isHelloFailure({ id: -1, error: {} }, true)).toBe(false)
  })
})
