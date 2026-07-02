import { readEnv, requireUrl } from '../auth/env.js'
import { resolveToken } from '../auth/client.js'
import { ExitCode, handleError, CliError } from '../output/errors.js'

interface ApiOpts {
  body?: string
  query?: string[]
  header?: string[]
  token?: string
  url?: string
}

function parseKv(items: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items ?? []) {
    const eq = item.indexOf('=')
    if (eq < 0) throw new CliError(ExitCode.Validation, `invalid k=v entry: ${item}`)
    out[item.slice(0, eq).trim()] = item.slice(eq + 1).trim()
  }
  return out
}

function appendQuery(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query)
  if (entries.length === 0) return url
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return url + (url.includes('?') ? '&' : '?') + qs
}

export async function apiCommand(method: string, path: string, opts: ApiOpts = {}): Promise<void> {
  const env = readEnv()
  const url = requireUrl(opts.url ?? env.url).replace(/\/$/, '')
  const trimmedPath = path.startsWith('/') ? path : '/' + path
  let target = `${url}${trimmedPath}`
  try {
    const query = parseKv(opts.query)
    target = appendQuery(target, query)
  } catch (e) {
    handleError(e)
    return
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...parseKv(opts.header)
  }

  const token = opts.token ?? env.token ?? await resolveToken({ url }).catch(() => undefined)
  if (token) headers['Authorization'] = `Bearer ${token}`

  const init: RequestInit = { method, headers }
  if (opts.body) init.body = opts.body

  let res: Response
  try {
    res = await fetch(target, init)
  } catch (e) {
    handleError(new CliError(ExitCode.Generic, `request failed: ${(e as Error).message}`))
    return
  }
  const text = await res.text()
  console.log(`HTTP ${res.status}`)
  if (text.length > 0) {
    try {
      const parsed = JSON.parse(text)
      console.log(JSON.stringify(parsed, null, 2))
    } catch {
      console.log(text)
    }
  }
  if (res.status >= 400) {
    handleError(new CliError(
      res.status >= 500 ? ExitCode.Server : res.status === 401 || res.status === 403 ? ExitCode.Auth : res.status === 429 ? ExitCode.RateLimited : ExitCode.Generic,
      `HTTP ${res.status} ${res.statusText}`
    ))
  }
}