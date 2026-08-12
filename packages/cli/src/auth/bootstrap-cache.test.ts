import { describe, expect, it } from 'vitest'
import { bootstrapPath, isBootstrapped, loadBootstrap, markBootstrapped } from './bootstrap-cache.js'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { vi } from 'vitest'

describe('bootstrap cache', () => {
  it('stores normalized markers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'huly-bootstrap-'))
    vi.stubEnv('XDG_CONFIG_HOME', root)
    expect(await loadBootstrap()).toEqual({})
    await markBootstrapped('https://Host/', 'ws', 'acct')
    expect(await isBootstrapped('https://host', 'ws', 'acct')).toBe(true)
    expect(bootstrapPath()).toContain('bootstrap.json')
    vi.unstubAllEnvs()
  })
})
