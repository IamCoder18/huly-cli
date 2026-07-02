import { readEnv, isNonInteractive, requireUrl } from '../auth/env.js'
import { loginAndCache, listWorkspaces, accountClient, resolveToken } from '../auth/client.js'
import { setCachedWorkspaceToken, writeActiveWorkspace, readActiveWorkspace } from '../auth/cache.js'
import { promptEmail, promptPassword, pickWorkspace } from '../auth/prompts.js'
import { withSpinner } from '../output/progress.js'
import { shouldJson } from '../output/format.js'
import { CliError, ExitCode } from '../output/errors.js'

interface LoginOpts {
  url?: string
  workspace?: string
  email?: string
  password?: string
  token?: string
  nonInteractive?: boolean
  headless?: boolean
  ci?: boolean
  json?: boolean
}

export async function loginCommand(opts: LoginOpts = {}): Promise<void> {
  const env = readEnv()
  const url = requireUrl(opts.url ?? env.url)
  const forceInteractive = !opts.headless && !opts.nonInteractive && !isNonInteractive()

  let email = opts.email ?? env.email
  let password = opts.password ?? env.password

  if (!email || !password) {
    if (opts.headless || opts.nonInteractive || isNonInteractive()) {
      throw new CliError(
        ExitCode.Validation,
        'credentials required',
        'set HULY_EMAIL and HULY_PASSWORD, pass --email/--password, or run without --headless'
      )
    }
    if (!email) email = await promptEmail(undefined, { forceInteractive })
    if (!password) password = await promptPassword({ forceInteractive })
  }

  const result = await withSpinner('Logging in…', () => loginAndCache(url, email!, password!), { ci: opts.headless })

  const workspaces = await withSpinner('Fetching workspaces…', () => listWorkspaces(url, result.token), {
    ci: opts.headless
  })

  const wantWorkspace = opts.workspace ?? env.workspace
  let chosenUrl: string | undefined = wantWorkspace
  // CLI-24: route json/CI mode decisions through shouldJson so CI=1 env
  // also triggers JSON output automatically.
  const useJson = shouldJson({ json: opts.json, ci: opts.ci })

  if (!chosenUrl) {
    if (workspaces.length === 1) {
      chosenUrl = workspaces[0].url
    } else if (!forceInteractive) {
      if (useJson) {
        console.log(JSON.stringify({ email, workspaces: workspaces.map((w) => ({ name: w.name, url: w.url, uuid: w.uuid })) }, null, 2))
        return
      }
      console.log(`logged in as ${email}`)
      console.log(`available workspaces:`)
      for (const w of workspaces) console.log(`  ${w.url}\t${w.name}\t${w.uuid}`)
      console.log(`hint: set HULY_WORKSPACE=<url> and re-run, or run \`huly login\` interactively`)
      return
    } else {
      const ws = await pickWorkspace(workspaces, { forceInteractive })
      chosenUrl = ws.url
    }
  }

  // CLI-25: match against url, uuid, and display name (any of them).
  // Throw on ambiguous name matches to avoid silently picking the wrong
  // workspace.
  const matches = workspaces.filter((w) => w.url === chosenUrl || w.uuid === chosenUrl || w.name === chosenUrl)
  let ws: typeof workspaces[number] | undefined
  if (matches.length === 1) {
    ws = matches[0]
  } else if (matches.length > 1) {
    throw new CliError(
      ExitCode.Validation,
      `workspace "${chosenUrl}" matches multiple workspaces: ${matches.map((m) => m.url).join(', ')}`,
      'pass the workspace URL instead'
    )
  } else {
    throw new CliError(
      ExitCode.NotFound,
      `workspace ${chosenUrl} not in accessible list`,
      `hint: one of ${workspaces.map((w) => w.url).join(', ')}`
    )
  }

  await writeActiveWorkspace(ws.url)

  // A5: selectWorkspace to get a workspace-scoped token; cache it correctly.
  const ac = await accountClient(url, result.token)
  try {
    const wsLogin = await ac.selectWorkspace(ws.url)
    await setCachedWorkspaceToken(url, email!, ws.url, {
      token: wsLogin.token,
      workspaceId: wsLogin.workspace ?? ws.uuid,
      role: String(wsLogin.role ?? 'OWNER'),
      endpoint: wsLogin.endpoint
    })
  } catch (err) {
    if (!useJson) {
      console.log(`warning: selectWorkspace failed: ${(err as Error).message}`)
      console.log(`hint: workspace-scoped operations may be limited`)
    }
  }

  if (useJson) {
    console.log(JSON.stringify({ email, workspace: { name: ws.name, url: ws.url, uuid: ws.uuid }, account: result.account }, null, 2))
    return
  }
  console.log(`logged in as ${email}`)
  console.log(`active workspace: ${ws.name} (${ws.url})`)
}