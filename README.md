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
3. [Agent Skill (LLM agents / OpenClaw)](#agent-skill-llm-agents--openclaw)
4. [Configuration](#configuration)
5. [Authentication](#authentication)
6. [Global flags](#global-flags)
7. [Output modes](#output-modes)
8. [Ref resolution](#ref-resolution)
   - [Writing markup: layout rules](#writing-markup-body--description-layout-rules)
9. [Command reference](#command-reference)
   - [login / signup / whoami](#login--signup--whoami)
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
   - [space](#space) / [space-type](#space-type)
   - [association](#association) / [relation](#relation)
   - [project-type](#project-type) / [task-type](#task-type) / [issue-status](#issue-status)
   - [activity](#activity)
   - [notification](#notification)
   - [approval](#approval)
10. [Common workflows](#common-workflows)
11. [Platform behaviors & best practices](#platform-behaviors--best-practices)
12. [CLI behaviors and smart defaults](#cli-behaviors-and-smart-defaults)
13. [Operational tips](#operational-tips)
14. [Output mode reference](#output-mode-reference)
15. [Class ID reference](#class-id-reference)
16. [Plugin / model surface map](#plugin--model-surface-map)
17. [Escape hatches](#escape-hatches)
18. [Internal architecture](#internal-architecture)
19. [Environment variables reference](#environment-variables-reference)
20. [Security model](#security-model)
21. [Node compatibility](#node-compatibility)
22. [Development](#development)

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
git clone https://github.com/IamCoder18/huly-cli.git
cd huly-cli
pnpm install
pnpm --filter @iamcoder18/huly-cli build
pnpm --filter @iamcoder18/huly-cli start -- --version
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

## Agent Skill (LLM agents / OpenClaw)

In addition to being a CLI, `huly-cli` ships a drop-in **Agent Skill** — a curated `SKILL.md` plus a `references/` bundle that teaches an LLM coding agent (or OpenClaw) how to drive your Huly workspace end-to-end without a browser. The skill encodes the surface map, the cascade side effects (Issue ↔ Action state machine, WorkSlot mirrors, parent-chain `reportedTime` recompute), the ref-resolution order, and the right command for each user intent — so the agent doesn't have to rediscover them.

### Install the skill

For AI coding agents (Kilo Code, Cursor, Claude Code, etc. — anything that consumes the open [`skills`](https://github.com/vercel-labs/skills) package format):

```bash
npx skills add IamCoder18/huly-cli
```

For [OpenClaw](https://openclaw.ai):

```bash
openclaw skills install @iamcoder18/huly
```

The install gives the agent the skill's `SKILL.md` and `references/*.md` so it can pick the correct surface on the first try. The skill assumes the `huly` CLI itself is already installed and authenticated — see [Installation](#installation) above and [Configuration](#configuration) / [Authentication](#authentication) below.

### Verify it works

No proactive check is needed — the skill instructs the agent to proceed with your request normally and only run setup if a `huly` command fails. If the CLI is missing or credentials are invalid, the agent will install the CLI and prompt you to configure credentials — see [Configuration](#configuration) and [Authentication](#authentication).

### Skill source

The canonical source for the skill lives in this repo at [`packages/huly-skill/SKILL.md`](https://github.com/IamCoder18/huly-cli/blob/main/packages/huly-skill/SKILL.md), with per-surface deep dives under [`packages/huly-skill/references/`](https://github.com/IamCoder18/huly-cli/blob/main/packages/huly-skill/references). It is published in lockstep with the CLI.

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
| `~/.config/huly/bootstrap.json` | Per-`(host, workspace, accountUuid)` marker for completed workspace-identity bootstrap (mode 0600). Delete the file (or just the affected `host -> workspace -> accountUuid` entry) to force a re-bootstrap. |
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

Create a new account directly:

```bash
huly signup --email you@example.com --password '***' --first You --last Name
huly signup --headless                      # uses HULY_* env vars, no prompts
huly signup --email ... --password ... --create-workspace my-ws   # signup + workspace
```

On selfhost the signup endpoint is open. On hosted/invite-only deployments
the account server may reject uninvited signups — in that case use an
invite link (`huly workspace access-link --role GUEST`).

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
| `--markdown` | Output body content as rendered Markdown (read commands). Falls back to raw prosemirror-JSON with a stderr warning if conversion fails. |
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
issue descriptions), `--markdown` returns the rendered Markdown text:

```bash
huly document get <ref> --markdown
# prints: # Hello
#         This is the document body in Markdown.
```

The CLI's read path catches markup conversion failures. If `markupToMarkdown`
fails server-side, `--markdown` falls back to the raw prosemirror-JSON
string and prints a warning to stderr; CI scripts can detect this by
setting `HULY_MARKDOWN_FALLBACK_FAIL=1` to make non-zero exit.

### Raw prosemirror-JSON (`--raw-markup`)

For debugging or scripting against the stored blob format, `--raw-markup`
returns the literal prosemirror-JSON string from MinIO (the same string
that goes into `client.markup.uploadMarkup`):

```bash
huly document get <ref> --raw-markup
# prints: {"type":"doc","content":[{"type":"paragraph",...}]}
```

`--raw-markup` is read-only: available on `card get`, `issue get`,
`document get`, `document snapshot --snapshot-id`, and `calendar get`.
Using it on create/update returns `unknown option --raw-markup`.

### Writing markup: `--body` / `--description` layout rules

The CLI converts your HTML markup into prosemirror JSON before storing it.
One layout rule still matters; the newline rule is no longer a hard
requirement.

- **Newlines are auto-stripped.** The CLI normalizes
  `<h1>x</h1>\n<p>y</p>` to `<h1>x</h1><p>y</p>` before parsing, so
  embedded `\n` no longer creates phantom empty paragraphs. Pass
  `--body-file ./body.html` if you prefer, but multi-line inline strings
  are now safe.
- **Nested HTML must be properly nested, not flat.** A nested list needs
  `<li>...<ul><li>...</li></ul></li>`, not `<li>...</li><ul><li>...</li></ul>`.
  Same for blockquotes in lists, code blocks in table cells, etc. — the
  prosemirror parser validates structure and silently drops malformed
  siblings.

Examples of correct markup:

```bash
# OK — multi-line (newlines auto-stripped)
huly card create --body "<h1>Title</h1>
<p>Body</p>"

# OK — single line also works
huly card create --body "<h1>Title</h1><p>Body</p>"

# BAD — flat nesting is silently dropped
huly card create --body "<ul><li>A</li><ul><li>B</li></ul></ul>"

# GOOD — proper nesting
huly card create --body "<ul><li>A<ul><li>B</li></ul></li></ul>"
```

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

### login / signup / whoami

```bash
huly login                          # interactive
huly login --headless               # env-only
huly signup --email ... --password ... --first ... --last ...
huly signup --headless              # uses HULY_* env vars, no prompts
huly signup --create-workspace my-ws   # signup + first workspace
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
huly workspace member add <account> --role MAINTAINER   # add / change role (requires OWNER)
huly workspace rename <new-name>    # rename current
huly workspace guests --read-only true           # toggle guest read-only
huly workspace guests --sign-up true             # toggle guest sign-up
huly workspace access-link --role GUEST          # create invite link
huly workspace regions              # list available regions
```

The pair sides (`workspace member remove`, `workspace member list`) are
intentionally not exposed as subcommands. List via `workspace members`
(filter with `--role Owner` / `--role Guest`); remove via the account-server
UI or the `accountClient` SDK call directly.

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

**Body format:** Markdown. Stored as prosemirror-JSON markup via
`client.markup.uploadMarkup`. The blob ref is stored in the issue's
`description` field; the ydoc is created lazily on first read/edit.

**`--markdown` on get:** returns the body as rendered Markdown. For
CLI-created documents (which store prosemirror-JSON markup) this works
correctly. For web-UI-created documents with embed / mention nodes, the
markdown conversion may produce partial output; the CLI warns to stderr
if it falls back to raw prosemirror-JSON. Use `--raw-markup` to dump
the stored prosemirror-JSON blob directly.

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

**Best practices & side effects:** `delete` cascades — every issue that has
this component gets `component: null` set automatically (orphans are detached,
not deleted). See
[Platform behaviors & best practices](#platform-behaviors--best-practices).

---

### milestone

```bash
huly milestone list --project TSK
huly milestone get <ref>
huly milestone create --project TSK --label "v1.0" [--target-date 2026-08-01] [--description <text>]
huly milestone update <ref> [--label <name>] [--description <text>] [--target-date 2026-08-15] [--status <s>]
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
huly channel create --name "engineering" [--description] [--topic "..."] [--private] [--auto-join] [--members <email...>]
huly channel update <ref> [--name] [--topic "..."] [--description] [--private true|false] [--auto-join true|false]
huly channel delete <ref...> [--yes]
huly channel archive <ref> [--value false]   # value=false to unarchive
huly channel unarchive <ref>
huly channel members <ref>
huly channel join <ref>                       # join self
huly channel join <ref> --member alice@...   # join specific user
huly channel leave <ref>
huly channel add-member <ref> alice@...      # one or more members
huly channel remove-member <ref> alice@...

huly channel message list <channelRef>
huly channel message send <channelRef> --body "hello" [--body-file <path>]
huly channel message update <channelRef> <messageRef> --body "edited" [--body-file <path>]
huly channel message delete <channelRef> <messageRef...> [--yes]
```

Note: unlike `huly dm`, channel commands don't expose flat-form aliases
(`huly channel message create` and `huly channel message get` are intentionally
not provided). Use `huly channel message send` / `huly channel message list`
respectively. To fetch a specific message by `_id`:

```bash
huly channel message list engineering --json \
  | jq '.[] | select(._id == "chunter:class:ChatMessage:<id>")'
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
huly dm list                                          # list DM spaces
huly dm create --person alice@example.com            # create 1:1 DM
huly dm create --members a@... --members b@...        # group DM
huly dm message list <dmRef>
huly dm message send <dmRef> --body "hi"
huly dm message send <dmRef> --person alice@... --body "hi"   # auto-creates DM
# aliases:
huly dm messages <dmRef>
huly dm send <dmRef> --body "hi"
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
huly thread update <replyRef> --body "edited" [--body-file <path>]
huly thread delete <replyRef...> [--yes]
```

**Best practices & side effects:** thread replies attach to the parent
`ActivityMessage` and auto-push the author into `repliedPersons[]` (unless
already present); the parent message's `lastReply` is updated to the reply's
`modifiedOn`. The author and `@`-mentioned persons in the reply body receive
inbox notifications. Replying to a Telegram notification appears here as a
thread reply.

---

### card

Card module (separate from tracker issues).

```bash
huly card list
huly card get <ref> [--markdown]
huly card create --master-tag <name|ref> --title "..." \\
                  [--card-space <ref>] [--parent <ref>] \\
                  [--description <text>] [--body <md>] [--body-file <path>]
huly card update <ref> [--title] [--description] [--body] [--body-file] [--replace-content]
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
huly action list [--owner email@...] [--issue <ref>] [--title <q>]
                 [--priority High|Medium|Low|NoPriority|Urgent]
                 [--visibility public|busy|private]
                 [--due-from <iso>] [--due-to <iso>]
                 [--completed true|false|all] [--limit N] [--offset N]
huly action get <ref>
huly action create --title "..." [--description] [--body] [--body-file] \\
                  [--due <iso>] [--priority <p>] \\
                  [--owner email@...] [--attached-to <ref>] [--attached-to-class <class>]
huly action update <ref> [--title] [--description] [--body] [--body-file]
huly action complete <ref>       # sets doneOn=now
huly action reopen <ref>         # clears doneOn
huly action schedule <ref>       # creates a WorkSlot for the task
huly action unschedule <ref>     # removes WorkSlots for the task
huly action delete <ref...> [--yes]
```

**`--completed` filter:** `true|false|all` (default `all`). `true` / `false`
match the value of `doneOn`; `all` returns both.

**Priority:** accepts any of `Urgent | High | Medium | Low | NoPriority`.
Match is case-insensitive. Unknown priorities throw NotFound.

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
huly document create --title "..." [--body <md>] [--body-file <path>] \\
                      [--teamspace <name|id>] [--parent <ref|title>]
huly document update <ref> [--title] [--body] [--body-file]
                         [--old-text] [--new-text] [--replace-all] [--archived]
huly document delete <ref...> [--yes]
huly document snapshots <ref>    # list version snapshots
huly document snapshot <ref>     # get a specific snapshot (by --snapshot-id)
huly document inline-comments <ref>
```

**`--body` vs `--old-text/--new-text`:** These are mutually exclusive.
Full body replace with `--body`; targeted substitution with `--old-text`
+ `--new-text`. The substitution throws if `--old-text` appears 0 times
(unless `--replace-all`).

**Auto-teamspace:** On first document create in a workspace with no
teamspaces, the CLI auto-creates a default `General` teamspace.

**Best practices & side effects:**
- Body is stored as raw Markdown.
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
huly teamspace create --name "Engineering" [--description] [--type public|private] [--private]
huly teamspace update <ref> [--name] [--description]
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
huly schedule create --title <t> --owner <userUuid> --time-zone <tz> \\
                     [--description <text>] [--duration 30] [--interval 15]
huly schedule update <ref> [--title] [--description] [--time-zone] [--duration] [--interval]
huly schedule delete <ref...> [--yes]
```

**`--owner`:** UUID of the account that owns the schedule (typically the
current user). Resolve via `huly user get --json | jq -r '._id'`.

---

### time

Time tracking on issues.

```bash
huly time list [--issue <ref>] [--start <iso>] [--end <iso>] [--limit N] [--offset N]
huly time log --issue TSK-1 --minutes 30 --description "did thing"
huly time log --issue TSK-1 --hours 2 --description "pair programming"
huly time report <issueRef>                 # per-issue summary
huly time delete <entryRef...> [--yes]
```

> **Note:** `time report` takes a single positional issue ref. Earlier
> revisions of this README mistakenly documented `--from` / `--to` /
> `--user` / `--project` flags here, but the CLI never accepted them —
> the underlying SDK method is single-issue only. For workspace-wide or
> date-range aggregations, use `huly time list --json` and filter
> client-side, e.g.:
>
> ```bash
> huly time list --json | jq '[.[] | select(.date >= "2026-06-01")]'
> ```

**Best practices & side effects:** logging time on an issue updates that
issue's `reportedTime` and recomputes `remainingTime`. If the issue has a
parent, the change walks up the parent chain automatically (`OnIssueUpdate`).
There is no opt-out — script accordingly.

---

### space

Core Space containers (typed buckets that hold issues, channels, projects,
etc.). Most workspaces expose this via tracker projects, calendar
calendars, and chunter channels — these commands target the raw `space`
documents.

```bash
huly space list [--type <id>] [--archived <bool>] [--private <bool>]
huly space get <ref>
huly space update <ref> [--name <n>] [--description <text>] [--private <bool>] [--archived <bool>]
huly space permissions <ref>
# `space members` is the management surface — the trio below take the
# required `--members <email...>` option:
huly space add-member    <ref> --members <email...>
huly space remove-member <ref> --members <email...>
huly space set-owners    <ref> --members <email...>
```

---

### space-type

```bash
huly space-type list
huly space-type get <ref>
```

---

### association

Bi-directional associations between any two docs (A↔B). Underlying
primitive for relations of kind `N:N`.

```bash
huly association list [--a <ref>] [--b <ref>] [--a-class <id>] [--b-class <id>]
huly association create --a <ref> --b <ref> [--a-class <id>] [--b-class <id>]
huly association delete <ref...> [--yes]
```

---

### relation

Asymmetric relations (A→B with a parent side) — the underlying primitive
for `tracker:class:IssueRelation`. Prefer `huly issue relation` for the
high-level ergonomic interface.

```bash
huly relation list [--source <ref>] [--source-class <id>] [--target <ref>]
huly relation create --source <ref> --target <ref> \
                     [--source-class <id>] [--target-class <id>] [--name <n>]
huly relation delete <ref...> [--yes]
```

---

### project-type

Tracker project types (Classic, Recruit, Lead, …).

```bash
huly project-type list
huly project-type get <ref>
```

---

### task-type

Task types used by projects (e.g. `Issue`, `Pull request`).

```bash
huly task-type list [--project-type <ref>]
huly task-type create --project-type <ref> --label <name> [--description <text>]
```

`--project-type` and `--label` are required.

---

### issue-status

Tracker issue statuses (the names appear in `huly issue status` filters
and `huly project statuses`).

```bash
huly issue-status create \
  --project-type <ref> \
  --name "Blocked" \
  --category Active \
  [--task-type <ref>] \
  [--description <text>] \
  [--rank <r>]
# alias: huly issue-statuses create ...
```

`--project-type`, `--name`, and `--category` are required.
`--category` accepts: `UnStarted | ToDo | Active | Won | Lost`.
`--task-type` defaults to the project type's default task type when omitted.

---

### activity

Activity messages (`ActivityMessage`), reactions, replies, saved messages,
and `@mention` lookups.

```bash
huly activity list [--target <ref>] [--target-class <id>] [--pinned] [--limit N]
huly activity get <ref>
huly activity pin <ref> [--unpin]
huly activity react --target <ref> --emoji 👍 [--add|--remove|--list]
huly activity reply list <targetRef>
huly activity reply add <targetRef> --body "..."
huly activity reply update <replyRef> --body "..."
huly activity reply delete <replyRef...> [--yes]
huly activity saved list
huly activity saved save --target <ref>
huly activity saved unsave --target <ref>
huly activity mentions
```

---

### notification

Inbox notifications, contexts, providers, types, and per-target subscribe
state.

```bash
huly notification list [--read|--unread] [--archived <bool>] [--limit N]
huly notification get <ref>
huly notification mark-read <ref...>
huly notification mark-unread <ref...>
huly notification mark-all-read
huly notification archive <ref...>
huly notification unarchive <ref...>
huly notification archive-all
huly notification delete <ref...> [--yes]
huly notification unread-count
huly notification providers
huly notification types
huly notification contexts list
huly notification contexts get <ref>
huly notification contexts pin <ref> [--unpin]
huly notification contexts hide <ref> [--unhide]
huly notification subscribe --target <ref> [--target-class <id>]
huly notification unsubscribe --target <ref> [--target-class <id>]
huly notification settings list [--provider <ref>]
huly notification settings update --provider <ref> --type <ref> --enabled true|false
```

---

### approval

Approval requests attached to any target doc.

```bash
huly approval list [--status Active|Completed|Rejected|Cancelled] [--attached-to <ref>]
huly approval get <ref>
# Create an approval request (one or more approvers)
huly approval request \
  --attached-to <ref> \
  --requested <emails...> \
  [--attached-to-class <id>] [--required-count <n>] [--tx <json>]
huly approval comment <ref> --body "..." [--decision approve|reject|comment]
# `--decision` is OPTIONAL. When omitted, the comment is a plain comment
# with no vote (same effect as `--decision comment`). The CLI accepts
# `--decision comment` to mirror the upstream enum verbatim, but the
# preferred form is to omit the flag entirely.
huly approval approve <ref> [--comment "..."]
huly approval reject <ref> --comment "..." [--rejected-tx <json>]
huly approval cancel <ref>           # requester only
huly approval delete <ref...> [--yes]
```

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
huly milestone create --project Q3I --label "v1.0" --target-date 2026-09-30

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
# Issues created today (issue list has no --since filter; use jq)
TODAY_MS=$(date -u -d 'today 00:00:00' +%s)000
huly issue list --limit 1000 --json | \
  jq -r --argjson t "$TODAY_MS" \
    '.[] | select(.createdOn >= $t) | "\(.identifier): \(.title)"'

# Time logged today (time list has --start/--end date filters)
huly time list --start "$(date -u +%Y-%m-%dT00:00:00Z)" --json --limit 1000
```

> **Tip:** `huly time report <issueRef>` is per-issue only — see the
> [time section](#time) for the rationale.

### Migration: copy issues between projects

The Huly platform does not let you change an issue's `space` (project) after
creation — the SDK has no method for it. The CLI exposes
`huly issue move <ref> --parent <ref|null>` for re-parenting inside the same
project only. To "move" issues between projects, copy them and delete the
originals:

```bash
set -e
SOURCE=OLD
DEST=NEW
IDS=$(huly issue list --project "$SOURCE" --json | jq -r '.[]._id')
for id in $IDS; do
  issue=$(huly issue get "$id" --json)
  title=$(echo "$issue"   | jq -r .title)
  desc=$(echo "$issue"    | jq -r .description)
  prio=$(echo "$issue"    | jq -r .priority)
  asg=$(echo "$issue"     | jq -r '.assignee // empty')
  huly issue create --project "$DEST" --title "$title" \
                     --description "$desc" \
                     --priority "$prio" \
                     ${asg:+--assignee "$asg"} \
                     --yes
  echo "copied: $id"
done
# Then delete the originals in a second pass (after you verify the copies):
# for id in $IDS; do huly issue delete "$id" --yes; done
```

### Find and fix orphan docs

```bash
# Documents whose teamspace was deleted
huly document list --json | \
  jq -r '.[] | select(.space == null) | ._id' \
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
| `huly channel message send` / `huly dm send` (alias for `dm message send`) / `huly thread add` | Auto-creates `ChatMessage`; sender + every `@`-mentioned person (parsed from the markup via `extractReferences`) are auto-added as `core.class.Collaborator` on the attached doc. On channel sends, the sender is auto-joined to the channel. Each collaborator and mention gets an inbox notification. |
| `huly comment add <issueRef> ...` | Issue comments are `ChatMessage`s stored in the issue's `comments` collection; same auto-collaborator + auto-notification rules apply. |
| `huly dm send --body "@alice ..."` | `@mention` resolves from workspace members by display name and creates a backlink; the recipient gets an inbox notification (subject to their notification prefs). |
| New workspace | `#general` and `#random` channels are auto-created; archiving them requires Spaces Admin. |
| `huly channel archive` | Allowed only for the owner/creator of the channel; for the auto-created system channels (`#general`/`#random`), Spaces Admin or Workspace Owner is required. |
| `huly channel update --private true` | Private channels still appear in the sidebar — users must request access. Use a group DM (not a channel) for hidden conversations. |
| `huly dm ...` "close conversation" | Hides from sidebar; message history is preserved. |
| Inline comments on issues / docs | **Not** linked to inbox notifications or chat; resolving an inline comment thread **deletes** all comments in it (cannot be undone). |

### Documents, controlled documents, training

| User action | Side effect |
|---|---|
| `huly document create` | Body is stored as raw Markdown string. |
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
| Read-only guest | A magic UUID (`83bbed9a-0867-4851-be32-31d49d1d42ce`) represents the global read-only guest. When `workspace guests --read-only true` is set, all workspace members get re-granted to this identity; their notifications are force-read; sessions get `data.connection.readOnly = true`. |
| Per-space `Permission` records | Every TxCUD is checked against the space type's `Permission` matrix. There is no global role override; granting rights is per-space. |
| Disabling RBAC | Settings → General → disable RBAC for the whole workspace. Useful for scripting tests; do not leave enabled in production. |

### Calendar & recurring events

| Behavior | Notes |
|---|---|
| `--rrule` accepted on `huly calendar create` | iCalendar RRULE string (e.g. `FREQ=DAILY;COUNT=3`). Server coerces `BYDAY`/`BYMONTH`/`BYMONTHDAY`/`BYSETPOS` to numeric arrays. |
| Recurring exceptions (EXDATE) | **Not implemented.** The `ReccuringEvent` model has no `exdates` field; exception dates are silently ignored. There is no UI to skip a single occurrence. |
| Recurring instance model | Each instance is a `ReccuringInstance` carrying `recurringEventId` + `originalStartTime`. To list instances, query by `recurringEventId`. |
| `blockTime` defaults to false | Events don't block the user's calendar by default. Pass `--block-time` to set. |
| `visibility` mapping for Google sync | Google `transparency:transparent` ↔ Huly `visibility:freeBusy`; Huly `private` ↔ Google `private`. |
| Visibility levels | `public` (everyone sees title+time), `freeBusy` (only "Busy"), `private` (only you). Title is always shown to those with view rights. |
| `--time-zone` defaults to `UTC` | For recurring events, the RRULE is evaluated in the given TZ. Pass `--time-zone America/New_York` etc. |
| `WorkSlot` visibility mirrors to event | Changing `WorkSlot.visibility` mirrors back to the parent `ToDo` and derived calendar events. |

### Search and indexing

| Behavior | Notes |
|---|---|
| Full-text backend | Elasticsearch. `fulltextSummary` field is concatenated from markup text + all `isFullTextAttribute` fields + link preview metadata. |
| Searchable fields | Determined by `FullTextSearchContext` per class; default includes title, description, body. Custom attribute opt-in via `isFullTextAttribute: true`. |
| Operators | No Huly-specific DSL. ES `query_string` passes through: `AND`, `OR`, `NOT`, `+`, `-`, `"…"`, `*`, `~`, `field:value`. The CLI does not wrap queries. |
| Index cap | `fulltextSummary` capped at `textLimit` (~1 MB); huge bodies are truncated server-side. |
| Reindex | `fullReindex` workspace event triggers a clean rebuild (the CLI has no direct hook — you can call `huly ws` with `{"method":"triggerReindex","params":[...]}` if needed). |
| `domain: fulltext-blob` is excluded from backups | Transient; not restorable. |
| Indexing is per-workspace | Each workspace gets its own pipeline; queries are workspace-scoped. |

### Locking, audit, soft-delete

| Behavior | Notes |
|---|---|
| Concurrency model | Optimistic locking via `modifiedOn` / `modifiedBy`. No version counter. Last write wins. |
| Y-doc collaborative fields | Concurrent edits to rich text merge via Y.js CRDT (per-character). |
| Audit trail | The `tx` domain IS the audit log. Every `TxCreateDoc`/`TxUpdateDoc`/`TxRemoveDoc`/`TxMixin` is persisted with `modifiedBy`/`modifiedOn`/`objectId`. Query it: `huly ws findAll core.class.Tx --json \| jq '.[] \| select(.objectId=="…")'`. |
| Activity feed | User-visible summaries built from the tx stream by `ActivityMessagesHandler`. Excludes ActivityMessage/InboxNotification/DocNotifyContext. |
| Soft delete | `Card.removed:boolean`, `Project.archived`, `Vacancy.archived`, `Document.state ∈ {Deleted, Obsolete, Archived}`. Other entities are hard-deleted (`TxRemoveDoc`). |
| Workspace states | `pending-creation` → `creating` → `active`; `pending-upgrade` → `upgrading` → `active`; `pending-deletion` → `deleting`; `archiving-*` chain; `migration-*` chain; `pending-restore` → `restoring` → `active`. |
| `WS_OPERATION` env var (server-side) | `all` (default) covers `pending-creation` + `pending-upgrade`; `all+backup` adds `pending-deletion`, archiving, migration, restoring. For selfhost single-pod, set `all+backup` on the workspace pod. |
| Read-only guest data | The CLI's resolver cache is **client-scoped via a `WeakMap<PlatformClient, …>`**, so each connected workspace gets its own cache automatically and entries die with the connection. No cross-workspace data leakage. |

### Cards & knowledge management (deep)

| Behavior | Notes |
|---|---|
| Adding attribute to one Card | Adds to **every** Card of that Type or Tag (`OnCardTag`). Cannot be scoped. |
| Derived Type inheritance | Sub-types auto-inherit all parent properties; intermediate mixins apply automatically. |
| Tag application | Tag properties only appear after the Tag is applied; removing the Tag drops values. |
| Relation kinds | `1:1` / `1:N` / `N:N`. N:N is symmetric; 1:N has owner/child sides. Relations are bi-directional, References are not. |
| Reference vs Relation | Reference is a one-directional attribute, filterable and sortable. Relation is a separate `Relation` doc with cardinality rules. |
| Reproving Cards | Card Type can be re-assigned post-creation (re-organization without data loss). |
| Card hierarchy cycle detection | Reparenting a Card walks up the parent chain; cycles are detected and the tx is rolled back. |
| File Type undeletable | The default `File` MasterTag cannot be deleted; uploaded files on File-Cards are permanent. |
| Drive versioning | Re-uploading onto an existing file creates a new version automatically. All versions listed under the original. |
| Default Drive | Every new workspace ships with one Drive named `Records`. |
| Mermaid | Slash command → `Diagram`; valid MermaidJS auto-renders below editor. Press Delete to remove. |
| Drawing board | Slash command → `Drawing board`; multi-user real-time. Clear is irreversible. Scribble history tracks who drew what. |
| Backlinks | Paper-clip icon (top-right of doc) opens panel of every `@mention` pointing to the doc. |
| Notes on highlights | Highlight text → `Note` icon → color; persists as inline note. Re-highlight to edit. |
| Inline comments vs Activity comments | Inline comments are isolated to the doc/issue and DON'T notify. Resolving a thread **deletes all replies**. |
| Saved messages in chat | Bookmark any message → appears in `Saved` tab in Chat sidebar. |
| `[] ` action items in docs | Typing `[] ` at line start inserts a checkbox; assigning it creates a Planner todo + sends notification. |

---

## CLI behaviors and smart defaults

The CLI silently applies several defaults and auto-creations to keep common
flows one-liners. This section catalogs them all so you know what the CLI
will do when you don't.

### Auto-creations (the CLI makes things for you)

| Command | What gets auto-created | When |
|---|---|---|
| `huly document create` | A `General` teamspace (type `space-type:default`, members `[]`, description "Default teamspace (auto-created)") | Workspace has zero teamspaces. |
| `huly issue create` | 5 default `IssueStatus` records (`Backlog`, `To do`, `In progress`, `Done`, `Canceled`) in `core:space:Model` | Workspace has zero `IssueStatus`. |
| `huly issue create` | First `ProjectToDo` (classic projects only) | `--assignee` set, status `Todo`/`Active`. See cascade table. |
| `huly dm create --person <email>` / `huly dm send --person <email>` | A DM with that person (resolves via `resolvePersonId`) | No existing DM with that person. |
| `huly issue label add <ref> --label <name>` | A `TagElement` in `tags:space:Tag` (first `TagCategory`) | Label doesn't exist yet. |
| `huly project create` | The current user is added as a `members: [<uuid>]` | Always, unless `--minimal`. |
| `huly calendar create` | A new `Calendar` doc | Always; `--type public\|private` defaults to `public`. |
| `huly action create` | If `--attached-to` omitted, the task is attached to the owner's `Person` (or current user) | Default. |

> **Note:** `huly issue create` re-tries the auto-seed on the **second**
> call if the first failed silently (model-load race). If the issue create
> keeps failing on a fresh workspace, run any other issue-list command
> first to nudge the model.

### Smart defaults (values the CLI fills for you)

| Command | Flag | Default |
|---|---|---|
| `huly project create` | `--sequence` | `0` |
| `huly project create` | `--members` | `[<current-user-uuid>]` |
| `huly project create` | `--description` | `''` (omitted with `--minimal`) |
| `huly issue create` | `--status` | Lowest-rank `IssueStatus` (usually `Backlog`) |
| `huly issue create` | `--priority` | `Normal` if it exists in the workspace; else first priority; else omitted |
| `huly issue create` | `--task-type` | `tracker:issue:default` |
| `huly issue create` | `parent` | `null` (top-level), unless `--minimal` |
| `huly issue create` | `space` | `project._id` (unless `--minimal`) |
| `huly calendar create-calendar` | `--access` | `public` (one of `owner` / `team` / `public`) |
| `huly calendar create-calendar` | `--private` | `false` |
| `huly schedule create` | `--duration` | `30` (minutes) |
| `huly schedule create` | `--interval` | `15` (minutes) |
| `huly action create` | `--priority` | `NoPriority` |
| `huly action create` | `--visibility` | `public` |
| `huly action create` | `--owner` | Current user |
| `huly action create` | `--attached-to-class` | `contact:class:Person` |
| `huly action create` | `--due` | none (`dueDate: null`) |
| `huly action create` | `doneOn` | `null` |
| `huly action create` | `rank` | `0\|aaaaa:` |
| `huly time log` | `--date` | `Date.now()` |
| `huly time log` | value conversion | minutes → man-hours (`value = minutes/60`); rounds to nearest 15 min |
| `huly card create` | `--card-space` | `card:space:Default` (may not exist; create one first) |
| `huly teamspace create` | `--type` | `public` |
| `huly card-space create` | `--private` | `false` |

### Ref resolution order (how `--assignee`, `--project`, etc. resolve)

When you pass a value to a flag like `--assignee`, `--project`, `--owner`,
`--person`, `--calendar`, etc., the CLI tries in this order:

1. **`me` / `""`** (empty string) — resolves to current user.
2. **Raw `_id`** (matches `^[a-z-]+:[a-z-]+:[0-9a-f-]{36}$`) — used as-is.
3. **Prefixed form** (`PREFIX-123`, e.g. `TSK-1`, `USR-42`) — looked up via the index.
4. **Bare number** (`42`) — uses `$HULY_PROJECT` env var for project context.
5. **`identifier | name | label | title` (lowercased)** — exact match against the index.
6. **Substring fallback** (loose `includes()` match) for `--assignee` only. NOT applied to `--owner` — see step 6b. May produce false positives; pass an exact email/name to avoid.
6b. **`--owner` is exact-match only** — `resolveEmployeeId` does a strict `===` comparison against `Person.name` and `Person.email` (if the field is populated). There is no fuzzy fallback. Pass the full name or email.
7. **Account lookup** — `accountClient.findPersonBySocialKey` for `--person`; falls back to workspace-local `Person` scan.
8. **Single-other-member heuristic** — `resolvePersonId` in DM/Channel code picks the only other workspace member if exactly one exists. Documented for awareness; avoid relying on it.

> **Heads up:** the substring fallback in step 6 is silently enabled for `--assignee` only. If
> you pass `--assignee bob` and there's a `Bob Anderson` and a `Bob
> Bishop`, the first alphabetical match wins. Use exact email to disambiguate.
> `--owner` does NOT have this fallback — it requires an exact name or email match.

### Auto-coercion in `--set key=value`

`huly project update --set key=value` (and `huly issue update --set`) coerce
values automatically:

- `key=null` → clears the field (sends `TxUpdateDoc` with `operations[key]: null`)
- `key=true` / `key=false` → boolean
- `key=<numeric string>` → `Number`
- `key=<anything else>` → string

Reserved keys (silently stripped): `set`, `unset`, `json`, `ci`, `markdown`, `dryRun`, `minimal`, `yes`, `workspace`, `url`, `defaultProjectIdentifier`.

### Cache & index behavior

| Cache | Lifetime | Invalidation |
|---|---|---|
| Resolver index (`PlatformClient` → `Map<classId, Map<key, _id>>`, backed by a `WeakMap`) | In-memory, **no TTL**; dies with the `PlatformClient` | Explicit `invalidateIndex(client, classId)` after every write. |
| Account `_accounts` URL cache | In-memory, per-host | Never invalidated; restart the CLI process to refresh. |
| `~/.config/huly/credentials.json` (account + workspace tokens) | On disk, mode 0600, no expiry | Refreshed on re-login. Delete the file to reset. |
| `~/.config/huly/active-workspace` | On disk, mode 0606 | Updated on `huly workspace use <name>` or `--workspace`. |
| `~/.config/huly/active-account` | On disk, mode 0606 | One line per host, updated on login. |

> **Stale-cache gotcha:** the resolver index never expires. If someone
> deletes or renames a project between two CLI commands in the same shell,
> the second command may still see the old name. Restart the CLI process
> (or run any write against the changed resource) to force a refresh.
>
> **Cross-workspace safety:** because the cache is keyed on the
> `PlatformClient` instance (WeakMap), switching workspaces — even within
> the same process — gives you a fresh cache automatically. No risk of
> stale entries bleeding across workspaces.

### Timeouts

| Path | Timeout | Fallback |
|---|---|---|
| `client.fetchMarkup` (all `--markdown` reads) | **5 seconds** | `'(body fetch timed out)'` |
| `ws` raw command | **60 seconds** | Promise rejects |
| `ws` raw command ping | **5 seconds** (interval) | `--no-ping` disables |
| `retry()` helper (defined, unused) | `429` only | `500 * attempt² ms` backoff, max 3 attempts |

There is **no WebSocket auto-reconnect** in the CLI. Each command opens a
fresh WS, runs, and closes in `finally`. If the connection drops mid-call,
the error bubbles up.

### Filtering & matching semantics

| Flag | Match type | Case-sensitive? |
|---|---|---|
| `--status` (issue) | Exact label/name | No |
| `--status-category` | Strips `task:statusCategory:` prefix, exact | No |
| `--priority` (issue) | Exact label/name | No |
| `--task-type` (issue) | Exact label/name OR raw `_id` | No |
| `--role` (member) | Aliases (`owner\|admin\|guest\|docguest\|readonlyguest\|maintainer`) | No |
| `--priority` (todo) | Strict enum (`High\|Medium\|Low\|NoPriority\|Urgent`), throws on invalid | No |
| `--visibility` (todo) | Strict enum (`public\|busy\|private`) | No |
| `--archived` (channel/document) | Anything that isn't `'false'` or `'0'` → `true` | n/a |
| `--completed` (todo) | `true\|false\|all` | n/a |
| `--description-search` / `--content-search` / `--title` (todo) | **MongoDB-style regex** with `$options: 'i'` | **No** |
| `--private` (channel) | Non-strict coercion (anything not `'false'`/`'0'` → true) | n/a |

### Idempotency (auto-retry on duplicate)

| Command | Behavior |
|---|---|
| `huly issue create` | If the create returns `duplicate`/`exists`/`already`, the CLI re-runs the lookup and returns the existing issue's `_id` (idempotent). |
| `huly project create` | Pre-flight `findAll({identifier})`; on `already exists|duplicate|exists` error, repeats the lookup and returns the existing project. |

### Error messages include next-step hints

| Error | Hint |
|---|---|
| `PLATFORM_NOT_FOUND` / `not found` | "check the ref or run `huly <resource> list`" |
| `PLATFORM_UNAUTHORIZED` / 401 | "run `huly login` or set `HULY_TOKEN`" |
| `PLATFORM_FORBIDDEN` / 403 | "insufficient permissions" |
| `PLATFORM_ALREADY_EXISTS` | mapped to `ExitCode.Conflict(6)` |
| `PLATFORM_RATE_LIMITED` / 429 | mapped to `ExitCode.RateLimited(5)` |
| `PLATFORM_VALIDATION` / 400 | mapped to `ExitCode.Validation(4)` |
| `>=500` | mapped to `ExitCode.Server(7)` |
| Bad `--status` | lists all available statuses |
| Bad `--priority` | lists available priorities |
| `ref-resolver` NotFound | shows first 10 candidates |

### Pagination

The CLI loads the full result set in one `findAll` call, then slices
in-memory with `--limit`/`--offset`. There is no server-side pagination.
For very large workspaces (>10k docs of a type), prefer filtering by
project/space/date to bound the result set before piping to `jq`.

### Confirmation prompts (`--yes`)

Required for:
- `workspace create`
- `workspace delete` (active workspace also needs `--force`)
- Any delete of ≥2 refs (`issue delete`, `project delete`, `channel delete`, `document delete`, `teamspace delete`, `action delete`, `comment delete`, `time delete`, `calendar delete`, `card delete`, `card-space delete`, `thread delete`, `channel message delete`, `action unschedule` of multiple slots)

NOT required for:
- `dm create --person` (auto-creates a DM silently)
- `dm send --person` (auto-creates a DM silently)
- `action unschedule` of a single slot
- All single-ref deletes

### Connection pooling

**None.** Every CLI invocation opens a fresh `PlatformClient` /
`AccountClient` and closes it in `finally`. The SDK keeps a single WS open
for the duration of the client. This is fast (sub-second per command) but
means you cannot pipeline multiple mutations over one WS.

---

## Operational tips

Lessons learned from running the CLI against a self-hosted Huly instance.
These are CLI-user-facing, not server-admin-facing.

### Environment variables (cheat sheet)

| Var | Default | Purpose |
|---|---|---|
| `HULY_URL` | — | Server URL (**required** — CLI exits with `HULY_URL is required` if unset) |
| `HULY_EMAIL` | — | Login email (used by `--headless` login) |
| `HULY_PASSWORD` | — | Login password (used by `--headless` login) |
| `HULY_TOKEN` | — | Pre-issued account JWT (bypasses login + caching) |
| `HULY_WORKSPACE` | — | Default workspace (URL or UUID) |
| `HULY_PROJECT` | — | Default project for `--project` and bare-number issue refs |
| `HULY_TEAMSPACE` | — | Default teamspace for `--teamspace` |
| `HULY_ENV_FILE` | `~/.config/huly/.env` | Path to the dotenv file |
| `HULY_NONINTERACTIVE` | — | `1` disables all prompts |
| `HULY_INSECURE_TLS` | — | `1` disables TLS verification globally (sets `NODE_TLS_REJECT_UNAUTHORIZED=0` + `https.globalAgent.options.rejectUnauthorized = false`) |
| `HULY_SKIP_BOOTSTRAP` | — | `1` skips the automatic workspace-identity bootstrap that runs on every `connectCli`. Set this in CI / benchmarks / when you want to leave a workspace untouched. Without it, the CLI mirrors the web UI's `ensureEmployee()` flow on first connect per `(host, workspace, accountUuid)` and writes a per-account marker to `~/.config/huly/bootstrap.json` so `--assignee <email>` lookups, the `ProjectToDo` cascade, and role-gated queries work without ever opening the workspace in a browser. |
| `NO_COLOR` | — | Disables chalk colors |
| `XDG_CONFIG_HOME` | `~/.config` | Base for credential/config files |
| `CI` | — | Triggers JSON output and disables spinner |

Precedence for global flags: **flag > env > cached file**. The cached
`~/.config/huly/active-workspace` is the lowest-priority default.

### Auth caching

- Tokens are persisted at `~/.config/huly/credentials.json` (mode 0600).
- Account token + per-workspace tokens are stored separately.
- Re-login **preserves existing workspace tokens** when the account token is refreshed.
- `HULY_TOKEN` bypasses all caching (account-level pre-issued JWT).
- The CLI will NOT re-login if a cached account token exists for the given email — this avoids clobbering workspace tokens.
- Workspace-scoped tokens are re-fetched via `selectWorkspace` on every `connectPlatform` call.

### Reset the CLI

```bash
rm -f ~/.config/huly/credentials.json \
      ~/.config/huly/active-account \
      ~/.config/huly/active-workspace
huly login --headless
```

### WebSocket session reconnect (during workspace upgrade)

When a workspace is being upgraded, the server allows the previous session
to multiplex for up to **30 seconds** (`sessionManager.reconnectTimeout`).
After that window, the client is force-disconnected. The CLI doesn't
auto-reconnect — restart the command. If you see `Model version mismatch`,
the workspace was upgraded under you; refresh and retry.

### Concurrent edit semantics

- All `Doc` updates use optimistic locking via `modifiedOn` / `modifiedBy`.
- Last write wins. There is no version counter.
- Rich-text fields (in y-docs) merge via Y.js CRDT (per-character).
- No pessimistic locks anywhere.

### Large lists and fulltext

For workspaces with >10k issues, prefer server-side filtering by project
or status before piping to `jq`. The CLI does not paginate server-side;
each `list` command fetches the full result set then slices in-memory.

For fulltext search, use `huly ws findAll` with a `FullTextSearchContext`
query — the CLI does not wrap search syntax, so ES query string operators
(`AND`, `OR`, `NOT`, `+`, `-`, `"…"`, `*`, `~`, `field:value`) pass
through.

### Audit trail queries

The `tx` domain is the audit log. To see who changed what:

```bash
huly ws findAll core.class.Tx '{"objectId":"<doc-id>","modifiedOn":{"$gte":<start-ms>,"$lte":<end-ms>}}' --json
```

Each tx carries `modifiedBy`, `modifiedOn`, `space`, `objectId`, and the
full operations payload.

### Account-server workspace limit

`WORKSPACE_LIMIT_PER_USER` defaults to **10** on the account pod. If you
hit it, you get `WorkspaceLimitReached`. Either increase the env var on
the account pod or delete some workspaces (use `WS_OPERATION=all+backup`
to make the worker actually clean up `pending-deletion` workspaces).

### Model upgrade queue

New plugin versions ship new `model-upgrade txs`. The workspace pod
applies them automatically when `WS_OPERATION=all` and the workspace's
`version_major/minor/patch` is below the current. On a fresh workspace,
this takes ~30 seconds. If `findAll` returns 0 for classes that should
have data, the model may not have applied yet — wait or restart the
workspace pod with `WS_OPERATION=upgrade` to force a re-apply.

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

The CLI converts user-facing HTML / Markdown body content into
prosemirror-JSON markup before storage. On `* create --body` it calls
`client.markup.uploadMarkup(...)` directly (bypassing the SDK's
`processMarkup`/`MarkupContent` path, which uses two ESM/CJS class
instances of `MarkupContent` that fail the `instanceof` check). On
`* update --body` it calls only `client.markup.collaborator.updateMarkup`
(the `updateContent` RPC) — no redundant JSON-blob upload per edit.

Read path: `get --markdown` calls `client.fetchMarkup(..., 'markdown')`
which triggers the server's `markupToJSON` → `markupToMarkdown` pipeline.
If the conversion fails server-side, the SDK returns the raw
prosemirror-JSON string. The CLI detects this (heuristic: result starts
with `{"type":"doc"`), prints a warning to stderr, and — if
`HULY_MARKDOWN_FALLBACK_FAIL=1` is set — exits non-zero so CI scripts
can detect silent fallback. Use `--raw-markup` (read commands only) to
dump the stored prosemirror-JSON directly.

For rich-text round-trip features (mention nodes, embeds) that don't
survive the JSON round-trip, use the raw escape hatch:
`huly ws tx '{"method":"createDoc", ...}'`.

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

## Node compatibility

| Node | Status |
|---|---|
| 22.11 | ✅ Recommended |
| 24.x | ✅ Works |
| 26.x | ⚠️ May need `RUSH_ALLOW_UNSUPPORTED_NODEJS=1` for rush-based builds downstream |
| 20.x | ❌ Missing crypto features used by SDK |

The CLI is a TypeScript source project — it requires Node 22.11+ to run
the dev tooling. The bundled `dist/index.js` runs on any Node ≥ 22.11.

---

## Development

### Project conventions

- TypeScript strict mode (no `any` except at API boundaries)
- camelCase functions, PascalCase classes, SCREAMING_SNAKE constants
- One resource per file in `src/resources/`
- New class IDs go in `src/transport/identifiers.ts`
- Help text MUST describe each flag, even if obvious
- Errors throw `CliError(ExitCode.X, msg, hint?)` — never raw `Error`

### Adding a new command

1. Add the resource function in `src/resources/<surface>.ts`
2. Add the class ID to `src/transport/identifiers.ts`
3. Wire the command in `src/cli.ts` (find the relevant `program.command(...)`)
4. Update `README.md` with the new command
5. Run `pnpm --filter @iamcoder18/huly-cli build`

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
a markup reference indirection: the CLI's `uploadMarkup` / `updateMarkup`
helpers call the collaborator's RPCs directly, producing a y-doc binary
and a JSON prosemirror-markup blob stored in MinIO. The doc field stores
a `MarkupRef` pointing at the blob instead of inline text. On read,
`client.fetchMarkup(...)` retrieves the blob, runs `markupToJSON`
(prosemirror) and optionally `markupToMarkdown`.

On `* create --body` the CLI calls both `uploadMarkup` (creates the
initial JSON blob) and lets the next `updateContent` create the ydoc.
On `* update --body` the CLI calls only `updateMarkup` (the ydoc is the
source of truth for collaborative reads; the JSON blob is no longer
uploaded per edit). For read commands, `--markdown` requests markdown
conversion and `--raw-markup` returns the raw prosemirror-JSON string.
See [Markup handling](#markup-handling) for the rationale.

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
huly channel message send "standup" --body "Yesterday I closed:
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

WEEK_AGO_MS=$(date -u -d '7 days ago' +%s)000

# Issues created this week (issue list has no --since; jq filters on createdOn)
NEW=$(huly issue list --limit 1000 --json | \
  jq -r --argjson t "$WEEK_AGO_MS" \
    '.[] | select(.createdOn >= $t) | "- #\(.identifier) \(.title) (\(.assignee // "unassigned"))"')

# Issues closed this week (status filter + jq on modifiedOn)
CLOSED=$(huly issue list --status Done --limit 1000 --json | \
  jq -r --argjson t "$WEEK_AGO_MS" \
    '.[] | select(.modifiedOn >= $t) | "- #\(.identifier) \(.title)"')

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

Top contributors (issues created this week):
$(huly issue list --limit 1000 --json | \
  jq -r --argjson t "$(date -u -d '7 days ago' +%s)000" \
    '[.[] | select(.createdOn >= $t) | .assignee // "(unassigned)"] | group_by(.) | map({k:.[0], n:length}) | sort_by(-.n) | .[0:5] | .[] | "  \(.n)\t\(.k)")')
EOF

