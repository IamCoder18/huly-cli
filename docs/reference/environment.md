# Environment variables

Every flag and env var the CLI honors. Pair this with
[CLI behavior](cli-behavior.md) for the auto-creations and defaults
those env vars influence.

## Table of contents

- [Environment variables (cheat sheet)](#environment-variables-cheat-sheet)
- [Auth caching](#auth-caching)
- [Reset the CLI](#reset-the-cli)
- [WebSocket session reconnect](#websocket-session-reconnect-during-workspace-upgrade)
- [Concurrent edit semantics](#concurrent-edit-semantics)
- [Large lists and fulltext](#large-lists-and-fulltext)
- [Audit trail queries](#audit-trail-queries)
- [Account-server workspace limit](#account-server-workspace-limit)
- [Model upgrade queue](#model-upgrade-queue)

---

## Environment variables (cheat sheet)

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
| `HULY_OPINIONATED` | `1` | Master switch for the CLI's opinionated defaults. Set to `0` (also `false` / `no` / `off`, case-insensitive) to disable every default that `--minimal` disables — including: project-type pinning to the classic tracker ProjectType, issue status defaulting to category `ToDo`, issue assignee defaulting to the current user by email, `card create` auto-picking the first available CardSpace, omission of `description` from the `project create` payload when `--description` is not supplied, and omission of `parent` from the `issue create` payload when `--parent` is not supplied. Equivalent to passing `--minimal` on every command. Anything else (or unset) keeps the defaults enabled. |
| `NO_COLOR` | — | Disables chalk colors |
| `XDG_CONFIG_HOME` | `~/.config` | Base for credential/config files |
| `CI` | — | Triggers JSON output and disables spinner |

Precedence for global flags: **flag > env > cached file**. The
cached `~/.config/huly/active-workspace` is the lowest-priority
default.

---

## Auth caching

- Tokens are persisted at
  `${XDG_CONFIG_HOME:-$HOME/.config}/huly/credentials.json` (mode
  0600). The CLI honors `XDG_CONFIG_HOME`; `~/.config/huly` is the
  default.
- Account token + per-workspace tokens are stored separately.
- Re-login **preserves existing workspace tokens** when the account
  token is refreshed.
- `HULY_TOKEN` bypasses all caching (account-level pre-issued JWT) —
  it is read from the environment each invocation and never written
  to `credentials.json`.
- The CLI will NOT re-login if a cached account token exists for the
  given email — this avoids clobbering workspace tokens.
- Workspace-scoped tokens are re-fetched via `selectWorkspace` on
  every `connectPlatform` call.

---

## Reset the CLI

```bash
# XDG-aware — resolves $XDG_CONFIG_HOME if set, else ~/.config.
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/huly"
rm -f "$config_dir/credentials.json" \
      "$config_dir/active-account" \
      "$config_dir/active-workspace" \
      "$config_dir/bootstrap.json"
huly login --headless
```

Removing `bootstrap.json` forces a re-run of the workspace-identity
bootstrap on the next connect (see [Getting started — Config files](../getting-started.md#config-files)).

For a full local-state wipe, also delete the dotenv file the CLI
loaded last — `HULY_ENV_FILE` if set, otherwise
`~/.config/huly/.env`:

```bash
env_file="${HULY_ENV_FILE:-$HOME/.config/huly/.env}"
rm -f "$env_file"
```

`HULY_ENV_FILE` is honored only for the dotenv loader; the cached
files (`credentials.json`, `active-workspace`, `active-account`,
`bootstrap.json`) always live in `$XDG_CONFIG_HOME`-aware
`configDir()`.

---

## WebSocket session reconnect (during workspace upgrade)

When a workspace is being upgraded, the server allows the previous
session to multiplex for up to **30 seconds**
(`sessionManager.reconnectTimeout`). After that window, the client
is force-disconnected. The CLI doesn't auto-reconnect — restart the
command. If you see `Model version mismatch`, the workspace was
upgraded under you; refresh and retry.

---

## Concurrent edit semantics

- All `Doc` updates use optimistic locking via `modifiedOn` /
  `modifiedBy`.
- Last write wins. There is no version counter.
- Rich-text fields (in y-docs) merge via Y.js CRDT (per-character).
- No pessimistic locks anywhere.

See [Platform behavior — Locking, audit, soft-delete](platform-behavior.md#locking-audit-soft-delete)
for the wider auditing model.

---

## Large lists and fulltext

For workspaces with >10k issues, prefer server-side filtering by
project or status before piping to `jq`. The CLI does not paginate
server-side; each `list` command fetches the full result set then
slices in-memory. See
[CLI behavior — Pagination](cli-behavior.md#pagination).

For fulltext search, use `huly ws findAll` with a
`FullTextSearchContext` query — the CLI does not wrap search syntax,
so ES query string operators (`AND`, `OR`, `NOT`, `+`, `-`, `"…"`,
`*`, `~`, `field:value`) pass through.

---

## Audit trail queries

The `tx` domain is the audit log. To see who changed what:

```bash
huly ws findAll '[{"_class":"core.class.Tx"},{"objectId":"<doc-id>","modifiedOn":{"$gte":<start-ms>,"$lte":<end-ms>}}]' --json
```

Each tx carries `modifiedBy`, `modifiedOn`, `space`, `objectId`,
and the full operations payload. See
[Escape hatches — WebSocket (`huly ws`)](../advanced/escape-hatches.md#websocket-huly-ws).

---

## Account-server workspace limit

`WORKSPACE_LIMIT_PER_USER` defaults to **10** on the account pod.
If you hit it, you get `WorkspaceLimitReached`. Either increase the
env var on the account pod or delete some workspaces (use
`WS_OPERATION=all+backup` so the worker actually cleans up
`pending-deletion` workspaces). See
[Getting started — Troubleshooting first-run](../getting-started.md#troubleshooting-first-run).

---

## Model upgrade queue

New plugin versions ship new `model-upgrade txs`. The workspace
pod applies them automatically **with the default `WS_OPERATION=upgrade`**
when the workspace's `version_major/minor/patch` is below the current
— model upgrades are the responsibility of the default mode; setting
`all` or `all+backup` does not change upgrade behavior, it just adds
the additional phases (`pending-creation`, `pending-deletion`,
archiving, migration, restore). On a fresh workspace, this takes
~30 seconds. If `findAll` returns 0 for classes that should have
data, the model may not have applied yet — wait or restart the
workspace pod to force a re-apply.
