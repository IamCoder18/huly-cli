# Getting started

Install → configure → log in → first command. Anything reusable across
every command lives in [Usage](usage.md) and
[Security](security.md).

## Table of contents

1. [Configuration](#configuration)
2. [Authentication](#authentication)
3. [Agent Skill (LLM agents / OpenClaw)](#agent-skill-llm-agents-openclaw)
4. [Troubleshooting first-run](#troubleshooting-first-run)

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
re-login on the next invocation. See
[Environment variables](reference/environment.md) for the full list of
every flag/env var the CLI honors, including cache directories and
auth bypass.

### Minimal `.env`

```bash
export HULY_URL=https://huly.example.com
export HULY_EMAIL=you@example.com
export HULY_PASSWORD=your-password
```

### Strict-mode `.env` (CI-friendly)

```bash
export HULY_URL=https://huly.example.com
export HULY_TOKEN=eyJ0eXAiOiJKV1Q...   # pre-issued account JWT, skip login
export HULY_WORKSPACE=production
export HULY_PROJECT=BACKEND            # for bare-number issue refs
export HULY_NONINTERACTIVE=1           # disable all prompts
```

---

## Authentication

The CLI supports three auth modes. Pick one — they all produce the
same cached credentials on disk.

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

### Signup

Create a new account directly:

```bash
huly signup --email you@example.com --password '***' --first You --last Name
huly signup --headless                      # uses HULY_* env vars, no prompts
huly signup --email ... --password ... --create-workspace my-ws   # signup + workspace
```

On selfhost the signup endpoint is open. On hosted/invite-only
deployments the account server may reject uninvited signups — in that
case use an invite link (`huly workspace access-link --role GUEST`).

### Token caching

After login, the CLI stores the **account token** and
**workspace tokens** in `~/.config/huly/credentials.json`. Each
subsequent invocation reuses the cache until tokens expire.

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

---

## Agent Skill (LLM agents / OpenClaw)

In addition to being a CLI, `huly-cli` ships a drop-in **Agent Skill** —
a curated `SKILL.md` plus a `references/` bundle that teaches an LLM
coding agent (or OpenClaw) how to drive your Huly workspace end-to-end
without a browser. The skill encodes the surface map, the cascade
side effects (Issue ↔ Action state machine, WorkSlot mirrors, parent-chain
`reportedTime` recompute), the ref-resolution order, and the right
command for each user intent — so the agent doesn't have to
rediscover them.

### Install the skill

For AI coding agents (Kilo Code, Cursor, Claude Code, etc. — anything
that consumes the open [`skills`](https://github.com/vercel-labs/skills)
package format):

```bash
npx skills add IamCoder18/huly-cli
```

For [OpenClaw](https://openclaw.ai):

```bash
openclaw skills install @iamcoder18/huly
```

The install gives the agent the skill's `SKILL.md` and
`references/*.md` so it can pick the correct surface on the first try.
The skill assumes the `huly` CLI itself is already installed and
authenticated — see [Configuration](#configuration) and
[Authentication](#authentication) above.

### Verify it works

No proactive check is needed — the skill instructs the agent to
proceed with your request normally and only run setup if a `huly`
command fails. If the CLI is missing or credentials are invalid, the
agent will install the CLI and prompt you to configure credentials.

### Skill source

The canonical source for the skill lives in this repo at
[`packages/huly-skill/SKILL.md`](https://github.com/IamCoder18/huly-cli/blob/main/packages/huly-skill/SKILL.md),
with per-surface deep dives under
[`packages/huly-skill/references/`](https://github.com/IamCoder18/huly-cli/blob/main/packages/huly-skill/references).
It is published in lockstep with the CLI.

---

## Troubleshooting first-run

### `HULY_URL is required`

Set `HULY_URL` in your shell or in `~/.config/huly/.env`. The CLI
refuses to fall back to a default.

### `WorkspaceLimitReached`

`WORKSPACE_LIMIT_PER_USER` defaults to **10** on the account pod. Either
increase the env var on the account pod or delete some workspaces
(use `WS_OPERATION=all+backup` so the worker actually cleans up
`pending-deletion` workspaces). See
[Environment variables — Account-server workspace limit](reference/environment.md#account-server-workspace-limit).

### Workspace appears empty after create

The model-upgrade queue may still be applying. On a fresh workspace
this takes ~30 seconds. If `findAll` returns 0 for classes that should
have data, wait or restart the workspace pod with
`WS_OPERATION=upgrade` to force a re-apply. See
[CLI architecture — Model upgrade queue](advanced/architecture.md).

### `version mismatch` on connect

The transactor and workspace pod must be at the same model version
(server-side ops concern). If you self-host, keep
`~/platform/common/scripts/version.txt` in sync across builds. The
CLI's read of `serverVersion` is logged on connect.

### Stale references after rename or delete

The resolver index has no TTL. If a project is renamed/deleted in one
command and you reference it by name in the next command in the same
shell, run any write against the changed class to invalidate the
index, or restart the process. See
[CLI behavior — Cache & index behavior](reference/cli-behavior.md#cache-index-behavior).
