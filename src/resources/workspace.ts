import { connectAccountCli } from '../transport/sdk.js'
import { readActiveWorkspace, writeActiveWorkspace, findAnyCachedCreds } from '../auth/cache.js'
import { readEnv } from '../auth/env.js'
import { shouldJson, json, table, kv, COLUMNS, C } from '../output/format.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import type { GlobalOpts } from '../cli.js'

interface WorkspaceInfo {
  name: string
  url: string
  uuid: string
  mode?: string
  region?: string
  [k: string]: unknown
}

interface Member {
  _id?: string
  person?: string
  account?: { uuid?: string; role?: string; fullAccount?: { email?: string } }
  name?: string
  email?: string
  role?: string
  [k: string]: unknown
}

export async function listWorkspaces(g: GlobalOpts = {}): Promise<void> {
  const ac = await connectAccountCli({ url: g.url })
  const workspaces = await withSpinner('Fetching workspaces…', () => ac.getUserWorkspaces(), g)

  if (shouldJson({ json: g.json, ci: g.ci })) {
    json(workspaces)
    return
  }

  table(workspaces as unknown as Record<string, unknown>[], COLUMNS.workspace(), { count: true, title: 'workspaces' })
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

export async function createWorkspace(opts: {
  name?: string
  region?: string
  json?: boolean
  ci?: boolean
  url?: string
  yes?: boolean
}): Promise<void> {
  if (!opts.name) throw new CliError(ExitCode.Validation, 'missing --name')
  if (!opts.yes) {
    throw new CliError(
      ExitCode.Validation,
      'creating a workspace is destructive',
      'pass --yes to confirm; or use `huly workspace create --name <n> --region <r> --yes`'
    )
  }
  const ac = await connectAccountCli({ url: opts.url })
  const result = await withSpinner(
    `Creating workspace "${opts.name}"…`,
    () => ac.createWorkspace(opts.name!, opts.region),
    opts
  )
  if (shouldJson({ json: opts.json, ci: opts.ci })) {
    json(result)
  } else {
    console.log(`created workspace: ${opts.name}`)
    if (result && typeof result === 'object') {
      console.log(JSON.stringify(result, null, 2))
    }
  }
}

export async function deleteWorkspace(opts: {
  json?: boolean
  ci?: boolean
  url?: string
  workspace?: string
  yes?: boolean
  force?: boolean
}): Promise<void> {
  const env = readEnv()
  const active = await readActiveWorkspace()
  const target = opts.workspace ?? env.workspace ?? active
  if (!target) {
    throw new CliError(ExitCode.Validation, 'no workspace resolved', 'pass --workspace or run `huly workspace use <n>` first')
  }
  if (!opts.force && (env.workspace || target === (env.workspace ?? active))) {
    throw new CliError(
      ExitCode.Validation,
      `cannot delete workspace ${target} while it is the active --workspace/HULY_WORKSPACE`,
      'unset HULY_WORKSPACE and run `huly workspace use <other>` first, or pass --force'
    )
  }
  if (!opts.yes) {
    throw new CliError(ExitCode.Validation, 'destructive: pass --yes to confirm workspace deletion')
  }
  const ac = await connectAccountCli({ url: opts.url })
  await withSpinner(
    `Deleting workspace ${target}…`,
    () => ac.deleteWorkspace(),
    opts
  )
  console.log(`deleted workspace: ${target}`)
}

export async function listMembers(g: GlobalOpts & { role?: string } = {}): Promise<void> {
  const ac = await connectAccountCli({ url: g.url })
  const members = (await withSpinner('Fetching members…', () => ac.getWorkspaceMembers(), g)) as Member[]
  let filtered = members
  if (g.role) {
    const want = g.role.toLowerCase()
    filtered = members.filter((m) => {
      const role = String(m.account?.role ?? m.role ?? '').toLowerCase()
      return role === want
    })
  }
  const cached = await findAnyCachedCreds(g.url ?? readEnv().url)
  const myEmail = cached?.email ?? null
  const rows = filtered.map((m) => {
    const mAny = m as Record<string, unknown>
    const acc = mAny.account as Record<string, unknown> | undefined
    const fullAcc = acc?.fullAccount as Record<string, unknown> | undefined
    const email = (fullAcc?.email as string | undefined) ?? (mAny.email as string | undefined) ?? null
    const fullName = (fullAcc?.name as string | undefined) ?? (mAny.name as string | undefined) ?? email
    // On selfhost with a single account, the account-client may not return
    // email/name. Fall back to the cached login email if the uuid matches.
    const uuid = (acc?.uuid as string | undefined) ?? (mAny.person as string | undefined) ?? (mAny._id as string | undefined) ?? null
    const finalEmail = email ?? (uuid != null && myEmail != null ? myEmail : null)
    return {
      name: fullName ?? finalEmail,
      role: (acc?.role as string | undefined) ?? (mAny.role as string | undefined) ?? null,
      email: finalEmail,
      uuid
    }
  })
  if (shouldJson({ json: g.json, ci: g.ci })) {
    json(rows)
    return
  }
  table(rows as unknown as Record<string, unknown>[], [
    { key: 'name', header: 'NAME', format: (r) => {
      const n = (r as { name: string | null }).name
      return n !== null ? C.emphasis(n) : C.muted('—')
    } },
    { key: 'email', header: 'EMAIL', format: (r) => {
      const e = (r as { email: string | null }).email
      return e !== null ? e : C.muted('—')
    } },
    { key: 'role', header: 'ROLE', format: (r) => {
      const role = (r as { role: string | null }).role
      if (role == null) return C.muted('—')
      return role.toLowerCase() === 'owner' ? C.yellow(role) : C.muted(role)
    } },
    { key: 'uuid', header: 'UUID', format: (r) => {
      const u = (r as { uuid: string | null }).uuid
      return u !== null ? C.id(u.slice(0, 12) + '…') : C.muted('—')
    } }
  ], { count: true })
}

export async function updateMemberRole(opts: {
  target?: string
  role?: string
  url?: string
  json?: boolean
  ci?: boolean
}): Promise<void> {
  if (!opts.target) throw new CliError(ExitCode.Validation, 'missing <account>')
  if (!opts.role) throw new CliError(ExitCode.Validation, 'missing --role (Owner|Admin|Guest|DocGuest|ReadOnlyGuest)')
  const ac = await connectAccountCli({ url: opts.url })
  await withSpinner(
    `Setting role=${opts.role} for ${opts.target}…`,
    () => ac.updateWorkspaceRole(opts.target!, opts.role!),
    opts
  )
  console.log(`updated member role: ${opts.target} → ${opts.role}`)
}

export async function workspaceInfo(g: GlobalOpts = {}): Promise<void> {
  const ac = await connectAccountCli({ url: g.url })
  const info = (await withSpinner('Fetching workspace info…', () => ac.getWorkspaceInfo(false), g)) as WorkspaceInfo
  if (shouldJson({ json: g.json, ci: g.ci })) {
    json(info)
    return
  }
  kv([
    ['Name', info.name],
    ['URL', info.url],
    ['UUID', info.uuid],
    ['Mode', info.mode ?? '—'],
    ['Region', info.region ?? '—']
  ])
}

export async function updateWorkspaceName(opts: {
  name?: string
  url?: string
  json?: boolean
  ci?: boolean
}): Promise<void> {
  if (!opts.name) throw new CliError(ExitCode.Validation, 'missing --name')
  const ac = await connectAccountCli({ url: opts.url })
  await withSpinner(
    `Renaming workspace to "${opts.name}"…`,
    () => ac.updateWorkspaceName(opts.name!),
    opts
  )
  console.log(`renamed workspace: ${opts.name}`)
}

export async function workspaceGuests(opts: {
  readOnly?: boolean
  signUp?: boolean
  url?: string
  json?: boolean
  ci?: boolean
}): Promise<void> {
  const ac = await connectAccountCli({ url: opts.url })
  if (opts.readOnly !== undefined) {
    await withSpinner(
      `Setting allowReadOnlyGuests=${opts.readOnly}…`,
      () => ac.updateAllowReadOnlyGuests(Boolean(opts.readOnly)),
      opts
    )
    console.log(`allowReadOnlyGuests=${opts.readOnly}`)
  }
  if (opts.signUp !== undefined) {
    await withSpinner(
      `Setting allowGuestSignUp=${opts.signUp}…`,
      () => ac.updateAllowGuestSignUp(Boolean(opts.signUp)),
      opts
    )
    console.log(`allowGuestSignUp=${opts.signUp}`)
  }
  if (opts.readOnly === undefined && opts.signUp === undefined) {
    throw new CliError(
      ExitCode.Validation,
      'no flags given',
      'pass --read-only true|false or --sign-up true|false to update guest settings'
    )
  }
}

export async function createAccessLink(opts: {
  role?: string
  expHours?: number
  autoJoin?: boolean
  email?: string
  url?: string
  json?: boolean
  ci?: boolean
}): Promise<void> {
  if (!opts.role) throw new CliError(ExitCode.Validation, 'missing --role (Guest|ReadOnlyGuest|DocGuest|Admin|Owner)')
  const ac = await connectAccountCli({ url: opts.url })
  const options: Record<string, unknown> = {}
  if (opts.expHours !== undefined) options.expHours = opts.expHours
  if (opts.autoJoin !== undefined) options.autoJoin = opts.autoJoin
  if (opts.email !== undefined) options.email = opts.email
  const result = await withSpinner(
    `Creating access link (role=${opts.role})…`,
    () => ac.createAccessLink(opts.role!, options),
    opts
  )
  if (shouldJson({ json: opts.json, ci: opts.ci })) {
    json(result)
  } else {
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
  }
}

export async function listRegions(g: GlobalOpts = {}): Promise<void> {
  const ac = await connectAccountCli({ url: g.url })
  const regions = await withSpinner('Fetching regions…', () => ac.getRegionInfo(), g)
  if (shouldJson({ json: g.json, ci: g.ci })) {
    json(regions)
    return
  }
  if (Array.isArray(regions)) {
    table(regions as unknown as Record<string, unknown>[], [
      { key: 'name', header: 'NAME', format: (r) => C.emphasis(String((r as { name: string }).name ?? '')) },
      { key: 'region', header: 'REGION', format: (r) => C.muted(String((r as { region: string }).region ?? '')) },
      { key: 'url', header: 'URL', format: (r) => C.id(String((r as { url: string }).url ?? '')) }
    ], { count: true, title: 'regions' })
  } else {
    console.log(JSON.stringify(regions, null, 2))
  }
}
