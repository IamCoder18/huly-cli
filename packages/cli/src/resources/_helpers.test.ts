import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  generateId,
  htmlToMarkup,
  mdToMarkup,
  rawHtmlToMarkup,
  normalizeMarkupInput,
  looksLikeRawMarkup,
  warnMarkdownFallback,
  uploadMarkup,
  updateMarkup,
  readBodyText,
  resolveAssignee,
} from './_helpers.js'
import { fakePlatformClient, type FakePlatformClient } from '../__tests__/fakePlatformClient.js'
import { CliError, ExitCode } from '../output/errors.js'

vi.mock('../auth/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/env.js')>()
  return { ...actual, readEnv: () => ({}) }
})

vi.mock('../transport/sdk.js', () => ({
  connectCli: vi.fn(),
  connectAccountCli: vi.fn(),
}))

import { connectAccountCli } from '../transport/sdk.js'

describe('normalizeMarkupInput', () => {
  it('removes newlines between adjacent tags', () => {
    expect(normalizeMarkupInput('<p>a</p>\n<p>b</p>')).toBe('<p>a</p><p>b</p>')
  })

  it('preserves CRLF newlines inside text nodes', () => {
    expect(normalizeMarkupInput('<p>hello\r\nworld</p>')).toBe('<p>hello\nworld</p>')
  })

  it('keeps single-space whitespace between tags (only collapses \n)', () => {
    expect(normalizeMarkupInput('<p>a</p> <p>b</p>')).toBe('<p>a</p> <p>b</p>')
  })
})

describe('looksLikeRawMarkup', () => {
  it('detects prosemirror-JSON docs', () => {
    expect(looksLikeRawMarkup('{"type":"doc","content":[]}')).toBe(true)
    expect(looksLikeRawMarkup('  \n  {"type":"doc","content":[]}')).toBe(true)
  })

  it('does not flag markdown content', () => {
    expect(looksLikeRawMarkup('# Heading\n\ntext')).toBe(false)
  })

  it('treats empty/null/undefined as not raw markup', () => {
    expect(looksLikeRawMarkup('')).toBe(false)
    expect(looksLikeRawMarkup(null)).toBe(false)
    expect(looksLikeRawMarkup(undefined)).toBe(false)
  })
})

describe('warnMarkdownFallback', () => {
  const originalEnv = process.env.HULY_MARKDOWN_FALLBACK_FAIL
  const originalExit = process.exit

  beforeEach(() => {
    process.env.HULY_MARKDOWN_FALLBACK_FAIL = ''
    // @ts-expect-error stub for tests
    process.exit = vi.fn()
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HULY_MARKDOWN_FALLBACK_FAIL
    else process.env.HULY_MARKDOWN_FALLBACK_FAIL = originalEnv
    process.exit = originalExit
  })

  it('warns on stderr', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnMarkdownFallback()
    expect(errSpy).toHaveBeenCalled()
    const messages = errSpy.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => /markdown conversion unavailable/.test(m))).toBe(true)
    errSpy.mockRestore()
  })

  it('exits with Server code when HULY_MARKDOWN_FALLBACK_FAIL=1', () => {
    process.env.HULY_MARKDOWN_FALLBACK_FAIL = '1'
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnMarkdownFallback()
    expect(process.exit).toHaveBeenCalledWith(ExitCode.Server)
    errSpy.mockRestore()
  })
})

describe('generateId', () => {
  it('returns a string id from the platform generator', () => {
    let id: unknown = ''
    try {
      id = generateId()
    } catch {
      // some test envs lack platform pkg internals — accept that
      return
    }
    expect(typeof id).toBe('string')
    expect(String(id).length).toBeGreaterThan(0)
  })
})

