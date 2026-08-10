# Escape hatches & internals — when the CLI falls short

This reference covers: `huly api` (HTTP), `huly ws` (raw WebSocket RPC), and the internal mechanics of ref resolution, output formatting, error codes, and caches. You usually don't need this for everyday work — load it when a command is missing a flag, when you need fulltext search, when you're debugging, or when the CLI's behavior surprises you.

---

## `huly api <METHOD> <path>` — REST escape hatch

Plain HTTP passthrough to the workspace API URL. Auth header is auto-attached from the resolved token.

```bash
huly api GET /api/v1/version
huly api GET /config.json
huly api POST /api/v1/things --body '{"key":"value"}'
huly api GET /api/v1/things --query foo=bar --query baz=qux
huly api GET /api/v1/private --header "Authorization: Bearer …"
```

Methods: `GET | POST | PUT | PATCH | DELETE`. Query params and headers accept repeated `k=v`.

Status codes map to exit codes:
- `2xx` → `Ok`
- `401` / `403` → `Auth` (3)
- `429` → `RateLimited` (5)
- `4xx` → `Validation` (4) or `Conflict` (6)
- `5xx` → `Server` (7)

Use this when:
- You want to hit an undocumented endpoint
- The CLI command exists but doesn't expose a flag you need (rare)
- You're hitting a custom plugin route

---

## `huly ws <method> [params]` — WebSocket RPC escape hatch

Speaks Huly's binary RPC directly. Method names mirror the SDK's `PlatformClient` interface.

**`[params]` is ONE positional argument that must be a JSON-encoded array.** SDK methods with multiple positional parameters (e.g. `findAll(classId, query, options)`) must be wrapped into a single array — passing them as separate CLI positional args will fail with "too many arguments".

```bash
# findAll(classId, query, options)
huly ws findAll '["tracker:class:Issue", {"_class":"tracker:class:Issue"}, {}]'

# findOne(classId, query)
huly ws findOne '["tracker:class:Project", {"identifier":"TSK"}]'

# createDoc(objectClass, space, attributes)
# (use `huly ws getHierarchy` to find the literal space for a class)
huly ws createDoc '["tracker:class:Project", "<project-space>", {"identifier":"NEW","name":"New project"}]'

# updateDoc(objectClass, space, objectId, ops)
huly ws updateDoc '["tracker:class:Issue", "<issue-space>", "<issue-id>", {"$set":{"status":"<status-id>"}}]'

# removeDoc(objectClass, space, objectId)
huly ws removeDoc '["tracker:class:Issue", "<issue-space>", "<issue-id>"]'

# tx(txArray) — raw transaction
huly ws tx '[{"_class":"core:class:TxCreateDoc","objectClass":"tracker:class:Project"}]'

# model inspection — getModel takes no required args
huly ws getModel
huly ws getHierarchy

# fulltext search via queryAll(classId, query, options)
# (bypasses the CLI's --description-search which is best-effort regex)
huly ws queryAll '["tracker:class:Issue", {"$search":"deploy pipeline"}, {}]'

# audit trail — the tx domain IS the audit log
huly ws findAll '["core:class:Tx", {"objectId":"<doc-id>"}]' --json \
  | jq '[.[] | {by: .modifiedBy, on: .modifiedOn, ops: .attributes}]'
```

**Timing:**
- 60s overall timeout per call
- 5s ping interval (disable with `--no-ping`)
- Default chunked responses are buffered and flushed as JSON arrays

**When to reach for this:**
- Fulltext search with ES query string operators (`AND`, `OR`, `+`, `-`, `"…"`, `field:value`)
- Audit-trail queries (`core:class:Tx`)
- Bulk operations where you want to skip CLI validation
- Plugin methods the CLI doesn't expose
- Reading the `Space` permission matrix directly

---

## Ref resolver — the 6-step algorithm

