---
title: Direct SDK and HTTP access (advanced)
description: When huly-cli doesn't have a flag for what you need — `huly api` and `huly ws` for raw, unvalidated passthroughs against your self-hosted Huly workspace. Advanced use only.
---

# Direct SDK and HTTP access (advanced)

> **Advanced only.** Two commands bypass every CLI safety check — ref resolution, type checking, cascade awareness, error mapping, and (for destructive calls) confirmation prompts:
>
> - **`huly api`** — raw HTTP passthrough.
> - **`huly ws`** — raw WebSocket RPC.
>
> Treat them like raw SQL. Most workflows do not need them. If you find yourself reaching for them often for a pattern the CLI should expose, file an issue — that's a missing-feature signal.

When a CLI command doesn't exist for what you need, or the flag you need isn't exposed, talk to the server directly. Both commands are pass-through — they don't filter or transform the response.

## Table of contents

- [HTTP (`huly api`)](#http-huly-api)
- [WebSocket (`huly ws`)](#websocket-huly-ws)
- [When to use direct SDK access](#when-to-use-direct-sdk-access)

---

## HTTP (`huly api`)

```bash
huly api GET /api/v1/version
huly api GET /config.json
huly api POST /api/v1/something --body '{"key":"value"}'
huly api GET /api/v1/things --query foo=bar --query baz=qux
huly api GET /api/v1/things --header "Authorization: Bearer ..."
```

Available methods: `GET | POST | PUT | PATCH | DELETE`. The path
is appended to the workspace's API URL. The CLI does not validate the path, method, body, or any custom headers — anything you send goes straight to the server.

> **`Authorization` is not overridable.** The CLI always sets `Authorization: Bearer <resolved-token>` after merging your custom headers (`packages/cli/src/raw/api.ts:43-49`), so passing `--header "Authorization: Bearer …"` has no effect. All other custom headers pass through verbatim.

---

## WebSocket (`huly ws`)

The Huly RPC protocol uses WebSocket for the SDK connection, but the
raw `huly ws` command is **text JSON only**. Use it for direct
method calls without opening the SDK's binary transport:

```bash
# findAll
huly ws findAll '[{"_class":"tracker:class:Project"},{}]'

# tx (raw transaction)
huly ws tx '[{"_class":"core:class:TxCreateDoc",...}]'
```

> `huly ws` accepts a single positional `<method>` followed by an
> optional `[params]` argument that is a **JSON-encoded array of
> positional parameters** for that method. On Huly 0.7.x the raw
> socket dispatches a small whitelist: `findAll`, `tx`, `hello`, and
> `ping`. Do not rely on `findOne`, `createDoc`, `updateDoc`, or other
> SDK methods through this command — use the high-level commands
> for writes, or `tx` for raw transaction payloads.
>
> The `tx` RPC supports every transaction type — `TxCreateDoc`,
> `TxUpdateDoc`, `TxRemoveDoc`, `TxMixin`, `TxApplyIf`. Build the
> payload directly; the CLI doesn't validate. **Confirm with the user before invoking** — raw RPC has no CLI confirmation prompt and bypasses every safety check.

---

## When to use direct SDK access

- A command exists but doesn't expose the flag you need (rare). Use the high-level command with `--set key=value` first; reach for `huly ws` / `huly api` only when the field is not exposed at all.
- A command exists but operates on a wrong sub-resource.
- You're debugging and need to see the raw server response.
- The CLI doesn't support the surface you need (use the SDK
  instead — see
  [Migration — from the SDK](../guides/migration.md#from-the-huly-sdk-typescript)).

The commands pass through directly; the CLI handles auth and
caching, not transformation. If you find yourself reaching for
`huly ws` often, that's a signal the CLI should expose that surface
natively — file an issue.

**Do not use raw RPC to bypass `--yes`, validation, or duplicate-identifier checks.** Those refusals are intentional.
