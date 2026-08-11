# huly-cli — Drive your self-hosted Huly from any AI agent.

[![npm version](https://img.shields.io/npm/v/@iamcoder18/huly-cli.svg?style=flat-square)](https://www.npmjs.com/package/@iamcoder18/huly-cli)
[![npm downloads](https://img.shields.io/npm/dm/@iamcoder18/huly-cli.svg?style=flat-square)](https://www.npmjs.com/package/@iamcoder18/huly-cli)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/IamCoder18/huly-cli/ci.yml?branch=main&style=flat-square)](https://github.com/IamCoder18/huly-cli/actions)
[![License](https://img.shields.io/npm/l/@iamcoder18/huly-cli.svg?style=flat-square)](LICENSE)

**Issues, projects, channels, docs, calendar & time tracking — from the terminal,
your AI agent, or OpenClaw.** No browser, no MCP, no Playwright.

---

## Quick start

```bash
# 1. Install the CLI
npm i -g @iamcoder18/huly-cli # OR pnpm add -g @iamcoder18/huly-cli

# 2. (Optional) Install the Agent Skill for AI coding agents
npx skills add IamCoder18/huly-cli

# 3. (Optional) For OpenClaw
openclaw skills install @iamcoder18/huly
```

Then [configure & log in](docs/getting-started.md) — usually two minutes.

<details>
<summary><strong>Also: try without installing, or use the new package name</strong></summary>

```bash
# Try it without installing
npx @iamcoder18/huly-cli --version

# Other package managers
yarn global add @iamcoder18/huly-cli
bun add -g @iamcoder18/huly-cli
```

To build from source, see [Development](docs/development.md).

</details>

---

## Why huly-cli (not the MCP wrappers)

|                                     | **huly-cli**                                                     | MCP-based wrappers               |
| ----------------------------------- | ---------------------------------------------------------------- | -------------------------------- |
| Talks to Huly via                   | **Direct SDK** (no separate MCP server or runtime)               | huly-mcp process + JSON-RPC      |
| Browser / Playwright                | **None — fully headless**                                        | Often required for auth/UI flows |
| Employee / user creation            | **Works** (including the fields MCP stops at)                    | Often half-implemented           |
| Time tracking / calendar recurrence | **First-class** (durations, recurring rules)                     | Frequently missing or stubbed    |
| Output formats                      | `table`, `json`, `jsonl`, `markdown` — same flags everywhere     | Varies per wrapper               |
| Agent install                       | `npx skills add IamCoder18/huly-cli` (one command)               | Manual MCP server config         |
| Polish                              | Every command has `--yes`, `--json`, idempotency, ref-resolution | Inconsistent                     |

> **Manually verified against every Huly product area** — accounts,
> workspaces, Tracker (projects, issues, components, milestones,
> templates), Collaboration (channels, DMs, threads, comments, activity),
> Knowledge (cards, documents, master-tags, teamspaces), Planning
> (actions, scheduling, time tracking), Calendar (events, recurrence),
> Platform (spaces, types, relations, approvals, notifications).

---

## Quickstart

```bash
# 1. Write your config (dotenv format — KEY=value, NO `export` prefix)
mkdir -p ~/.config/huly
cat > ~/.config/huly/.env <<'EOF'
HULY_URL=https://huly.example.com
HULY_EMAIL=you@example.com
HULY_PASSWORD=your-password
EOF

# 2. Create an account + first workspace (skip if you already have one)
#    The CLI reads HULY_PASSWORD from the dotenv file automatically.
huly signup --email you@example.com --password "$HULY_PASSWORD" \
            --first You --last Name --create-workspace my-ws --yes

# 3. Log in
huly login --headless

# 4. Create a project + first issue
huly project create --name "Demo" --identifier DEMO
huly issue  create --project DEMO --title "Set up CI pipeline" --yes

# 5. Create a Planner todo + schedule it (note: --start and --duration are required)
huly action    create --title "Implement login screen" --owner you@example.com --yes
huly action    list --assignee you@example.com --completed false
huly action    schedule <ref> --start "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --duration 30
```

> Want the full narrative? See
> [Getting started](docs/getting-started.md) and the
> [Bootstrap a new project](docs/guides/workflows.md#bootstrap-a-new-project)
> workflow.

---

## Documentation

### Onboarding

- [Getting started](docs/getting-started.md) — config files, auth modes,
  signup, the Agent Skill, troubleshooting first-run
- [Usage](docs/usage.md) — global flags, output modes, ref resolution,
  writing markup correctly
- [Security](docs/security.md) — what the CLI does and doesn't do,
  credential storage, threat model

### Command reference

- [Accounts & workspaces](docs/commands/accounts-workspaces.md) — `login`,
  `signup`, `whoami`, `workspace`, `user`
- [Tracker](docs/commands/tracker.md) — `project`, `issue`, `component`,
  `milestone`, `issue-template`
- [Collaboration](docs/commands/collaboration.md) — `comment`, `channel`,
  `dm`, `thread`, `activity`
- [Knowledge](docs/commands/knowledge.md) — `card`, `card-space`,
  `master-tag`, `document`, `teamspace`
- [Planning](docs/commands/planning.md) — `action`, `schedule`, `time`
- [Calendar](docs/commands/calendar.md) — `calendar`, recurring events
- [Platform](docs/commands/platform.md) — `space`, `space-type`,
  `association`, `relation`, `project-type`, `task-type`, `issue-status`,
  `notification`, `approval`

### Guides

- [Workflows](docs/guides/workflows.md) — bootstrap a project, bulk-archive,
  daily report, copy issues between projects, orphan cleanup
- [Migration](docs/guides/migration.md) — from `huly-mcp`, the SDK,
  the REST API, or the web UI

### Reference

- [CLI behavior](docs/reference/cli-behavior.md) — smart defaults, caches,
  filtering, idempotency, error exits, prompts, pooling
- [Platform behavior](docs/reference/platform-behavior.md) — cascades,
  triggers, permissions, integrations, calendar quirks, locking
- [Environment variables](docs/reference/environment.md) — every
  `HULY_*` var, credential file locations, reset recipe
- [Model surface](docs/reference/model.md) — class ID reference and
  plugin/surface map

### Advanced

- [Escape hatches](docs/advanced/escape-hatches.md) — `huly api` and
  `huly ws` for raw RPCs
- [CLI architecture](docs/advanced/architecture.md) — source layout,
  connection flow, markup handling
- [Server architecture](docs/advanced/server-architecture.md) — services,
  database, transactions, backups, upgrades

### Contributing

- [Development](docs/development.md) — conventions, adding a new
  command, build commands

---

## License

MIT — see [LICENSE](LICENSE).