When you pass a positional `<ref>` (e.g. `huly issue get TSK-1`), the CLI tries (`transport/ref-resolver.ts:106-140`):

1. **Raw `_id`** — matches `^[a-z0-9]+:[a-z0-9]+:[A-Za-z0-9_-]+$` (e.g. `tracker:issue:abc123`) OR a 16+ char UUID-like blob. Returned as-is.
2. **Index lookup** — `buildIndex(client, classId, identifierField)` builds a per-PlatformClient WeakMap of every doc of that class, keyed on `identifier`, `name`, `label`, `title:<lowercased>`, and the raw `_id`.
3. **Prefixed form** `^[A-Z][A-Z0-9]+-\d+$` — e.g. `TSK-12`. Index lookup.
4. **Bare digits** with `defaultProjectIdentifier` set — composes `TSK` + `-` + `5` to make `TSK-5`. Index lookup.
5. **Title-based lookup** using lowercased title.
6. Throw `NotFound` with the first 10 index keys as a hint.

When `NotFound` fires, the message looks like:

```
error  ref not found: foo
hint:  candidates: TSK-1, TSK-2, TSK-3, …
```

This is your fallback prompt for the agent — try the candidates, or list them all explicitly.

---

## Ref resolver cache (and when it lies)

The index lives in `WeakMap<PlatformClient, Map<classId, Map<string, Ref<Doc>>>>`.

**Critical properties:**
- **In-memory, no TTL.** Dies with the `PlatformClient` instance.
- **Cross-workspace safe.** Keyed on the client, not globally — switching workspaces = fresh client = fresh cache.
- **Invalidated explicitly after writes.** `invalidateIndex(client, CLASS.X)` is called after every create / label-add / label-remove for that class.

**When you'll see stale data:**
- You renamed a project, then in the same shell tried `huly project get <old-name>`. The cache still has `old-name` mapped. Restart the process, or run any write to the changed class.
- Cross-class writes: if you changed something in class A, then asked for class B's data using a value derived from A's response, the class B cache may be stale.

**Fix:** just run `huly project list --json` again — `findAll` does NOT use the index, it queries the server directly. So a fresh `list` after a rename reliably rebuilds.

---

## Ref-accepting flags: the asymmetry between them

There is no single shared algorithm — each flag has its own resolver:

| Flag | Resolver | Substring fallback? |
|---|---|---|
| `--assignee` (issue) | `resolveAssignee` in `resources/_helpers.ts:298-322` | **Yes** — falls back to substring match after exact |
| `--owner` (action) | `resolveEmployeeId` in `resources/todo.ts:65-78` | **No** — strict exact match only |
| `--person` (DM/channel) | `resolvePersonId` in `resources/channel.ts:61-130` | **No** — strict, throws if multiple matches |
| `--calendar` (event) | inline in `resources/calendar.ts:649-672` | **No** — exact `id` then `name` lookup |
| `--members` (variadic) | shares `resolvePersonId` (same as `--person`) | **No** |

**The asymmetry to memorize:**
- `--assignee alice` → looks for "alice" OR any Person whose email/name *contains* "alice". **First match in the `findAll()` result order wins** (the CLI does NOT sort persons). Use `--assignee alice@example.com` to disambiguate.
- `--owner alice` → **strict** exact match against `Person.name` OR `Person.email`. No substring fallback. Pass the full name or email.

If you have two people named Bob in your workspace, `--assignee bob` picks whichever Bob appears first in the findAll response (not necessarily alphabetical). Pass full emails.

---

## Output modes — the internals

| Mode | Trigger | Output |
|---|---|---|
| Human table | (default) | Auto-sized columns via `output/format.ts`. Colors via chalk (suppressed by `NO_COLOR` or non-TTY). |
| JSON | `--json` OR `--ci` OR `CI=1` | `console.log(JSON.stringify(data, null, 2))`. Always arrays for `list`, objects for `get/create/update/delete`. |
| Markdown body | `--markdown` on `get` of a content-bearing resource | `client.fetchMarkup(…, 'markdown')` with 5s timeout. Falls back to raw body string. |
| Dry-run | `--dry-run` | Prints the would-be tx JSON. No state changes. |

