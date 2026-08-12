import type { PlatformClient } from '@hcengineering/api-client'
import { describe, expect, it, vi } from 'vitest'
import { resolveRef, resolveRefs, buildIndex, invalidateIndex } from './ref-resolver.js'

const client = (docs: Record<string, unknown>[]) =>
  ({ findAll: vi.fn().mockResolvedValue(docs) }) as unknown as PlatformClient

describe('reference resolver', () => {
  it('resolves ids, identifiers, titles, and numeric project references', async () => {
    const c = client([
      { _id: 'abc1234567890123', identifier: 'PROJ-12', title: 'Build Thing', name: 'Thing' },
    ])
    expect(await resolveRef('abc1234567890123', { client: c, classId: 'x' as never })).toBe(
      'abc1234567890123',
    )
    expect(await resolveRef('PROJ-12', { client: c, classId: 'x' as never })).toBe('abc1234567890123')
    expect(await resolveRef('build thing', { client: c, classId: 'x' as never })).toBe('abc1234567890123')
    expect(
      await resolveRef('12', { client: c, classId: 'x' as never, defaultProjectIdentifier: 'PROJ' }),
    ).toBe('abc1234567890123')
    await expect(resolveRefs(['PROJ-12', 'Thing'], { client: c, classId: 'x' as never })).resolves.toEqual([
      'abc1234567890123',
      'abc1234567890123',
    ])
  })

  it('reports missing refs with candidates and invalidates indexes', async () => {
    const c = client([{ _id: '1', identifier: 'ONE' }])
    await expect(resolveRef('missing', { client: c, classId: 'x' as never })).rejects.toMatchObject({
      code: 2,
      hint: expect.stringContaining('ONE'),
    })
    await buildIndex(c, 'x' as never)
    invalidateIndex(c, 'x')
    expect(c.findAll).toHaveBeenCalledTimes(1)
    await buildIndex(c, 'x' as never)
    expect(c.findAll).toHaveBeenCalledTimes(2)
  })
})
