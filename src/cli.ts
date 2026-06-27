#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { handleError } from './output/errors.js'
import { isNonInteractive, markNonInteractive } from './auth/env.js'
import { loginCommand } from './commands/login.js'
import { whoamiCommand } from './commands/whoami.js'
import { listWorkspaces, currentWorkspace, useWorkspace, createWorkspace, deleteWorkspace, listMembers, updateMemberRole, workspaceInfo, updateWorkspaceName, workspaceGuests, createAccessLink, listRegions } from './resources/workspace.js'
import { getUser, updateUser, findUser } from './resources/user.js'
import {
  listProjects, getProject, createProject, updateProject, deleteProjects,
  listStatuses, listTargetPreferences, upsertTargetPreference
} from './resources/project.js'
import {
  listIssues, getIssue, createIssue, updateIssue, deleteIssues,
  addIssueLabel, removeIssueLabel,
  addIssueRelation, removeIssueRelation, listIssueRelations,
  linkDocument, unlinkDocument, moveIssue, previewDelete,
  relatedTargets, setRelatedTarget
} from './resources/issue.js'
import {
  listComponents, getComponent, createComponent, updateComponent, deleteComponents
} from './resources/component.js'
import {
  listMilestones, getMilestone, createMilestone, updateMilestone, deleteMilestones
} from './resources/milestone.js'
import {
  listIssueTemplates, getIssueTemplate, createIssueTemplate, updateIssueTemplate, deleteIssueTemplates,
  addTemplateChild, removeTemplateChild
} from './resources/issue-template.js'
import {
  listCards, getCard, createCard, deleteCards,
  listActions, createAction, deleteActions,
  listDocuments, createDocument, deleteDocuments,
  listEvents, createEvent, deleteEvents
} from './resources/misc.js'
import { apiCommand } from './raw/api.js'
import { wsCommand } from './raw/ws.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

export interface GlobalOpts {
  url?: string
  workspace?: string
  json?: boolean
  ci?: boolean
  markdown?: boolean
  dryRun?: boolean
  minimal?: boolean
  yes?: boolean
  nonInteractive?: boolean
  headless?: boolean
}

export function globalsFrom(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts
}

function attachGlobalOpts(cmd: Command): Command {
  return cmd
    .option('--url <url>', 'Huly server URL')
    .option('--workspace <name>', 'workspace URL name or UUID')
    .option('--json', 'output JSON')
    .option('--ci', 'CI mode (JSON output)')
    .option('--markdown', 'output body as markdown')
    .option('--dry-run', 'print intended tx, do not apply')
    .option('--minimal', 'minimal payload (no smart defaults)')
    .option('-y, --yes', 'skip confirmation prompts')
    .option('--non-interactive', 'disable interactive prompts')
}

function attachToChildren(cmd: Command): void {
  for (const child of cmd.commands) {
    attachGlobalOpts(child)
    attachToChildren(child)
  }
}

const GLOBAL_OPTS_HELP = `
Global options (also available on parent commands):
  --url <url>           Huly server URL
  --workspace <name>    workspace URL name or UUID
  --json / --ci         output JSON
  --markdown            output body as markdown
  --dry-run             print intended tx, do not apply
  --minimal             minimal payload (no smart defaults)
  -y, --yes             skip confirmation prompts
  --non-interactive     disable interactive prompts
`

function withGlobalHelp(cmd: Command): Command {
  cmd.addHelpText('after', GLOBAL_OPTS_HELP)
  return cmd
}

