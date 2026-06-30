import { readEnv } from '../auth/env.js'
import { connectPlatform, accountClient, resolveToken } from '../auth/client.js'
import { readActiveWorkspace, findAnyCachedCreds } from '../auth/cache.js'
import { shouldJson, json, kv, header, C, colorizeStatus } from '../output/format.js'
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

  if (opts.json) {
    json(result)
    return
  }

  header(`Account — ${result.account}`, { subtitle: `server: ${result.url}` })
  kv([
    ['Server', C.id(result.url)],
    ['Account', C.emphasis(result.account ?? '—')],
    ['Active workspace', result.active_workspace ? C.emphasis(result.active_workspace) : C.muted('(none)')]
  ])

  if (workspaces.length > 0) {
    console.log()
    console.log(C.emphasis('Workspaces'))
    console.log(C.muted('─'.repeat(20)))
    for (const w of workspaces) {
      const isActive = w.url === workspace
      const marker = isActive ? C.ok('') + ' ' : C.muted('○ ')
      const mode = colorizeStatus(w.mode)
      console.log(`  ${marker} ${C.emphasis(w.name)} ${C.muted('(' + w.url + ')')}  ${mode}  ${C.id(w.uuid.slice(0, 8) + '…')}`)
    }
  }

  if (workspace) {
    try {
      const client = await connectPlatform({ token, workspace })
      const account = await client.getAccount()
      console.log()
      console.log(C.muted(`connected to workspace: ${C.emphasis(account.uuid)} (role: ${C.emphasis(account.role)})`))
      await client.close()
    } catch (err) {
      console.log()
      console.log(C.warn(`(warning) could not connect to ${workspace}: ${(err as Error).message}`))
    }
  }
}