`shouldJson(opts)` resolves to `Boolean(opts.json || opts.ci || process.env.CI)` — any of those flips to JSON.

`--ci` is currently identical to `--json` but signals non-interactive intent in your scripts.

---

## Exit codes (always exit, never silent)

| Code | Constant | Trigger |
|---|---|---|
| 0 | `Ok` | Success |
| 1 | `Generic` | Unrecognized error |
| 2 | `NotFound` | Ref / object not found |
| 3 | `Auth` | 401, 403 — `huly login` or set `HULY_TOKEN` |
| 4 | `Validation` | 400, missing arg, bad enum, bad `k=v` |
| 5 | `RateLimited` | 429 (with 500/2000ms backoff, max 3 attempts) |
| 6 | `Conflict` | Duplicate, already exists |
| 7 | `Server` | ≥500 |
| 8 | `Ambiguous` | Declared, not yet raised |

All errors throw `CliError(ExitCode.X, msg, hint?)`. `handleError(e)` classifies, prints `error [N]  <message>` + indented hint, then exits.

This means scripts can use `set -e` and `case $? in …` cleanly.

---

## Caches

| Cache | Lifetime | Invalidation |
|---|---|---|
| Resolver index | In-memory, no TTL, dies with `PlatformClient` | `invalidateIndex(client, classId)` after writes |
| `_accounts` URL map | In-memory, per process | Never (restart process) |
| `credentials.json` (disk) | Until `rm`'d or until re-login refreshes | Re-login refreshes account token; preserves workspaces |
| `active-workspace` (disk) | Until `workspace use` or `--workspace` | `writeActiveWorkspace` overwrites |
| `active-account` (disk) | Until re-login | Updated on login |

All on-disk caches are mode 0600.

---

## `--set key=value` auto-coercion

Used by `huly project update`, `huly issue update`, etc.:

| Value | Coerced to |
|---|---|
| `null` | clears the field |
| `true` / `false` | boolean |
| `<numeric string>` (e.g. `42`, `-3.14`) | `Number` |
| anything else | `String` |

