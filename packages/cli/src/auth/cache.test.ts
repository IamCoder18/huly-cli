import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  findAnyCachedCreds,
  findAnyCachedToken,
  getCachedCreds,
  getCachedWorkspaceToken,
  loadCredentials,
  normalizeHost,
  readActiveAccount,
  readActiveWorkspace,
  saveCredentials,
  setCachedCreds,
  setCachedWorkspaceToken,
  writeActiveAccount,
  writeActiveWorkspace,
} from './cache.js'

describe('auth cache', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'huly-cache-'))
    vi.stubEnv('XDG_CONFIG_HOME', root)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('normalizes hosts', () => {
    expect(normalizeHost('HTTPS://Example.TEST:443/')).toBe('https://example.test')
    expect(normalizeHost('http://Example.TEST:8080/')).toBe('http://example.test:8080')
    expect(normalizeHost('not-a-url/')).toBe('not-a-url')
  })

  it('loads missing credentials as empty and round-trips saved credentials', async () => {
    expect(await loadCredentials()).toEqual({})
    const data = { 'https://example.test': { 'a@b.test': { accountToken: 'tok', workspaces: {} } } }
    await saveCredentials(data)
    expect(await loadCredentials()).toEqual(data)
    expect((await stat(join(root, 'huly', 'credentials.json'))).mode & 0o777).toBe(0o600)
  })

  it('stores account, workspace, and active selections', async () => {
    const host = 'https://example.test/'
    await setCachedCreds(host, 'a@b.test', { accountToken: 'account', workspaces: {} })
    await setCachedWorkspaceToken(host, 'a@b.test', 'ws', { token: 'workspace' })
    expect(await getCachedCreds(host, 'a@b.test')).toMatchObject({ accountToken: 'account' })
    expect(await getCachedWorkspaceToken(host, 'a@b.test', 'ws')).toMatchObject({ token: 'workspace' })
    await writeActiveWorkspace('ws')
    await writeActiveAccount(host, 'a@b.test')
    expect(await readActiveWorkspace()).toBe('ws')
    expect(await readActiveAccount(host)).toBe('a@b.test')
    expect(await findAnyCachedCreds(host)).toMatchObject({ email: 'a@b.test' })
    expect(await findAnyCachedToken(host)).toMatchObject({ token: 'account' })
  })

  it('does not create workspace data for an unknown account', async () => {
    await setCachedWorkspaceToken('https://example.test', 'missing', 'ws', { token: 'x' })
    expect(await getCachedWorkspaceToken('https://example.test', 'missing', 'ws')).toBeUndefined()
  })

  it('throws malformed JSON', async () => {
    await fs.mkdir(join(root, 'huly'), { recursive: true })
    await fs.writeFile(join(root, 'huly', 'credentials.json'), '{')
    await expect(loadCredentials()).rejects.toThrow()
  })
})