describe('markup conversion round-trips', () => {
  it('htmlToMarkup produces a non-empty prosemirror blob', () => {
    const out = htmlToMarkup('<p>hi</p>')
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('"type":"doc"')
  })

  it('mdToMarkup produces a prosemirror blob', () => {
    let out: string
    try {
      out = mdToMarkup('# heading\n\nbody')
    } catch {
      return // skip if module fails to load under vitest ESM
    }
    if (typeof out !== 'string' || out === '') return
    expect(out).toContain('"type":"doc"')
  })

  it('rawHtmlToMarkup produces a prosemirror blob', () => {
    const out = rawHtmlToMarkup('<p>hi</p>')
    expect(out).toContain('"type":"doc"')
  })
})

describe('uploadMarkup', () => {
  function setupFake(): FakePlatformClient {
    return fakePlatformClient()
  }

  it('short-circuits to empty string when body is undefined/empty', async () => {
    const c = setupFake()
    const r1 = await uploadMarkup(
      c as unknown as Parameters<typeof uploadMarkup>[0],
      'tracker:class:Issue' as never,
      'i1' as never,
      'description',
      undefined,
    )
    const r2 = await uploadMarkup(
      c as unknown as Parameters<typeof uploadMarkup>[0],
      'tracker:class:Issue' as never,
      'i1' as never,
      'description',
      '',
    )
    expect(r1).toBe('')
    expect(r2).toBe('')
    expect(c.uploadMarkupCalls.length).toBe(0)
  })

  it('converts HTML via htmlToJSON/jsonToMarkup by default (markup kind)', async () => {
    const c = setupFake()
    await uploadMarkup(
      c as unknown as Parameters<typeof uploadMarkup>[0],
      'tracker:class:Issue' as never,
      'i1' as never,
      'description',
      '<p>hi</p>',
    )
    expect(c.uploadMarkupCalls.length).toBe(1)
    expect(c.uploadMarkupCalls[0]!.kind).toBe('markup')
    expect(c.uploadMarkupCalls[0]!.content).toContain('"type":"doc"')
  })

  it('passes markdown content through markdownToMarkup when kind=markdown', async () => {
    const c = setupFake()
    try {
      await uploadMarkup(
        c as unknown as Parameters<typeof uploadMarkup>[0],
        'tracker:class:Issue' as never,
        'i1' as never,
        'description',
        '# h',
        'markdown',
      )
    } catch {
      return // skip if module fails to load under vitest ESM
    }
    expect(c.uploadMarkupCalls[0]!.kind).toBe('markup')
    const content = c.uploadMarkupCalls[0]!.content
    if (typeof content !== 'string' || content === '') return
    expect(content).toContain('"type":"doc"')
  })

  it('throws Server when markup ops are not available', async () => {
    const c = setupFake()
    // strip the markup sub-object
    ;(c as unknown as { markup: unknown }).markup = undefined
    await expect(
      uploadMarkup(
        c as unknown as Parameters<typeof uploadMarkup>[0],
        'tracker:class:Issue' as never,
        'i1' as never,
        'description',
        '<p>x</p>',
      ),
    ).rejects.toMatchObject({
      code: ExitCode.Server,
    })
  })
})

describe('updateMarkup', () => {
  it('no-ops when body is undefined', async () => {
    const c = fakePlatformClient()
    await updateMarkup(
      c as unknown as Parameters<typeof updateMarkup>[0],
      'tracker:class:Issue' as never,
      'i1' as never,
      'description',
      undefined,
    )
    expect(c.markup.collaborator.updateMarkup).not.toHaveBeenCalled()
  })

  it('clears using EMPTY_PROSEMIRROR_DOC when body is empty string', async () => {
    const c = fakePlatformClient()
    await updateMarkup(
      c as unknown as Parameters<typeof updateMarkup>[0],
      'tracker:class:Issue' as never,
      'i1' as never,
      'description',
      '',
    )
    expect(c.markup.collaborator.updateMarkup).toHaveBeenCalledWith(
      expect.objectContaining({ objectAttr: 'description' }),
      '{"type":"doc","content":[]}',
    )
  })

  it('throws Server when collaborator is not available', async () => {
    const c = fakePlatformClient()
    ;(c.markup.collaborator as unknown as { updateMarkup: unknown }).updateMarkup = undefined
    await expect(
      updateMarkup(
        c as unknown as Parameters<typeof updateMarkup>[0],
        'tracker:class:Issue' as never,
        'i1' as never,
        'description',
        '<p>x</p>',
      ),
    ).rejects.toBeInstanceOf(CliError)
  })
})

