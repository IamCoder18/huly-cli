---
title: Escape hatches
description: When huly-cli doesn't have a flag for what you need — `huly api` and `huly ws` for raw SDK RPCs against your self-hosted Huly workspace.
---

# Escape hatches

When a CLI command doesn't exist for what you need, or the flag you
need isn't exposed, talk to the server directly. Both escape hatches
are pass-through — they don't filter or transform the response.

## Table of contents

- [HTTP (`huly api`)](#http-huly-api)
- [WebSocket (`huly ws`)](#websocket-huly-ws)
- [When to use escape hatches](#when-to-use-escape-hatches)

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
is appended to the workspace's API URL.

---

## WebSocket (`huly ws`)

The Huly RPC protocol uses WebSocket for the SDK connection, but the
raw `huly ws` escape hatch is **text JSON only**. Use it for direct
method calls without opening the SDK's binary transport:

```bash
# findAll
huly ws findAll '[{"_class":"tracker:class:Project"},{}]'

# findOne
huly ws findOne '[{"_class":"tracker:class:Project"},{"identifier":"TSK"}]'

# createDoc
huly ws createDoc '["tracker:class:Project","core:space:Space",{"identifier":"NEW","name":"New project"}]'

# tx (raw transaction)
huly ws tx '[{"_class":"core:class:TxCreateDoc",...}]'
```

> `huly ws` accepts a single positional `<method>` followed by an
> optional `[params]` argument that is a **JSON-encoded array of
> positional parameters** for that method. Method names mirror the
> SDK's `PlatformClient` interface. See
> `node_modules/@hcengineering/api-client/lib/client.js` for the full
> list.
>
> The `tx` RPC supports every transaction type — `TxCreateDoc`,
> `TxUpdateDoc`, `TxRemoveDoc`, `TxMixin`, `TxApplyIf`. Build the
> payload directly; the CLI doesn't validate. Use this for things
> the CLI doesn't expose (custom mixins, batched transactions,
> advanced markup round-trips).

---

## When to use escape hatches

- A command exists but doesn't expose the flag you need (rare).
- A command exists but operates on a wrong sub-resource.
- You're doing batch operations and need to skip validation.
- You're debugging and need to see the raw server response.
- The CLI doesn't support the surface you need (use the SDK
  instead — see
  [Migration — from the SDK](../guides/migration.md#from-the-huly-sdk-typescript)).

The escape hatches pass through directly; the CLI handles auth and
caching, not transformation. If you find yourself reaching for
`huly ws` often, that's a signal the CLI should expose that surface
natively — file an issue.
