# huly-cli

AI-agent-first CLI for self-hosted Huly.

`huly` is a unified command-line interface for the Huly platform. It wraps
the Huly SDK into scriptable commands so you can automate workspace tasks,
integrate Huly into CI/CD pipelines, or operate Huly from agents without
a browser.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [Command Reference](#command-reference)
- [Ref Resolution](#ref-resolution)
- [Output Modes](#output-modes)
- [Common Patterns](#common-patterns)
- [Escape Hatches](#escape-hatches)
- [Troubleshooting](#troubleshooting)

## Installation

```bash
# from npm
npm install -g huly-cli

# from source
git clone https://github.com/your-org/huly-cli.git
cd huly-cli && npm install && npm run build
```

After install, the `huly` binary is on PATH.

### Node version

Node 22–24. Node 26 fails the rush build check (this repo's build chain).
Node 22.11+ is recommended.

## Configuration

Environment variables (read from `.env` or shell):

| Variable | Default | Description |
|---|---|---|
| `HULY_URL` | (none, required) | Base URL of your Huly server, e.g. `https://huly.example.com` |
| `HULY_EMAIL` | (none) | Account email for password login |
| `HULY_PASSWORD` | (none) | Account password for password login |
| `HULY_TOKEN` | (none) | Pre-issued account JWT (skips login) |
| `HULY_WORKSPACE` | (none) | Default workspace (URL name or UUID) |
| `HULY_PROJECT` | (none) | Default project identifier (e.g. `TSK`) |

Load from `~/.config/huly/.env`:

```bash
# ~/.config/huly/.env
export HULY_URL=https://huly.example.com
export HULY_EMAIL=you@example.com
export HULY_PASSWORD=...
```

CLI flags override env vars. Flags override credentials.

## Authentication

```bash
# Interactive (prompts for password if not in env)
huly login

# Headless (uses env only)
huly login --headless

# Verify
huly whoami --json
```

Tokens are cached at `~/.config/huly/credentials.json` (mode 0600). The
cache holds both account-level and workspace-level tokens. Subsequent
`huly` invocations reuse the cache.

### First-time signup

`huly signup` does not exist as a CLI command. Sign up via the web UI
first, or use the SDK directly. After signup, log in with the CLI.

## Command Reference

Top-level commands (run `huly --help` for the full list):

| Command | Purpose |
|---|---|
| `login` / `whoami` | Authentication, identity |
| `workspace` | Create, list, delete, switch workspaces |
| `user` | Profile, person lookup by email |
| `project` | Tracker projects: list, get, create, update, delete |
| `issue` | Tracker issues: full CRUD + relations, labels, moves |
| `component` | Components: list, get, create, update, delete |
| `milestone` | Milestones: list, get, create, update, delete |
| `issue-template` | Issue templates: full CRUD + add/remove-child |
| `comment` | Issue comments: list, add, update, delete |
| `channel` | Channels: CRUD, members, join/leave, messages |
| `dm` | Direct messages: list, create, send |
| `thread` | Thread replies: list, add, update, delete |
| `card` | Card module: list, get, create, update, delete |
| `card-space` | Card spaces: list, get, create, delete |
| `master-tag` | Card master tags: list |
| `action` | Planner tasks (ToDos): list, create, complete, reopen, schedule |
| `document` | Documents: CRUD, snapshots, inline comments |
| `teamspace` | Document teamspaces: list, get, create, delete |
| `calendar` | Calendars + events: full CRUD, recurring events |
| `schedule` | Calendar schedules: full CRUD |
| `time` | Time tracking: list, log, delete, report |
| `api` | Raw HTTP escape hatch |
| `ws` | Raw WebSocket escape hatch |

### Global flags

Available on every command:

| Flag | Description |
|---|---|
| `--url <url>` | Server URL (overrides `HULY_URL`) |
| `--workspace <name>` | Active workspace (overrides `HULY_WORKSPACE`) |
| `--json` | Output machine-readable JSON |
| `--ci` | Alias for `--json` |
| `--markdown` | Output body content as markdown |
| `--dry-run` | Print intended tx, do not apply |
| `--minimal` | Minimal payload (no smart defaults) |
| `-y, --yes` | Skip confirmation prompts |
| `--non-interactive` | Disable interactive prompts |

Global flags may be placed before or after the subcommand:

```bash
huly --workspace life issue list
huly issue list --workspace life
```

## Ref Resolution

References to documents (issues, cards, projects, etc.) can be specified in
several ways. The CLI tries each in order:

1. **Raw `_id`** — the full ID, e.g. `tracker:class:Issue:abc123def`
2. **Prefixed form** — `<PREFIX>-<n>` for issues, e.g. `TSK-1`
3. **Bare number** — uses `HULY_PROJECT` to resolve, e.g. `1` → `TSK-1`
4. **Title** — case-insensitive match on the document's title

```bash
huly issue get TSK-1                # by prefixed form
huly issue get "Smoke test issue"   # by title
huly issue get 1                    # by bare number (uses $HULY_PROJECT)
huly issue get tracker:issue:abc... # by raw id
```

A local index cache speeds up title resolution. The cache is invalidated
automatically after writes.

## Output Modes

### Human-readable tables (default)

```
ID    NAME     DESCRIPTION       _ID
────  ───────  ────────────────  ────────────
TSK   Default  Default project   faultProject
```

### JSON (`--json` / `--ci`)

```json
[
  {"identifier": "TSK", "name": "Default", "_id": "tracker:project:DefaultProject"}
]
```

CI mode is identical to JSON but signals non-interactive intent.

### Markdown body (`--markdown`)

For documents, comments, and other content-bearing resources, `--markdown`
prints the body as markdown text (without the surrounding table).

## Common Patterns

### Create an issue end-to-end

```bash
huly issue create \
  --project TSK \
  --title "Implement login flow" \
  --description "Add OAuth2 login" \
  --priority High \
  --assignee alice@example.com \
  --label backend --label auth
```

### Move issues between projects

```bash
huly issue move TSK-1 --project OTHER
```

### Bulk operations

```bash
# Mark all 'Backlog' issues as done
huly issue list --status Backlog --json | jq -r '.[]._id' \
  | xargs -I{} huly issue update {} --status Done --yes
```

### Dry-run before destructive ops

```bash
huly project delete MYPROJ --dry-run   # shows what would be deleted
huly project delete MYPROJ --yes        # actually delete
```

### Destructive operations

Destructive commands require `--yes` to confirm. The active workspace
additionally requires `--force` to delete:

```bash
huly workspace delete my-workspace --yes --force
```

### Script-friendly output

```bash
# Get just the ID
huly project list --json | jq -r '.[]._id'

# Filter server-side
huly issue list --status-category Active --project TSK --json
```

## Escape Hatches

When a CLI command doesn't exist for what you need, use the raw RPC
escape hatches:

### HTTP (`huly api`)

```bash
huly api GET /api/v1/version
huly api POST /api/v1/something --body '{"key":"value"}'
```

### WebSocket (`huly ws`)

The Huly RPC protocol uses WebSocket. Use the `ws` command for direct
method calls:

```bash
huly ws findAll '{"_class":"tracker:class:Project"}' '{}'
```

Method names and parameters mirror the SDK's `PlatformClient` interface.
See `node_modules/@hcengineering/api-client/lib/client.js` for the full
list.

## Troubleshooting

### "permission denied to create schema" on account pod startup

The cockroach `selfhost` user lacks the `CREATE` privilege on `defaultdb`.
Run once after `docker compose down -v`:

```bash
docker exec -e PGPASSWORD=... huly_v7-cockroach-1 \
  /cockroach/cockroach sql --insecure -d defaultdb -u root \
  -e "GRANT CREATE ON DATABASE defaultdb TO selfhost"
```

### "Forbidden" on workspace delete

The account server's `deleteWorkspace` RPC requires `OWNER` role. If you
get Forbidden, verify your workspace role:

```bash
docker exec -u root huly_v7-cockroach-1 /cockroach/cockroach sql \
  --url 'postgresql://root@127.0.0.1:26257/defaultdb?sslcert=certs/client.root.crt&sslkey=certs/client.root.key&sslmode=verify-full&sslrootcert=certs/ca.crt' \
  -e "SELECT * FROM global_account.workspace_members WHERE workspace_uuid = '<ws-uuid>'"
```

### "no IssueStatus in project" on issue create

The workspace may not have completed its tracker migration. Try:

```bash
huly project statuses --project TSK --json
```

If empty, the migration hasn't run. The CLI cannot seed IssueStatuses on
workspaces with incomplete local model state.

### Stale `no document found, failed to apply model transaction` warnings

These appear in transactor logs on every CLI command. They are the
workspace pod's model-upgrade loop retrying update txes whose target
class doesn't exist yet. Cosmetic only — does not affect functionality.

### Token expired

```bash
huly logout   # clears the credentials cache
huly login    # re-authenticate
```

Or delete `~/.config/huly/credentials.json` manually.

## Development

```bash
git clone https://github.com/your-org/huly-cli.git
cd huly-cli
npm install
npm run build       # compile TS
npm run dev         # watch mode
node dist/index.js  # run CLI

# Smoke tests
bash scripts/smoke.sh all   # all phases
bash scripts/smoke.sh 6     # one phase
```

See `docs/HANDOVER.md` for the full handover document, `docs/issues.md`
for the bug inventory, and `docs/learnings.md` for detailed learnings.

## License

Eclipse Public License 2.0 (matching the upstream platform).