**Reserved keys silently stripped** (so don't try to set them). The set differs between `create` and `update`:

- `create`: `json, ci, markdown, dryRun, minimal, yes, workspace, url, space`
- `update`: `set, unset, json, ci, markdown, dryRun, minimal, yes, workspace, url, defaultProjectIdentifier`

`defaultProjectIdentifier` is the internal helper used by `--project TSK-5` ref resolution; `set` / `unset` only exist on `update`.

---

## Filtering & matching semantics (cheat sheet)

| Flag | Match | Notes |
|---|---|---|
| `--status` (issue) | exact label, case-insensitive | bad value lists available statuses |
| `--status-category` | strips `task:statusCategory:` prefix | accepted values are case-sensitive (`UnStarted\|ToDo\|Active\|Won\|Lost`); matching against stored categories is case-insensitive |
| `--priority` (issue) | exact label, case-insensitive | `Urgent\|High\|Normal\|Low\|None` |
| `--task-type` (issue) | exact label OR raw `_id` | per-project |
| `--role` (member) | aliases owner/admin/guest/docguest/readonlyguest/maintainer | case-insensitive |
| `--priority` (action) | **strict** enum | `Urgent\|High\|Medium\|Low\|NoPriority` — case-SENSITIVE |
| `--visibility` (action) | **strict** enum | `public\|busy\|private` — case-SENSITIVE |
| `--archived` | non-strict | `v !== 'false' && v !== '0'` → `true` |
| `--private` | non-strict | same as `--archived` |
| `--completed` (action) | `true\|false\|all` | `all` returns both |
| `--description-search`, `--content-search`, `--title` (action) | MongoDB regex | case-insensitive (`$options: 'i'`), special chars escaped |
| `--label` (issue) | exact match, repeatable | `{ labels: { $in: opts.label } }` |

There is **no server-side pagination**. `--limit / --offset` slice the full result in-memory after `findAll`. For >10k docs of a class, filter by space/date.

---

## Markup handling (y-docs)

The CLI deliberately bypasses the SDK's `MarkupContent` upload. Every body field is passed as a raw string instead. Implications:

- `huly document create --body "…"` stores the literal markdown.
- `huly document get <ref> --markdown` round-trips cleanly on CLI-created docs (returns your literal markdown).
- For web-UI-created docs, `--markdown` calls `fetchMarkup` with a 5s timeout. On timeout, you get the raw markup-ref string (e.g. `markup:abc123…`).

If you need collaborative editing features (mentions as actual nodes, embeds), the CLI will NOT preserve them. Use `huly ws tx` with a manually-constructed `MarkupContent` instead.

---

## Confirming destructive ops

`--yes` is required when:
- `workspace create`
- `workspace delete` (plus `--force` for the active workspace)
- ANY `delete <ref...>` with ≥2 refs

NOT required for:
- `dm create --person` (auto-creates)
- `dm send --person` (auto-creates)
- `action unschedule` with a single `--slot-id`
- All single-ref deletes

A 100ms sleep between consecutive deletes throttles the server tx stream during bulk operations.

---

## Retry behavior

The CLI has a `retry()` helper that retries on **429 only** with `500 * attempt² ms` backoff (500ms, 2000ms; max 3 attempts). It does NOT retry on 5xx, on NotFound, on Validation, or on Conflict. If you need retry logic, wrap your script in a loop.

There is **no WebSocket auto-reconnect**. Each command opens a fresh WS, runs, and closes in `finally`. If the connection drops mid-call, the error bubbles up — re-run.

---

## Server architecture context (helpful when debugging)

The CLI talks to three of the ~16 selfhost services:

| Service | Port | What the CLI does |
|---|---|---|
| `account` | 3000 | Login, workspace ops, account token |
| `transactor` | 3333 | WebSocket RPC (`findAll`, `tx`) |
| `collaborator` | 3078 | Read path for `fetchMarkup` |

The CLI never talks to `workspace`, `kvs`, `minio`, `redpanda`, `elastic`, `cockroach`, or `front` directly.

### Workspace lifecycle (server-side states)

```
pending-creation → creating → active
pending-upgrade → upgrading → active
pending-deletion → deleting → [gone]
archiving-pending-backup → archiving-backup → archiving-pending-clean → archiving-clean → archived
pending-restore → restoring → active
```

If you see "Model version mismatch", the workspace was upgraded under you. Refresh and retry.

`WS_OPERATION` env var on the workspace pod controls which states get processed (`upgrade` default / `all` / `all+backup`). For selfhost single-pod, set `all+backup`.

---

## Common recipes using escape hatches

### Audit who changed a doc

```bash
huly ws findAll '["core:class:Tx",{"objectId":"<doc-id>","modifiedOn":{"$gte":<start-ms>,"$lte":<end-ms>}}]' \
  --json \
  | jq '[.[] | {by: .modifiedBy, on: .modifiedOn, ops: .attributes}]'
```

### Fulltext search across issues

```bash
# Server-side Elasticsearch query — much more powerful than --description-search
huly ws queryAll '["tracker:class:Issue", {"$search":"deploy AND pipeline", "space":"<project-id>"}]' \
  --json
```

### Query the permission matrix of a space

```bash
huly space permissions <space-ref> --json
```

### Get the raw model

```bash
huly ws getModel --json | jq '.classes | length'
```

### Trigger a reindex (rare; usually the server self-heals)

```bash
huly ws tx '[{"method":"triggerReindex","params":[]}]'
```
