export interface HulyEnv {
  url: string
  email?: string
  password?: string
  token?: string
  workspace?: string
  project?: string
  teamspace?: string
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): HulyEnv {
  return {
    url: env.HULY_URL ?? 'https://huly.aaravlabs.com',
    email: env.HULY_EMAIL,
    password: env.HULY_PASSWORD,
    token: env.HULY_TOKEN,
    workspace: env.HULY_WORKSPACE,
    project: env.HULY_PROJECT,
    teamspace: env.HULY_TEAMSPACE
  }
}

export function isNonInteractive(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.HULY_NONINTERACTIVE === '1') return true
  if (env.CI) return true
  if (process.env.__HULY_NONINTERACTIVE === '1') return true
  return false
}

export function markNonInteractive(): void {
  process.env.HULY_NONINTERACTIVE = '1'
  process.env.__HULY_NONINTERACTIVE = '1'
}

export function insecureTLS(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HULY_INSECURE_TLS === '1'
}

export function isHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.HULY_URL) return false
  return env.HULY_URL.startsWith('http://')
}

export function activeAccountPath(): string {
  return `${configDir()}/active-account`
}

export function noColor(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NO_COLOR != null && env.NO_COLOR !== ''
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const home = process.env.HOME ?? '~'
  return `${xdg ?? `${home}/.config`}/huly`
}

export function credentialsPath(): string {
  return `${configDir()}/credentials.json`
}

export function activeWorkspacePath(): string {
  return `${configDir()}/active-workspace`
}