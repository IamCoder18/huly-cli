import { readEnv } from '../auth/env.js'
import { loginAndCache, listWorkspaces } from '../auth/client.js'
import { setCachedWorkspaceToken, writeActiveWorkspace } from '../auth/cache.js'
import { promptEmail, promptPassword, pickWorkspace } from '../auth/prompts.js'
import { withSpinner } from '../output/progress.js'
import { CliError, ExitCode } from '../output/errors.js'
import { isNonInteractive } from '../auth/env.js'

interface LoginOpts {
  headless?: boolean
}

export async function loginCommand(opts: LoginOpts = {}): Promise<void> {
  const env = readEnv()
  const url = env.url
  const forceInteractive = !opts.headless && !isNonInteractive()

  let email = env.email
  let password = env.password

  if (!email || !password) {
    if (opts.headless || isNonInteractive()) {
      throw new CliError(
        ExitCode.Validation,
        'credentials required',
        'set HULY_EMAIL and HULY_PASSWORD, or run without --headless'
      )
    }
    if (!email) email = await promptEmail(undefined, { forceInteractive })
    if (!password) password = await promptPassword({ forceInteractive })
  }

  const result = await withSpinner('Logging in…', () => loginAndCache(url, email!, password!), { ci: opts.headless })

  const workspaces = await withSpinner('Fetching workspaces…', () => listWorkspaces(url, result.token), {
    ci: opts.headless
  })

  let chosenUrl = env.workspace
  if (!chosenUrl) {
    if (!forceInteractive) {
      throw new CliError(
        ExitCode.Validation,
        'workspace required',
        'set HULY_WORKSPACE or run without --headless / non-interactive'
      )
    }
    const ws = await pickWorkspace(workspaces, { forceInteractive })
    chosenUrl = ws.url
  }

  const ws = workspaces.find((w) => w.url === chosenUrl)
  if (!ws) {
    throw new CliError(
      ExitCode.NotFound,
      `workspace ${chosenUrl} not in accessible list`,
      `hint: one of ${workspaces.map((w) => w.url).join(', ')}`
    )
  }

  await writeActiveWorkspace(ws.url)
  await setCachedWorkspaceToken(url, email!, ws.url, {
    token: result.token,
    workspaceId: ws.uuid,
    role: 'owner'
  })

  console.log(`logged in as ${email}`)
  console.log(`active workspace: ${ws.name} (${ws.url})`)
}