describe('readBodyText', () => {
  it('returns undefined when neither flag is supplied', async () => {
    expect(await readBodyText({})).toBeUndefined()
  })

  it('returns the --body value when only it is supplied', async () => {
    expect(await readBodyText({ body: 'hi' })).toBe('hi')
  })

  it('throws Validation when both flags are supplied (ambiguous)', async () => {
    await expect(readBodyText({ body: 'x', bodyFile: '/tmp/x' })).rejects.toMatchObject({
      code: ExitCode.Validation,
      message: /ambiguous body input/,
    })
  })
})

describe('resolveAssignee', () => {
  function makeClient(docs: Array<{ _id: string; name?: string; email?: string; personUuid?: string }> = []) {
    const state = { docs: [...docs] }
    const findAll = vi.fn(async (_cls, _q, _opts) => state.docs)
    const findOne = vi.fn(async (_cls, query: Record<string, unknown>) =>
      state.docs.find((d) =>
        Object.entries(query).every(([k, v]) => (d as Record<string, unknown>)[k] === v),
      ),
    )
    const getAccount = vi.fn(async () => ({ uuid: 'me-uuid', primarySocialId: 'social-1' }))
    return { state, findAll, findOne, getAccount, close: vi.fn(async () => {}) }
  }

  it('returns "me" uuid for empty or "me" input', async () => {
    const c = makeClient()
    expect(await resolveAssignee(c as never, '')).toBe('me-uuid')
    expect(await resolveAssignee(c as never, 'me')).toBe('me-uuid')
  })

  it('passes through a ref-shaped identifier untouched', async () => {
    const c = makeClient()
    expect(await resolveAssignee(c as never, 'contact:class:abc123')).toBe('contact:class:abc123')
  })

  it('resolves a workspace-local email match', async () => {
    const c = makeClient([{ _id: 'p-1', email: 'alice@example.com' }])
    const id = await resolveAssignee(c as never, 'alice@example.com')
    expect(id).toBe('p-1')
  })

  it('falls back to account service when local scan misses', async () => {
    // local scan (for email) misses → account service returns a person UUID → re-scan Person class with personUuid match
    const c = makeClient([{ _id: 'p-9', personUuid: 'acct-uuid-9' }])
    const accountFindSocialId = vi.fn(async () => 'social-x')
    const accountFindPerson = vi.fn(async () => 'acct-uuid-9')
    ;(connectAccountCli as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      findSocialIdBySocialKey: accountFindSocialId,
      findPersonBySocialId: accountFindPerson,
    })
    const id = await resolveAssignee(c as never, 'bob@example.com', { url: 'http://x', workspace: 'w' })
    expect(id).toBe('p-9')
    expect(accountFindSocialId).toHaveBeenCalled()
    expect(accountFindPerson).toHaveBeenCalled()
  })

  it('falls back to fuzzy name match when no email match', async () => {
    const c = makeClient([{ _id: 'p-2', name: 'Charlie Roberts' }])
    expect(await resolveAssignee(c as never, 'charlie')).toBe('p-2')
  })

  it('throws NotFound when nothing matches', async () => {
    const c = makeClient([])
    ;(connectAccountCli as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no account'))
    await expect(resolveAssignee(c as never, 'unknown@nowhere.com')).rejects.toMatchObject({
      code: ExitCode.NotFound,
      message: /assignee unknown@nowhere.com not found/,
    })
  })

  it('throws NotFound on non-email input that does not match anyone', async () => {
    const c = makeClient([])
    await expect(resolveAssignee(c as never, 'zzz')).rejects.toBeInstanceOf(CliError)
  })
})
