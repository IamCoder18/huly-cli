import { readEnv, isNonInteractive, requireUrl } from '../auth/env.js'
import { signUpAndCache, createWorkspace } from '../auth/client.js'
import { writeActiveWorkspace } from '../auth/cache.js'
import { promptEmail, promptPassword, promptText, promptConfirm } from '../auth/prompts.js'
import { withSpinner } from '../output/progress.js'
import { shouldJson } from '../output/format.js'
import { CliError, ExitCode } from '../output/errors.js'

interface SignupOpts {
  url?: string
  email?: string
  password?: string
  firstName?: string
  lastName?: string
  workspace?: string
  nonInteractive?: boolean
  headless?: boolean
  ci?: boolean
  json?: boolean
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'workspace'
}

export async function signupCommand(opts: SignupOpts = {}): Promise<void> {
  const env = readEnv()
  const url = requireUrl(opts.url ?? env.url)
  const forceInteractive = !opts.headless && !opts.nonInteractive && !isNonInteractive()

  let email = opts.email ?? env.email
  let password = opts.password ?? env.password
  let firstName = opts.firstName ?? env.firstName
  let lastName = opts.lastName ?? env.lastName

  if (!email || !password || !firstName || !lastName) {
    if (opts.headless || opts.nonInteractive || isNonInteractive()) {
      const missing: string[] = []
      if (!email) missing.push('--email / HULY_EMAIL')
      if (!password) missing.push('--password / HULY_PASSWORD')
      if (!firstName) missing.push('--first / HULY_FIRST_NAME')
      if (!lastName) missing.push('--last / HULY_LAST_NAME')
      throw new CliError(
        ExitCode.Validation,
        'signup requires all of: ' + missing.join(', '),
        'run without --headless to be prompted, or set the env vars'
      )
    }
    if (!email) email = await promptEmail(undefined, { forceInteractive })
    if (!password) password = await promptPassword({ forceInteractive })
    if (!firstName) firstName = await promptText('First name', { forceInteractive })
    if (!lastName) lastName = await promptText('Last name', { forceInteractive })
  }

  if (!email.includes('@')) {
    throw new CliError(ExitCode.Validation, `invalid email: ${email}`)
  }

  const result = await withSpinner(
    `Signing up ${email}…`,
    () => signUpAndCache(url, email!, password!, firstName!, lastName!),
    { ci: opts.headless }
  )

  // After signup, the new account has zero workspaces. In headless mode
  // create a workspace only if --workspace was passed; otherwise, prompt
  // the user interactively.
  let workspaceName: string | undefined
  if (opts.workspace) {
    workspaceName = opts.workspace
  } else if (!opts.headless && !opts.nonInteractive && !isNonInteractive()) {
    const want = await promptConfirm('Create a new workspace now?', { forceInteractive, default: true })
    if (want) {
      const defaultName = slugify(`${firstName}-ws`)
      workspaceName = await promptText('Workspace name (URL slug)', { forceInteractive }) || defaultName
    }
  }

  let createdWorkspace: { name: string; uuid: string } | undefined
  if (workspaceName) {
    const ws = await withSpinner(
      `Creating workspace ${workspaceName}…`,
      () => createWorkspace(url, result.token, email!, workspaceName!),
      { ci: opts.headless }
    )
    await writeActiveWorkspace(workspaceName)
    createdWorkspace = { name: workspaceName, uuid: ws.workspaceId }
  }

  if (shouldJson({ json: opts.json, ci: opts.ci })) {
    console.log(JSON.stringify({
      email,
      account: result.account,
      name: `${firstName} ${lastName}`,
      workspace: createdWorkspace ?? null
    }, null, 2))
    return
  }
  console.log(`signed up as ${email}`)
  console.log(`account: ${result.account}`)
  if (createdWorkspace) {
    console.log(`workspace: ${createdWorkspace.name} (${createdWorkspace.uuid})`)
    console.log(`active workspace: ${createdWorkspace.name}`)
    console.log(`next: \`huly project list\` to see the bootstrap projects`)
  } else {
    console.log(`next:`)
    console.log(`  - \`huly workspace create --name <name> --yes\` to create one`)
    console.log(`  - or accept an invite, then \`huly login\` to fetch it`)
  }
}
