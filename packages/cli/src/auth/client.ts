import pkg from '@hcengineering/api-client'
import accountPkg from '@hcengineering/account-client'
import type { PlatformClient, ConnectOptions } from '@hcengineering/api-client'
import type { AccountClient } from '@hcengineering/account-client'
import { createRequire } from 'node:module'
import { readEnv, insecureTLS } from './env.js'
import { getCachedCreds, setCachedCreds, setCachedWorkspaceToken, findAnyCachedToken, findAnyCachedCreds, readActiveAccount, writeActiveAccount } from './cache.js'

const require = createRequire(import.meta.url)
const wsModule = require('ws') as typeof import('ws')

// `NodeWebSocketFactory` lives in `@hcengineering/api-client/lib/socket/node.js`
// but the package's `exports` field does not expose it. We recreate the small
// shim inline so we don't need to bypass the exports map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClientSocket = any
const NodeWebSocketFactory = (url: string): AnyClientSocket => {
  const wsOpts = insecureTLS() ? { rejectUnauthorized: false } : {}
  const ws = new wsModule.WebSocket(url, wsOpts)
  const client: AnyClientSocket = {
    get readyState (): number {
      return ws.readyState
    },
    send: (data: string | ArrayBufferLike | Blob | ArrayBufferView): void => {
      if (data instanceof Blob) {
        void data.arrayBuffer().then((buffer) => { ws.send(buffer) })
      } else {
        ws.send(data as any)
      }
    },
    close: (code?: number): void => {
      ws.close(code)
    }
  }
  ws.on('message', (data: any) => {
    if (client.onmessage != null) {
      let eventData: string | ArrayBuffer | SharedArrayBuffer = data
      if (typeof Buffer !== 'undefined' && data instanceof Buffer) {
        eventData = new Uint8Array(data).buffer
      }
      const event = { data: eventData, type: 'message', target: client }
      client.onmessage(event)
    }
  })
  ws.on('close', (code: number, _reason: string) => {
    if (client.onclose != null) {
      const evt = { code, reason: '', wasClean: code === 1000, type: 'close', target: client }
      client.onclose(evt)
    }
  })
  ws.on('open', () => {
    if (client.onopen != null) {
      const evt = { type: 'open', target: client }
      client.onopen(evt)
    }
  })
  ws.on('error', (err: Error) => {
    if (client.onerror != null) {
      const evt = { type: 'error', target: client, error: err }
      client.onerror(evt)
    }
  })
  return client
}

// Polyfills for `window` / `WebSocket` are installed in src/index.ts before
// the SDK is loaded; no need to repeat here.

const { connect } = pkg
const { getClient } = accountPkg

export type { AccountClient, PlatformClient }

const accountsUrlCache = new Map<string, string>()

async function resolveAccountsUrl(url: string): Promise<string> {
  const host = url.replace(/\/$/, '')
  if (accountsUrlCache.has(host)) return accountsUrlCache.get(host)!
  let accountsUrl = `${host}/_accounts`
  try {
    // CLI-08: HULY_INSECURE_TLS is enforced globally via applyInsecureTLS()
    // (Node's built-in undici fetch ignores per-request `agent`), so we no
    // longer pass an `agent` here. The fetch below honors NODE_TLS_REJECT_UNAUTHORIZED.
    const r = await fetch(`${host}/config.json`)
    if (r.ok) {
      const cfg = (await r.json()) as { ACCOUNTS_URL?: string }
      if (cfg.ACCOUNTS_URL) accountsUrl = cfg.ACCOUNTS_URL
    }
  } catch {
    // fall through to default
  }
  accountsUrlCache.set(host, accountsUrl)
  return accountsUrl
}

export async function accountClient(url: string, token?: string): Promise<AccountClient> {
  const accountsUrl = await resolveAccountsUrl(url)
  return getClient(accountsUrl, token)
}

export async function login(
  url: string,
  email: string,
  password: string
): Promise<{ token: string; account: string }> {
  const c = await accountClient(url)
  const info = await c.login(email, password)
  if (!info.token) throw new Error('login succeeded but no token returned')
  return { token: info.token, account: info.account }
}

export async function loginAndCache(
  url: string,
  email: string,
  password: string
): Promise<{ token: string; account: string }> {
  const result = await login(url, email, password)
  // Preserve any cached workspace tokens — only refresh the account token.
  const existing = await getCachedCreds(url, email)
  await setCachedCreds(url, email, {
    accountToken: result.token,
    workspaces: existing?.workspaces ?? {}
  })
  await writeActiveAccount(url, email)
  return result
}

