import { describe, expect, it, vi } from 'vitest'
import type { PlatformClient } from '@hcengineering/api-client'
import { resolveProjectForCommand } from './_project-resolve.js'
import { CliError, ExitCode } from '../output/errors.js'

vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({}) }
})

vi.mock('../auth/prompts.js', () => ({
  pickProject: vi.fn(async () => ({ _id: 'p-prompt', name: 'Prompted', identifier: 'PROMPT' })),
}))

function client(docs: Array<Record<string, unknown>>): PlatformClient {
  return {
    findAll: vi.fn(async (_cls, query) => {
      const q = (query ?? {}) as Record<string, unknown>
      return docs.filter((d) => Object.entries(q).every(([k, v]) => d[k] === v))
    }),
    findOne: vi.fn(async (_cls, query) => {
      const q = (query ?? {}) as Record<string, unknown>
      return docs.find((d) => Object.entries(q).every(([k, v]) => d[k] === v))
    }),
  } as unknown as PlatformClient
}

describe('resolveProjectForCommand', () => {
  it('returns the project matching the explicit ref', async () => {
    const c = client([
      { _id: 'p-1', name: 'Alpha', identifier: 'ALPHA' },
      { _id: 'p-2', name: 'Beta', identifier: 'BETA' },
    ])
    const p = await resolveProjectForCommand(c, 'BETA')
    expect(p._id).toBe('p-2')
  })

  it('matches identifiers case-insensitively', async () => {
    const c = client([{ _id: 'p-1', name: 'Alpha', identifier: 'ALPHA' }])
    const p = await resolveProjectForCommand(c, 'alpha')
    expect(p._id).toBe('p-1')
  })

  it('falls through to interactive pickProject when no projects match the ref', async () => {
    const c = client([{ _id: 'p-2', name: 'Other', identifier: 'OTHER' }])
    const p = await resolveProjectForCommand(c, 'NOPE')
    expect(p._id).toBe('p-prompt')
  })

  it('throws NotFound when no projects exist in the workspace', async () => {
    const c = client([])
    await expect(resolveProjectForCommand(c, 'X')).rejects.toMatchObject({
      code: ExitCode.NotFound,
      message: /no projects found/,
    })
    // sanity: instanceof CliError
    await expect(resolveProjectForCommand(c, 'X')).rejects.toBeInstanceOf(CliError)
  })

  it('returns the prompted pick when no ref supplied', async () => {
    const c = client([
      { _id: 'p-1', name: 'Alpha', identifier: 'ALPHA' },
      { _id: 'p-2', name: 'Beta', identifier: 'BETA' },
    ])
    const p = await resolveProjectForCommand(c)
    expect(p._id).toBe('p-prompt')
  })
})
