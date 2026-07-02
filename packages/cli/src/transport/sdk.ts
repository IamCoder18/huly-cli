import { connectPlatform, type PlatformClient, type AccountClient, resolveToken } from '../auth/client.js'
import { readEnv, requireUrl } from '../auth/env.js'
import { readActiveWorkspace, getCachedWorkspaceToken, readActiveAccount } from '../auth/cache.js'
import { CliError, ExitCode } from '../output/errors.js'

export interface ConnectOpts {
  url?: string
  workspace?: string
  token?: string
  email?: string
  password?: string
}

export async function resolveWorkspace(opts: ConnectOpts): Promise<string> {
  const ws = opts.workspace ?? readEnv().workspace ?? (await readActiveWorkspace())
  if (!ws) {
    throw new CliError(
      ExitCode.Validation,
      'no workspace resolved',
      'set --workspace, HULY_WORKSPACE, or run `huly workspace use <name>`'
    )
  }
  return ws
}

export async function connectCli(opts: ConnectOpts = {}): Promise<PlatformClient> {
  const workspace = await resolveWorkspace(opts)
  const client = await connectPlatform({ ...opts, workspace })
  return client
}

export async function connectAccountCli(opts: ConnectOpts = {}): Promise<AccountClient> {
  const env = readEnv()
  const url = requireUrl(opts.url ?? env.url)
  let token = await resolveToken({ ...opts, url })
  // If a workspace is in scope (flag, env var, or active workspace file),
  // prefer the workspace-scoped token so methods like getWorkspaceMembers /
  // getWorkspaceInfo (which require workspace authorization) succeed.
  // Workspace-scoped tokens have the workspace UUID which server-side
  // permission gates (e.g. deleteWorkspace) require.
  const workspace = opts.workspace ?? env.workspace ?? (await readActiveWorkspace())
  if (workspace) {
    try {
      // A7: prefer cached active account over env.email (interactive login
      // doesn't set HULY_EMAIL).
      const active = await readActiveAccount(url)
      const email = active ?? opts.email ?? env.email
      if (email) {
        const ws = await getCachedWorkspaceToken(url, email, workspace)
        if (ws?.token) token = ws.token
      }
    } catch {
      // best-effort; fall back to account token
    }
  }
  const { accountClient } = await import('../auth/client.js')
  return await accountClient(url, token)
}