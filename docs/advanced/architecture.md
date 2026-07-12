# CLI architecture

How the CLI is wired together internally. Useful when debugging, when
adding a new resource, or when a command's behavior surprises you.
For the **server** side, see
[Server architecture](server-architecture.md).

## Table of contents

- [Source layout](#source-layout)
- [Connection flow](#connection-flow)
- [Markup handling](#markup-handling)

---

## Source layout

```text
src/
  cli.ts              # top-level command registration
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
    channel.ts        # channel CRUD + members + messages (# dm, thread)
    card.ts           # card module (# card-space, master-tag)
    action.ts         # planner tasks
    document.ts       # documents + teamspaces + snapshots (# teamspace)
    calendar.ts       # events + recurring + calendars + schedules (# schedule)
    time.ts           # time tracking
    user.ts           # profile + person lookup
    workspace.ts      # workspace ops
    todo.ts           # legacy todo (replaced by action)
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
```

The bundled `dist/index.js` is what npm publishes; the source above
is the dev tree.

---

## Connection flow

1. `huly --workspace prod issue list`
2. `globalsFrom(cmd)` extracts `--workspace prod` from the parsed
   `Command`.
3. `connectCli({ workspace: 'prod' })` resolves workspace name →
   URL/UUID.
4. `connectPlatform(...)` reads a token from the credentials cache
   and falls back to env login (`HULY_TOKEN`, or `HULY_EMAIL` /
   `HULY_PASSWORD`).
5. SDK opens a WebSocket to the transactor and loads the model.
6. `client.findAll(CLASS.Issue, { ... })` issues the server-side
   query.
7. CLI formats the result as table / JSON / Markdown.

Each invocation opens a fresh `PlatformClient` and closes it in
`finally` — see
[CLI behavior — Connection pooling](../reference/cli-behavior.md#connection-pooling).

The resolver cache is keyed by the `PlatformClient` instance via a
`WeakMap`, so workspace switches get a fresh cache automatically
and entries die with the connection. See
[CLI behavior — Cache & index behavior](../reference/cli-behavior.md#cache-index-behavior).

---

## Markup handling

The CLI converts user-facing HTML / Markdown body content into
prosemirror-JSON markup before storage. On `* create --body` it
calls `client.markup.uploadMarkup(...)` directly (bypassing the
SDK's `processMarkup` / `MarkupContent` path, which uses two ESM/CJS
class instances of `MarkupContent` that fail the `instanceof` check).
On `* update --body` it calls only
`client.markup.collaborator.updateMarkup` (the `updateContent` RPC)
— no redundant JSON-blob upload per edit.

**Read path:** `get --markdown` calls `client.fetchMarkup(...,
'markdown')` which triggers the server's `markupToJSON` →
`markupToMarkdown` pipeline. If the conversion fails server-side,
the SDK returns the raw prosemirror-JSON string. The CLI detects
this (heuristic: result starts with `{"type":"doc"`), prints a
warning to stderr, and — if `HULY_MARKDOWN_FALLBACK_FAIL=1` is set
— exits non-zero so CI scripts can detect silent fallback. Use
`--raw-markup` (read commands only) to dump the stored
prosemirror-JSON directly.

For rich-text round-trip features (mention nodes, embeds) that
don't survive the JSON round-trip, use the raw escape hatch:
`huly ws tx '[{"method":"createDoc", ...}]'` — see
[Escape hatches](escape-hatches.md#websocket-huly-ws).

For the layout rules your input HTML must follow, see
[Usage — Writing markup](../usage.md#writing-markup-body-description-layout-rules).
