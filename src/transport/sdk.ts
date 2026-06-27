import { connectPlatform, type PlatformClient, type AccountClient, resolveToken } from '../auth/client.js'
import { readEnv } from '../auth/env.js'
import { readActiveWorkspace } from '../auth/cache.js'
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
  const token = await resolveToken(opts)
  const { accountClient } = await import('../auth/client.js')
  return await accountClient(url, token)
}