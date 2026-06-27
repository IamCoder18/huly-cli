import { readEnv } from '../auth/env.js'
import { connectPlatform, accountClient, resolveToken } from '../auth/client.js'
import { readActiveWorkspace, findAnyCachedCreds } from '../auth/cache.js'
import { shouldJson, json, kv } from '../output/format.js'
import { withSpinner } from '../output/progress.js'

export async function whoamiCommand(opts: { json?: boolean } = {}): Promise<void> {
  const env = readEnv()
  const active = await readActiveWorkspace()
  const workspace = env.workspace ?? active

  const token = await resolveToken({})
  const cached = await findAnyCachedCreds(env.url)
  const email = cached?.email ?? env.email

  const ac = await withSpinner('Loading account…', () => accountClient(env.url, token))
  const socialIds = await ac.getSocialIds(false)
  const primary = socialIds.find((s) => s.isPrimary) ?? socialIds[0]
  const workspaces = await withSpinner('Fetching workspaces…', () => ac.getUserWorkspaces())

  const result = {
    url: env.url,
    account: primary?.key ?? email,
    active_workspace: workspace ?? null,
    workspaces: workspaces.map((w: any) => ({
      name: w.name,
      url: w.url,
      uuid: w.uuid,
      mode: w.mode
    }))
  }

  if (opts.json || shouldJson({ ci: true })) {
    json(result)
    return
  }

  kv([
    ['Server', result.url],
    ['Account', result.account],
    ['Active workspace', result.active_workspace ?? '(none)'],
    ['Workspaces', `${workspaces.length}`]
  ])

  if (workspace) {
    try {
      const client = await connectPlatform({ token, workspace })
      const account = await client.getAccount()
      console.log()
      console.log(`connected to workspace: ${account.uuid} (role: ${account.role})`)
      await client.close()
    } catch (err) {
      console.log(`\n(warning) could not connect to ${workspace}: ${(err as Error).message}`)
    }
  }
}