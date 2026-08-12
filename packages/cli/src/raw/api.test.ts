import { describe, expect, it, vi } from 'vitest'
import { apiCommand } from './api.js'

vi.mock('../auth/env.js', () => ({
  readEnv: () => ({ url: 'https://host', token: 'token' }),
  requireUrl: (u: string) => u,
}))
vi.mock('../auth/client.js', () => ({ resolveToken: vi.fn().mockResolvedValue('token') }))

describe('raw api command', () => {
  it('builds requests and pretty-prints JSON responses', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await apiCommand('POST', 'api/test', { query: ['q=a b'], header: ['X-Test=yes'], body: '{"x":1}' })
    const request = fetchMock.mock.calls[0]
    expect(request).toBeDefined()
    if (request === undefined) throw new Error('Missing fetch request')
    expect(request[0]).toBe('https://host/api/test?q=a%20b')
    expect((request[1] as RequestInit).method).toBe('POST')
    expect(log.mock.calls.flat().join('\n')).toContain('"ok": true')
    fetchMock.mockRestore()
    log.mockRestore()
  })

  it('prints raw non-JSON responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('plain', { status: 200 }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await apiCommand('GET', '/plain')
    expect(log.mock.calls.flat().join('\n')).toContain('plain')
    vi.restoreAllMocks()
  })
})
