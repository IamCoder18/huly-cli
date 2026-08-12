import { afterEach, describe, expect, it, vi } from 'vitest'
import { header, json, kv, shouldJson, table, withTimeout } from './format.js'

describe('format output', () => {
  afterEach(() => vi.restoreAllMocks())

  it('prints JSON, key/value output, headers, and tables', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    json({ ok: true })
    kv(
      [
        ['Name', 'Alice'],
        ['Empty', undefined],
      ],
      { title: 'Details' },
    )
    header('Title', { subtitle: 'Sub', accent: 'Accent' })
    table(
      [{ id: '1', name: 'Alice' }],
      [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
      ],
      { count: true },
    )
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('"ok": true')
    expect(output).toContain('Alice')
    expect(output).toContain('1 result')
  })

  it('handles empty tables and no-border tables', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    table([], [{ key: 'id', header: 'ID' }], { noBorder: true })
    expect(log.mock.calls.flat().join('\n')).toContain('(no results)')
  })

  it('evaluates JSON mode from explicit flags with CI neutralized', () => {
    vi.stubEnv('CI', '')
    try {
      expect(shouldJson({ json: true })).toBe(true)
      expect(shouldJson({ ci: true })).toBe(true)
      expect(shouldJson({})).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('treats process.env.CI as JSON mode when set', () => {
    vi.stubEnv('CI', 'true')
    try {
      expect(shouldJson({})).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves before timeout and rejects after it', async () => {
    vi.useFakeTimers()
    await expect(withTimeout(Promise.resolve('ok'), 100, 'fallback')).resolves.toBe('ok')
    const pending = withTimeout(new Promise(() => {}), 100, 'fallback')
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('fallback')
    vi.useRealTimers()
  })
})
