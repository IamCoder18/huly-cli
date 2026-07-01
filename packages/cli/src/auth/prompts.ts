import inquirer from 'inquirer'
import type { WorkspaceInfoWithStatus } from '@hcengineering/account-client'
import { isNonInteractive } from './env.js'
import { CliError, ExitCode } from '../output/errors.js'

export interface PromptOpts {
  forceInteractive?: boolean
}

export async function promptEmail(defaultEmail?: string, opts: PromptOpts = {}): Promise<string> {
  if (!opts.forceInteractive && isNonInteractive()) {
    throw new CliError(ExitCode.Validation, 'no email', 'set HULY_EMAIL or run interactively')
  }
  const { email } = await inquirer.prompt<{ email: string }>([
    {
      type: 'input',
      name: 'email',
      message: 'Email:',
      default: defaultEmail,
      validate: (v) => (v.includes('@') ? true : 'enter a valid email')
    }
  ])
  return email
}

export async function promptPassword(opts: PromptOpts = {}): Promise<string> {
  if (!opts.forceInteractive && isNonInteractive()) {
    throw new CliError(ExitCode.Validation, 'no password', 'set HULY_PASSWORD or run interactively')
  }
  const { password } = await inquirer.prompt<{ password: string }>([
    { type: 'password', name: 'password', message: 'Password:', mask: '*' }
  ])
  return password
}

export async function promptText(label: string, opts: PromptOpts = {}): Promise<string> {
  if (!opts.forceInteractive && isNonInteractive()) {
    throw new CliError(ExitCode.Validation, `no ${label.toLowerCase()}`, `set the env var or run interactively`)
  }
  const { value } = await inquirer.prompt<{ value: string }>([
    { type: 'input', name: 'value', message: `${label}:`, validate: (v) => (v.trim().length > 0 ? true : 'required') }
  ])
  return value.trim()
}

export async function promptConfirm(message: string, opts: PromptOpts & { default?: boolean } = {}): Promise<boolean> {
  if (!opts.forceInteractive && isNonInteractive()) {
    throw new CliError(ExitCode.Validation, 'no confirm answer', 'run interactively or pass an explicit flag')
  }
  const { value } = await inquirer.prompt<{ value: boolean }>([
    { type: 'confirm', name: 'value', message, default: opts.default ?? false }
  ])
  return value
}

export async function pickWorkspace(
  workspaces: WorkspaceInfoWithStatus[],
  opts: PromptOpts = {}
): Promise<WorkspaceInfoWithStatus> {
  if (!opts.forceInteractive && isNonInteractive()) {
    throw new CliError(
      ExitCode.Validation,
      'no workspace selected',
      'set HULY_WORKSPACE or run interactively'
    )
  }
  if (workspaces.length === 0) {
    throw new CliError(ExitCode.NotFound, 'no workspaces accessible for this account')
  }
  const { workspace } = await inquirer.prompt<{ workspace: WorkspaceInfoWithStatus }>([
    {
      type: 'list',
      name: 'workspace',
      message: 'Workspace:',
      choices: workspaces.map((w) => ({
        name: `${w.name} (${w.url}) [${w.mode}]`,
        value: w
      }))
    }
  ])
  return workspace
}

export async function pickProject<T extends { _id: string; name?: string; identifier?: string; label?: string }>(
  projects: T[],
  message = 'Project:',
  opts: PromptOpts = {}
): Promise<T> {
  if (!opts.forceInteractive && isNonInteractive()) {
    throw new CliError(
      ExitCode.Validation,
      'no project selected',
      'pass --project, set HULY_PROJECT, or run interactively'
    )
  }
  if (projects.length === 0) {
    throw new CliError(ExitCode.NotFound, 'no projects found in this workspace')
  }
  const { project } = await inquirer.prompt<{ project: T }>([
    {
      type: 'list',
      name: 'project',
      message,
      choices: projects.map((p) => ({
        name: p.label ?? p.name ?? p.identifier ?? p._id,
        value: p as T
      }))
    }
  ])
  return project
}