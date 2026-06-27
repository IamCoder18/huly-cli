import pkg from '@hcengineering/api-client'
import accountPkg from '@hcengineering/account-client'
import { readEnv } from './env.js'
import { getCachedCreds, setCachedCreds, setCachedWorkspaceToken, findAnyCachedToken, writeActiveAccount } from './cache.js'

const { connect } = pkg
const { getClient } = accountPkg

import type { PlatformClient, ConnectOptions } from '@hcengineering/api-client'
import type { AccountClient } from '@hcengineering/account-client'

export type { AccountClient, PlatformClient }

export async function accountClient(url: string, token?: string): Promise<AccountClient> {
  const accountsUrl = `${url.replace(/\/$/, '')}/_accounts`
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
  await setCachedCreds(url, email, { accountToken: result.token, workspaces: {} })
  await writeActiveAccount(url, email)
  return result
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
    ? { token, workspace }
    : { email: email!, password: password!, workspace }

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
  let token = opts.token ?? env.token
  if (token) return token
  const email = opts.email ?? env.email
  const password = opts.password ?? env.password
  if (email && password) {
    const r = await loginAndCache(url, email, password)
    return r.token
  }
  if (email) {
    const cached = await getCachedCreds(url, email)
    if (cached) return cached.accountToken
  }
  const any = await findAnyCachedToken(url)
  if (any) return any.token
  throw new Error('auth required: set HULY_EMAIL/HULY_PASSWORD, HULY_TOKEN, or run `huly login`')
}