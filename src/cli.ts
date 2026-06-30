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
  listComments, addComment, updateComment, deleteComments
} from './resources/comment.js'
import {
  listCalendars,
  listSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedules,
  listEvents, getEvent, createEvent, updateEvent, deleteEvents,
  listRecurringEvents, listRecurringInstances,
  createCalendar, deleteCalendar
} from './resources/calendar.js'
import {
  listTimeEntries, logTime, deleteTimeEntries, timeReport
} from './resources/time.js'
import {
  listCards, getCard, createCard, updateCard, deleteCards,
  listCardSpaces, getCardSpace, createCardSpace, deleteCardSpaces,
  listMasterTags
} from './resources/card.js'
import {
  listDocuments, getDocument, createDocument, updateDocument, deleteDocuments,
  listSnapshots, getSnapshot, listInlineComments,
  listTeamspaces, getTeamspace, createTeamspace, updateTeamspace, deleteTeamspaces
} from './resources/document.js'
import {
  listActions, getAction, createAction, updateAction, deleteActions,
  completeAction, reopenAction, scheduleAction, unscheduleAction
} from './resources/todo.js'
import {
  listChannels, getChannel, createChannel, updateChannel, deleteChannels,
  archiveChannel, listChannelMembers, joinChannel, leaveChannel,
  addChannelMembers, removeChannelMembers,
  listChannelMessages, sendChannelMessage, updateChannelMessage, deleteChannelMessages,
  listThreadReplies, addThreadReply, updateThreadReply, deleteThreadReplies,
  listDms, createDm, listDmMessages, sendDmMessage
} from './resources/channel.js'
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

