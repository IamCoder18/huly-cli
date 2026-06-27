import { connectAccountCli } from '../transport/sdk.js'
import { readActiveWorkspace, writeActiveWorkspace } from '../auth/cache.js'
import { readEnv } from '../auth/env.js'
import { shouldJson, json, table } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import type { GlobalOpts } from '../cli.js'

export async function listWorkspaces(g: GlobalOpts = {}): Promise<void> {
  const ac = await connectAccountCli({ url: g.url })
  const workspaces = await withSpinner('Fetching workspaces…', () => ac.getUserWorkspaces(), g)

  if (shouldJson({ json: g.json, ci: g.ci })) {
    json(workspaces)
    return
  }

  table(workspaces as unknown as Record<string, unknown>[], [
    { key: 'name', header: 'NAME' },
    { key: 'url', header: 'URL' },
    { key: 'uuid', header: 'UUID', format: (r) => String((r as { uuid: string }).uuid).slice(0, 12) + '…' },
    { key: 'mode', header: 'MODE' },
    { key: 'lastVisit', header: 'LAST VISIT', format: (r) => {
      const v = (r as { lastVisit?: number }).lastVisit
      return v ? new Date(v).toISOString().slice(0, 10) : '—'
    } }
  ])
}

export async function currentWorkspace(g: GlobalOpts = {}): Promise<void> {
  const env = readEnv()
  const flagWs = g.workspace ?? env.workspace
  const active = await readActiveWorkspace()
  const ws = flagWs ?? active ?? null
  if (shouldJson({ json: g.json, ci: g.ci })) {
    json({ workspace: ws, source: flagWs ? 'env' : active ? 'active-workspace' : null })
    return
  }
  if (!ws) {
    console.log('(no workspace set)')
    return
  }
  console.log(ws)
}

export async function useWorkspace(name: string, g: GlobalOpts = {}): Promise<void> {
  const env = readEnv()
  if (env.workspace || g.workspace) {
    throw new CliError(
      ExitCode.Validation,
      'cannot `workspace use` while --workspace/HULY_WORKSPACE is set',
      'unset HULY_WORKSPACE or pass --workspace explicitly per command'
    )
  }
  await writeActiveWorkspace(name)
  console.log(`active workspace: ${name}`)
}