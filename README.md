# huly-cli

AI-agent-first CLI for self-hosted Huly.

`huly` wraps the Huly SDK into scriptable commands so you can automate
workspace tasks, integrate Huly into CI/CD pipelines, or operate Huly from
agents without a browser.

- **Shell pipelines** — pipe `huly issue list --json` to `jq`, `xargs`, etc.
- **CI/CD** — log issues from CI failures, link commits, close on merge
- **Agents** — any LLM can drive the CLI; no browser, no Playwright
- **Cron / automation** — daily backups of comments, scheduled cleanup, audits
- **Cross-workspace ops** — bulk-move issues between workspaces
- **Offline scripting** — write ops as bash scripts, version them in git

---

## Install

```bash
npm i -g @iamcoder18/huly-cli
huly --version
```

Other package managers: `pnpm add -g`, `yarn global add`, `bun add -g` (same package name).

### From source

```bash
git clone https://github.com/IamCoder18/huly-cli.git
cd huly-cli
pnpm install
pnpm --filter @iamcoder18/huly-cli build
pnpm --filter @iamcoder18/huly-cli start -- --version
```

The repo's `bin/huly` script wraps `node dist/index.js "$@"`, so it's
also fine to add `bin/` to `PATH` directly.

---

## Agent Skill (LLM agents / OpenClaw)

The CLI ships a drop-in **Agent Skill** — a curated `SKILL.md` plus a
`references/` bundle that teaches an LLM coding agent (or OpenClaw) how
to drive your Huly workspace end-to-end without a browser.

```bash
# Any agent consuming the open `skills` package format
npx skills add IamCoder18/huly-cli

# OpenClaw
openclaw skills install @iamcoder18/huly
```

The install gives the agent the skill's `SKILL.md` and `references/*.md`
so it can pick the correct surface on the first try. See
[Getting started — Agent Skill](docs/getting-started.md#agent-skill)
for verification and the canonical skill source path.

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
huly action    schedule <ref> --start "$(date -u +%Y-%m-%dT09:00:00Z)" --duration 30
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

This project follows the upstream Huly platform license. See the source
header in `src/cli.ts` for attribution and `LICENSE` at the repo root if
present.