export async function signUpAndCache(
  url: string,
  email: string,
  password: string,
  firstName: string,
  lastName: string
): Promise<{ token: string; account: string }> {
  const c = await accountClient(url)
  // The server's signUp also returns a session token in the same call on
  // selfhost, so we can cache immediately.
  await c.signUp(email, password, firstName, lastName)
  const info = await c.login(email, password)
  if (!info.token) throw new Error('signUp succeeded but login returned no token')
  await setCachedCreds(url, email, {
    accountToken: info.token,
    workspaces: {}
  })
  await writeActiveAccount(url, email)
  return { token: info.token, account: info.account }
}

export interface CreateWorkspaceResult {
  workspaceUrl: string
  workspaceId: string
  role: string
  endpoint: string
  token: string
}

export async function createWorkspace(
  url: string,
  token: string,
  email: string,
  workspaceName: string
): Promise<CreateWorkspaceResult> {
  const c = await accountClient(url, token)
  const result = await c.createWorkspace(workspaceName)
  if (!result.token) throw new Error('createWorkspace succeeded but no token returned')
  await setCachedWorkspaceToken(url, email, workspaceName, {
    token: result.token,
    workspaceId: result.workspace ?? '',
    role: String(result.role ?? 'OWNER'),
    endpoint: result.endpoint
  })
  return {
    workspaceUrl: workspaceName,
    workspaceId: result.workspace ?? '',
    role: String(result.role ?? 'OWNER'),
    endpoint: result.endpoint,
    token: result.token
  }
}

export async function listWorkspaces(url: string, token: string) {
  const c = await accountClient(url, token)
  return await c.getUserWorkspaces()
}

export async function selectWorkspace(url: string, token: string, workspaceUrl: string) {
  const c = await accountClient(url, token)
  return await c.selectWorkspace(workspaceUrl)
}

export interface ConnectArgs {
  url?: string
  workspace?: string
  email?: string
  password?: string
  token?: string
}

export async function connectPlatform(opts: ConnectArgs): Promise<PlatformClient> {
  const env = readEnv()
  const url = opts.url ?? env.url
  const workspace = opts.workspace ?? env.workspace
  const email = opts.email ?? env.email
  const password = opts.password ?? env.password
  let token = opts.token ?? env.token
  let resolvedEmail = email

  if (!workspace) {
    throw new Error('workspace required: pass --workspace, set HULY_WORKSPACE, or run `huly workspace use <name>`')
  }

  if (!token && email && password) {
    const loginResult = await loginAndCache(url, email, password)
    token = loginResult.token
  }

  if (!token) {
    if (email) {
      const cached = await getCachedCreds(url, email)
      if (cached) {
        token = cached.accountToken
        resolvedEmail = email
      }
    }
    if (!token) {
      const cached = await findAnyCachedToken(url)
      if (cached) {
        token = cached.token
        resolvedEmail = cached.email
      }
    }
    if (!token) {
      throw new Error('auth required: set HULY_EMAIL/HULY_PASSWORD, HULY_TOKEN, or run `huly login`')
    }
  }

  const connectOpts: ConnectOptions = token
    ? { token, workspace, socketFactory: NodeWebSocketFactory }
    : { email: email!, password: password!, workspace, socketFactory: NodeWebSocketFactory }

  const client = await connect(url, connectOpts)

  if (resolvedEmail && token) {
    try {
      const wsLogin = await selectWorkspace(url, token, workspace)
      await setCachedWorkspaceToken(url, resolvedEmail, wsLogin.workspaceUrl ?? workspace, {
        token: wsLogin.token,
        role: wsLogin.role,
        endpoint: wsLogin.endpoint,
        workspaceId: wsLogin.workspace
      })
    } catch {
      // best-effort caching
    }
  }

  return client
}

export async function resolveToken(opts: { url?: string; token?: string; email?: string; password?: string }): Promise<string> {
  const env = readEnv()
  const url = opts.url ?? env.url
  const token = opts.token ?? env.token
  if (token) return token
  const email = opts.email ?? env.email
  const password = opts.password ?? env.password
  // Prefer cached credentials over re-authenticating. Re-login would clobber
  // any cached workspace tokens.
  if (email) {
    const cached = await getCachedCreds(url, email)
    if (cached) return cached.accountToken
  }
  if (email && password) {
    const r = await loginAndCache(url, email, password)
    return r.token
  }
  const any = await findAnyCachedToken(url)
  if (any) return any.token
  throw new Error('auth required: set HULY_EMAIL/HULY_PASSWORD, HULY_TOKEN, or run `huly login`')
}