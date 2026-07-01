# huly-cli

AI-agent-first CLI for self-hosted Huly.

`huly` is a unified command-line interface for the Huly platform. It wraps
the Huly SDK into scriptable commands so you can automate workspace tasks,
integrate Huly into CI/CD pipelines, or operate Huly from agents without
a browser.

This README is the canonical reference. It is intentionally long so you can
find what you need without leaving the docs. The CLI's own `--help` output
is concise by design; this document expands it with examples, caveats, and
the rationale behind design decisions.

---

## Table of Contents

1. [Why huly-cli](#why-huly-cli)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Authentication](#authentication)
5. [Global flags](#global-flags)
6. [Output modes](#output-modes)
7. [Ref resolution](#ref-resolution)
8. [Command reference](#command-reference)
   - [login / whoami](#login--whoami)
   - [workspace](#workspace)
   - [user](#user)
   - [project](#project)
   - [issue](#issue)
   - [component](#component)
   - [milestone](#milestone)
   - [issue-template](#issue-template)
   - [comment](#comment)
   - [channel](#channel)
   - [dm](#dm)
   - [thread](#thread)
   - [card](#card)
   - [card-space](#card-space)
   - [master-tag](#master-tag)
   - [action](#action)
   - [document](#document)
   - [teamspace](#teamspace)
   - [calendar](#calendar)
   - [schedule](#schedule)
   - [time](#time)
9. [Common workflows](#common-workflows)
10. [Platform behaviors & best practices](#platform-behaviors--best-practices)
11. [Output mode reference](#output-mode-reference)
12. [Class ID reference](#class-id-reference)
13. [Plugin / model surface map](#plugin--model-surface-map)
14. [Escape hatches](#escape-hatches)
15. [Internal architecture](#internal-architecture)
16. [Environment variables reference](#environment-variables-reference)
17. [Troubleshooting](#troubleshooting)
18. [Performance & limits](#performance--limits)
19. [Security model](#security-model)
20. [Compatibility matrix](#compatibility-matrix)
21. [Development](#development)
22. [Cross-references](#cross-references)
22. [License](#license)

---

## Why huly-cli

Huly's web UI is great for interactive use. The SDK is great for programmatic
use. `huly-cli` bridges them for shell-and-script use cases:

- **Shell pipelines**: pipe `huly issue list --json` to `jq`, `xargs`, etc.
- **CI/CD**: log issues from CI failures, link commits, close on merge
- **Agents**: any LLM can drive the CLI; no browser, no Playwright
- **Cron/automation**: daily backups of comments, scheduled cleanup, audits
- **Cross-workspace ops**: bulk-move issues between workspaces
- **Offline scripting**: write ops as bash scripts, version them in git

The CLI mirrors the platform's domain model — projects, issues, channels,
calendar events — so there's a 1:1 mapping between `huly <surface> <verb>`
and the underlying SDK calls.

---

## Installation

### From npm

```bash
npm i -g @iamcoder18/huly-cli
huly --version
```

#### Other package managers

```bash
# pnpm
pnpm add -g @iamcoder18/huly-cli

# yarn (classic)
yarn global add @iamcoder18/huly-cli

# yarn (berry / modern)
yarn global add @iamcoder18/huly-cli

# bun
bun add -g @iamcoder18/huly-cli
```

### From source

```bash
git clone https://github.com/iamcoder18/huly-cli.git
cd huly-cli
npm install
npm run build
node dist/index.js --version

# Optional: install `huly` on PATH
ln -s "$(pwd)/dist/index.js" /usr/local/bin/huly
```

The repo's `bin/huly` script wraps `node dist/index.js "$@"`, so it's
also fine to add `bin/` to PATH directly.

### Node version

Tested on Node 22.11 and Node 24. Node 20 lacks some `crypto` features
the SDK uses. Node 26 fails the rush build check (this repo's build chain
version-checks Node major).

If you must run Node 26, set:
```bash
export RUSH_ALLOW_UNSUPPORTED_NODEJS=1
```

### Dependencies

- `node` >= 22.11
- `npm` >= 9
- A Huly server reachable from where you run the CLI
- Credentials for at least one Huly account

---

## Configuration

Configuration comes from (in precedence order):

1. CLI flags (highest)
2. Shell environment variables
3. `~/.config/huly/.env` (loaded automatically if present)

### Config files

| Path | Purpose |
|---|---|
| `~/.config/huly/.env` | Login + URL config (mode 0600 recommended) |
| `~/.config/huly/credentials.json` | Cached JWT tokens (mode 0600) |
| `~/.config/huly/active-workspace` | Last-used workspace name |

The CLI creates these on first run. Deleting `credentials.json` forces
re-login on the next invocation.

### Minimal `.env`

```bash
export HULY_URL=https://huly.example.com
export HULY_EMAIL=you@example.com
export HULY_PASSWORD=your-password
```

### Strict mode `.env` (CI-friendly)

```bash
export HULY_URL=https://huly.example.com
export HULY_TOKEN=eyJ0eXAiOiJKV1Q...   # pre-issued account JWT, skip login
export HULY_WORKSPACE=production
export HULY_PROJECT=BACKEND            # for bare-number issue refs
export HULY_NONINTERACTIVE=1           # disable all prompts
```

---

## Authentication

The CLI supports three auth modes:

### 1. Password login (interactive)

```bash
huly login
# prompts for password if HULY_PASSWORD is unset
```

### 2. Password login (headless)

```bash
huly login --headless
# reads HULY_EMAIL + HULY_PASSWORD from env only
# never prompts
```

### 3. Pre-issued token

```bash
export HULY_TOKEN=eyJ0...
huly whoami
```

Useful for service accounts and CI where you don't want a stored password.

### Token caching

After login, the CLI stores the **account token** and **workspace tokens**
in `~/.config/huly/credentials.json`. Each subsequent invocation reuses
the cache until tokens expire.

```bash
# clear cache
rm ~/.config/huly/credentials.json

# verify cache contents
cat ~/.config/huly/credentials.json | jq .
```

### Logout

There's no `huly logout` command. Either:

```bash
rm ~/.config/huly/credentials.json
```

Or unset the tokens in the file. Logout is intentionally manual so you
don't accidentally drop credentials during a long automation run.

### Signup

`huly signup` does not exist as a CLI command (the platform requires
email-confirmation UX the CLI can't provide). Sign up via:

- The web UI
- The `accountClient.signUp` SDK call directly
- An admin's invite link (`huly workspace access-link --role GUEST`)

After signup, `huly login` works normally.

---

## Global flags

These flags work on every command. They may be placed before or after
the subcommand:

```bash
huly --workspace prod issue list
huly issue list --workspace prod        # equivalent
```

| Flag | Description |
|---|---|
| `--url <url>` | Server URL (overrides `HULY_URL`) |
| `--workspace <name>` | Active workspace (overrides `HULY_WORKSPACE`). Name or UUID. |
| `--json` | Output machine-readable JSON |
| `--ci` | Alias for `--json`. Same effect; signals non-interactive intent. |
| `--markdown` | Output body content as raw markdown (skips markup resolution) |
| `--dry-run` | Print the tx that would be applied, do not apply |
| `--minimal` | Skip smart defaults (no auto-Teamspace, no auto-IssueStatus) |
| `-y, --yes` | Skip confirmation prompts (required for destructive ops) |
| `--non-interactive` | Same as `--yes` + disable any interactive prompts |

### Precedence rules

- A flag on the subcommand overrides the flag on the parent
- A flag after the subcommand overrides the flag before
- `--workspace prod issue list` ≡ `issue list --workspace prod`
- `huly login --workspace prod` is a no-op — login is workspace-independent

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic error (uncaught exception, network failure, etc.) |
| 2 | Validation error (missing required arg, invalid ref, etc.) |
| 3 | Not found (ref doesn't exist) |
| 4 | Forbidden (insufficient permissions) |
| 64 | Usage error (no command given, unknown subcommand) |

All errors are exit-coded; pipe-friendly. `set -e` works as expected.

---

## Output modes

### Table (default)

Designed for humans. Auto-sizes columns, truncates long fields, hides
uninteresting ones:

```
ID    NAME       DESCRIPTION              _ID
────  ─────────  ───────────────────────  ────────────
TSK   Default    Default project          faultProject
DEMO  Demo       Demo project             emoProject
```

### JSON (`--json` / `--ci`)

Full objects, arrays for lists. Designed for `jq` / `xargs`:

```json
[
  {
    "_id": "tracker:project:DefaultProject",
    "_class": "tracker:class:Project",
    "name": "Default",
    "identifier": "TSK",
    "description": "Default project",
    "private": false,
    "archived": false,
    "members": [],
    "modifiedBy": "core:account:System",
    "modifiedOn": 1782697470759
  }
]
```

### CI mode (`--ci`)

Identical to `--json`. Use `--ci` in shell scripts to signal "I expect
machine-readable output, do not prompt for input" — helps future maintainers
understand intent. (Currently no behavioral difference; reserved for future
strict-mode behavior.)

### Markdown body (`--markdown`)

For resources that have body content (documents, comments, channel messages,
issue descriptions), `--markdown` returns the raw markdown text instead
of a table:

```bash
huly document get <ref> --markdown
# prints: # Hello\nThis is the document body in markdown.
```

The CLI's read path catches markup resolution failures and falls back to
returning the raw body string. If a doc was created with the CLI (which
stores bodies as raw strings), `--markdown` returns that string verbatim.

---

## Ref resolution

References to documents can be specified in several ways. The CLI tries
each in order:

### 1. Raw `_id`

The full class-prefixed ID. Always works, slowest:

```bash
huly issue get tracker:issue:6a41527f12a078ec98cf64d5
```

### 2. Prefixed form

For issues: `<PROJECT_IDENTIFIER>-<NUMBER>`. Resolved via the local index
of issues:

```bash
huly issue get TSK-1
```

### 3. Bare number

If `HULY_PROJECT` is set, bare numbers resolve against that project's
issues:

```bash
export HULY_PROJECT=TSK
huly issue get 1       # equivalent to TSK-1
```

### 4. Title match

Case-insensitive match on the document's title. Used for documents,
teamspaces, projects, etc. (not issues):

```bash
huly document get "My design doc"
```

### Resolution algorithm

1. Check if it matches `_id` regex (`<prefix>:<prefix>:<id>`)
2. Check if it matches prefixed issue form (`[A-Z]+-\d+`)
3. Check if it's a bare number with `HULY_PROJECT` set
4. Look up in the local class index (built from prior `findAll`)
5. Try `findOne` by name/title
6. Throw `NotFound` with candidate suggestions

The local index is **invalidated automatically after writes** to the same
class. Cross-class writes (e.g. updating an issue doesn't invalidate the
project index) require a fresh process.

---

## Command reference

This section documents every command in detail. Commands are grouped by
top-level resource.

### login / whoami

```bash
huly login                          # interactive
huly login --headless               # env-only
huly whoami                         # show current account + workspace
huly whoami --json                  # machine-readable
```

`whoami` output:

```
URL:        https://huly.example.com
Account:    you@example.com
Workspace:  production  (uuid=..., mode=active)
```

---

### workspace

Workspace-level operations.

```bash
huly workspace list                 # list all accessible workspaces
huly workspace current              # show current workspace
huly workspace use <name>           # set active workspace
huly workspace create --name X      # create (requires --yes)
huly workspace delete --yes         # delete current (requires --yes)
huly workspace delete --yes --force # delete active workspace
huly workspace info                 # show uuid, region, mode
huly workspace members              # list members (OWNER role required)
huly workspace member <uuid> --role MAINTAINER   # change role
huly workspace rename <new-name>    # rename current
huly workspace guests --read-only true           # toggle guest read-only
huly workspace guests --sign-up true             # toggle guest sign-up
huly workspace access-link --role GUEST          # create invite link
huly workspace regions              # list available regions
```

**Destructive:** `delete` requires `--yes`. Deleting the active workspace
additionally requires `--force`.

**Permissions:** `delete`, `member`, `rename`, `guests`, `access-link`
require OWNER role. `info`, `members`, `list`, `use`, `current`, `regions`
require membership.

---

### user

Account-level identity operations.

```bash
huly user get                       # current user profile
huly user get --ref <uuid>          # by account uuid
huly user update --city "Berlin"    # update profile fields
huly user find <email>              # look up by email (returns personUuid)
```

`user find` resolution order:
1. Try `accountClient.findPersonBySocialKey` (account-level)
2. Fall back to workspace-local `Person` scan (name match)

Both paths may fail if the user is not in your workspace.

---

### project

Tracker project operations.

```bash
huly project list [--limit N] [--offset N]
huly project get <ref>              # by identifier, name, or _id
huly project create --name X --identifier BACKEND [--description] [--private]
huly project update <ref> --set description="..."
huly project update <ref> --set description=null    # clear field
huly project update <ref> --set private=true
huly project delete <ref...> [--yes]
huly project statuses --project TSK
huly project target-preferences --project TSK
huly project target-preference upsert --project TSK --key ... --value ...
```

**Identifier rules:**
- Must be uppercase letters and digits only
- 1-5 characters typical
- Unique per workspace (CLI pre-checks for duplicates; this selfhost's
  server does not enforce uniqueness server-side)

**`--set` semantics:** Pass `key=value` to set, `key=null` to clear.
Anything else is left unchanged.

**Best practices & side effects:**
- `delete` is **destructive**: cascade-deletes all `Issue`, `Component`,
  `Milestone`, and `IssueTemplate` in the project (`OnProjectRemove`). Use
  `huly project get <ref> --json` first to inspect the project.
- The CLI does not expose project/status/task-type creation. Custom space
  types and custom task types can only be applied to **new** projects — you
  cannot migrate an existing project to a different type.
- New projects are created with `ProjectType.classic = true` (Tracker default);
  Recruit/Lead space types set `classic: false`, which disables the issue/todo
  cascade automation.
See [Platform behaviors & best practices](#platform-behaviors--best-practices).

---

### issue

Tracker issue operations — the most-used surface.

```bash
huly issue list [--project TSK] [--status <name>] [--status-category Active]
                [--assignee <email>] [--label bug] [--parent <ref>|null]
                [--description-search <q>] [--limit N] [--offset N]

huly issue get <ref> [--markdown]   # by prefixed (TSK-1), bare (1), or _id
huly issue create --project TSK --title "..." [--description] [--body <md>]
                  [--body-file <path>] [--status <name>] [--priority <p>]
                  [--assignee <email>] [--label bug --label auth]
                  [--due 2026-07-01T14:00:00Z] [--parent <ref>]
                  [--task-type <name>]
huly issue update <ref> --title "..."  # any combination of updatable fields
huly issue delete <ref...> [--yes]
huly issue preview-delete <ref...>     # show what delete would affect

huly issue label <ref> add <name>
huly issue label <ref> remove <name>

huly issue relation <ref> add <type> <targetRef>      # type: blocks|isBlockedBy|relatesTo
huly issue relation <ref> remove <type> <targetRef>
huly issue relation <ref> list

huly issue link-document <ref> <docRef>
huly issue unlink-document <ref> <docRef>

huly issue move <ref> --parent <parentRef>      # set parent
huly issue move <ref> --parent null             # clear parent

huly issue related-targets --project TSK
huly issue related-target set --project TSK --source <ref> --target <ref>
```

**Status categories:** `UnStarted | ToDo | Active | Won | Lost`. Used by
the kanban-style status filters.

**Priorities:** `Urgent | High | Normal | Low | None`. Server-side enum;
the CLI auto-matches case-insensitively.

**Body format:** Markdown. Stored as raw string (the SDK's
`MarkupContent` upload is bypassed because the collaborator's
`createMarkup` RPC throws on this selfhost).

**`--markdown` on get:** returns raw body string. For CLI-created
documents (which store raw strings), this works correctly. For web-UI-created
documents with markup refs to y-docs, the ref string is returned instead.

**Known issue:** Issue create requires the project to have at least one
IssueStatus. On workspaces where the tracker migration didn't seed statuses,
issue create fails with "no IssueStatus in workspace". Workaround: create
a status manually via the web UI first.

**Best practices & side effects:** assigning an issue or changing its status
may auto-create, auto-close, or auto-rollback attached `ProjectToDo`s and
auto-advance the issue's status when the first `WorkSlot` starts (classic
projects only). See [Platform behaviors & best practices](#platform-behaviors--best-practices)
for the full cascade table. To inspect side effects after a mutation, use
`huly action list --issue <ref>` and `huly issue get <ref> --json`.

---

### component

```bash
huly component list --project TSK
huly component get <ref>
huly component create --project TSK --label "Backend"
huly component update <ref> --label "New Name"
huly component delete <ref...> [--yes]
```

**Known issue:** `component list` returns 0 results after a successful
`create` on this selfhost. The create succeeds (returns an `_id`) but the
list doesn't find it. Tracked as C2 in `docs/open-issues.md`. Same issue
affects milestone, issue-template, and time-entry lists.

**Best practices & side effects:** `delete` cascades — every issue that has
this component gets `component: null` set automatically (orphans are detached,
not deleted). See
[Platform behaviors & best practices](#platform-behaviors--best-practices).

---

### milestone

```bash
huly milestone list --project TSK
huly milestone get <ref>
huly milestone create --project TSK --label "v1.0" [--due 2026-08-01]
huly milestone update <ref> --label "v1.0 Final" --due 2026-08-15
huly milestone delete <ref...> [--yes]
```

**Best practices & side effects:** milestones are project-locked; you cannot
transfer a milestone to another project after creation. `delete` cascades —
all issues referencing the milestone get `milestone: null`.

---

### issue-template

```bash
huly issue-template list --project TSK
huly issue-template get <ref>
huly issue-template create --project TSK --title "Bug template"
huly issue-template update <ref> --title "..."
huly issue-template delete <ref...> [--yes]
huly issue-template add-child <templateRef> <childRef>    # template refs can include other templates
huly issue-template remove-child <templateRef> <childRef>
```

---

### comment

```bash
huly comment list --issue <ref>     # issue can be TSK-1 or full _id
huly comment add --issue TSK-1 --body "Looking into this"
huly comment add --issue TSK-1 --body-file ./comment.md
huly comment update <commentRef> --body "Updated text"
huly comment delete <ref...> [--yes]
```

**Best practices & side effects:** issue comments are stored as
`ChatMessage`s in the issue's `comments` collection. Sending a comment auto-adds
the author (and any `@mentioned` users) as collaborators on the issue, and
emits an inbox notification per collaborator. Delete cascades — any
`InboxNotification` attached to the deleted comment is removed.

---

### channel

```bash
huly channel list [--archived]
huly channel get <ref>
huly channel create --name "engineering" [--topic "..."] [--private]
huly channel update <ref> --topic "..."
huly channel delete <ref...> [--yes]
huly channel archive <ref> [--value false]   # value=false to unarchive
huly channel members <ref>
huly channel join <ref>                       # join self
huly channel join <ref> --member alice@...   # join specific user
huly channel leave <ref>
huly channel add-member <ref> alice@...      # one or more members
huly channel remove-member <ref> alice@...

huly channel message list <channelRef>
huly channel message get <channelRef> <messageRef> [--markdown]
huly channel message create <channelRef> --body "hello" [--body-file <path>]
huly channel message update <channelRef> <messageRef> --body "edited"
huly channel message delete <channelRef> <messageRef...> [--yes]
```

**Best practices & side effects:**
- Sending a message auto-adds the sender as a channel member (`$push: members`).
- The sender and every `@`-mentioned person in the message body are
  auto-added as `Collaborator`s on the channel, and each gets an inbox
  notification (subject to their notification provider settings).
- `#general` and `#random` are auto-created when a workspace is created.
  `archive` on these requires `Spaces Admin` or `Workspace Owner`.
- `--private true` keeps the channel listed in the sidebar; users must
  request access. Use a DM (not a channel) for hidden conversations.
- Channel `auto-join` only affects **future** workspace members, never
  retroactively adds existing ones.
See [Platform behaviors & best practices](#platform-behaviors--best-practices).

---

### dm

Direct messages.

```bash
huly dm list                                  # list DM spaces
huly dm create --person alice@example.com    # create 1:1 DM
huly dm messages <dmRef>
huly dm send <dmRef> --body "hi"
huly dm send --person alice@example.com --body "hi"     # auto-creates DM
```

**Best practices & side effects:** sending a DM message parses `@mentions`
from the markup and creates per-recipient inbox notifications; the mentioned
person is auto-added as a `Collaborator` on the underlying DM space. Use a DM
(or group DM) rather than a private channel if you want a conversation that
isn't listed in the channel sidebar. "Close conversation" hides from the
sidebar but preserves message history.

---

### thread

Replies to chat messages (channel messages or DM messages).

```bash
huly thread list <targetRef>      # target = channel + message _id, or just message _id
huly thread add <targetRef> --body "reply" [--body-file <path>]
huly thread update <replyRef> --body "edited"
huly thread delete <replyRef...> [--yes]
```

**Best practices & side effects:** thread replies attach to the parent
`ActivityMessage` and auto-push the author into `repliedPersons[]` (unless
already present); the parent message's `lastReply` is updated to the reply's
`modifiedOn`. The author and `@`-mentioned persons in the reply body receive
inbox notifications. Replying to a Telegram notification appears here as a
thread reply.

---

---

### card

Card module (separate from tracker issues).

```bash
huly card list
huly card get <ref> [--markdown]
huly card create --master-tag <name|id> --title "..." [--body <md>] [--body-file <path>]
huly card update <ref> [--title] [--description] [--body] [--body-file]
huly card delete <ref...> [--yes]
```

**Master-tag:** cards MUST have a master-tag. The CLI resolves name or
ID. Use `huly master-tag list` to see available tags. First-card setup
typically requires using the web UI once to create a master-tag, since
the CLI doesn't expose master-tag creation.

---

### card-space

```bash
huly card-space list
huly card-space get <ref>
huly card-space create --name "Engineering" [--description] [--private]
huly card-space delete <ref...> [--yes]
```

---

### master-tag

```bash
huly master-tag list              # read-only on CLI
```

---

### action (Planner tasks / ToDos)

```bash
huly action list [--completed all|open|done] [--priority High] [--owner email@...]
huly action get <ref>
huly action create --title "..." [--description] [--body] [--body-file]
                  [--due 2026-07-01T14:00:00Z] [--priority High]
                  [--owner email@...] [--attached-to <ref>] [--attached-to-class <classId>]
huly action update <ref> [--title] [--description] [--body] [--body-file]
huly action complete <ref>       # sets doneOn=now
huly action reopen <ref>         # clears doneOn
huly action schedule <ref>       # creates a WorkSlot for the task
huly action unschedule <ref>     # removes WorkSlots for the task
huly action delete <ref...> [--yes]
```

**`--completed` filter:** `all` (default) shows all, `open` excludes done,
`done` shows only done.

**Priority:** accepts any of `Urgent | High | Normal | Low | None`. Match
is case-insensitive. Unknown priorities throw NotFound.

**Best practices & side effects:**
- `--attached-to <ref>` + `--attached-to-class tracker:class:Issue` attaches
  the todo to one parent only. Unlike server-auto-created todos (which use
  `createTxCollectionCUD` and live under both the issue and `time.space.ToDos`),
  a CLI-created todo appears under the issue but **not** in the assignee's
  personal todo list. Use `--owner <email>` to additionally point `user` at a
  person, or omit `--attached-to` entirely to attach the todo to a `Person`.
- `complete` / `delete` may trigger issue status rollback or advance (when the
  todo is attached to an issue).
- `schedule` on a `Backlog`/`Todo` issue-attached todo can auto-advance the
  issue's status to the next `Active` state.
See [Platform behaviors & best practices](#platform-behaviors--best-practices).

---

### document

```bash
huly document list
huly document create --title "..." [--body <md>] [--body-file <path>]
                      [--teamspace <name>] [--parent <ref>] [--description] [--archived]
huly document update <ref> [--title] [--body] [--body-file] [--old-text] [--new-text]
                         [--replace-all]
huly document delete <ref...> [--yes]
huly document snapshots <ref>    # list version snapshots
huly document snapshot <ref>     # get a specific snapshot (by ID)
huly document inline-comments <ref>
```

**`--body` vs `--old-text/--new-text`:** These are mutually exclusive.
Full body replace with `--body`; targeted substitution with `--old-text`
+ `--new-text`. The substitution throws if `--old-text` appears 0 times
(unless `--replace-all`).

**Auto-teamspace:** On first document create in a workspace with no
teamspaces, the CLI auto-creates a default `General` teamspace.

**Best practices & side effects:**
- Body is stored as raw Markdown (the SDK's `MarkupContent` upload is
  bypassed on this selfhost because the `createMarkup` RPC throws).
- Any `@mention` in the body creates a backlink and an inbox notification for
  the mentioned user (subject to their notification prefs).
- Documents created from `huly document create` are nested under a teamspace;
  if you want flat-by-Type organization, use cards instead (see `cards/`
  docs).
- For controlled documents, `--state` transitions are gated by an approval
  workflow: Author → Reviewer → Approver e-signatures are enforced in that
  order, and inline comments must be resolved before approval.

---

### teamspace

Document teamspaces.

```bash
huly teamspace list
huly teamspace get <ref>
huly teamspace create --name "Engineering" [--description] [--private]
huly teamspace delete <ref...> [--yes]
```

---

### calendar

Calendar events, recurring events, and calendars.

```bash
huly calendar calendars                            # list calendars (NOT events)
huly calendar create-calendar --name "Work" [--description] [--private] [--access owner|team|public]
huly calendar delete-calendar <ref>

huly calendar list                                 # list events
huly calendar get <eventRef> [--markdown]          # events have --markdown body
huly calendar create --title "..." [--start ISO] [--end ISO] [--attendee email@...]
                  [--location] [--all-day] [--description] [--body <md>]
                  [--calendar-id <ref>] [--rrule "FREQ=DAILY;COUNT=3"]
huly calendar update <eventRef> [--title] [--start] [--end] [--attendee]
huly calendar delete <eventRef...> [--yes]

huly calendar recurring                            # list recurring event definitions
huly calendar recurring-instances <recRef>         # list materialized instances
```

**Date format:** ISO 8601 with timezone, e.g. `2026-07-01T14:00:00Z`.
The CLI does not parse natural-language dates — use `date -u -d "..."`
or similar to generate.

**RRULE format:** iCalendar RFC 5545, e.g. `FREQ=DAILY;COUNT=3`,
`FREQ=WEEKLY;BYDAY=MO,WE,FR`. Use `recurring-instances` to see what got
materialized.

**`calendars` vs `get`:** confusingly, `calendar get <ref>` returns
EVENTS (not calendars). To fetch a calendar's metadata, use
`calendar calendars --json` and grep for `_id`.

---

### schedule

Calendar schedules (owner availability).

```bash
huly schedule list
huly schedule create --owner <userUuid> [--time-zone UTC] [--description]
                     [--duration 30] [--interval 30]
huly schedule update <ref> [...]
huly schedule delete <ref...> [--yes]
```

**`--owner`:** UUID of the account that owns the schedule (typically the
current user). Resolve via `huly user get --json | jq -r '._id'`.

---

### time

Time tracking on issues.

```bash
huly time log --issue TSK-1 --minutes 30 --description "did thing"
huly time log --issue TSK-1 --hours 2 --description "pair programming"
huly time report --from 2026-06-01 --to 2026-06-30 [--user email@...] [--project TSK]
huly time delete <entryRef...> [--yes]
```

**Best practices & side effects:** logging time on an issue updates that
issue's `reportedTime` and recomputes `remainingTime`. If the issue has a
parent, the change walks up the parent chain automatically (`OnIssueUpdate`).
There is no opt-out — script accordingly.

---

## Common workflows

### Bootstrap a new project

```bash
# Create the project
huly project create --name "Q3 Initiative" --identifier Q3I --description "Q3 goals"

# Add statuses (web UI recommended — CLI doesn't expose status creation)
# Add components
huly component create --project Q3I --label "API"
huly component create --project Q3I --label "Web"

# Add milestones
huly milestone create --project Q3I --label "v1.0" --due 2026-09-30

# Create the first issue
huly issue create --project Q3I --title "Set up CI pipeline" --priority High \
                   --assignee alice@example.com --label backend
```

### Bulk-archive old issues

```bash
huly issue list --status-category Won --limit 1000 --json \
  | jq -r '.[]._id' \
  | xargs -I{} huly issue move {} --parent null --yes
```

### Daily activity report

```bash
# Issues created today
huly issue list --limit 100 --json | \
  jq -r '.[] | select(.createdOn > (now - 86400) * 1000) | "\(.identifier): \(.title)"'

# Time logged today
huly time report --from $(date -u +%Y-%m-%d) --to $(date -u +%Y-%m-%d)
```

### Migration: move issues between projects

```bash
# Get all issue IDs in old project
IDS=$(huly issue list --project OLD --json | jq -r '.[]._id')

# Move each to new project (cannot bulk — CLI moves one at a time)
for id in $IDS; do
  huly issue move "$id" --project NEW --yes 2>&1 | head -1
done
```

### Find and fix orphan docs

```bash
# Documents whose teamspace was deleted
huly document list --json | \
  jq -r '.[] | select(.space == null) ._id' \
  | xargs -I{} huly document delete {} --yes
```

---

## Platform behaviors & best practices

The Huly server runs server-side triggers on most transactions. This means a
single CLI command can cascade into side effects the user did not explicitly
request — auto-created `ProjectToDo`s, inbox notifications, parent-estimate
recomputations, cascade-deletes, and more. The CLI is intentionally a thin
wrapper over the SDK, so these behaviors apply equally whether the action
came from the CLI, the web UI, or an integration.

This section catalogs the behaviors a CLI user is most likely to encounter,
grouped by surface. Use it as a reference when a command produces an
unexpected result.

> **Gating:** many tracker/todo behaviors below only fire for projects whose
> `ProjectType.classic` is `true`. Default Tracker projects are classic;
> Recruit and Lead projects are not. There is no per-workspace toggle.

### Issues & ToDos (the cascade everyone hits)

| User action (CLI) | Server-side side effect |
|---|---|
| `huly issue create --assignee <email>` (in a classic project, status `Todo`/`In Progress`) | Auto-creates a `ProjectToDo` for the assignee; sends inbox notification. |
| `huly issue create --assignee <email>` (status `Backlog`/`Done`/`Canceled`) | No auto-todo. Status must be `Todo` or `In Progress` (status **category**, not name). |
| `huly issue update <ref> --assignee <email>` (assignee changes) | Closes all open `ProjectToDo`s on the issue (`doneOn = now`), then creates a new `ProjectToDo` for the new assignee. |
| `huly issue update <ref> --status <name>` moving to `Done`/`Canceled` | All open `ProjectToDo`s on the issue are marked done. |
| `huly issue update <ref> --status <name>` moving to `Todo`/`In Progress` + assignee set + no todos exist | Creates the first `ProjectToDo`. |
| `huly action delete <ref>` (when this is the last open todo on its issue) | Issue status auto-rolls back to the previous un-started status in the workflow. |
| `huly action schedule <ref>` (first `WorkSlot` on a todo whose issue is `Backlog`/`Todo`) | Issue status auto-advances to the next `Active` status. |
| `huly action complete <ref>` (completing the last open todo) | May auto-advance the issue status past the last `Active` state (driven by `IssueToDoDone` mixin on classic projects). |
| `huly time report ...` (logging time on an issue with a parent) | Updates `reportedTime` / `remainingTime` on the issue **and walks up to parents** automatically (`OnIssueUpdate` recomputes the chain). |
| `huly issue update <ref> --title ...` | Propagates the new title into `parentTitle` on every sub-issue's `parents[]`. |
| `huly issue move <ref> --parent ...` | Rewrites the issue's `parents[]` chain; recomputes parent `childInfo`. |
| `huly issue create --parent <ref>` | The new issue inherits the parent's space and appears under it. |

### Tasks (`action` / Planner ToDos)

| User action | Side effect |
|---|---|
| `huly action create --attached-to <issueRef> --attached-to-class tracker:class:Issue` | Attaches to **one** parent only. Unlike server-auto-created todos (which use `createTxCollectionCUD` and live in both the issue's `todos` collection and `time.space.ToDos`), a CLI-created todo is a single-parent doc — it appears under the issue but **not** in the assignee's personal todo list unless you also `--owner <email>` and omit `--attached-to`. There is currently no CLI flag to mimic the dual-parent shape. |
| `huly action update <ref> --title/--description/--visibility` | Mirrors the change to all `WorkSlot`s of that todo (`OnToDoUpdate`). |
| `huly action complete <ref>` | Removes/crops future `WorkSlot`s; on an attached issue, may auto-advance status (`OnToDoUpdate` → `IssueToDoDone`). |
| `huly action delete <ref>` | Triggers `OnToDoRemove`. If it was the last open todo on an issue, the issue's status rolls back. |
| `huly action schedule <ref> --start ... --duration ...` | Creates a `WorkSlot` (`OnWorkSlotCreate`). The first `WorkSlot` on an issue-attached todo can auto-advance the issue's status. The todo's `visibility` change mirrors to the `WorkSlot` (`OnWorkSlotUpdate`). |
| `huly action unschedule <ref>` | Removes `WorkSlot`s; if the todo had a status that was auto-advanced by `OnWorkSlotCreate`, the rollback only happens via `OnToDoRemove`. |

### Projects, components, milestones, templates

| User action | Side effect |
|---|---|
| `huly project delete <ref>` | Cascade-deletes **all** `Issue`, `Component`, `Milestone`, `IssueTemplate` in the project; sets broadcast target filter to drop notifications (`OnProjectRemove`). |
| `huly component delete <ref>` | Every issue with that component gets `component: null` (orphans are detached, not deleted) (`OnComponentRemove`). |
| `huly project create --name X` | Identifier is auto-generated from the title and can be edited. Default space type is `Classic project`; default task type is `Issue` with states `Backlog`/`Todo`/`In Progress`/`Done`/`Canceled`. |
| `--auto-join` on a project / channel | Only **future** workspace members are added. Existing members are not retroactively added. |
| `huly issue-template` create/delete | Templates are project-scoped — usable only on issues in the project they were created in. |

### Chat, channels, DMs, threads, comments

| User action | Side effect |
|---|---|
| `huly channel send` / `huly dm send` / `huly thread send` | Auto-creates `ChatMessage`; sender + every `@`-mentioned person (parsed from the markup via `extractReferences`) are auto-added as `core.class.Collaborator` on the attached doc. On channel sends, the sender is auto-joined to the channel. Each collaborator and mention gets an inbox notification. |
| `huly comment add <issueRef> ...` | Issue comments are `ChatMessage`s stored in the issue's `comments` collection; same auto-collaborator + auto-notification rules apply. |
| `huly dm send --message "@alice ..."` | `@mention` resolves from workspace members by display name and creates a backlink; the recipient gets an inbox notification (subject to their notification prefs). |
| New workspace | `#general` and `#random` channels are auto-created; archiving them requires Spaces Admin. |
| `huly channel archive` | Allowed only for the owner/creator of the channel; for the auto-created system channels (`#general`/`#random`), Spaces Admin or Workspace Owner is required. |
| `huly channel update --private true` | Private channels still appear in the sidebar — users must request access. Use a group DM (not a channel) for hidden conversations. |
| `huly dm ...` "close conversation" | Hides from sidebar; message history is preserved. |
| Inline comments on issues / docs | **Not** linked to inbox notifications or chat; resolving an inline comment thread **deletes** all comments in it (cannot be undone). |

### Documents, controlled documents, training

| User action | Side effect |
|---|---|
| `huly document create` | Body is stored as raw Markdown string (the SDK's `MarkupContent` upload is bypassed because the collaborator's `createMarkup` RPC throws on this selfhost). |
| `huly document update --state effective` (ControlledDocument → `Effective`) | All older `Effective` versions of the same template are auto-archived; `DocumentMeta.title` is rewritten to `"<code> <title>"`; if the document has `documents.mixin.DocumentTraining` enabled, `training.class.TrainingRequest` is auto-created per trainee. |
| Edit a ControlledDocument after review | The document must be re-reviewed before it can be approved (`OnDocTitleChanged`/`OnDocHasBecomeEffective`). Inline comments must be resolved before approval. |
| Author / Reviewer / Approver e-signatures | Order is enforced: **Author must sign before Reviewer/Approver** can sign. |
| `huly document create` (first in a workspace) | A "Records" Drive is pre-created; metadata (code/prefix/category) is editable only during the initial draft phase. |
| `huly document update --transfer` | Requires archive rights on source + create rights on destination; doc must be in current product version. |
| Training assigned before being released | Blocked — must `Release` the training first. |
| Trainee exhausts max attempts | No auto-retry; a new `TrainingRequest` must be issued. |

### Cards & types

| User action | Side effect |
|---|---|
| Add an attribute to one card of a Type/Tag | The field is added to **all existing cards** of that Type or Tag (`OnCardTag` mixin). |
| Define a Relation between Types A ↔ B | Bi-directional: shows up on both A and B cards automatically. |
| Define a Reference (not Relation) | One-directional on A; usable as sort/filter criterion; cannot be made back-link later. |
| Delete a Card Type | Cascade-deletes **all** cards of that Type — cannot be undone. |
| Delete the `File` Type | Refused (system type). |
| Upload a file to a File Card | The file is permanently attached — no delete. |
| Reparent a Card | Increments new parent's `children`, builds `parentInfo[]`, and **rolls back on cycle detection**. |
| Derive a Type from another | Sub-types auto-inherit all parent properties. |
| Save a filtered Card view | Can be Public (workspace-wide) or Private (only you). |

### People, employees, contacts

| User action | Side effect |
|---|---|
| Invite via invite link | New joiner is automatically added as `Employee` (`OnPersonCreate` → `OnEmployeeCreate`). |
| `huly user add <email>` (Employee creation) | Sends an invite email — user can only sign up with that email. |
| Deactivate / kick an Employee | Marks inactive, **retains the contact** for object integrity. Re-invite via "Resend Invite" rather than re-create. |
| Activate an Employee (`OnEmployeeCreate`) | Creates the user's private `PersonSpace`, auto-joins all `core.class.Space` with `autoJoin: true`, and (for `Owner` role) auto-assigns ownership of any `TypedSpace`/`CardSpace` with empty `owners`. Also auto-creates a default `Calendar` ("HULY"). |
| Activate an Employee (in HR-enabled workspaces) | Auto-adds `hr.mixin.Staff` with `department: Head`; walks the department hierarchy on `Staff.department` change. |
| GitHub integration collaborator | Auto-created as `Person` contact (no workspace access unless invited separately). |
| Merge Person + Employee | Combines into one record (use when same person joins from two paths). |
| Custom contact fields | Only `Contact` and `Task` classes are customizable. Supported types: URL, String, Boolean, Number, Date, Enum. Ref and Array are not yet implemented. |
| Hide vs Remove property | Hide keeps data; Remove deletes property and data. |

### Notifications & inbox

| User action | Side effect |
|---|---|
| Any `create`/`update`/`delete` via the CLI | Emits an `ActivityMessage` in the doc's `docUpdateMessages` and a collaborator inbox notification (`ActivityMessagesHandler`), unless the class has the `IgnoreActivity` mixin or is a `Card` with `serverCard.metadata.CommunicationEnabled`. |
| `@mention` someone in chat or a doc | Auto-resolves to a `Person` ref, creates a backlink in the recipient's notifications, and the recipient gets an inbox notification subject to their per-provider prefs. |
| Telegram reply to a notification | Appears in Huly as a thread reply in the originating message. |
| Per-thread unsubscribe (three-dot → unsubscribe) | Only available in the web UI; not currently exposed via the CLI. |
| Hover-peek in inbox | Lets you preview without marking the message Read. |
| Delete a `ChatMessage` | Removes all `InboxNotification` rows whose `attachedTo` points at it (no dangling notifications). |
| Web-push | Sends to recipient's `PushSubscription`s only when `serverNotification.metadata.WebPushUrl` is configured server-side. |

### Integrations

| Integration | Behavior |
|---|---|
| GitHub linked repo | Issues/comments/PRs sync bidirectionally; "Create issue without GitHub" override creates a Huly-only issue. |
| Gmail connected | Past emails with each contact back-fill onto the contact page on first connect. |
| Telegram | Multi-workspace requires `/sync_all_channels` in the bot menu; replies to notifications become thread replies in Huly. |
| Google Calendar sync | Pre-sync Huly events don't retroactively push to Google; visibility maps (`Public` ↔ `Visible to everyone`, `Private` ↔ `Only visible to you`). Disconnecting Google does not delete already-synced events. |
| Recording in a meeting | Auto-saves to Drive, visible to anyone with Drive access. |
| Live transcription (Hulia) | Currently workspace-wide visibility; privacy hardening planned. |
| `PublicLink` create with empty `url` | Server auto-fills `url` with a signed JWT — no CLI action needed. |

### Roles & permissions (relevant to CLI scripting)

| Role | CLI-relevant limits |
|---|---|
| `OWNER` | Required for `workspace delete`, `member`, `rename`, `guests`, `access-link`. Only OWNER/Maintainer can create spaces, projects, or manage task types. |
| `MAINTAINER` | Cannot delete the workspace, remove owners, or change their own role. |
| `GUEST` | Limited to spaces explicitly flagged as `Guest`-accessible; can only create/update/delete in those. |
| `READONLY` | All write attempts rejected. |
| `Spaces Admin` | Can archive system channels (`#general`/`#random`). |
| TraceX roles | `Qualified User`, `Manager`, `QARA` for controlled-document workflows. |
| Private space + `autoJoin` | New workspace members auto-added regardless of explicit member list. |

### Best practices for CLI users

1. **Expect cascades.** Treat `huly issue update --assignee ...` as "assign + create todo + notify", not just "assign". When scripting, factor in that the operation produces downstream inbox notifications for the assignee.
2. **Use `huly action list --issue <ref>` to verify.** After updating an issue, list its todos to confirm the server-side behavior matched expectations.
3. **Check `projectType.classic` before relying on todo automation.** Custom Tracker space types may have `classic: false`. Use `huly project get <ref> --json` and inspect.
4. **Prefer `--json` for verification.** Side-effect objects (todos, inbox notifications, activity messages) emit in transactions; pair mutations with `huly <resource> get <ref> --json` to verify state.
5. **Use `huly issue preview-delete <ref...>` before destructive ops.** Deletions cascade aggressively (project → issues/components/milestones/templates; card type → cards).
6. **Schedule via `huly action schedule` rather than raw `WorkSlot` create.** `OnWorkSlotCreate` only auto-advances issue status on the **first** slot, and only when current status is `Backlog`/`Todo` in a classic project.
7. **Time reports propagate to parents.** Logging time on a sub-issue updates the parent's `reportedTime`/`remainingTime`. There's no opt-out.
8. **Refuse shortcuts that hide side effects.** The CLI is intentionally thin; "this only updates one field" is rarely true. If a side effect is undesirable (e.g., you don't want todos auto-created), work around it: e.g., update the issue without `--assignee`, then call `huly action create` separately.
9. **Inline comments are not notifications.** Resolve them through the web UI; the CLI does not surface the `Resolve inline comment` action.
10. **Document state changes are gated by approval flow.** `huly document update --state effective` only works after the review/approval workflow has produced all required signatures (Author → Reviewer → Approver).

---

## Output mode reference

| Command category | Default | `--json` | `--markdown` |
|---|---|---|---|
| `list` | Table | Array of full objects | N/A |
| `get <ref>` | Table (key fields) | Full object | Body as markdown text |
| `create` / `update` / `delete` | One-line confirmation | `{ _id, created: bool, ... }` | N/A |
| `whoami` | Multi-line | Object | N/A |
| `login` | One-line | One-line | N/A |

### When to use `--json`

Use `--json` whenever:
- You're piping to `jq`, `xargs`, or another tool
- You're writing a script that needs the `_id` field
- You want to assert specific fields in CI
- You want full objects instead of truncated table rows

Avoid `--json` when:
- You're interactively exploring (tables are more readable)
- You want body content (use `--markdown` instead)

---

## Class ID reference

The platform's class hierarchy. Used as `_class` in JSON, as class IDs in
escape-hatch calls, and as class filters in queries.

| Plugin | Class ID pattern | Examples |
|---|---|---|
| `core` | `core:class:*` | `Account`, `Space`, `Type`, `Doc`, `Obj` |
| `contact` | `contact:class:*` | `Person` |
| `tracker` | `tracker:class:*` | `Project`, `Issue`, `IssueStatus`, `Component`, `Milestone`, `IssueTemplate`, `TimeSpendReport`, `TypeIssuePriority` |
| `task` | `task:class:*` | `Task` |
| `board` | `board:class:*` | `Card` |
| `card` | `card:class:*` | `CardSpace`, `MasterTag` |
| `calendar` | `calendar:class:*` | `Event`, `ReccuringEvent`, `ReccuringInstance`, `Calendar`, `Schedule` |
| `document` | `document:class:*` | `Document`, `DocumentSnapshot`, `DocumentEmbedding`, `Teamspace` |
| `chunter` | `chunter:class:*` | `Channel`, `ChatMessage`, `DirectMessage`, `Message`, `ThreadMessage` |
| `time` | `time:class:*` | `ToDo`, `WorkSlot` |
| `notification` | `notification:class:*` | `Notification`, `NotificationContext`, `InboxNotification` (Phase 15 — not yet in CLI) |
| `activity` | `activity:class:*` | `ActivityMessage`, `Reaction`, `SavedMessage` (Phase 14 — not yet in CLI) |
| `approval` | `approval:class:*` | `ApprovalRequest`, `Approval` (Phase 16 — not yet in CLI) |

The CLI's class IDs are in `src/transport/identifiers.ts`. They're the
canonical reference for escape-hatch use.

---

## Plugin / model surface map

For each plugin, what classes the CLI exposes and which are read-only:

| Plugin | CLI surface | Read | Write |
|---|---|---|---|
| core | (used internally) | — | — |
| contact | `user` | `get`, `find` | — |
| tracker | `project`, `issue`, `component`, `milestone`, `issue-template`, `time` | All | All |
| task | `action` (alias for `todo`) | All | All |
| board | `card` | All | All |
| card | `card-space`, `master-tag` | All | `card-space` only (master-tags are read-only) |
| calendar | `calendar`, `schedule` | All | All |
| document | `document`, `teamspace` | All | All |
| chunter | `channel`, `dm`, `thread` | All | All |
| time | (used by `time` commands) | — | — |
| notification | (Phase 15 — not implemented) | — | — |
| activity | (Phase 14 — not implemented) | — | — |
| approval | (Phase 16 — not implemented) | — | — |

---

## Escape hatches

When a CLI command doesn't exist for what you need, use the raw RPC
escape hatches. These pass through directly to the server.

### HTTP (`huly api`)

```bash
huly api GET /api/v1/version
huly api GET /config.json
huly api POST /api/v1/something --body '{"key":"value"}'
huly api GET /api/v1/things --query foo=bar --query baz=qux
huly api GET /api/v1/things --header "Authorization: Bearer ..."
```

Available methods: `GET | POST | PUT | PATCH | DELETE`. The path is
appended to the workspace's API URL.

### WebSocket (`huly ws`)

The Huly RPC protocol uses WebSocket. Use the `ws` command for direct
method calls:

```bash
# findAll
huly ws findAll '{"_class":"tracker:class:Project"}' '{}'

# findOne
huly ws findOne '{"_class":"tracker:class:Project"}' '{"identifier":"TSK"}'

# createDoc
huly ws createDoc 'tracker:class:Project' 'core:space:Space' \
  '{"identifier":"NEW","name":"New project"}'

# tx (raw transaction)
haly ws tx '{"_class":"core:class:TxCreateDoc",...}'
```

Method names mirror the SDK's `PlatformClient` interface. See
`node_modules/@hcengineering/api-client/lib/client.js` for the full list.

### When to use escape hatches

- A command exists but doesn't expose the flag you need (rare)
- A command exists but operates on a wrong sub-resource
- You're doing batch operations and need to skip validation
- You're debugging and need to see the raw server response
- The CLI doesn't support the surface you need (use the SDK instead)

---

## Internal architecture

### Layout

```
src/
  cli.ts              # top-level command registration (1000+ LOC)
  index.ts            # entry point + Node shims (window, localStorage)
  auth/
    client.ts         # login, accountClient, connectPlatform
    cache.ts          # token cache (credentials.json)
    env.ts            # env var loading
  resources/
    _helpers.ts       # shared command helpers
    _project-resolve.ts
    project.ts        # project CRUD
    issue.ts          # issue CRUD + relations + labels + moves
    component.ts      # component CRUD
    milestone.ts      # milestone CRUD
    issue-template.ts
    comment.ts
    channel.ts        # channel CRUD + members + messages
    dm.ts             # (in channel.ts)
    thread.ts         # (in channel.ts)
    card.ts           # card module
    card-space.ts     # (in card.ts)
    master-tag.ts     # (in card.ts)
    action.ts         # planner tasks
    document.ts       # documents + teamspaces + snapshots
    teamspace.ts      # (in document.ts)
    calendar.ts       # events + recurring + calendars + schedules
    schedule.ts       # (in calendar.ts)
    time.ts           # time tracking
    user.ts           # profile + person lookup
    workspace.ts      # workspace ops
    todo.ts           # (legacy todo; replaced by action)
    project.parse.ts  # project parsing helpers
    misc.ts           # misc utilities
  transport/
    sdk.ts            # connectCli, connectAccountCli, resolveWorkspace
    identifiers.ts    # CLASS, CLASS_ICON, ref helpers
    ref-resolver.ts   # ref → Ref<Doc> resolution
  output/
    format.ts         # table, json, kv, withTimeout
    progress.ts       # withSpinner
    errors.ts         # CliError, ExitCode
  commands/
    dry-run.ts        # dry-run helpers
scripts/
  smoke.sh            # phase-based smoke test (13 phases)
docs/
  HANDOVER.md         # session handover
  issues.md           # historical issue inventory
  learnings.md        # detailed learnings
  open-issues.md      # currently-open issues (excluding verified fixes)
```

### Connection flow

1. `huly --workspace prod issue list`
2. `globalsFrom(cmd)` extracts `--workspace prod` from the parsed Command
3. `connectCli({ workspace: 'prod' })` resolves workspace name → URL/UUID
4. `connectPlatform(...)` reads token from cache, falls back to env login
5. SDK opens WebSocket to transactor, loads model
6. `client.findAll(CLASS.Issue, { ... })` issues server-side query
7. CLI formats result as table/JSON

### Markup handling

The SDK's `processMarkup` calls the collaborator's `uploadMarkup` RPC
on every `MarkupContent` instance. This throws on this selfhost because
the collaborator's `createMarkup` has a hocuspocus hang.

**Workaround:** the CLI passes body content as raw strings instead of
`new MarkupContent(body, 'markdown')`. The SDK's else branch passes
strings through unchanged. The read path (`get --markdown`) falls back
to returning the raw body string when markup resolution fails.

This means `get --markdown` returns the raw body for CLI-created docs
(always correct) and the ref string for web-UI-created docs (rare on
this selfhost, since only CLI creates docs).

---

## Environment variables reference

| Variable | Default | Description |
|---|---|---|
| `HULY_URL` | (none) | Base URL of your Huly server |
| `HULY_EMAIL` | (none) | Account email for password login |
| `HULY_PASSWORD` | (none) | Account password for password login |
| `HULY_TOKEN` | (none) | Pre-issued account JWT (skips login) |
| `HULY_WORKSPACE` | (none) | Default workspace (URL name or UUID) |
| `HULY_PROJECT` | (none) | Default project for bare-number issue refs |
| `HULY_TEAMSPACE` | (none) | Default teamspace for document creation |
| `HULY_NONINTERACTIVE` | 0 | Set to 1 to disable all prompts |
| `HULY_LOG` | (none) | Log level: `debug | info | warn | error` |
| `HULY_LOCALSTORAGE` | (none) | Path for SDK's localStorage shim (rarely needed) |
| `NO_COLOR` | (none) | Set to 1 to disable colored output |

---

## Troubleshooting

### "permission denied to create schema" on account pod startup

The cockroach `selfhost` user lacks the `CREATE` privilege on `defaultdb`.
This happens after `docker compose down -v` (which wipes the volume and
recreates the user without privileges).

**Fix:**
```bash
docker exec -e PGPASSWORD=... huly_v7-cockroach-1 \
  /cockroach/cockroach sql --insecure -d defaultdb -u root \
  -e "GRANT CREATE ON DATABASE defaultdb TO selfhost"
```

The password is `CR_USER_PASSWORD` from `~/huly-selfhost/.env`.

### "Forbidden" on workspace delete / members / region operations

The deployed `account:local-fix` image uses MongoDB code paths even
though the selfhost runs Postgres. This is a build-artifact mismatch —
the deployed bundle has the wrong collection implementation.

**Fix:** rebuild `account` from the `fix/server-issues-2026-06` branch:
```bash
cd ~/platform
PATH=/tmp/node22/bin:$PATH ./scripts/docker.sh --tool rush build --to-version-only account
docker build -t hardcoreeng/account:local-fix -f docker/images/account/Dockerfile .
docker compose -f ~/huly-selfhost/compose.yml up -d --force-recreate account
```

### "no IssueStatus in workspace" on issue create

The workspace's tracker migration didn't seed IssueStatuses. The CLI
cannot auto-seed on workspaces with incomplete local model state.

**Fix:** create statuses via the web UI once, or run the tracker
migration manually:
```bash
# Manual SQL seed (use with caution)
docker exec -u root huly_v7-cockroach-1 /cockroach/cockroach sql \
  --url 'postgresql://root@127.0.0.1:26257/defaultdb?sslcert=...' \
  -e "INSERT INTO global_tracker.class_xxx ..."
```

Or recreate the workspace (the seed runs on workspace creation).

### "no document found, failed to apply model transaction" warnings

These appear in transactor logs on every CLI command. They are the
workspace pod's model-upgrade loop retrying update txes whose target
class doesn't exist yet. Cosmetic only — does not affect functionality.

**Tracking:** Fix #3 (model-upgrade retry) helps but doesn't fully clear
the warnings. A deeper fix requires N-pass retries or tx re-ordering.

### Component/milestone create succeeds but list returns 0

Sub-resource create→list roundtrip is broken on this selfhost.
Tracked as C2 in `docs/open-issues.md`.

**Workaround:** the doc was created (CLI returned an _id). Just don't
rely on the list query. Future CLI versions will track created IDs
in a local index instead of relying on server-side findAll.

### "Error: connect ECONNREFUSED" on first call after server restart

The CLI caches connections. After the server restarts, the next call
will fail with a connection error. Run any command again — the CLI
reconnects transparently.

### Token expired errors

JWTs expire after a server-configured TTL (default ~7 days). When
expired, you get `Unauthorized`:

```bash
rm ~/.config/huly/credentials.json
huly login --headless
```

### "Cannot add option '--non-interactive' to command 'huly'"

This error occurs if you have a custom CLI script that re-attaches
global options without skipping `--non-interactive`. The fix: pass
`{ skipNonInteractive: true }` when attaching to the program command.

---

## Performance & limits

### Connection pooling

The CLI opens one WebSocket per invocation. There's no keepalive across
invocations. Each `huly <cmd>` is a fresh process, so model reload happens
every time.

For long-running scripts that make many CLI calls, prefer inlining via
the SDK directly:

```js
import { connect } from '@hcengineering/api-client'
const client = await connect(url, { workspace, token })
// ... reuse client
await client.close()
```

### Query limits

Default `--limit` is unlimited (server caps at chunked response size).
For predictable response sizes:
```bash
huly issue list --limit 100
```

### Timeouts

| Operation | Timeout |
|---|---|
| Login | 30s |
| Connection | 30s |
| findAll | 60s (then chunked) |
| Markup fetch (read) | 5s (with fallback) |
| Ping/pong | 30s |

The CLI never silently hangs. If an operation times out, you get an
explicit error.

### Bulk operations

For >1000 docs, prefer chunked scripts:

```bash
huly issue list --limit 1000 --offset 0   # batch 1
huly issue list --limit 1000 --offset 1000  # batch 2
```

The SDK supports `{limit, total: true}` for accurate counts but the
CLI's --limit/--offset doesn't expose it.

---

## Security model

### What the CLI does

- Loads credentials from env or `~/.config/huly/.env` (mode 0600)
- Caches JWTs to `~/.config/huly/credentials.json` (mode 0600)
- Connects over TLS to the server (no plaintext HTTP)
- Never logs tokens (not even at debug level)
- Validates server certs (no self-signed bypass)

### What the CLI does NOT do

- Does NOT handle password rotation (CLI just reads `HULY_PASSWORD`)
- Does NOT enforce workspace-level RBAC (the server does)
- Does NOT store secrets in source control (use `.env` outside git)
- Does NOT support OAuth or SSO (password login only)
- Does NOT support TOTP / 2FA login (server-side only)

### Credential storage recommendations

For personal use: the defaults (mode 0600) are fine.

For shared CI runners: use `HULY_TOKEN` with a service-account JWT, never
embed passwords. Set short TTLs on the token.

For production automation: consider a secrets manager (Vault, AWS
Secrets Manager, etc.) that injects env vars at runtime.

### Threat model

The CLI assumes:
- The server is trusted (run it on your own infrastructure)
- The local filesystem is trusted (no other users can read ~/.config/huly/)
- The shell environment is trusted (env vars may be logged by parent processes)

If any of these don't hold, the CLI's threat model is violated.

---

## Compatibility matrix

### Server versions tested

| Huly version | Status | Notes |
|---|---|---|
| 0.7.423 (local-fix images) | ✅ Fully tested | All 13 implemented smoke phases pass |
| 0.7.422 | ⚠️ Mostly works | MODEL_VERSION mismatch on workspace pod |
| 0.7.421 and earlier | ❌ Not tested | API may have changed |

### Node versions tested

| Node | Status |
|---|---|
| 22.11 | ✅ Recommended |
| 24.x | ✅ Works |
| 26.x | ❌ Fails rush build check |
| 20.x | ❌ Missing crypto features |

### OS tested

- Linux (Ubuntu 22.04, Debian 12) — primary development platform
- macOS (14.x Apple Silicon) — secondary; works
- Windows (10, 11 with WSL2) — works via WSL
- Native Windows — untested; use WSL

---

## Development

### Setup

```bash
git clone https://github.com/iamcoder18/huly-cli.git
cd huly-cli
npm install
npm run build       # compile TS → dist/
npm run dev         # watch mode (tsc --watch)
node dist/index.js  # run CLI
```

### Run the smoke test

```bash
# All phases
bash scripts/smoke.sh all

# One phase
bash scripts/smoke.sh 6

# With debug output
DEBUG=1 bash scripts/smoke.sh 0
```

### Project conventions

- TypeScript strict mode (no `any` except at API boundaries)
- camelCase functions, PascalCase classes, SCREAMING_SNAKE constants
- One resource per file in `src/resources/`
- New class IDs go in `src/transport/identifiers.ts`
- Each new command must have a corresponding smoke test
- Help text MUST describe each flag, even if obvious
- Errors throw `CliError(ExitCode.X, msg, hint?)` — never raw `Error`

### Adding a new command

1. Add the resource function in `src/resources/<surface>.ts`
2. Add the class ID to `src/transport/identifiers.ts`
3. Wire the command in `src/cli.ts` (find the relevant `program.command(...)`)
4. Add a smoke test case in `scripts/smoke.sh`
5. Update `README.md` with the new command
6. Run `npm run build && bash scripts/smoke.sh all`

### Adding a new resource (e.g. Phase 11's `space`)

1. Create `src/resources/space.ts`
2. Add class IDs to `src/transport/identifiers.ts`
3. Wire 10+ subcommands in `src/cli.ts`
4. Add a phase to `scripts/smoke.sh` (increment the phase number)
5. Update `README.md` with the new resource section
6. Run `bash scripts/smoke.sh all`

---

## Cross-references

- `docs/HANDOVER.md` — what to read first when resuming work
- `docs/learnings.md` — detailed server architecture and gotchas
- `docs/issues.md` — historical bug inventory (2026-06-27)
- `docs/open-issues.md` — current open issues (excludes verified fixes)

---

## License

Eclipse Public License 2.0 (matching the upstream platform).

```
This program and the accompanying materials are made available under the
terms of the Eclipse Public License 2.0 which is available at
https://www.eclipse.org/legal/epl-2.0/
```
---

## Server architecture (deep dive)

This section explains how the CLI interacts with the Huly server. Useful
for debugging, performance tuning, and writing automation.

### Service map

The selfhost has ~16 services. The CLI talks to four of them:

| Service | What the CLI does with it |
|---|---|
| `account` (port 3000) | Login, workspace ops, account token management |
| `transactor` (port 3333) | WebSocket RPC: findAll, findOne, createDoc, updateDoc, tx, loadModel |
| `collaborator` (port 3078) | Read path only: fetchMarkup, getContent. The CLI's read timeout (5s) covers this. |
| `nginx` (port 80, behind caddy on 443) | Reverse proxies the above. TLS terminator is caddy on the host. |

The CLI never talks to `workspace`, `kvs`, `minio`, `redpanda`, `elastic`,
`cockroach`, or `front` directly. Those are server-internal.

### Database layout (cockroach)

CockroachDB holds everything. Two schemas per workspace:

**`defaultdb` (the account DB)** — global across the cluster:
- `global_account.workspace` — uuid, name, dataId (the workspace's DB name)
- `global_account.workspace_status` — mode, is_disabled, processing_attempts, version_*
- `global_account.workspace_members` — (account_uuid, workspace_uuid, role)
- `global_account.account`, `global_account.person`, `global_account.social_id`
- `global_account.region`, `global_account.invite`, etc.

**Per-workspace DB** (named after `workspace.dataId`):
- `public.tx` — the transaction log (every CUD as TxCreateDoc/Update/Remove)
- `public.tracker` — Project, Issue, Component, Milestone, IssueStatus, etc.
- `public.document` — Document, DocumentSnapshot
- `public.calendar` — Calendar, Event, Schedule
- `public.chunter` — Channel, ChatMessage
- `public.time` — ToDo, WorkSlot
- `public.card` — Card, CardSpace, MasterTag
- `public.contact` — Person
- `public.config` — workspace config

**To inspect a workspace's data directly:**
```bash
docker exec -e PGPASSWORD=$CR_USER_PASSWORD huly_v7-cockroach-1 \
  /cockroach/cockroach sql --insecure -d defaultdb -u selfhost \
  -e "SELECT * FROM global_account.workspace_members LIMIT 5"
```

Use cockroach root (cert-based) for full access:
```bash
docker exec -u root huly_v7-cockroach-1 /cockroach/cockroach sql \
  --url 'postgresql://root@127.0.0.1:26257/defaultdb?sslcert=certs/client.root.crt&sslkey=certs/client.root.key&sslmode=verify-full&sslrootcert=certs/ca.crt'
```

### The model — class hierarchy and domain model

The Huly "model" is the sum of all classes registered in the workspace.
Classes are organized into **plugins** (tracker, calendar, chunter, ...).
Each class has a domain (storage bucket):

- `tracker` (DOMAIN_TRACKER): Project, Issue, Component, Milestone, IssueStatus, IssueTemplate, TypeIssuePriority, TimeSpendReport, RelatedIssueTarget
- `calendar` (DOMAIN_CALENDAR): Calendar, Event, ReccuringEvent, ReccuringInstance, Schedule
- `document` (DOMAIN_DOCUMENT): Document, DocumentSnapshot, DocumentEmbedding, Teamspace
- `chunter` (DOMAIN_CHUNTER): Channel, ChatMessage, DirectMessage, Message, ThreadMessage
- `time` (DOMAIN_TIME): ToDo, WorkSlot
- `card` (DOMAIN_CARD): Card, CardSpace, MasterTag
- `core` (DOMAIN_MODEL): Type, Status, ArrOf, EmbValue, and all base classes
- `contact` (DOMAIN_CONTACT): Person

The model's `findAll` behavior depends on the class's domain:
- DOMAIN_MODEL classes: query the local `ModelDb` (in-memory index)
- All other domains: query the server (via WebSocket)

**The CLI's local model is incomplete** (3-key stub). This means queries
against DOMAIN_MODEL classes (TypeIssuePriority, etc.) often return
empty even though the data exists on the server. See the `conn.findAll`
bypass in `src/resources/issue.ts`.

### Workspace lifecycle

A workspace goes through these states (mode column):

```
[created] → pending-creation → creating → active
[upgraded] → pending-upgrade → upgrading → active
[deleted by owner] → pending-deletion → deleting → [gone]
[archived] → archiving-pending-backup → archiving-backup → archiving-pending-clean
          → archiving-clean → archived
[migrated] → migration-pending-backup → migration-backup → migration-pending-cleanup → [deleted]
[restored] → pending-restore → restoring → active
```

The workspace pod polls for pending workspaces and processes them.
`WS_OPERATION` env var controls which states the pod handles:

| WS_OPERATION value | Processes |
|---|---|
| `upgrade` (default) | only `pending-upgrade` |
| `all` (after Fix #5) | `pending-creation` + `pending-upgrade` + `pending-deletion` |
| `all+backup` | all of `all` + `migration-pending-*` + `archiving-pending-*` + `pending-restore` |

For self-hosted single-pod deployments, use `WS_OPERATION=all+backup`.

### The WebSocket protocol

The CLI speaks Huly's binary RPC protocol over WebSocket. Key methods:

| Method | Direction | Purpose |
|---|---|---|
| `hello` | client → server | First message; identifies client (binary mode, compression) |
| `findAll` | client → server | Query; server returns array + total |
| `findOne` | client → server | Single-doc query |
| `loadModel` | client → server | Initial model load (returns txs since last hash) |
| `loadChunk` | client → server | Lazy-load a domain's documents |
| `tx` | client → server | Apply a transaction |
| `updateFromRemote` | server → client | Push a tx (server-initiated) |
| `ping` / `pong` | both | Keepalive |

Chunks are how the server streams large query results. The default chunk
size is whatever fits in a WebSocket frame (~64KB compressed).

### Transaction model

Every write in Huly is a transaction (tx). A tx is one of:
- `TxCreateDoc` — new document
- `TxUpdateDoc` — update document fields
- `TxRemoveDoc` — delete document
- `TxMixin` — attach/update a mixin
- `TxApplyIf` — atomic tx group (commit-on-condition)

The CLI generates these via the SDK's `client.createDoc`, `client.updateDoc`,
etc. Each tx has:
- `_id` — tx UUID (generated client-side)
- `_class` — tx type class
- `space` — where the tx lives (`core:space:Tx`)
- `objectId` — the document being created/updated
- `objectClass` — the doc's class
- `objectSpace` — the doc's space
- `modifiedBy`, `modifiedOn` — actor + timestamp
- `attributes` — the create/update payload

The server applies txs in order, checking model consistency. A tx can be
rejected if:
- The `objectClass` doesn't exist in the model
- A referenced object doesn't exist
- The user lacks permission
- The doc was deleted concurrently

Rejected txs surface as PlatformError. The CLI surfaces these as CliError.

### Markup and y-docs

For content-bearing fields (description, body, content), the platform uses
a markup reference indirection:

1. CLI sends `MarkupContent { content: 'markdown text', kind: 'markdown' }`
2. SDK's `processMarkup` calls `client.uploadMarkup(class, id, attr, text, kind)`
3. Collaborator creates a y-doc with the markdown text
4. The doc's data field stores a `MarkupRef { content: 'blobId' }` instead of the text
5. On read, `client.fetchMarkup(...)` retrieves and renders the y-doc

**Failure mode on this selfhost:** the collaborator's `createMarkup` RPC
hangs (hocuspocus connection timeout). Fix #2 wraps `getContent` in a
3s timeout; the corresponding `createMarkup` fix is **not yet deployed**.
The CLI works around by passing raw strings instead of `MarkupContent`.

This means:
- Write path: body stored as plain string (not a ref) ✓
- Read path: returns raw string for CLI-created docs ✓
- Read path: returns ref string (not rendered text) for web-UI-created docs ⚠

For this selfhost, only CLI creates docs, so the read path is consistent.

### Account-server permission model

The account server gates every method by token type:

| Token type | `extra.service` | Granted methods |
|---|---|---|
| Login token (password / OAuth) | undefined | User-level methods only: login, selectWorkspace, listWorkspaces, findPersonBySocialKey (after Fix #1), getWorkspaceInfo, getSocialIds, etc. |
| Service token | `'tool' \| 'workspace' \| 'aibot' \| 'backup' \| 'payment' \| ...` | Service-level methods: getPendingWorkspace, updateWorkspaceInfo, etc. |
| Admin token | `admin === 'true'` | All methods |

The CLI uses login tokens. Service-to-service calls (e.g. the worker
calling `getPendingWorkspace`) use service tokens.

**Common pitfall:** calling a service-only method with a login token
returns Forbidden. Always use the right token type.

### The model-upgrade queue

When a workspace's `version_major/minor/patch` is less than the server's
current version, the workspace pod applies model-upgrade txs:

1. Pod calls `getPendingWorkspace(this.region, this.version, 'upgrade')`
2. Account server returns workspaces where `version_* < current`
3. Pod loads the model-upgrade txs from the platform's source tree
4. Pod applies them in order
5. Pod calls `updateWorkspaceInfo(workspace, 'upgrade-done', version)`
6. Workspace's `version_*` is bumped, status becomes `active`

The model-upgrade txs are auto-generated from the platform's `@Model(...)`
decorators in `~/platform/models/<m>/src/`. Each plugin contributes a
batch of class-creation txs.

**Known issue:** if the model-upgrade tx batch has internal dependencies
(e.g. an update tx that references a class created by a later tx), the
server applies them in the wrong order and skips update txs whose target
class doesn't exist yet. Fix #3 (1-pass retry) helps but doesn't fully
resolve the issue.

**Symptom:** transactor logs show:
```
no document found, failed to apply model transaction, skipping _class="core:class:TxUpdateDoc"
```

This is cosmetic — doesn't affect runtime behavior. The skipped txs are
typically for older class versions that no longer matter.

### The `dataId` quirk

When you `createWorkspace`, the server assigns a `dataId` (a cockroach
DB name). All subsequent docs for this workspace go into that DB.

**Bug:** if kafka replays a `workspace-deleted` event for a workspace
that was already hard-deleted (e.g. via direct SQL), the worker re-creates
the workspace row **without** a `dataId`. Subsequent operations on this
workspace fail because there's no DB to write to.

**Workaround:** if you hard-delete via SQL, also delete the kafka
events for that workspace. Or just leave the workspace in
`pending-deletion` mode and let the worker process it eventually.

### Backup strategy

Backups are stored in MinIO bucket `huly-backups`. The CLI/server doesn't
configure MinIO lifecycle, so backups accumulate forever unless you set
up ILM externally:

```bash
docker exec huly_v7-minio-1 mc alias set local http://localhost:9000 minioadmin minioadmin
docker exec huly_v7-minio-1 mc mb --ignore-existing local/huly-backups
docker exec huly_v7-minio-1 mc ilm add local/huly-backups --expiry-days 14
```

This sets 14-day expiry on all backups. Adjust as needed for compliance.

### Redpanda SASL bootstrap

The kafka broker (Redpanda) requires SASL auth. During initial bootstrap,
`rpk cluster info -X user=admin -X pass=...` returns `ILLEGAL_SASL_STATE`
because SASL isn't ready yet.

**Fix:** use an unauthenticated metadata probe:
```yaml
healthcheck:
  test: ['CMD-SHELL', 'rpk cluster info --brokers=localhost:9092 || exit 1']
  interval: 10s
  timeout: 5s
  retries: 20
  start_period: 30s
```

Then set `depends_on: { redpanda: { condition: service_healthy } }` on
every kafka-dependent service.

### Workspace version sync

The transactor and workspace pod must be at the **same MODEL_VERSION**
(derived from `~/platform/common/scripts/version.txt`). If they drift,
the transactor's `sessionManager` rejects WebSocket connections:

```
version mismatch: transactor 0.7.422 != workspace 0.7.423
```

**Fix:** keep `~/platform/common/scripts/version.txt` in sync across
builds. After bumping, rebuild all pods that consume the version.

The CLI reads the version from `bundle.js` (the SDK). The server's
`hello` response includes `serverVersion`. The CLI logs `Connected to
server: <version>` on connect.


---

## Migration guides

### Migrating from `huly-mcp` (the MCP server)

If you're using the MCP server (`huly-mcp`) and want to switch to `huly-cli`:

**Same operations, different invocation:**
```bash
# MCP: list_issues
# CLI:
huly issue list --json

# MCP: create_issue
# CLI:
huly issue create --project TSK --title "..." --json

# MCP: get_issue
# CLI:
huly issue get TSK-1 --json
```

**Output format:** both produce JSON arrays. The MCP server wraps
responses in `{ result: [...] }`; the CLI returns raw `[...]`. Strip the
wrapper if you're reusing MCP client code.

**Auth:** both use the same `account-token` JWT. You can reuse the
MCP server's credentials cache by symlinking it:
```bash
ln -s ~/.config/huly-mcp/credentials.json ~/.config/huly/credentials.json
```

**Tool naming:** MCP uses `snake_case` (e.g. `list_issues`); CLI uses
`kebab-case` (e.g. `issue list`). The MCP names map to CLI as:
- `list_<resources>` → `<resource> list`
- `get_<resource>` → `<resource> get`
- `create_<resource>` → `<resource> create`
- `update_<resource>` → `<resource> update`
- `delete_<resource>` → `<resource> delete`
- `<verb>_<resource>` (e.g. `add_comment`) → `<resource> <verb>`

### Migrating from the web UI

If you're used to clicking around in the web UI:

| Web UI action | CLI command |
|---|---|
| Click project in sidebar | `huly workspace use <name>` then `huly project list` |
| Open issue TSK-1 | `huly issue get TSK-1 --markdown` |
| Create new issue | `huly issue create --project TSK --title "..."` |
| Move issue to "Done" | `huly issue update TSK-1 --status Done` |
| Add label "bug" | `huly issue label TSK-1 add bug` |
| Comment on issue | `huly comment add --issue TSK-1 --body "..."` |
| Send DM | `huly dm send --person alice@... --body "..."` |
| Create channel | `huly channel create --name engineering` |
| Create calendar event | `huly calendar create --title "Standup" --start ... --end ...` |
| Log time | `huly time log --issue TSK-1 --minutes 30` |
| Switch workspace | `huly workspace use <name>` |

### Migrating from the Huly SDK (TypeScript)

If you have scripts using the SDK directly:

```ts
// SDK
import { connect } from '@hcengineering/api-client'
const client = await connect(url, { workspace, token })
const issues = await client.findAll('tracker:class:Issue', { space: project._id })
```

```bash
# CLI equivalent (in shell)
huly --workspace $WORKSPACE issue list --project $PROJECT --json
```

The CLI wraps the SDK and handles auth, caching, model loading, and
error formatting. Prefer the CLI for one-off scripts; prefer the SDK
for long-running services.

### Migrating from the REST API

If you're using `curl` against the Huly REST API:

```bash
# REST (raw)
curl -X GET "$HULY_URL/api/v1/version"

# CLI
huly api GET /api/v1/version
```

The CLI's `api` command passes through to the REST API but handles auth
headers automatically. Use it for ad-hoc endpoints the CLI doesn't cover.

### Migrating from the GraphQL API

Huly doesn't ship a GraphQL API. The CLI is the closest equivalent — it
wraps the platform's RPCs into REST-like commands. If you need GraphQL,
you're out of luck.

---

## Recipes

### Recipe: CI integration

```yaml
# .github/workflows/huly-sync.yml
name: Sync CI status to Huly
on: [push]
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @iamcoder18/huly-cli
      - name: Sync status to Huly
        env:
          HULY_URL: ${{ secrets.HULY_URL }}
          HULY_TOKEN: ${{ secrets.HULY_TOKEN }}
          HULY_WORKSPACE: ${{ vars.HULY_WORKSPACE }}
        run: |
          COMMIT_MSG=$(git log -1 --pretty=%B)
          BRANCH=$(git rev-parse --abbrev-ref HEAD)
          huly issue create --project CI --title "$BRANCH: $COMMIT_MSG" \
                            --label auto --label ci --yes
```

### Recipe: Daily standup bot

```bash
#!/bin/bash
# standup.sh — runs daily, posts to #standup channel
set -e

# Get yesterday's issues you closed
CLOSED=$(huly issue list --json | \
  jq -r --arg date "$(date -u -d 'yesterday' +%Y-%m-%d)" \
  '.[] | select(.modifiedOn > ($date | strptime("%Y-%m-%d") | mktime * 1000)) | select(.status == "Done") | "- #\(.identifier) \(.title)"')

# Post to channel
huly channel message create "standup" --body "Yesterday I closed:
$CLOSED
"
```

### Recipe: Bulk-migrate issues

```bash
#!/bin/bash
# migrate-issues.sh — copy issues from one project to another
set -e

SOURCE=$1
DEST=$2
STATUS="open"

IDS=$(huly issue list --project "$SOURCE" --status-category "$STATUS" --json | jq -r '.[]._id')

for id in $IDS; do
  # Get full issue
  issue=$(huly issue get "$id" --json)
  title=$(echo "$issue" | jq -r .title)
  desc=$(echo "$issue" | jq -r .description)
  
  # Create in dest
  huly issue create --project "$DEST" --title "$title" --description "$desc" --yes
  
  echo "migrated: $id ($title)"
done
```

### Recipe: Weekly digest email

```bash
#!/bin/bash
# weekly-digest.sh
set -e

WEEK_AGO=$(date -u -d '7 days ago' +%Y-%m-%d)

# Issues created this week
NEW=$(huly issue list --since "$WEEK_AGO" --json | jq -r '.[] | "- #\(.identifier) \(.title) (\(.assignee // "unassigned"))"')

# Issues closed this week
CLOSED=$(huly issue list --status Done --since "$WEEK_AGO" --json | jq -r '.[] | "- #\(.identifier) \(.title)"')

# Send via your mailer (here we use sendmail)
{
  echo "Subject: Huly Weekly Digest"
  echo
  echo "This week:"
  echo "$NEW"
  echo
  echo "Closed:"
  echo "$CLOSED"
} | sendmail -t
```

### Recipe: Audit orphan documents

```bash
# Find documents with no teamspace
huly document list --json | jq -r '.[] | select(.space == null) | ._id' | \
  xargs -I{} echo "orphan doc: {}"

# Find documents with no author
huly document list --json | jq -r '.[] | select(.createdBy == null) | ._id' | \
  xargs -I{} echo "no-author doc: {}"
```

### Recipe: Backup via cron

```cron
# /etc/cron.d/huly-backup
0 2 * * * huly user get > /dev/null && echo "workspace OK at $(date)" >> /var/log/huly-health.log
```

Or use the Huly server's own backup mechanism (see "Backup strategy" above).

### Recipe: Generate report for management

```bash
#!/bin/bash
# management-report.sh
set -e

cat <<EOF
Weekly Status Report — $(date +%Y-%m-%d)

Open issues: $(huly issue list --status-category Active --json | jq length)
Closed this week: $(huly issue list --status Done --since "$(date -u -d '7 days ago' +%Y-%m-%d)" --json | jq length)

Top contributors:
$(huly issue list --since "$(date -u -d '7 days ago' +%Y-%m-%d)" --json | \
  jq -r '.[].assignee' | sort | uniq -c | sort -rn | head -5)

---

## Migration guides

### Migrating from `huly-mcp` (the MCP server)

If you're using the MCP server (`huly-mcp`) and want to switch to `huly-cli`:

**Same operations, different invocation:**
```bash
# MCP: list_issues
# CLI:
huly issue list --json

# MCP: create_issue
# CLI:
huly issue create --project TSK --title "..." --json

# MCP: get_issue
# CLI:
huly issue get TSK-1 --json
```

**Output format:** both produce JSON arrays. The MCP server wraps
responses in `{ result: [...] }`; the CLI returns raw `[...]`. Strip the
wrapper if you're reusing MCP client code.

**Auth:** both use the same `account-token` JWT. You can reuse the
MCP server's credentials cache by symlinking it:
```bash
ln -s ~/.config/huly-mcp/credentials.json ~/.config/huly/credentials.json
```

**Tool naming:** MCP uses `snake_case` (e.g. `list_issues`); CLI uses
`kebab-case` (e.g. `issue list`). The MCP names map to CLI as:
- `list_<resources>` becomes `<resource> list`
- `get_<resource>` becomes `<resource> get`
- `create_<resource>` becomes `<resource> create`
- `update_<resource>` becomes `<resource> update`
- `delete_<resource>` becomes `<resource> delete`
- `<verb>_<resource>` (e.g. `add_comment`) becomes `<resource> <verb>`

### Migrating from the web UI

If you're used to clicking around in the web UI:

| Web UI action | CLI command |
|---|---|
| Click project in sidebar | `huly workspace use <name>` then `huly project list` |
| Open issue TSK-1 | `huly issue get TSK-1 --markdown` |
| Create new issue | `huly issue create --project TSK --title "..."` |
| Move issue to "Done" | `huly issue update TSK-1 --status Done` |
| Add label "bug" | `huly issue label TSK-1 add bug` |
| Comment on issue | `huly comment add --issue TSK-1 --body "..."` |
| Send DM | `huly dm send --person alice@... --body "..."` |
| Create channel | `huly channel create --name engineering` |
| Create calendar event | `huly calendar create --title "Standup" --start ... --end ...` |
| Log time | `huly time log --issue TSK-1 --minutes 30` |
| Switch workspace | `huly workspace use <name>` |

### Migrating from the Huly SDK (TypeScript)

If you have scripts using the SDK directly:

```ts
// SDK
import { connect } from '@hcengineering/api-client'
const client = await connect(url, { workspace, token })
const issues = await client.findAll('tracker:class:Issue', { space: project._id })
```

```bash
# CLI equivalent (in shell)
huly --workspace $WORKSPACE issue list --project $PROJECT --json
```

The CLI wraps the SDK and handles auth, caching, model loading, and
error formatting. Prefer the CLI for one-off scripts; prefer the SDK
for long-running services.

### Migrating from the REST API

If you're using `curl` against the Huly REST API:

```bash
# REST (raw)
curl -X GET "$HULY_URL/api/v1/version"

# CLI
huly api GET /api/v1/version
```

The CLI's `api` command passes through to the REST API but handles auth
headers automatically. Use it for ad-hoc endpoints the CLI doesn't cover.

### Migrating from the GraphQL API

Huly doesn't ship a GraphQL API. The CLI is the closest equivalent — it
wraps the platform's RPCs into REST-like commands. If you need GraphQL,
you're out of luck.

---

## Recipes

### Recipe: CI integration

```yaml
# .github/workflows/huly-sync.yml
name: Sync CI status to Huly
on: [push]
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @iamcoder18/huly-cli
      - name: Sync status to Huly
        env:
          HULY_URL: ${{ secrets.HULY_URL }}
          HULY_TOKEN: ${{ secrets.HULY_TOKEN }}
          HULY_WORKSPACE: ${{ vars.HULY_WORKSPACE }}
        run: |
          COMMIT_MSG=$(git log -1 --pretty=%B)
          BRANCH=$(git rev-parse --abbrev-ref HEAD)
          huly issue create --project CI --title "$BRANCH: $COMMIT_MSG" \
                            --label auto --label ci --yes
```

### Recipe: Daily standup bot

```bash
#!/bin/bash
# standup.sh - runs daily, posts to #standup channel
set -e

# Get yesterday's issues you closed
CLOSED=$(huly issue list --json | \
  jq -r --arg date "$(date -u -d 'yesterday' +%Y-%m-%d)" \
  '.[] | select(.modifiedOn > ($date | strptime("%Y-%m-%d") | mktime * 1000)) | select(.status == "Done") | "- #\(.identifier) \(.title)"')

# Post to channel
huly channel message create "standup" --body "Yesterday I closed:
$CLOSED
"
```

### Recipe: Bulk-migrate issues

```bash
#!/bin/bash
# migrate-issues.sh - copy issues from one project to another
set -e

SOURCE=$1
DEST=$2
STATUS="open"

IDS=$(huly issue list --project "$SOURCE" --status-category "$STATUS" --json | jq -r '.[]._id')

for id in $IDS; do
  # Get full issue
  issue=$(huly issue get "$id" --json)
  title=$(echo "$issue" | jq -r .title)
  desc=$(echo "$issue" | jq -r .description)

  # Create in dest
  huly issue create --project "$DEST" --title "$title" --description "$desc" --yes

  echo "migrated: $id ($title)"
done
```

### Recipe: Weekly digest email

```bash
#!/bin/bash
# weekly-digest.sh
set -e

WEEK_AGO=$(date -u -d '7 days ago' +%Y-%m-%d)

# Issues created this week
NEW=$(huly issue list --since "$WEEK_AGO" --json | \
  jq -r '.[] | "- #\(.identifier) \(.title) (\(.assignee // "unassigned"))"')

# Issues closed this week
CLOSED=$(huly issue list --status Done --since "$WEEK_AGO" --json | \
  jq -r '.[] | "- #\(.identifier) \(.title)"')

# Render the email body
{
  echo "Subject: Huly Weekly Digest"
  echo ""
  echo "This week:"
  echo "$NEW"
  echo ""
  echo "Closed:"
  echo "$CLOSED"
}
```

### Recipe: Audit orphan documents

```bash
# Find documents with no teamspace
huly document list --json | \
  jq -r '.[] | select(.space == null) | ._id' | \
  xargs -I{} echo "orphan doc: {}"

# Find documents with no author
huly document list --json | \
  jq -r '.[] | select(.createdBy == null) | ._id' | \
  xargs -I{} echo "no-author doc: {}"
```

### Recipe: Backup health check

```bash
#!/bin/bash
# backup-health.sh - verify Huly is reachable and authenticated
set -e

if ! huly user get > /dev/null 2>&1; then
  echo "ALERT: huly not reachable or auth failed"
  exit 1
fi

if ! huly workspace list > /dev/null 2>&1; then
  echo "ALERT: workspace list failed"
  exit 1
fi

echo "OK at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

### Recipe: Cross-workspace issue link

```bash
# Get an issue ID from workspace A and reference it in workspace B's issue
WS_A_ISSUE=$(huly --workspace prod issue get TSK-1 --json | jq -r '._id')
huly --workspace staging issue create \
  --project TST \
  --title "Mirrored from prod: $WS_A_ISSUE" \
  --description "Track this issue across workspaces"
```

### Recipe: Cleanup on workspace delete

```bash
# Delete all docs in a teamspace before deleting the teamspace
TS_REF="document:teamspace:Engineering"
huly document list --json | \
  jq -r --arg ts "$TS_REF" '.[] | select(.space == $ts) | ._id' | \
  xargs -I{} huly document delete {} --yes

huly teamspace delete "$TS_REF" --yes
```

### Recipe: Self-test (no auth needed)

```bash
# Verify CLI is installed and version
huly --version

# Verify command list
huly --help | head -20

# Run smoke test (requires auth)
bash scripts/smoke.sh 0
```

### Recipe: Monitor model-upgrade progress

```bash
# Tail transactor logs for upgrade completion
docker logs -f huly_v7-transactor-1 2>&1 | grep -E "upgrade|Processing upgrade"
```

### Recipe: Generate report for management

```bash
#!/bin/bash
# management-report.sh
set -e

cat <<EOF
Weekly Status Report - $(date +%Y-%m-%d)

Open issues: $(huly issue list --status-category Active --json | jq length)
Closed this week: $(huly issue list --status Done --since "$(date -u -d '7 days ago' +%Y-%m-%d)" --json | jq length)

Top contributors:
$(huly issue list --since "$(date -u -d '7 days ago' +%Y-%m-%d)" --json | \
  jq -r '.[].assignee' | sort | uniq -c | sort -rn | head -5)
EOF
```

### Recipe: Backup script

```bash
#!/bin/bash
# backup-workspace.sh - export all data to JSON
set -e

WORKSPACE="${1:?usage: $0 <workspace>}"
OUT="/tmp/huly-backup-$WORKSPACE-$(date +%Y%m%d-%H%M%S).json"

{
  echo "{"
  echo "\"workspace\": $(huly --workspace $WORKSPACE workspace info --json),"
  echo "\"projects\": $(huly --workspace $WORKSPACE project list --json),"
  echo "\"issues\": $(huly --workspace $WORKSPACE issue list --limit 10000 --json),"
  echo "\"channels\": $(huly --workspace $WORKSPACE channel list --json),"
  echo "\"teamspaces\": $(huly --workspace $WORKSPACE teamspace list --json)"
  echo "}"
} > "$OUT"

echo "backed up to $OUT ($(du -h $OUT | cut -f1))"
```

### Recipe: Diff two workspaces

```bash
# Compare issues between staging and prod
diff <(huly --workspace staging issue list --json | jq -S 'sort_by(._id)') \
     <(huly --workspace prod issue list --json | jq -S 'sort_by(._id)')
```

### Recipe: Interactive REPL

```bash
# Use rlwrap for a huly REPL
rlwrap -a -S 'huly> ' -- node -e "
const { connect } = require('@hcengineering/api-client');
const client = await connect(process.env.HULY_URL, {
  workspace: process.env.HULY_WORKSPACE,
  token: process.env.HULY_TOKEN
});
const issues = await client.findAll('tracker:class:Issue', {});
console.log(issues);
"
```

### Recipe: Generate CLI reference card

```bash
# One-page cheat sheet
huly --help | head -30 > /tmp/cli-cheatsheet.txt
for cmd in workspace user project issue channel dm document calendar time; do
  echo "=== $cmd ===" >> /tmp/cli-cheatsheet.txt
  huly $cmd --help | head -20 >> /tmp/cli-cheatsheet.txt
done
cat /tmp/cli-cheatsheet.txt
```

---

## Performance tuning

### Connection reuse across commands

The CLI opens a new WebSocket per process. For scripts with many calls:

```bash
# Slow (N connections)
for id in $(seq 1 100); do
  huly issue get "TSK-$id"
done

# Fast (1 connection, N commands)
node -e "
const { connect } = require('@hcengineering/api-client');
const c = await connect(url, { workspace, token });
for (let i = 1; i <= 100; i++) {
  await c.findOne('tracker:class:Issue', { identifier: 'TSK-' + i });
}
await c.close();
"
```

### Pagination for large workspaces

```bash
# First 1000
huly issue list --limit 1000 --json > /tmp/issues-1k.json

# Next 1000 (offset)
huly issue list --limit 1000 --offset 1000 --json > /tmp/issues-2k.json
```

Combine with `jq` for memory-efficient streaming:
```bash
huly issue list --limit 10000 --json | jq -c '.[]' | head -100
```

### Parallel execution

```bash
# Run multiple reads in parallel (CLI doesn't share state, so each is safe)
huly issue get TSK-1 &
huly issue get TSK-2 &
huly issue get TSK-3 &
wait
```

### Avoid full-model loads

The CLI loads the full model on every connection. For high-frequency
scripts, consider whether you really need model-aware operations:

- `findAll` always loads the model
- `api GET /...` (REST) doesn't
- `ws` escape hatch doesn't load the client-side model (only the connection)

### Bulk-write batching

The CLI writes one tx per command. For bulk inserts:

```bash
# Slow (N round-trips)
for title in $(seq 1 100); do
  huly issue create --project TSK --title "Issue $title" --yes
done

# Fast (1 round-trip, N txs in one TxApplyIf)
node -e "
const { connect } = require('@hcengineering/api-client');
const c = await connect(url, { workspace, token });
const ops = c.apply();
for (let i = 0; i < 100; i++) {
  ops.createDoc('tracker:class:Issue', projectSpace, { title: 'Issue ' + i, ... });
}
await ops.commit();
"
```

---

## CLI reference card

Quick lookup of all flags and their purposes.

### Workspace
```
list                                list accessible workspaces
current                             show current workspace
use <name>                          set active workspace
create --name X --yes               create workspace
delete --yes                        delete current
delete --yes --force                delete active workspace
info                                show uuid, region, mode
members                             list workspace members
member <uuid> --role MAINTAINER     change member role
rename <new-name>                   rename current
guests --read-only true|false       toggle guest read-only
guests --sign-up true|false         toggle guest sign-up
access-link --role GUEST            create invite link
regions                             list available regions
```

### Project
```
list [--limit N] [--offset N]
get <ref>                           by identifier, name, or _id
create --name X --identifier BACKEND [--description] [--private]
update <ref> --set key=value        update fields (null to clear)
delete <ref...> [--yes]
statuses --project TSK              list issue statuses
target-preferences --project TSK    list target preferences
target-preference upsert ...        upsert a target preference
```

### Issue
```
list [--project TSK] [--status <name>] [--status-category Active]
     [--assignee <email>] [--label bug] [--parent <ref>|null]
     [--description-search <q>] [--limit N] [--offset N]
get <ref> [--markdown]
create --project TSK --title "..." [--description] [--body]
      [--body-file <path>] [--status <name>] [--priority <p>]
      [--assignee <email>] [--label bug --label auth] [--due ISO]
      [--parent <ref>] [--task-type <name>]
update <ref> --title "..."           update fields
delete <ref...> [--yes]
preview-delete <ref...>             show impact of delete
label <ref> add <name>              add a label
label <ref> remove <name>           remove a label
relation <ref> add <type> <target>  add a relation
relation <ref> remove <type> <target>   remove
relation <ref> list                 list relations
link-document <issueRef> <docRef>   link a document
unlink-document <issueRef> <docRef> unlink
move <ref> --parent <ref|null>      set/clear parent
related-targets --project TSK       list related targets
related-target set --project ...    create a related target
```

### Document
```
list
create --title "..." [--body <md>] [--body-file <path>]
        [--teamspace <name>] [--parent <ref>] [--description] [--archived]
update <ref> [--title] [--body] [--body-file]
       [--old-text] [--new-text] [--replace-all]
delete <ref...> [--yes]
snapshots <ref>                     list version snapshots
snapshot <ref>                      get a specific snapshot
inline-comments <ref>               list inline comments
```

### Teamspace
```
list
get <ref>
create --name "Engineering" [--description] [--private]
delete <ref...> [--yes]
```

### Channel
```
list [--archived]
get <ref>
create --name "engineering" [--topic "..."] [--private]
update <ref> --topic "..."
delete <ref...> [--yes]
archive <ref> [--value false]
members <ref>
join <ref> [--member <email>]
leave <ref>
add-member <ref> <email...>
remove-member <ref> <email...>
message list <channelRef>
message get <channelRef> <messageRef> [--markdown]
message create <channelRef> --body "..."
message update <channelRef> <messageRef> --body "..."
message delete <channelRef> <messageRef...> [--yes]
```

### DM
```
list
create --person <email>
messages <dmRef>
send <dmRef> --body "..."
send --person <email> --body "..."   auto-creates DM
```

### Thread
```
list <targetRef>
add <targetRef> --body "..."
update <replyRef> --body "..."
delete <replyRef...> [--yes]
```

### Card
```
list
get <ref> [--markdown]
create --master-tag <name|id> --title "..." [--body] [--body-file]
update <ref> [--title] [--description] [--body] [--body-file]
delete <ref...> [--yes]
```

### Card-space
```
list
get <ref>
create --name "Engineering" [--description] [--private]
delete <ref...> [--yes]
```

### Master-tag
```
list
```

### Action (Planner)
```
list [--completed all|open|done] [--priority High] [--owner <email>]
get <ref>
create --title "..." [--description] [--body] [--body-file]
      [--due ISO] [--priority High] [--owner <email>]
      [--attached-to <ref>] [--attached-to-class <classId>]
update <ref> [--title] [--description] [--body] [--body-file]
complete <ref>                       sets doneOn=now
reopen <ref>                         clears doneOn
schedule <ref>                       creates WorkSlot
unschedule <ref>                     removes WorkSlots
delete <ref...> [--yes]
```

### Calendar
```
calendars                            list calendars (not events)
create-calendar --name "Work" [--description] [--private] [--access ...]
delete-calendar <ref>
list                                 list events
get <eventRef> [--markdown]
create --title "..." [--start ISO] [--end ISO] [--attendee <email>]
        [--location] [--all-day] [--description] [--body]
        [--calendar-id <ref>] [--rrule "FREQ=DAILY;COUNT=3"]
update <eventRef> [--title] [--start] [--end] [--attendee]
delete <eventRef...> [--yes]
recurring                            list recurring event definitions
recurring-instances <recRef>         list materialized instances
```

### Schedule
```
list
create --owner <userUuid> [--time-zone UTC] [--description]
       [--duration 30] [--interval 30]
update <ref> [...]
delete <ref...> [--yes]
```

### Time
```
log --issue TSK-1 --minutes 30 --description "..."
log --issue TSK-1 --hours 2 --description "..."
report --from 2026-06-01 --to 2026-06-30 [--user <email>] [--project TSK]
delete <entryRef...> [--yes]
```

### Component / Milestone / Issue-template
```
list --project TSK
get <ref>
create --project TSK --label "..."
update <ref> --label "..."
delete <ref...> [--yes]
```

(Issue-template additionally has `add-child` and `remove-child`.)

### Comment
```
list --issue TSK-1
add --issue TSK-1 --body "..."
add --issue TSK-1 --body-file <path>
update <commentRef> --body "..."
delete <ref...> [--yes]
```

### User
```
get [--ref <uuid>]
update --city "Berlin"
find <email>                         account-level or workspace-local lookup
```

### API / WS escape hatches
```
api <METHOD> <path> [--body json] [--query k=v] [--header k=v]
ws <method> [params-json]
```

EOF
wc -l README.md