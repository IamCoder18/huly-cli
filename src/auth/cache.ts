import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { activeAccountPath, activeWorkspacePath, configDir, credentialsPath } from './env.js'

export interface WorkspaceCreds {
  token: string
  role?: string
  endpoint?: string
  workspaceId?: string
}

export interface HostCreds {
  [email: string]: {
    accountToken: string
    workspaces: Record<string, WorkspaceCreds>
  }
}

export interface CredentialsFile {
  [host: string]: HostCreds
}

export async function loadCredentials(): Promise<CredentialsFile> {
  try {
    const raw = await fs.readFile(credentialsPath(), 'utf8')
    return JSON.parse(raw) as CredentialsFile
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

export async function saveCredentials(creds: CredentialsFile): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(credentialsPath(), JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export async function getCachedCreds(
  host: string,
  email: string
): Promise<HostCreds[string] | undefined> {
  const all = await loadCredentials()
  return all[host]?.[email]
}

export async function setCachedCreds(
  host: string,
  email: string,
  data: HostCreds[string]
): Promise<void> {
  const all = await loadCredentials()
  all[host] = all[host] ?? {}
  all[host][email] = data
  await saveCredentials(all)
}

export async function setCachedWorkspaceToken(
  host: string,
  email: string,
  workspaceKey: string,
  data: WorkspaceCreds
): Promise<void> {
  const all = await loadCredentials()
  if (!all[host]?.[email]) return
  all[host][email].workspaces[workspaceKey] = data
  await saveCredentials(all)
}

export async function readActiveWorkspace(): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(activeWorkspacePath(), 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

export async function writeActiveWorkspace(name: string): Promise<void> {
  await fs.mkdir(dirname(activeWorkspacePath()), { recursive: true })
  await fs.writeFile(activeWorkspacePath(), name + '\n', { mode: 0o600 })
}

export async function readActiveAccount(host: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(activeAccountPath(), 'utf8')
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    const entry = lines.find((l) => l.startsWith(host + '|'))
    return entry ? entry.slice(host.length + 1) : undefined
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

export async function writeActiveAccount(host: string, email: string): Promise<void> {
  await fs.mkdir(dirname(activeAccountPath()), { recursive: true })
  let lines: string[] = []
  try {
    const raw = await fs.readFile(activeAccountPath(), 'utf8')
    lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const entry = `${host}|${email}`
  const filtered = lines.filter((l) => !l.startsWith(host + '|'))
  filtered.push(entry)
  await fs.writeFile(activeAccountPath(), filtered.join('\n') + '\n', { mode: 0o600 })
}

export async function findAnyCachedCreds(host: string): Promise<{ email: string; data: HostCreds[string] } | undefined> {
  const all = await loadCredentials()
  const hostCreds = all[host]
  if (!hostCreds) return undefined
  const active = await readActiveAccount(host)
  const emails = Object.keys(hostCreds)
  if (active && hostCreds[active]) return { email: active, data: hostCreds[active] }
  if (emails.length === 0) return undefined
  return { email: emails[0], data: hostCreds[emails[0]] }
}

export async function findAnyCachedToken(host: string): Promise<{ email: string; token: string } | undefined> {
  const found = await findAnyCachedCreds(host)
  return found ? { email: found.email, token: found.data.accountToken } : undefined
}