import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import https from 'node:https'
import { CliError, ExitCode } from '../output/errors.js'

export interface HulyEnv {
  url: string
  email?: string
  password?: string
  token?: string
  workspace?: string
  project?: string
  teamspace?: string
  firstName?: string
  lastName?: string
}

let dotenvLoaded = false
function loadDotenvFile(): void {
  if (dotenvLoaded) return
  dotenvLoaded = true
  const file = process.env.HULY_ENV_FILE ?? path.join(os.homedir(), '.config', 'huly', '.env')
  if (!fs.existsSync(file)) return
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const key = m[1]
    let raw = m[2].trim()
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1)
    } else {
      const hashIdx = raw.indexOf(' #')
      if (hashIdx >= 0) raw = raw.slice(0, hashIdx).trimEnd()
    }
    if (process.env[key] === undefined) process.env[key] = raw
  }
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): HulyEnv {
  loadDotenvFile()
  return {
    url: env.HULY_URL ?? '',
    email: env.HULY_EMAIL,
    password: env.HULY_PASSWORD,
    token: env.HULY_TOKEN,
    workspace: env.HULY_WORKSPACE,
    project: env.HULY_PROJECT,
    teamspace: env.HULY_TEAMSPACE,
    firstName: env.HULY_FIRST_NAME,
    lastName: env.HULY_LAST_NAME
  }
}

/**
 * Throws an explicit CliError when the resolved URL is empty. Use this at
 * any call site that actually needs the URL (i.e. every connect/login/signup
 * path) so the user sees `HULY_URL is required` instead of a downstream
 * `invalid url` from undici / `ws`.
 */
export function requireUrl(url: string | undefined): string {
  if (!url || url.trim() === '') {
    throw new CliError(ExitCode.Validation, 'HULY_URL is required', 'pass --url <server> or set HULY_URL in your env')
  }
  return url
}

export function isNonInteractive(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.HULY_NONINTERACTIVE === '1') return true
  if (env.CI) return true
  if (process.env.__HULY_NONINTERACTIVE === '1') return true
  return false
}

export function markNonInteractive(): void {
  process.env.HULY_NONINTERACTIVE = '1'
  process.env.__HULY_NONINTERACTIVE = '1'
}

export function insecureTLS(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HULY_INSECURE_TLS === '1'
}

/**
 * Apply `HULY_INSECURE_TLS=1` to the global Node TLS state so that ALL
 * outgoing HTTPS requests (including those performed by Node's built-in
 * undici `fetch` and SDK code that ignores our `agent` option) skip TLS
 * verification. Must be called as early as possible — before any fetch or
 * SDK connect — to take effect for the lifetime of the process.
 *
 * Effect: sets NODE_TLS_REJECT_UNAUTHORIZED=0 and the internal undici
 * dispatcher equivalent via NODE_EXTRA_CA_CERTS-style fallbacks. Future
 * fetches use rejectUnauthorized=false.
 */
export function applyInsecureTLS(): void {
  if (!insecureTLS()) return
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try {
    https.globalAgent.options.rejectUnauthorized = false
  } catch { /* ignore */ }
}

export function isHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.HULY_URL) return false
  return env.HULY_URL.startsWith('http://')
}

export function activeAccountPath(): string {
  return `${configDir()}/active-account`
}

export function noColor(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NO_COLOR != null && env.NO_COLOR !== ''
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const home = process.env.HOME ?? '~'
  return `${xdg ?? `${home}/.config`}/huly`
}

export function credentialsPath(): string {
  return `${configDir()}/credentials.json`
}

export function activeWorkspacePath(): string {
  return `${configDir()}/active-workspace`
}