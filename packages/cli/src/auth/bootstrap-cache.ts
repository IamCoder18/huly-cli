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

// Latch so a corrupt bootstrap.json emits a single warning per process,
// not one per CLI invocation. Reset on a successful save.
let corruptWarningEmitted = false

export async function loadBootstrap(): Promise<BootstrapFile> {
  let raw: string
  try {
    raw = await fs.readFile(bootstrapPath(), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  try {
    return JSON.parse(raw) as BootstrapFile
  } catch (err) {
    // A truncated or otherwise corrupt file (interrupted write, manual
    // edit, disk full) must NOT disable bootstrap forever — fall back
    // to an empty marker so the next connect can repair it via a fresh
    // save. Quarantine the bad copy for post-mortem.
    if (!corruptWarningEmitted) {
      corruptWarningEmitted = true
      // eslint-disable-next-line no-console
      console.warn(
        `[huly] bootstrap.json is corrupt (${(err as Error).message}); ` +
          'quarantining and treating as empty. Bootstrap will run again on the next connect.'
      )
      try {
        await fs.rename(bootstrapPath(), `${bootstrapPath()}.corrupt.${Date.now()}.bak`)
      } catch {
        /* best effort */
      }
    }
    return {}
  }
}

export async function saveBootstrap(file: BootstrapFile): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  // Atomic write: write to a temp file in the same directory, apply
  // permissions, then rename. Avoids leaving a half-written bootstrap.json
  // if the process is killed mid-write, and avoids concurrent-process
  // races where two saves stomp each other.
  const tmpPath = `${bootstrapPath()}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(file, null, 2), { mode: 0o600 })
  await fs.chmod(tmpPath, 0o600).catch(() => { /* not all platforms support chmod */ })
  await fs.rename(tmpPath, bootstrapPath())
  corruptWarningEmitted = false
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