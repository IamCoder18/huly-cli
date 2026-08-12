import type { PlatformClient } from '@hcengineering/api-client'
import { describe, expect, it, vi } from 'vitest'
import { listDocs, getDoc, deleteDoc } from './dry-run.js'

describe('dry-run commands', () => {
  it('lists with offset and limit and emits JSON', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const client = { findAll: vi.fn().mockResolvedValue([{ _id: '1' }, { _id: '2' }, { _id: '3' }]) } as never
    await expect(
      listDocs(client, 'tracker:class:Issue' as never, {}, { offset: 1, limit: 1, json: true }),
    ).resolves.toEqual([{ _id: '2' }])
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('returns undefined for missing docs', async () => {
    const client = { findOne: vi.fn().mockResolvedValue(undefined) } as never
    await expect(getDoc(client, 'x' as never, '1' as never, 's' as never)).resolves.toBeUndefined()
  })

  it('does not remove during dry run', async () => {
    const client = { removeDoc: vi.fn() } as unknown as PlatformClient
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      deleteDoc(client, 'x' as never, 's' as never, '1' as never, { dryRun: true }),
    ).resolves.toMatchObject({ skipped: true })
    expect(client.removeDoc).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('would remove')
    log.mockRestore()
  })
})
