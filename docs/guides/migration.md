---
title: Migration guides
description: Switch to huly-cli from huly-mcp, the SDK directly, the REST API, or the web UI — with side-by-side command translations.
---

# Migration guides

Switching **to** `huly-cli` from another way of driving Huly. Most of
this is mechanical — same SDK underneath, different invocation.

## Table of contents

- [From `huly-mcp` (MCP server)](#from-huly-mcp-the-mcp-server)
- [From the Huly web UI](#from-the-web-ui)
- [From the Huly SDK (TypeScript)](#from-the-huly-sdk-typescript)
- [From the REST API](#from-the-rest-api)
- [From the GraphQL API](#from-the-graphql-api)

---

## From `huly-mcp` (the MCP server)

If you're using the MCP server (`huly-mcp`) and want to switch to
`huly-cli`:

### Same operations, different invocation

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

### Output format

Both produce JSON arrays. The MCP server wraps responses in
`{ result: [...] }`; the CLI returns raw `[...]`. Strip the wrapper
if you're reusing MCP client code:

```bash
# CLI → unwrap if your code expects the MCP shape
huly issue list --json | jq '{ result: . }'
```

### Auth

Both use the same `account-token` JWT. You can reuse the MCP server's
credentials cache by symlinking it (XDG-aware on the destination
side; the MCP server's directory lives at `~/.config/huly-mcp` in
practice and is the usual source path):

```bash
src="$HOME/.config/huly-mcp/credentials.json"
dst_dir="${XDG_CONFIG_HOME:-$HOME/.config}/huly"
mkdir -p "$dst_dir"

# Back up any existing CLI credentials and link to the MCP cache.
# Re-running this block is safe: the existing file is preserved
# as credentials.json.bak before the symlink overwrites it.
dst="$dst_dir/credentials.json"
if [ -e "$dst" ] && [ ! -L "$dst" ]; then
  mv "$dst" "$dst.bak"
fi
[ -L "$dst" ] && rm "$dst"
ln -s "$src" "$dst"
```

### Tool naming

MCP uses `snake_case` (e.g. `list_issues`); the CLI uses
space-separated resource/verb syntax (`issue list`). The MCP names map
to CLI as:

| MCP | CLI |
|---|---|
| `list_<resources>` | `<resource> list` |
| `get_<resource>` | `<resource> get` |
| `create_<resource>` | `<resource> create` |
| `update_<resource>` | `<resource> update` |
| `delete_<resource>` | `<resource> delete` |
| `<verb>_<resource>` (e.g. `add_comment`) | `<resource> <verb>` |

---

## From the web UI

If you're used to clicking around in the web UI:

| Web UI action | CLI command |
|---|---|
| Click project in sidebar | `huly workspace use <name>` then `huly project list` |
| Open issue TSK-1 | `huly issue get TSK-1 --markdown` |
| Create new issue | `huly issue create --project TSK --title "..."` |
| Move issue to "Done" | `huly issue update TSK-1 --status Done` |
| Add label "bug" | `huly issue label TSK-1 add --label bug` |
| Comment on issue | `huly comment add --issue TSK-1 --body "..."` |
| Send DM | `huly dm send placeholder --person alice@... --body "..."` (use any placeholder for `<dm>` when `--person` is set; the CLI auto-creates the DM as needed) |
| Create channel | `huly channel create --name engineering` |
| Create calendar event | `huly calendar create --title "Standup" --start ... --end ...` |
| Log time | `huly time log --issue TSK-1 --minutes 30` |
| Switch workspace | `huly workspace use <name>` |

> Heads up: the platform fires cascades from CLI mutations too — see
> [Platform behavior](../reference/platform-behavior.md) for what
> will auto-create, auto-rollback, or auto-notify alongside each
> command.

---

## From the Huly SDK (TypeScript)

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

If you need to call a method the CLI doesn't expose, see
[Escape hatches](../advanced/escape-hatches.md) for `huly ws` (raw
WebSocket RPC).

---

## From the REST API

If you're using `curl` against the Huly REST API:

```bash
# REST (raw)
curl -X GET "$HULY_URL/api/v1/version"

# CLI
huly api GET /api/v1/version
```

The CLI's `api` command passes through to the REST API but handles
auth headers automatically. Use it for ad-hoc endpoints the CLI
doesn't cover. See
[Escape hatches — HTTP (`huly api`)](../advanced/escape-hatches.md#http-huly-api).

---

## From the GraphQL API

Huly doesn't ship a GraphQL API. The CLI is the closest equivalent —
it wraps the platform's RPCs into REST-like commands. If you need
GraphQL, you're out of luck.
