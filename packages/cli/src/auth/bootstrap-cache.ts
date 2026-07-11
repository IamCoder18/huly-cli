import { promises as fs } from 'node:fs'
import { configDir } from './env.js'
import { normalizeHost } from './cache.js'

/**
 * On-disk marker that records which `(host, workspace, accountUuid)` triples
 * have already been bootstrapped into a workspace's local identity graph
 * (Person + SocialIdentity collection + Employee mixin). Mirrors the layout
 * of `credentials.json` (host -> nested -> nested) so it sits naturally
 * next to it in `$XDG_CONFIG_HOME/huly/`.
 *
 * A present entry means "bootstrap transactions were issued successfully on
 * some prior run"; it is NOT a guarantee that the workspace still has the
 * state (workspace DBs can be wiped independently). For self-hosted recovery
 * the file can be deleted to force a re-bootstrap.
 */
export interface BootstrapFile {
  [host: string]: {
    [workspace: string]: {
      [accountUuid: string]: { at: number }
    }
  }
}

export function bootstrapPath(): string {
  return `${configDir()}/bootstrap.json`
}

export async function loadBootstrap(): Promise<BootstrapFile> {
  try {
    const raw = await fs.readFile(bootstrapPath(), 'utf8')
    return JSON.parse(raw) as BootstrapFile
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

export async function saveBootstrap(file: BootstrapFile): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(bootstrapPath(), JSON.stringify(file, null, 2), { mode: 0o600 })
  await fs.chmod(bootstrapPath(), 0o600).catch(() => { /* not all platforms support chmod */ })
}

export async function isBootstrapped(
  host: string,
  workspace: string,
  accountUuid: string
): Promise<boolean> {
  if (!host || !workspace || !accountUuid) return false
  const file = await loadBootstrap()
  return Boolean(file[normalizeHost(host)]?.[workspace]?.[accountUuid])
}

export async function markBootstrapped(
  host: string,
  workspace: string,
  accountUuid: string
): Promise<void> {
  if (!host || !workspace || !accountUuid) return
  const file = await loadBootstrap()
  const key = normalizeHost(host)
  file[key] = file[key] ?? {}
  file[key][workspace] = file[key][workspace] ?? {}
  file[key][workspace][accountUuid] = { at: Date.now() }
  await saveBootstrap(file)
}

export async function clearBootstrap(
  host: string,
  workspace: string,
  accountUuid: string
): Promise<void> {
  const file = await loadBootstrap()
  const key = normalizeHost(host)
  if (file[key]?.[workspace]?.[accountUuid]) {
    delete file[key][workspace][accountUuid]
    await saveBootstrap(file)
  }
}