function attachGlobalOpts(cmd: Command, opts: { skipNonInteractive?: boolean } = {}): Command {
  let c = cmd
    .option('--url <url>', 'Huly server URL')
    .option('--workspace <name>', 'workspace URL name or UUID')
    .option('--json', 'output JSON')
    .option('--ci', 'CI mode (JSON output)')
    .option('--markdown', 'output body as markdown')
    .option('--dry-run', 'print intended tx, do not apply')
    .option('--minimal', 'minimal payload (no smart defaults)')
    .option('-y, --yes', 'skip confirmation prompts')
  if (!opts.skipNonInteractive) {
    c = c.option('--non-interactive', 'disable interactive prompts')
  }
  return c
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
  ws.command('list').description('List accessible workspaces')
    .addHelpText('after', `
Examples:
  $ huly workspace list
  $ huly workspace list --json | jq -r '.[].name'`)
    .action(async (_o, cmd) => {
    try { await listWorkspaces(globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  ws.command('current').description('Show current workspace').action(async (_o, cmd) => {
    try { await currentWorkspace(globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  ws.command('use <name>').description('Set active workspace')
    .addHelpText('after', `
Examples:
  $ huly workspace use production
  $ huly workspace use life  # switch workspace for subsequent commands
  $ huly --workspace life issue list  # one-off without switching`)
    .action(async (name, _o, cmd) => {
    try { await useWorkspace(name, globalsFrom(cmd)) } catch (e) { handleError(e) }
  })
  ws.command('create').description('Create a new workspace (requires --yes)')
    .requiredOption('--name <name>')
    .option('--region <region>')
    .addHelpText('after', `
Examples:
  $ huly workspace create --name "My new workspace" --yes
  $ huly workspace create --name "EU workspace" --region eu-west --yes

Note: workspace creation runs the tracker migration. May take 30-60s.`)
    .action(async (opts, cmd) => {
      try { await createWorkspace({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('delete').description('Delete the current workspace (DESTRUCTIVE; requires --yes; --force to delete the active workspace)')
    .option('--force', 'delete even if this is the active workspace')
    .addHelpText('after', `
Examples:
  $ huly workspace delete my-old-workspace --yes
  $ huly workspace delete life --yes --force  # delete active workspace

WARNING: server-side hard-delete may take several minutes. Worker calls
doCleanup which drops all docs in all per-workspace tables.`)
    .action(async (opts, cmd) => {
      try { await deleteWorkspace({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('members').description('List workspace members')
    .option('--role <r>', 'filter by role (Owner|Admin|Guest|ReadOnlyGuest|DocGuest)')
    .addHelpText('after', `
Examples:
  $ huly workspace members
  $ huly workspace members --role Owner --json
  $ huly workspace members --role Guest`)
    .action(async (opts, cmd) => {
      try { await listMembers({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  // N2: alias `member add` for consistency with channel.add-member.
  // (No `member remove` — the SDK has no remove-member API; users must
  // leave the workspace via huly workspace leave.)
  const wsMember = ws.command('member').description('Manage a single member (alias for `workspace member`)')
  wsMember.command('add <account>').description('Add or change a member\'s role (requires OWNER)')
    .requiredOption('--role <r>', 'Owner|Admin|Guest|ReadOnlyGuest|DocGuest')
    .addHelpText('after', `
Examples:
  $ huly workspace member add alice@example.com --role MAINTAINER
  $ huly workspace member add bob@example.com --role GUEST
  $ huly workspace member add 86d46120-594e-4c10-8996-821ac2a7001a --role OWNER`)
    .action(async (account, opts, cmd) => {
      try { await updateMemberRole({ ...opts, target: account, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('info').description('Show current workspace info (name, uuid, region, mode)')
    .addHelpText('after', `
Examples:
  $ huly workspace info
  $ huly workspace info --json | jq -r .uuid`)
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
    .addHelpText('after', `
Examples:
  $ huly workspace guests --read-only true
  $ huly workspace guests --sign-up false --read-only true
  $ huly workspace guests --sign-up true

Note: 'guests' (plural) is for workspace-level guest *settings*.
For individual guest role assignment, use \`huly workspace member add --role GUEST\`.`)
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
    .addHelpText('after', `
Examples:
  $ huly workspace access-link --role GUEST
  $ huly workspace access-link --role MAINTAINER --exp-hours 48
  $ huly workspace access-link --role GUEST --auto-join
  $ huly workspace access-link --role GUEST --email alice@example.com`)
    .action(async (opts, cmd) => {
      try { await createAccessLink({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ws.command('regions').description('List available regions')
    .action(async (_o, cmd) => {
      try { await listRegions(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })

  const user = program.command('user').description('Manage user profile')
  // N7: harmonize ref spec — accept positional <ref> OR --ref flag (matches project get).
  user.command('get [ref]').description('Show user profile (current user by default, or by ref/uuid)')
    .option('--ref <id>', 'account uuid (overrides positional ref)')
    .addHelpText('after', `
Examples:
  $ huly user get                      # current user profile
  $ huly user get --ref 86d46120-594e-4c10-8996-821ac2a7001a
  $ huly user get 86d46120-594e-4c10-8996-821ac2a7001a  # positional form (N7)`)
    .action(async (ref, opts, cmd) => {
      try { await getUser({ ...opts, ref, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  user.command('update').description('Update current user profile')
    .option('--name <name>')
    .option('--bio <text>')
    .option('--city <city>')
    .option('--country <country>')
    .addHelpText('after', `
Examples:
  $ huly user update --city "Berlin"
  $ huly user update --bio "New bio" --country "DE"`)
    .action(async (opts, cmd) => {
      try { await updateUser({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  user.command('find <email>').description('Look up a user by email (account-level or workspace-local)')
    .addHelpText('after', `
Examples:
  $ huly user find alice@example.com
  $ huly user find alice@example.com --json

Resolution order: accountClient.findPersonBySocialKey → workspace-local
Person scan by name. Either may fail if the user is not in your workspace.`)
    .action(async (email, _o, cmd) => {
      try { await findUser(email, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })

  const project = program.command('project').description('Manage tracker projects'); withGlobalHelp(project)
  project.command('list').description('List projects').option('--limit <n>', 'limit', (v) => parseInt(v, 10)).option('--offset <n>', 'offset', (v) => parseInt(v, 10))
    .addHelpText('after', `
Examples:
  $ huly project list
  $ huly project list --limit 10 --json
  $ huly project list --offset 10  # pagination`)
    .action(async (opts, cmd) => {
    try { await listProjects({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  project.command('get <ref>').description('Get a project')
    .addHelpText('after', `
Examples:
  $ huly project get TSK
  $ huly project get "Default project"
  $ huly project get tracker:project:DefaultProject`)
    .action(async (ref, opts, cmd) => {
    try { await getProject(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  project
    .command('create')
    .description('Create a project')
    .requiredOption('--name <name>')
    .requiredOption('--identifier <id>', 'short uppercase identifier (1-5 chars typical)')
    .option('--description <text>')
    .option('--private')
    .addHelpText('after', `
Examples:
  $ huly project create --name "Q3 Goals" --identifier Q3G
  $ huly project create --name "Internal" --identifier INT --private \\
      --description "Internal projects"

Required: --name, --identifier. Identifier must be uppercase letters/digits.
The CLI pre-checks for duplicate identifiers (server may not enforce).`)
    .action(async (opts, cmd) => {
      try { await createProject({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  project
    .command('update <ref>')
    .description('Update a project')
    .option('--set <kv...>', 'set key=value (repeatable); value=null clears')
    .option('--unset <key...>', 'unset key (repeatable)')
    .addHelpText('after', `
Examples:
  $ huly project update TSK --set description="Updated description"
  $ huly project update TSK --set description=null  # clear
  $ huly project update TSK --set private=true
  $ huly project update TSK --unset description`)
    .action(async (ref, opts, cmd) => {
      try { await updateProject(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  project.command('delete <ref...>').description('Delete projects (DESTRUCTIVE; requires --yes)').action(async (refs, opts, cmd) => {
    try { await deleteProjects(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  project.command('statuses [ref]').description('List issue statuses for a project (defaults to $HULY_PROJECT or first arg)')
    .option('--project <ref>')
    .action(async (ref, opts, cmd) => {
      try { await listStatuses({ project: ref ?? opts.project, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
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
    .addHelpText('after', `
Examples:
  $ huly issue list --project TSK
  $ huly issue list --status Backlog --assignee alice@example.com
  $ huly issue list --status-category Active --limit 50 --json
  $ huly issue list --description-search "smoke"
  $ huly issue list --parent null  # top-level only

Ref formats accepted by --project, --assignee, --label: name, identifier, or _id.`)
    .action(async (opts, cmd) => {
      try { await listIssues({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue
    .command('get <ref>')
    .description('Get an issue')
    .addHelpText('after', `
Examples:
  $ huly issue get TSK-1
  $ huly issue get 1                # uses \$HULY_PROJECT
  $ huly issue get TSK-1 --markdown
  $ huly issue get tracker:issue:6a... # raw _id`)
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
    .option('--priority <p>', 'Urgent | High | Normal | Low | None')
    .option('--assignee <email>', 'must be a workspace member')
    .option('--label <l...>', 'repeatable: --label bug --label auth')
    .option('--due <iso>', 'ISO 8601 e.g. 2026-07-01T14:00:00Z')
    .option('--parent <ref>')
    .option('--task-type <name|id>')
    .addHelpText('after', `
Examples:
  $ huly issue create --project TSK --title "Add OAuth login"
  $ huly issue create --project TSK --title "Bug" --priority High \\
      --assignee alice@example.com --label bug --label p1
  $ huly issue create --project TSK --title "..." --body-file ./spec.md \\
      --due 2026-08-01T00:00:00Z
  $ huly issue create --project TSK --title "Sub-task" --parent TSK-5

Required: --project, --title. Valid priority values: Urgent, High, Normal,
Low, None. Assignee must be a workspace member.`)
    .action(async (opts, cmd) => {
      try { await createIssue({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue
    .command('update <ref>')
    .description('Update an issue')
    .option('--set <kv...>', 'key=value (repeatable); key=null clears the field')
    .option('--unset <key...>')
    .option('--status <name>')
    .option('--priority <p>', 'Urgent | High | Normal | Low | None')
    .option('--assignee <email>')
    .option('--title <t>')
    .option('--description <text>')
    .option('--task-type <name|id>')
    .addHelpText('after', `
Examples:
  $ huly issue update TSK-1 --status Done
  $ huly issue update TSK-1 --description "Updated text"
  $ huly issue update TSK-1 --set priority=High --set assignee=bob@example.com
  $ huly issue update TSK-1 --set description=null  # clear field

Pass any combination of --status/--priority/--assignee/--title/--description/--set.`)
    .action(async (ref, opts, cmd) => {
      try { await updateIssue(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  issue.command('delete <ref...>').description('Delete issues (requires --yes for multiple)').action(async (refs, opts, cmd) => {
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

  const comment = program.command('comment').description('Manage comments (issue comments are ChatMessages)'); withGlobalHelp(comment)
  comment.command('list').description('List comments on an issue')
    .requiredOption('--issue <ref>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .option('--offset <n>', 'offset', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listComments({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  comment.command('add').description('Add a comment to an issue')
    .requiredOption('--issue <ref>')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (opts, cmd) => {
      try { await addComment({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  comment.command('update <ref>').description('Update a comment\'s body')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (ref, opts, cmd) => {
      try { await updateComment(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  comment.command('delete <ref...>').description('Delete comments')
    .action(async (refs, opts, cmd) => {
      try { await deleteComments(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const channel = program.command('channel').description('Manage chunter channels (and their messages/threads)'); withGlobalHelp(channel)
  channel.command('list').description('List channels')
    .option('--archived <bool>', 'filter by archived state (true|false)')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .addHelpText('after', `
Examples:
  $ huly channel list
  $ huly channel list --archived false
  $ huly channel list --json | jq -r '.[] | select(.topic != null) | .name'`)
    .action(async (opts, cmd) => {
      try { await listChannels({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('get <ref>').description('Get a channel')
    .addHelpText('after', `
Examples:
  $ huly channel get engineering
  $ huly channel get chunter:space.General  # raw _id`)
    .action(async (ref, opts, cmd) => {
      try { await getChannel(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('create').description('Create a channel')
    .requiredOption('--name <n>')
    .option('--description <text>')
    .option('--topic <text>')
    .option('--private', 'private channel (members only)')
    .option('--auto-join', 'new workspace members join automatically')
    .option('--members <email...>', 'initial members (workspace members only)')
    .addHelpText('after', `
Examples:
  $ huly channel create --name engineering --topic "Eng discussions"
  $ huly channel create --name leads --private --members alice@.. bob@..
  $ huly channel create --name general --auto-join

Required: --name. Optional: --description, --topic, --private,
--auto-join, --members (space-separated emails).`)
    .action(async (opts, cmd) => {
      try { await createChannel({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('update <ref>').description('Update a channel')
    .option('--name <n>')
    .option('--description <text>')
    .option('--topic <text>')
    .option('--private <bool>', 'true|false')
    .option('--auto-join <bool>', 'true|false')
    .addHelpText('after', `
Examples:
  $ huly channel update engineering --topic "New topic"
  $ huly channel update engineering --private true`)
    .action(async (ref, opts, cmd) => {
      try { await updateChannel(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('delete <ref...>').description('Delete channels (DESTRUCTIVE; requires --yes)')
    .action(async (refs, opts, cmd) => {
      try { await deleteChannels(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('archive <ref>').description('Archive a channel (--value false to unarchive)')
    .option('--value <bool>', 'true|false', (v) => v !== 'false' && v !== '0')
    .addHelpText('after', `
Examples:
  $ huly channel archive engineering
  $ huly channel archive engineering --value false  # unarchive`)
    .action(async (ref, opts, cmd) => {
      try { await archiveChannel(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('unarchive <ref>').description('Unarchive a channel')
    .action(async (ref, opts, cmd) => {
      try { await archiveChannel(ref, { ...opts, value: false, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('members <ref>').description('List channel members')
    .addHelpText('after', `
Examples:
  $ huly channel members engineering
  $ huly channel members engineering --json`)
    .action(async (ref, opts, cmd) => {
      try { await listChannelMembers(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('join <ref>').description('Join a channel (--member <email> for a specific user)')
    .option('--member <email>', 'add a specific user (OWNER/admin only)')
    .addHelpText('after', `
Examples:
  $ huly channel join engineering
  $ huly channel join engineering --member alice@example.com`)
    .action(async (ref, opts, cmd) => {
      try { await joinChannel(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('leave <ref>').description('Leave a channel')
    .option('--member <email>', 'remove a specific user (OWNER/admin only)')
    .action(async (ref, opts, cmd) => {
      try { await leaveChannel(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  channel.command('add-member <ref>').description('Add one or more members')
    .requiredOption('--members <email...>', 'space-separated list')
    .addHelpText('after', `
Examples:
  $ huly channel add-member engineering --members alice@example.com
  $ huly channel add-member engineering --members alice@.. bob@.. carol@..`)
    .action(async (ref, opts, cmd) => {
      try { await addChannelMembers(ref, opts.members, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  channel.command('remove-member <ref>').description('Remove one or more members')
    .requiredOption('--members <email...>', 'space-separated list')
    .addHelpText('after', `
Examples:
  $ huly channel remove-member engineering --members alice@example.com
  $ huly channel remove-member engineering --members alice@.. bob@..`)
    .action(async (ref, opts, cmd) => {
      try { await removeChannelMembers(ref, opts.members, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  const cmsg = channel.command('message').description('Manage messages within a channel')
  cmsg.command('list <ref>').description('List messages in a channel')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .addHelpText('after', `
Examples:
  $ huly channel message list engineering
  $ huly channel message list engineering --limit 50
  $ huly channel message list engineering --json`)
    .action(async (ref, opts, cmd) => {
      try { await listChannelMessages(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cmsg.command('send <ref>').description('Send a message to a channel')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (ref, opts, cmd) => {
      try { await sendChannelMessage(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cmsg.command('update <ref> <id>').description('Update a message')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (ref, id, opts, cmd) => {
      try { await updateChannelMessage(ref, id, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cmsg.command('delete <ref>').description('Delete one or more messages')
    .action(async (ref, opts, cmd) => {
      try { await deleteChannelMessages(ref, opts.messageIds ?? [], globalsFrom(cmd)) } catch (e) { handleError(e) }
    })

  const dm = program.command('dm').description('Manage direct messages'); withGlobalHelp(dm)
  dm.command('list').description('List DMs (spaces)')
    .action(async (opts, cmd) => {
      try { await listDms(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  dm.command('create').description('Create a DM (with --person or --members)')
    .option('--person <email>')
    .option('--members <email...>')
    .addHelpText('after', `
Examples:
  $ huly dm create --person alice@example.com
  $ huly dm create --members alice@.. bob@..   # group DM`)
    .action(async (opts, cmd) => {
      try { await createDm({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  // N1: dm.message mirrors channel.message (consistent nesting). The flat
  // 'dm messages' and 'dm send' commands remain as backward-compatible aliases.
  const dmMsg = dm.command('message').description('Manage messages within a DM (alias for `dm messages`/`dm send`)')
  dmMsg.command('list <dm>').description('List messages in a DM')
    .action(async (dm, opts, cmd) => {
      try { await listDmMessages(dm, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  dmMsg.command('send <dm>').description('Send a DM message (or to <email> via --person)')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--person <email>', 'recipient email (auto-creates DM if needed)')
    .addHelpText('after', `
Examples:
  $ huly dm message send <dmId> --body "hello"
  $ huly dm message send placeholder --person alice@.. --body "hi"
  $ huly dm message list <dmId>`)
    .action(async (dm, opts, cmd) => {
      try { await sendDmMessage(dm, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  // Backward-compatible flat commands (deprecated; use dm message <verb>)
  dm.command('messages <dm>').description('[alias] List messages in a DM (use `dm message list`)')
    .action(async (dm, opts, cmd) => {
      try { await listDmMessages(dm, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  dm.command('send <dm>').description('[alias] Send a DM message (use `dm message send`)')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--person <email>', 'recipient email (auto-creates DM if needed)')
    .action(async (dm, opts, cmd) => {
      try { await sendDmMessage(dm, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const thread = program.command('thread').description('Manage thread replies on a chat message'); withGlobalHelp(thread)
  thread.command('list <target>').description('List replies on a target message')
    .action(async (target, opts, cmd) => {
      try { await listThreadReplies(target, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  thread.command('add <target>').description('Add a reply')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (target, opts, cmd) => {
      try { await addThreadReply(target, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  thread.command('update <replyId>').description('Update a reply')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (replyId, opts, cmd) => {
      try { await updateThreadReply(replyId, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  thread.command('delete <replyId...>').description('Delete replies')
    .action(async (replies, opts, cmd) => {
      try { await deleteThreadReplies(replies, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })

  // Note: the old `board:class:Card` (board module) commands were removed —
  // they're out of scope per the parity plan. The new `card:class:Card`
  // commands live below under the `card` command (Phase 12).

  const card = program.command('card').description('Manage Kanban cards (card module)'); withGlobalHelp(card)
  card
    .command('list')
    .description('List cards')
    .option('--card-space <ref>')
    .option('--master-tag <ref>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .option('--offset <n>', 'offset', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listCards({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  card.command('get <ref>').description('Get a card')
    .action(async (ref, opts, cmd) => {
      try { await getCard(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  card
    .command('create')
    .description('Create a card (requires --master-tag)')
    .requiredOption('--title <t>')
    .requiredOption('--master-tag <name|ref>', 'master-tag name (e.g. "Task") or _id')
    .option('--card-space <ref>', 'card space; defaults to card:space:Default')
    .option('--description <text>')
    .option('--body <md>')
    .option('--body-file <path>')
    .addHelpText('after', `
Examples:
  $ huly card create --title "My card" --master-tag "Task"
  $ huly card create --title "..." --master-tag card:master-tag.Task \\
      --card-space card:space:Default --body-file ./spec.md

N9: --master-tag is REQUIRED. First-time setup usually requires creating a
master-tag via the web UI (the CLI doesn't expose master-tag creation).

List available tags with \`huly master-tag list\`.`)
    .action(async (opts, cmd) => {
      try { await createCard({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  card.command('update <ref>').description('Update a card')
    .option('--title <t>')
    .option('--description <text>')
    .option('--body <md>')
    .option('--body-file <path>')
    .action(async (ref, opts, cmd) => {
      try { await updateCard(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  card.command('delete <ref...>').description('Delete cards').action(async (refs, opts, cmd) => {
    try { await deleteCards(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const cardSpace = program.command('card-space').description('Manage card spaces'); withGlobalHelp(cardSpace)
  cardSpace.command('list').description('List card spaces')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listCardSpaces({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cardSpace.command('get <ref>').description('Get a card-space').action(async (ref, opts, cmd) => {
    try { await getCardSpace(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  cardSpace.command('create').description('Create a card-space')
    .requiredOption('--name <name>')
    .option('--description <text>')
    .action(async (opts, cmd) => {
      try { await createCardSpace({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cardSpace.command('delete <ref...>').description('Delete card-spaces')
    .action(async (refs, opts, cmd) => {
      try { await deleteCardSpaces(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const mt = program.command('master-tag').description('Manage card master tags'); withGlobalHelp(mt)
  mt.command('list').description('List master tags')
    .option('--card-space <ref>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listMasterTags({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const action = program.command('action').description('Manage tasks (Planner ToDos)'); withGlobalHelp(action)
  action
    .command('list')
    .description('List tasks')
    .option('--owner <email>')
    .option('--issue <ref>', 'filter to todos attached to an issue')
    .option('--title <q>', 'regex match on title')
    .option('--priority <p>', 'High|Medium|Low|NoPriority|Urgent')
    .option('--visibility <v>', 'public|busy|private')
    .option('--due-from <iso>')
    .option('--due-to <iso>')
    .option('--completed <bool>', 'true|false|all', (v) => v === 'all' ? 'all' : v !== 'false' && v !== '0')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .option('--offset <n>', 'offset', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listActions({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action.command('get <ref>').description('Get a task')
    .action(async (ref, opts, cmd) => {
      try { await getAction(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action
    .command('create')
    .description('Create a task')
    .requiredOption('--title <t>')
    .option('--description <text>')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--due <iso>')
    .option('--priority <p>')
    .option('--visibility <v>')
    .option('--owner <email>')
    .option('--attached-to <ref>')
    .option('--attached-to-class <class>')
    .action(async (opts, cmd) => {
      try { await createAction({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action.command('update <ref>').description('Update a task')
    .option('--title <t>')
    .option('--description <text>')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--due <iso>')
    .option('--priority <p>')
    .option('--visibility <v>')
    .option('--owner <email>')
    .action(async (ref, opts, cmd) => {
      try { await updateAction(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action.command('complete <ref>').description('Mark a task done (sets doneOn=now)')
    .action(async (ref, opts, cmd) => {
      try { await completeAction(ref, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  action.command('reopen <ref>').description('Reopen a task (clears doneOn)')
    .action(async (ref, opts, cmd) => {
      try { await reopenAction(ref, globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  action.command('schedule <ref>').description('Create a WorkSlot for the task')
    .requiredOption('--start <iso>')
    .requiredOption('--duration <minutes>', '', (v) => parseInt(v, 10))
    .option('--all-day')
    .action(async (ref, opts, cmd) => {
      try { await scheduleAction(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action.command('unschedule <ref>').description('Remove WorkSlots for the task')
    .option('--slot-id <id>', 'remove a specific slot only')
    .action(async (ref, opts, cmd) => {
      try { await unscheduleAction(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  action.command('delete <ref...>').description('Delete tasks').action(async (refs, opts, cmd) => {
    try { await deleteActions(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const doc = program.command('document').description('Manage documents (and their snapshots/inline comments)'); withGlobalHelp(doc)
  doc
    .command('list')
    .description('List documents')
    .option('--teamspace <name|id>')
    .option('--title-search <q>', 'regex match on title')
    .option('--content-search <q>', 'best-effort regex match on content')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .option('--offset <n>', 'offset', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listDocuments({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  doc.command('get <ref>').description('Get a document (use --markdown to render the body)')
    .action(async (ref, opts, cmd) => {
      try { await getDocument(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  doc
    .command('create')
    .description('Create a document')
    .requiredOption('--title <t>')
    .option('--teamspace <name|id>', 'defaults to the first available teamspace')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--parent <ref|title>', 'parent ref or title (resolved within teamspace)')
    .action(async (opts, cmd) => {
      try { await createDocument({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  doc
    .command('update <ref>')
    .description('Update a document (full body replace OR targeted --old-text/--new-text)')
    .option('--body <md>')
    .option('--body-file <path>')
    .option('--old-text <s>')
    .option('--new-text <s>')
    .option('--replace-all')
    .option('--title <t>')
    .option('--archived')
    .action(async (ref, opts, cmd) => {
      try { await updateDocument(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  doc.command('delete <ref...>').description('Delete documents').action(async (refs, opts, cmd) => {
    try { await deleteDocuments(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  doc.command('snapshots <ref>').description('List all snapshots for a document')
    .addHelpText('after', `
Examples:
  $ huly document snapshots <docRef>
  $ huly document snapshots <docRef> --json

Use \`document snapshot --snapshot-id <id>\` to fetch a specific snapshot.`)
    .action(async (ref, opts, cmd) => {
      try { await listSnapshots(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  doc.command('snapshot <ref>').description('Get a specific snapshot (by --snapshot-id)')
    .requiredOption('--snapshot-id <id>')
    .addHelpText('after', `
Examples:
  $ huly document snapshot <docRef> --snapshot-id 6a41527f12a078ec98cf64d5
  $ huly document snapshot <docRef> --snapshot-id 6a41527f12a078ec98cf64d5 --markdown

N4: \`snapshot\` (singular) gets one; \`snapshots\` (plural) lists all.`)
    .action(async (ref, opts, cmd) => {
      try { await getSnapshot(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  doc.command('inline-comments <ref>').description('List inline comments for a document')
    .action(async (ref, opts, cmd) => {
      try { await listInlineComments(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const ts = program.command('teamspace').description('Manage document teamspaces'); withGlobalHelp(ts)
  ts.command('list').description('List teamspaces')
    .action(async (_o, cmd) => {
      try { await listTeamspaces(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  ts.command('get <ref>').description('Get a teamspace')
    .action(async (ref, opts, cmd) => {
      try { await getTeamspace(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ts.command('create').description('Create a teamspace')
    .requiredOption('--name <n>')
    .option('--description <text>')
    .option('--type <t>', 'public|private (default public)')
    .option('--private')
    .action(async (opts, cmd) => {
      try { await createTeamspace({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ts.command('update <ref>').description('Update a teamspace')
    .option('--name <n>')
    .option('--description <text>')
    .option('--archived <bool>')
    .action(async (ref, opts, cmd) => {
      try { await updateTeamspace(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  ts.command('delete <ref...>').description('Delete teamspaces').action(async (refs, opts, cmd) => {
    try { await deleteTeamspaces(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })

  const cal = program.command('calendar').description('Manage calendar events, schedules, calendars'); withGlobalHelp(cal)
  // N5: 'calendars' (plural noun) lists CALENDAR OBJECTS; 'list' (verb) lists EVENTS.
  // 'get' (verb) gets an EVENT. To fetch a calendar's metadata, use 'calendars --json'.
  cal.command('calendars').description('List calendar objects (not events — see `calendar list` for events)')
    .addHelpText('after', `
Examples:
  $ huly calendar calendars
  $ huly calendar calendars --json | jq -r '.[].name'`)
    .action(async (_o, cmd) => {
      try { await listCalendars(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  cal.command('create-calendar').description('Create a calendar')
    .requiredOption('--name <name>')
    .option('--description <text>')
    .option('--private', 'private calendar (members only)')
    .option('--access <a>', 'owner|team|public')
    .addHelpText('after', `
Examples:
  $ huly calendar create-calendar --name "Work"
  $ huly calendar create-calendar --name "Personal" --private --access owner`)
    .action(async (opts, cmd) => {
      try { await createCalendar({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal.command('delete-calendar <ref>').description('Delete a calendar')
    .action(async (ref, opts, cmd) => {
      try { await deleteCalendar(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal
    .command('list')
    .description('List EVENTS (not calendars — see `calendar calendars` for calendars)')
    .option('--start <iso>', 'ISO 8601 start date filter')
    .option('--end <iso>', 'ISO 8601 end date filter')
    .option('--calendar <id|name>', 'filter to a specific calendar')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .addHelpText('after', `
Examples:
  $ huly calendar list
  $ huly calendar list --start 2026-06-01 --end 2026-06-30
  $ huly calendar list --calendar "Work" --limit 20
  $ huly calendar list --json | jq -r '.[] | "\(.title): \(.date)"'`)
    .action(async (opts, cmd) => {
      try { await listEvents({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal.command('get <ref>').description('Get an EVENT (not a calendar)')
    .addHelpText('after', `
Examples:
  $ huly calendar get <eventRef>
  $ huly calendar get <eventRef> --markdown

To fetch a calendar (the container, not an event inside it), use
\`calendar calendars --json\` and grep for the calendar id.`)
    .action(async (ref, opts, cmd) => {
      try { await getEvent(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal
    .command('create')
    .description('Create an event (or recurring event with --rrule)')
    .requiredOption('--title <t>')
    .requiredOption('--start <iso>')
    .requiredOption('--end <iso>')
    .option('--attendee <email>')
    .option('--location <text>')
    .option('--all-day')
    .option('--description <text>')
    .option('--body <md>')
    .option('--calendar-id <id>')
    .option('--rrule <string>', 'RRULE e.g. FREQ=DAILY;COUNT=3')
    .action(async (opts, cmd) => {
      try { await createEvent({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal.command('update <ref>').description('Update an event')
    .option('--title <t>')
    .option('--description <text>')
    .option('--start <iso>')
    .option('--end <iso>')
    .option('--all-day')
    .option('--location <text>')
    .option('--attendee <email>')
    .action(async (ref, opts, cmd) => {
      try { await updateEvent(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  cal.command('delete <ref...>').description('Delete events').action(async (refs, opts, cmd) => {
    try { await deleteEvents(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
  })
  cal.command('recurring').description('List recurring events')
    .action(async (_o, cmd) => {
      try { await listRecurringEvents(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  cal.command('recurring-instances <ref>').description('List instances of a recurring event')
    .option('--start <iso>')
    .option('--end <iso>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .action(async (ref, opts, cmd) => {
      try { await listRecurringInstances(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const schedule = program.command('schedule').description('Manage calendar schedules'); withGlobalHelp(schedule)
  schedule.command('list').description('List schedules')
    .action(async (_o, cmd) => {
      try { await listSchedules(globalsFrom(cmd)) } catch (e) { handleError(e) }
    })
  schedule.command('get <ref>').description('Get a schedule')
    .action(async (ref, opts, cmd) => {
      try { await getSchedule(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  schedule.command('create').description('Create a schedule')
    .requiredOption('--title <t>')
    .requiredOption('--owner <uuid>')
    .requiredOption('--time-zone <tz>')
    .option('--description <text>')
    .option('--duration <minutes>', 'meetingDuration', (v) => parseInt(v, 10))
    .option('--interval <minutes>', 'meetingInterval', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await createSchedule({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  schedule.command('update <ref>').description('Update a schedule')
    .option('--title <t>')
    .option('--description <text>')
    .option('--time-zone <tz>')
    .option('--duration <minutes>', '', (v) => parseInt(v, 10))
    .option('--interval <minutes>', '', (v) => parseInt(v, 10))
    .action(async (ref, opts, cmd) => {
      try { await updateSchedule(ref, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  schedule.command('delete <ref...>').description('Delete schedules')
    .action(async (refs, opts, cmd) => {
      try { await deleteSchedules(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })

  const time = program.command('time').description('Time tracking on issues'); withGlobalHelp(time)
  time.command('list').description('List time entries')
    .option('--issue <ref>')
    .option('--start <iso>')
    .option('--end <iso>')
    .option('--limit <n>', 'limit', (v) => parseInt(v, 10))
    .option('--offset <n>', 'offset', (v) => parseInt(v, 10))
    .action(async (opts, cmd) => {
      try { await listTimeEntries({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  time.command('log').description('Log time on an issue')
    .requiredOption('--issue <ref>')
    .option('--minutes <n>', 'minutes spent', (v) => parseInt(v, 10))
    .option('--hours <n>', 'hours spent (decimal ok)', (v) => Number(v))
    .option('--description <text>')
    .option('--date <iso>', 'default now')
    .action(async (opts, cmd) => {
      try { await logTime({ ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  time.command('report <issue>').description('Time report for a single issue')
    .action(async (issue, opts, cmd) => {
      try { await timeReport(issue, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
    })
  time.command('delete <ref...>').description('Delete time entries')
    .action(async (refs, opts, cmd) => {
      try { await deleteTimeEntries(refs, { ...opts, ...globalsFrom(cmd) }) } catch (e) { handleError(e) }
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
  attachGlobalOpts(program, { skipNonInteractive: true })
  await program.parseAsync(argv)
}