import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface HulyEnv {
  url: string
  email?: string
  password?: string
  token?: string
  workspace?: string
  project?: string
  teamspace?: string
}

let dotenvLoaded = false
function loadDotenvFile(): void {
  if (dotenvLoaded) return
  dotenvLoaded = true
  const file = process.env.HULY_ENV_FILE ?? path.join(os.homedir(), '.config', 'huly', '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let raw = m[2].trim()
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = raw
  }
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): HulyEnv {
  loadDotenvFile()
  return {
    url: env.HULY_URL ?? 'https://huly.aaravlabs.com',
    email: env.HULY_EMAIL,
    password: env.HULY_PASSWORD,
    token: env.HULY_TOKEN,
    workspace: env.HULY_WORKSPACE,
    project: env.HULY_PROJECT,
    teamspace: env.HULY_TEAMSPACE
  }
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
  // Also disable verification for the legacy `https` agent path used by
  // some SDK bridges.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('node:https') as typeof import('node:https')
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