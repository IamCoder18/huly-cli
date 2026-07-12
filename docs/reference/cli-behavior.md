# CLI behavior

Everything the CLI silently applies for you — auto-creations, smart
defaults, caching, filtering semantics, error mappings. Lookup tables
first, narrative second.

## Table of contents

- [Auto-creations](#auto-creations)
- [Smart defaults (values the CLI fills for you)](#smart-defaults-values-the-cli-fills-for-you)
- [Ref resolution order (how flag values resolve)](#ref-resolution-order-how-flag-values-resolve)
- [Auto-coercion in `--set key=value`](#auto-coercion-in-set-keyvalue)
- [Cache & index behavior](#cache-index-behavior)
- [Timeouts](#timeouts)
- [Filtering & matching semantics](#filtering-matching-semantics)
- [Idempotency](#idempotency)
- [Error messages include next-step hints](#error-messages-include-next-step-hints)
- [Pagination](#pagination)
- [Confirmation prompts](#confirmation-prompts-yes)
- [Connection pooling](#connection-pooling)

---

## Auto-creations

The CLI silently creates things on your behalf to keep common flows
one-liners. Most can be disabled with `--minimal` /
`HULY_OPINIONATED=0`.

| Command | What gets auto-created | When |
|---|---|---|
| `huly document create` | A `General` teamspace (type `space-type:default`, members `[]`, description "Default teamspace (auto-created)") | Workspace has zero teamspaces. |
| `huly issue create` | 5 default `IssueStatus` records (`Backlog`, `To do`, `In progress`, `Done`, `Canceled`) in `core:space:Model` | Workspace has zero `IssueStatus`. |
| `huly issue create` | First `ProjectToDo` (classic projects only) | `--assignee` is non-empty (explicitly set, or defaulted to the current user by the opinionated default) AND status category is `ToDo`/`Active`. An explicit `--assignee ''` suppresses the cascade. See [Platform behavior — Issues](../reference/platform-behavior.md#issues-todos-the-cascade-everyone-hits). |
| `huly dm create --person <email>` / `huly dm send --person <email>` | A DM with that person (resolves via `resolvePersonId`) | No existing DM with that person. |
| `huly issue label add <ref> --label <name>` | A `TagElement` in `tags:space:Tag` (first `TagCategory`) | Label doesn't exist yet. |
| `huly project create` | The current user is added as `members: [<uuid>]` | Always (security invariant — required by `SpaceSecurityMiddleware` so the creator can `findAll` their own project). Not gated by `--minimal` or `HULY_OPINIONATED=0`. |
| `huly calendar create` | A new `Calendar` doc | Always; `--type public\|private` defaults to `public`. |
| `huly action create` | If `--attached-to` omitted, the task is attached to the owner's `Person` (or current user) | Default. |

> `huly issue create` re-tries the auto-seed on the **second** call
> if the first failed silently (model-load race). If the issue create
> keeps failing on a fresh workspace, run any other issue-list
> command first to nudge the model.

---

## Smart defaults (values the CLI fills for you)

| Command | Flag | Default |
|---|---|---|
| `huly project create` | `--sequence` | `0` |
| `huly project create` | `--members` | `[<current-user-uuid>]` |
| `huly project create` | `--description` | `''` (omitted with `--minimal` / `HULY_OPINIONATED=0` — but an explicit `--description ''` is still preserved verbatim; only a fully omitted flag is removed from the payload) |
| `huly project create` | `type` | `tracker:ids:ClassingProjectType` (the classic tracker ProjectType — note the server-side typo "Classing"). Without this default, projects may not be classic and miss the issue↔action cascade. Pass `HULY_OPINIONATED=0` or `--minimal` to skip. |
| `huly issue create` | `--status` | Lowest-rank `IssueStatus` in category `ToDo` (usually `To do`). Pin to Backlog with `--status Backlog`. With `HULY_OPINIONATED=0` or `--minimal`, falls back to the lowest-rank status overall (usually `Backlog`). |
| `huly issue create` | `--assignee` | Current user's email (resolved from `getAccount().fullSocialIds`). Pass `--assignee <other>` to override, `--assignee ''` to leave unassigned. Disabled with `HULY_OPINIONATED=0` or `--minimal`. |
| `huly issue create` | `--priority` | `Normal` if it exists in the workspace; else first priority; else omitted |
| `huly issue create` | `--task-type` | First available TaskType for the project; if none, falls back to `tracker:taskTypes:Issue` (NOT `tracker:issue:default` — that ref is invalid and the create errors) |
| `huly issue create` | `parent` | `null` (top-level), unless `--minimal` / `HULY_OPINIONATED=0` |
| `huly issue create` | `space` | `project._id` (unless `--minimal` / `HULY_OPINIONATED=0`) |
| `huly card create` | `--card-space` | First available, non-archived `CardSpace` (resolved with `findAll({ archived: false }, { sort: { createdOn: 1 }, limit: 1 })` — the oldest by `createdOn`). Falls back to literal `card:space:Default` if zero exist. With `HULY_OPINIONATED=0` or `--minimal`, uses the literal `card:space:Default` directly (which often does not exist). |
| `huly calendar create-calendar` | `--access` | `public` (one of `owner` / `team` / `public`) |
| `huly calendar create-calendar` | `--private` | `false` |
| `huly schedule create` | `--duration` | `30` (minutes) |
| `huly schedule create` | `--interval` | `15` (minutes) |
| `huly action create` | `--priority` | `NoPriority` |
| `huly action create` | `--visibility` | `public` |
| `huly action create` | `--owner` | Current user |
| `huly action create` | `--attached-to-class` | `contact:class:Person` |
| `huly action create` | `--due` | none (`dueDate: null`) |
| `huly action create` | `doneOn` | `null` |
| `huly action create` | `rank` | `0\|aaaaa:` |
| `huly time log` | `--date` | `Date.now()` |
| `huly time log` | value conversion | minutes → man-hours (`value = minutes/60`); rounds to nearest 15 min |
| `huly card create` | `--card-space` | `card:space:Default` (may not exist; create one first) |
| `huly teamspace create` | `--type` | `public` |
| `huly card-space create` | `--private` | `false` |

`--minimal` / `HULY_OPINIONATED=0` removes every default that is not
a security-invariant (the only one the CLI refuses to drop is the
current-user-as-member on `project create`).

---

## Ref resolution order (how flag values resolve)

When you pass a value to a flag like `--assignee`, `--project`,
`--owner`, `--person`, `--calendar`, etc., the CLI tries in this
order:

1. **`me` / `""`** (empty string) — resolves to current user.
   **Exception:** `huly issue create --assignee ''` treats `''` as
   "leave unassigned" (sets `data.assignee = null`), suppressing the
   ProjectToDo cascade. This is the documented way to override the
   opinionated default that would otherwise auto-assign to you.
2. **Raw `_id`** (matches
   `^[a-z-]+:[a-z-]+:[0-9a-f-]{36}$`) — used as-is.
3. **Prefixed form** (`PREFIX-123`, e.g. `TSK-1`, `USR-42`) —
   looked up via the index.
4. **Bare number** (`42`) — uses `$HULY_PROJECT` env var for project
   context.
5. **`identifier | name | label | title`** (lowercased) — exact
   match against the index.
6. **Substring fallback** (loose `includes()` match) for `--assignee`
   only. NOT applied to `--owner` — see step 6b. May produce false
   positives; pass an exact email/name to avoid.
   - **6b.** `--owner` is exact-match only — `resolveEmployeeId` does
     a strict `===` comparison against `Person.name` and
     `Person.email` (if the field is populated). There is no fuzzy
     fallback. Pass the full name or email.
7. **Account lookup** — `accountClient.findPersonBySocialKey` for
   `--person`; falls back to workspace-local `Person` scan.
8. **Single-other-member heuristic** —
   `resolvePersonId` in DM/Channel code picks the only other
   workspace member if exactly one exists. Documented for awareness;
   avoid relying on it.

> **Heads up:** the substring fallback in step 6 is silently enabled
> for `--assignee` only. If you pass `--assignee bob` and there's a
> `Bob Anderson` and a `Bob Bishop`, the first alphabetical match
> wins. Use exact email to disambiguate. `--owner` does NOT have this
> fallback — it requires an exact name or email match.

---

## Auto-coercion in `--set key=value`

`huly project update --set key=value` (and `huly issue update
--set`) coerce values automatically:

- `key=null` → clears the field (sends `TxUpdateDoc` with
  `operations[key]: null`)
- `key=true` / `key=false` → boolean
- `key=<numeric string>` → `Number`
- `key=<anything else>` → string

Reserved keys (silently stripped): `set`, `unset`, `json`, `ci`,
`markdown`, `dryRun`, `minimal`, `yes`, `workspace`, `url`,
`defaultProjectIdentifier`.

---

## Cache & index behavior

| Cache | Lifetime | Invalidation |
|---|---|---|
| Resolver index (`PlatformClient` → `Map<classId, Map<key, _id>>`, backed by a `WeakMap`) | In-memory, **no TTL**; dies with the `PlatformClient` | Explicit `invalidateIndex(client, classId)` after every write. |
| Account `_accounts` URL cache | In-memory, per-host | Never invalidated; restart the CLI process to refresh. |
| `~/.config/huly/credentials.json` (account + workspace tokens) | On disk, mode 0600, no expiry | Refreshed on re-login. Delete the file to reset. |
| `~/.config/huly/active-workspace` | On disk, mode 0606 | Updated on `huly workspace use <name>` or `--workspace`. |
| `~/.config/huly/active-account` | On disk, mode 0606 | One line per host, updated on login. |

> **Stale-cache gotcha:** the resolver index never expires. If
> someone deletes or renames a project between two CLI commands in
> the same shell, the second command may still see the old name.
> Restart the CLI process (or run any write against the changed
> resource) to force a refresh.
>
> **Cross-workspace safety:** because the cache is keyed on the
> `PlatformClient` instance (WeakMap), switching workspaces — even
> within the same process — gives you a fresh cache automatically.
> No risk of stale entries bleeding across workspaces.

See [Environment — Auth caching](environment.md#auth-caching) for the
on-disk cache details.

---

## Timeouts

| Path | Timeout | Fallback |
|---|---|---|
| `client.fetchMarkup` (all `--markdown` reads) | **5 seconds** | `'(body fetch timed out)'` |
| `ws` raw command | **60 seconds** | Promise rejects |
| `ws` raw command ping | **5 seconds** (interval) | `--no-ping` disables |
| `retry()` helper (defined, unused) | `429` only | `500 * attempt² ms` backoff, max 3 attempts |

There is **no WebSocket auto-reconnect** in the CLI. Each command
opens a fresh WS, runs, and closes in `finally`. If the connection
drops mid-call, the error bubbles up. See
[Environment — WebSocket session reconnect](environment.md#websocket-session-reconnect-during-workspace-upgrade)
for the server-side window when a workspace is being upgraded.

---

## Filtering & matching semantics

| Flag | Match type | Case-sensitive? |
|---|---|---|
| `--status` (issue) | Exact label/name | No |
| `--status-category` | Strips `task:statusCategory:` prefix, exact | No |
| `--priority` (issue) | Exact label/name | No |
| `--task-type` (issue) | Exact label/name OR raw `_id` | No |
| `--role` (member) | Aliases (`owner\|admin\|guest\|docguest\|readonlyguest\|maintainer`) | No |
| `--priority` (todo) | Strict enum (`High\|Medium\|Low\|NoPriority\|Urgent`), throws on invalid | No |
| `--visibility` (todo) | Strict enum (`public\|busy\|private`) | No |
| `--archived` (channel/document) | Anything that isn't `'false'` or `'0'` → `true` | n/a |
| `--completed` (todo) | `true\|false\|all` | n/a |
| `--description-search` / `--content-search` / `--title` (todo) | **MongoDB-style regex** with `$options: 'i'` | **No** |
| `--private` (channel) | Non-strict coercion (anything not `'false'`/`'0'` → true) | n/a |

---

## Idempotency

| Command | Behavior |
|---|---|
| `huly issue create` | If the create returns `duplicate` / `exists` / `already`, the CLI re-runs the lookup and returns the existing issue's `_id` (idempotent). |
| `huly project create` | Pre-flight `findAll({identifier})`; on `already exists\|duplicate\|exists` error, repeats the lookup and returns the existing project. |

---

## Error messages include next-step hints

| Error | Hint |
|---|---|
| `PLATFORM_NOT_FOUND` / `not found` | "check the ref or run `huly <resource> list`" |
| `PLATFORM_UNAUTHORIZED` / 401 | "run `huly login` or set `HULY_TOKEN`" |
| `PLATFORM_FORBIDDEN` / 403 | "insufficient permissions" |
| `PLATFORM_ALREADY_EXISTS` | mapped to `ExitCode.Conflict(6)` |
| `PLATFORM_RATE_LIMITED` / 429 | mapped to `ExitCode.RateLimited(5)` |
| `PLATFORM_VALIDATION` / 400 | mapped to `ExitCode.Validation(4)` |
| `>=500` | mapped to `ExitCode.Server(7)` |
| Bad `--status` | lists all available statuses |
| Bad `--priority` | lists available priorities |
| `ref-resolver` NotFound | shows first 10 candidates |

See [Usage — Exit codes](../usage.md#exit-codes) for the full exit
table.

---

## Pagination

The CLI loads the full result set in one `findAll` call, then slices
in-memory with `--limit` / `--offset`. There is no server-side
pagination. For very large workspaces (>10k docs of a type), prefer
filtering by project/space/date to bound the result set before
piping to `jq`. See
[Environment — Large lists and fulltext](environment.md#large-lists-and-fulltext).

---

## Confirmation prompts (`--yes`)

**Required for:**

- `workspace create`
- `workspace delete` (active workspace also needs `--force`)
- Any delete of ≥2 refs (`issue delete`, `project delete`, `channel
  delete`, `document delete`, `teamspace delete`, `action delete`,
  `comment delete`, `time delete`, `calendar delete`, `card delete`,
  `card-space delete`, `thread delete`, `channel message delete`,
  `action unschedule` of multiple slots).

**NOT required for:**

- `dm create --person` (auto-creates a DM silently)
- `dm send --person` (auto-creates a DM silently)
- `action unschedule` of a single slot
- All single-ref deletes

---

## Connection pooling

**None.** Every CLI invocation opens a fresh `PlatformClient` /
`AccountClient` and closes it in `finally`. The SDK keeps a single
WS open for the duration of the client. This is fast (sub-second
per command) but means you cannot pipeline multiple mutations over
one WS.