function preAction(cmd: Command): void {
  const opts = cmd.optsWithGlobals() as GlobalOpts
  if (opts.nonInteractive || opts.headless || opts.ci || isNonInteractive()) {
    markNonInteractive()
  }
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = new Command()
  program
    .name('huly')
    .description('AI-agent-first CLI for self-hosted Huly')
    .version(pkg.version)
    .option('--non-interactive', 'disable interactive prompts')
    .hook('preAction', (thisCmd) => preAction(thisCmd as Command))

  program
    .command('login')
    .description('Log in and cache credentials')
    .option('--headless', 'use env vars only, no prompts')
    .action(async (opts, cmd) => {
      try {
        const g = globalsFrom(cmd)
        await loginCommand({ headless: opts.headless ?? g.headless ?? g.nonInteractive })
      } catch (e) { handleError(e) }
    })

  program
    .command('whoami')
    .description('Show current account and workspace')
    .action(async (_opts, cmd) => {
      try { await whoamiCommand({ json: cmd.optsWithGlobals()?.json }) } catch (e) { handleError(e) }
    })

  const ws = program.command('workspace').description('Manage workspaces'); withGlobalHelp(ws)
  ws.command('list').description('List accessible workspaces').action(async (_o, cmd) => {
    try { await listWorkspaces(globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  ws.command('current').description('Show current workspace').action(async (_o, cmd) => {
    try { await currentWorkspace(globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  ws.command('use <name>').description('Set active workspace').action(async (name, _o, cmd) => {
    try { await useWorkspace(name, globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  ws.command('create').description('Create a new workspace (requires --yes)')
    .requiredOption('--name <name>')
    .option('--region <region>')
    .action(async (opts, cmd) => {
      try { await createWorkspace({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('delete').description('Delete the current workspace (DESTRUCTIVE; requires --yes)')
    .action(async (opts, cmd) => {
      try { await deleteWorkspace({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('members').description('List workspace members')
    .option('--role <r>', 'filter by role (Owner|Admin|Guest|ReadOnlyGuest|DocGuest)')
    .action(async (opts, cmd) => {
      try { await listMembers({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('member <account>').description('Update a member\'s role (account uuid or email)')
    .requiredOption('--role <r>', 'Owner|Admin|Guest|ReadOnlyGuest|DocGuest')
    .action(async (account, opts, cmd) => {
      try { await updateMemberRole({ ...opts, target: account, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('info').description('Show current workspace info (name, uuid, region, mode)')
    .action(async (_o, cmd) => {
      try { await workspaceInfo(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  ws.command('rename').description('Rename current workspace')
    .requiredOption('--name <name>')
    .action(async (opts, cmd) => {
      try { await updateWorkspaceName({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('guests').description('Update guest settings (--read-only and/or --sign-up, true|false)')
    .option('--read-only <bool>')
    .option('--sign-up <bool>')
    .action(async (opts, cmd) => {
      try {
        const readOnly = opts.readOnly === undefined ? undefined : opts.readOnly !== 'false' && opts.readOnly !== '0'
        const signUp = opts.signUp === undefined ? undefined : opts.signUp !== 'false' && opts.signUp !== '0'
        await workspaceGuests({ ...globalsFrom(cmd), readOnly, signUp })
      } catch (e) { handleError(e) }
    })
  ws.command('access-link').description('Create an access link (signup invite) for a role')
    .requiredOption('--role <r>', 'Guest|ReadOnlyGuest|DocGuest|Admin|Owner')
    .option('--exp-hours <n>', 'expiration in hours', (v) => parseInt(v, 10))
    .option('--auto-join')
    .option('--email <email>')
    .action(async (opts, cmd) => {
      try { await createAccessLink({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('regions').description('List available regions')
    .action(async (_o, cmd) => {
      try { await listRegions(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })

  const user = program.command('user').description('Manage user profile')
  user.command('get').description('Show the current user profile (or `--ref <id>`)')
    .option('--ref <id>')
    .action(async (opts, cmd) => {
      try { await getUser({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  user.command('update').description('Update current user profile')
    .option('--name <name>')
    .option('--bio <text>')
    .option('--city <city>')
    .option('--country <country>')
    .action(async (opts, cmd) => {
      try { await updateUser({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  user.command('find <email>').description('Look up a user by email (requires server permission)')
    .action(async (email, _o, cmd) => {
      try { await findUser(email, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })

  const project = program.command('project').description('Manage tracker projects'); withGlobalHelp(project)
  project.command('list').description('List projects').option('--limit <n>', 'limit', (v) => parseInt(v, 10)).option('--offset <n>', 'offset', (v) => parseInt(v, 10)).action(async (opts, cmd) => {
    try { await listProjects({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  project.command('get <ref>').description('Get a project').action(async (ref, opts, cmd) => {
    try { await getProject(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  project
    .command('create')
    .description('Create a project')
    .requiredOption('--name <name>')
    .requiredOption('--identifier <id>')
    .option('--description <text>')
    .option('--private')
    .action(async (opts, cmd) => {
      try { await createProject({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  project
    .command('update <ref>')
    .description('Update a project')
    .option('--set <kv...>', 'set key=value (repeatable)')
    .option('--unset <key...>', 'unset key (repeatable)')
    .action(async (ref, opts, cmd) => {
      try { await updateProject(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  project.command('delete <ref...>').description('Delete projects').action(async (refs, opts, cmd) => {
    try { await deleteProjects(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  project.command('statuses').description('List issue statuses for a project (defaults to $HULY_PROJECT)')
    .option('--project <ref>')
    .action(async (opts, cmd) => {
      try { await listStatuses({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  project.command('target-preferences').description('List project target preferences (alias for `target-preference list`)')
    .option('--project <ref>')
    .action(async (opts, cmd) => {
      try { await listTargetPreferences({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  const tgtPref = project.command('target-preference').description('Manage project target preferences')
  tgtPref.command('list').description('List project target preferences')
    .option('--project <ref>')
    .action(async (opts, cmd) => {
      try { await listTargetPreferences({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  tgtPref.command('upsert').description('Create or merge a project target preference')
    .option('--project <ref>')
    .option('--props <kv...>', 'key=value (repeatable)')
    .action(async (opts, cmd) => {
      try { await upsertTargetPreference({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const issue = program.command('issue').description('Manage tracker issues'); withGlobalHelp(issue)
  issue
    .command('list')
    .description('List issues')
    .option('--project <id>')
    .option('--status <name>')
    .option('--status-category <c>', 'UnStarted|ToDo|Active|Won|Lost')
    .option('--description-search <q>')
    .option('--parent <ref|null>', 'filter by parent ref (literal "null" for top-level)')
    .option('--assignee <email>')
    .option('--label <l...>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .option('--offset <n>', 'offset', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listIssues({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue
    .command('get <ref>')
    .description('Get an issue')
    .action(async (ref, opts, cmd) => {
      try { await getIssue(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue
    .command('create')
    .description('Create an issue')
    .option('--project <id>')
    .requiredOption('--title <t>')
    .option('--description <text>')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--status <name>')
    .option('--priority <p>')
    .option('--assignee <email>')
    .option('--label <l...>')
    .option('--due <iso>')
    .option('--parent <ref>')
    .option('--task-type <name|id>')
    .action(async (opts, cmd) => {
      try { await createIssue({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue
    .command('update <ref>')
    .description('Update an issue')
    .option('--set <kv...>')
    .option('--unset <key...>')
    .option('--status <name>')
    .option('--priority <p>')
    .option('--assignee <email>')
    .option('--title <t>')
    .option('--task-type <name|id>')
    .action(async (ref, opts, cmd) => {
      try { await updateIssue(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue.command('delete <ref...>').description('Delete issues').action(async (refs, opts, cmd) => {
    try { await deleteIssues(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  const issueLabel = issue.command('label <ref>').description('Manage labels on an issue')
  issueLabel.command('add <ref>').description('Add a label to an issue').action(async (ref, _opts, cmd) => {
    const o = cmd.optsWithGlobals() as { label?: string }
    if (!o.label) {
      console.error('error: missing --label')
      process.exit(2)
    }
    try { await addIssueLabel(ref, o.label, globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  issueLabel.command('remove <ref>').description('Remove a label from an issue').action(async (ref, _opts, cmd) => {
    const o = cmd.optsWithGlobals() as { label?: string }
    if (!o.label) {
      console.error('error: missing --label')
      process.exit(2)
    }
    try { await removeIssueLabel(ref, o.label, globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  issueLabel.option('--label <name>', 'label name (required for add/remove)')
  issueLabel.hook('preAction', (thisCmd) => {
    const o = thisCmd.opts() as Record<string, unknown>
    const parent = thisCmd.parent
    if (parent) Object.assign(o, parent.opts())
  })
  const issueRel = issue.command('relation').description('Manage relations on an issue')
  issueRel.command('add <ref>').description('Add a relation')
    .requiredOption('--type <t>', 'blocks|isBlockedBy|relatesTo')
    .requiredOption('--target <ref>')
    .action(async (ref, opts, cmd) => {
      try { await addIssueRelation(ref, opts.type as 'blocks' | 'isBlockedBy' | 'relatesTo', opts.target, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  issueRel.command('remove <ref>').description('Remove a relation')
    .requiredOption('--type <t>', 'blocks|isBlockedBy|relatesTo')
    .requiredOption('--target <ref>')
    .action(async (ref, opts, cmd) => {
      try { await removeIssueRelation(ref, opts.type as 'blocks' | 'isBlockedBy' | 'relatesTo', opts.target, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  issueRel.command('list <ref>').description('List relations on an issue')
    .action(async (ref, _opts, cmd) => {
      try { await listIssueRelations(ref, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  issue.command('link-document <ref>').description('Link a document to an issue')
    .requiredOption('--document <ref>')
    .action(async (ref, opts, cmd) => {
      try { await linkDocument(ref, opts.document, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  issue.command('unlink-document <ref>').description('Unlink a document from an issue')
    .requiredOption('--document <ref>')
    .action(async (ref, opts, cmd) => {
      try { await unlinkDocument(ref, opts.document, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  issue.command('move <ref>').description('Move an issue (set/drop parent)')
    .option('--parent <ref|null>', 'new parent ref, or literal "null" to drop')
    .action(async (ref, opts, cmd) => {
      try { await moveIssue(ref, opts.parent ?? null, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  issue.command('preview-delete <ref...>').description('Preview the impact of deleting issues')
    .action(async (refs, _opts, cmd) => {
      try { await previewDelete(refs, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  issue.command('related-targets').description('List related-issue-targets for a project')
    .option('--project <ref>')
    .action(async (opts, cmd) => {
      try { await relatedTargets('', { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue.command('related-target set').description('Create a related-issue-target for a project')
    .option('--project <ref>')
    .requiredOption('--source <name>')
    .requiredOption('--target <name>')
    .action(async (opts, cmd) => {
      try { await setRelatedTarget({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const component = program.command('component').description('Manage tracker components'); withGlobalHelp(component)
  component.command('list').description('List components')
    .option('--project <ref>')
    .action(async (opts, cmd) => {
      try { await listComponents({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  component.command('get <ref>').description('Get a component').action(async (ref, opts, cmd) => {
    try { await getComponent(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  component.command('create').description('Create a component')
    .option('--project <ref>')
    .requiredOption('--label <name>')
    .option('--description <text>')
    .action(async (opts, cmd) => {
      try { await createComponent({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  component.command('update <ref>').description('Update a component')
    .option('--label <name>')
    .option('--description <text>')
    .action(async (ref, opts, cmd) => {
      try { await updateComponent(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  component.command('delete <ref...>').description('Delete components').action(async (refs, opts, cmd) => {
    try { await deleteComponents(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const milestone = program.command('milestone').description('Manage tracker milestones'); withGlobalHelp(milestone)
  milestone.command('list').description('List milestones')
    .option('--project <ref>')
    .action(async (opts, cmd) => {
      try { await listMilestones({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  milestone.command('get <ref>').description('Get a milestone').action(async (ref, opts, cmd) => {
    try { await getMilestone(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  milestone.command('create').description('Create a milestone')
    .option('--project <ref>')
    .requiredOption('--label <name>')
    .option('--description <text>')
    .option('--target-date <iso>')
    .action(async (opts, cmd) => {
      try { await createMilestone({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  milestone.command('update <ref>').description('Update a milestone')
    .option('--label <name>')
    .option('--description <text>')
    .option('--target-date <iso>')
    .option('--status <s>')
    .action(async (ref, opts, cmd) => {
      try { await updateMilestone(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  milestone.command('delete <ref...>').description('Delete milestones').action(async (refs, opts, cmd) => {
    try { await deleteMilestones(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const tmpl = program.command('issue-template').description('Manage issue templates'); withGlobalHelp(tmpl)
  tmpl.command('list').description('List templates')
    .option('--project <ref>')
    .action(async (opts, cmd) => {
      try { await listIssueTemplates({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  tmpl.command('get <ref>').description('Get a template')
    .action(async (ref, opts, cmd) => {
      try { await getIssueTemplate(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  tmpl.command('create').description('Create a template')
    .option('--project <ref>')
    .requiredOption('--title <t>')
    .option('--description <text>')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (opts, cmd) => {
      try { await createIssueTemplate({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  tmpl.command('update <ref>').description('Update a template')
    .option('--title <t>')
    .option('--description <text>')
    .option('--body <md>')
    .action(async (ref, opts, cmd) => {
      try { await updateIssueTemplate(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  tmpl.command('delete <ref...>').description('Delete templates').action(async (refs, opts, cmd) => {
    try { await deleteIssueTemplates(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  tmpl.command('add-child <template>').description('Add a child reference to a template')
    .requiredOption('--child <ref>')
    .action(async (template, opts, cmd) => {
      try { await addTemplateChild(template, opts.child, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  tmpl.command('remove-child <template>').description('Remove a child reference from a template')
    .requiredOption('--child <ref>')
    .action(async (template, opts, cmd) => {
      try { await removeTemplateChild(template, opts.child, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })

  const card = program.command('card').description('Manage board cards'); withGlobalHelp(card)
  card.command('list').description('List cards').option('--space <id>').option('--limit <n>', 'limit', (v) => parseInt(v, 10)).action(async (opts, cmd) => {
    try { await listCards({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  card.command('get <ref>').description('Get a card').action(async (ref, opts, cmd) => {
    try { await getCard(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  card
    .command('create')
    .description('Create a card')
    .option('--space <id>')
    .requiredOption('--title <t>')
    .option('--description <text>')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--rank <r>')
    .action(async (opts, cmd) => {
      try { await createCard({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  card.command('delete <ref...>').description('Delete cards').action(async (refs, opts, cmd) => {
    try { await deleteCards(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const action = program.command('action').description('Manage tasks (top-level todo)'); withGlobalHelp(action)
  action
    .command('list')
    .description('List tasks')
    .option('--assignee <email>')
    .option('--status <s>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listActions({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action
    .command('create')
    .description('Create a task')
    .requiredOption('--title <t>')
    .option('--description <text>')
    .option('--due <iso>')
    .option('--assignee <email>')
    .action(async (opts, cmd) => {
      try { await createAction({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action.command('delete <ref...>').description('Delete tasks').action(async (refs, opts, cmd) => {
    try { await deleteActions(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const doc = program.command('document').description('Manage documents'); withGlobalHelp(doc)
  doc.command('list').description('List documents').option('--limit <n>', 'limit', (v) => parseInt(v, 10)).action(async (opts, cmd) => {
    try { await listDocuments({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  doc
    .command('create')
    .description('Create a document')
    .requiredOption('--title <t>')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--parent <id>')
    .action(async (opts, cmd) => {
      try { await createDocument({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  doc.command('delete <ref...>').description('Delete documents').action(async (refs, opts, cmd) => {
    try { await deleteDocuments(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const cal = program.command('calendar').description('Manage calendar events'); withGlobalHelp(cal)
  cal
    .command('list')
    .description('List events')
    .option('--start <iso>')
    .option('--end <iso>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listEvents({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal
    .command('create')
    .description('Create an event')
    .requiredOption('--title <t>')
    .requiredOption('--start <iso>')
    .requiredOption('--end <iso>')
    .option('--attendee <email>')
    .option('--location <text>')
    .option('--all-day')
    .option('--description <text>')
    .option('--body <md>')
    .action(async (opts, cmd) => {
      try { await createEvent({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal.command('delete <ref...>').description('Delete events').action(async (refs, opts, cmd) => {
    try { await deleteEvents(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const raw = program.command('api').description('Raw HTTP escape hatch')
  raw
    .argument('<method>', 'HTTP method')
    .argument('<path>', 'URL path (e.g. /_accounts, /_transactor/...)')
    .option('--body <json>', 'request body')
    .option('--query <kv...>', 'query params k=v')
    .option('--header <kv...>', 'headers k=v')
    .action(async (method, path, opts) => {
      try { await apiCommand(method, path, opts) } catch (e) { handleError(e) }
    })

  const wsCmd = program.command('ws').description('Raw WebSocket escape hatch')
    wsCmd
    .argument('<method>', 'RPC method (e.g. findAll, tx)')
    .argument('[params]', 'JSON-encoded params')
    .option('--binary')
    .option('--no-ping', 'disable ping/pong')
    .action(async (method, params, opts) => {
      try { await wsCommand(method, params, opts) } catch (e) { handleError(e) }
    })

  attachToChildren(program)
  await program.parseAsync(argv)
}