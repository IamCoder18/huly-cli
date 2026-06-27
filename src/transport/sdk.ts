import { connectPlatform, type PlatformClient, type AccountClient, resolveToken } from '../auth/client.js'
import { readEnv } from '../auth/env.js'
import { readActiveWorkspace, getCachedWorkspaceToken } from '../auth/cache.js'
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
  return await connectPlatform({ ...opts, workspace })
}

export async function connectAccountCli(opts: ConnectOpts = {}): Promise<AccountClient> {
  const env = readEnv()
  const url = opts.url ?? env.url
  let token = await resolveToken(opts)
  // If a workspace is in scope, prefer the workspace-scoped token so methods
  // like getWorkspaceMembers / getWorkspaceInfo (which require workspace
  // authorization) succeed.
  const workspace = opts.workspace ?? env.workspace
  if (workspace) {
    try {
      const email = env.email
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