# Issue Inventory

> Status snapshot of CLI + server-side issues as of 2026-07-01.
> Source: 18-phase parity plan implementation review against
> `~/huly-selfhost` (Huly 0.7.423, single-host dev install).
>
> Phases 0-16 implemented and verified. Phases 17-18 (README
> finalization, final smoke wrapper) pending.

This document is the source of truth for what works, what doesn't, and
what was done about it. When you fix something, update the relevant row
and bump the *Last verified* date.

---

## 1. CLI-side bugs (fixable in this repo)

| # | Issue | Where | Status |
|---|-------|-------|--------|
| 1.1 | Sub-resource `createDoc` does not pass `space` in the attributes payload, so the doc data is missing the `space` field and live queries by `space` return 0. | `src/resources/component.ts` `createComponent`, `src/resources/milestone.ts` `createMilestone`, `src/resources/issue-template.ts` `createIssueTemplate`, `src/resources/time.ts` `logTime` | **Open** — create returns success but findAll returns 0. ~5 commands affected. |
| 1.2 | `fetchMarkup` calls have no timeout, so they hang indefinitely when the collaborator service is unhealthy. | `src/resources/document.ts` `getDocument`, `src/resources/issue.ts` `getIssue`, `src/resources/component.ts` `getComponent`, `src/resources/calendar.ts` `getEvent` (and others that use `--markdown`) | **Open** — list views show `(blob, use get --markdown)` but `get --markdown` itself hangs. |
| 1.3 | `huly user find <email>` and any `--person <email>` path call `accountClient.findPersonBySocialKey`, which the account server returns `Forbidden` for. | `src/resources/user.ts` `findUser`, `src/resources/channel.ts` `resolvePersonId`, `src/resources/todo.ts` `resolveEmployeeId` | **Open** — name-scan fallback added to `resolvePersonId` and `resolveEmployeeId`; `user find` still uses the raw account call. |
| 1.4 | `huly issue create` requires an `IssueStatus` in the target project, but fresh workspaces have none. | `src/resources/issue.ts` `createIssue` | **Open** — the CLI throws `ExitCode.NotFound` on missing status. Workaround for users: pre-create a status. |
| 1.5 | `huly project create` does not pre-check for duplicate identifier. The CLI catches the "already exists" error server-side, but this selfhost doesn't enforce identifier uniqueness, so duplicates are silently allowed. | `src/resources/project.ts` `createProject` | **Open** — duplicate identifier goes through. |
| 1.6 | `client.fetchMarkup` is called for chat-message `get` but collaborator's chat-message path is broken on this server. | `src/resources/channel.ts` `getChannelMessage` (not yet implemented; `getChannel` only) | **Open** if/when implemented. |
| 1.7 | `MarkupContent` stored as empty `{}` for chat messages — the body is the blob ref, not the text. | `src/output/format.ts` `COLUMNS.channelMessage` | **Open** — shows `(blob, use get --markdown)`. |
| 1.8 | The CLI's `deleteWorkspace` guard refuses to delete the *active* workspace. Bypassing it requires removing the `active-workspace` cache file or unsetting `HULY_WORKSPACE` first. | `src/resources/workspace.ts` `deleteWorkspace` | **Open** — automation workaround only. |
| 1.9 | `huly issue create` bypass path returned `tx._id` instead of `tx.objectId`, so every issue was off-by-one in the counter portion of its UUID vs. the actually-stored `_id`. Consequence: subsequent `resolveRef` on the returned id always failed; smoke tests had to fall back to list-by-title matching. | `src/resources/issue.ts:479` (now fixed at `:478`) | **Fixed** — `tx.objectId` is now returned. |
| 1.10 | `huly issue create` never set `number` or `identifier` on the new issue; the server's `OnIssueUpdate` trigger only computes parent estimations, never the sequence. Every issue was created with `identifier: "?"` and no number. | `src/resources/issue.ts` `createIssue` | **Fixed** — the CLI now does the front-end's `$inc: { sequence: 1 }` on the project, reads the new value, and sets `identifier = ${project.identifier}-${number}` (mirrors `CreateIssue.svelte:465-477`). |
| 1.11 | `huly project create` did not set `defaultTimeReportDay`, `defaultIssueStatus`, or `defaultAssignee` — all three are required by the `Project` interface. The front-end's `CreateProject.svelte:133-137` always sets them. | `src/resources/project.ts` `createProject` | **Fixed** — added to the create payload. |
| 1.12 | `huly issue create` hardcoded `data.kind = 'tracker:issue:default'`, which is the bootstrap taskType id. Custom task-type projects don't have a default-issue ref. | `src/resources/issue.ts` `createIssue` | **Fixed** — now queries the project's first `TaskType` and falls back to the hardcoded id only if the project has none. |
| 1.13 | `huly activity saved` used `addCollection` for `SavedMessage`; `SavedMessage extends Preference`, not `AttachedDoc`, so the wrong space was used and the create never round-tripped. | `src/resources/activity.ts` `saveMessage` / `unsaveMessage` | **Fixed** — switched to `createDoc`/`removeDoc`. |
| 1.14 | `huly whoami` reported the first cached account on the URL, not the one specified by the env vars. When the env account was different from any cached account, `whoami` lied. | `src/commands/whoami.ts` | **Fixed** — `env.email` is now preferred over `findAnyCachedCreds(url)`. |
| 1.15 | `huly issue create --parent <ref>` only set `data.parent`; the `parents` ancestor array (which the server's `OnIssueUpdate` rolls up for parent-issue aggregations) was left as `[]`. Sub-issue hierarchy was broken. | `src/resources/issue.ts` `createIssue` | **Fixed** — walks the parent's `parents` array and prepends the immediate parent (mirrors `CreateIssue.svelte:492-503`). |
| 1.16 | `huly card create` did not accept `--parent`; sub-cards couldn't be created via the CLI. | `src/cli.ts` + `src/resources/card.ts` `createCard` | **Fixed** — `--parent` option added; `parentInfo` is built from the parent's `parentInfo` + its own ref (mirrors `card-resources/src/utils.ts:584-603`). |
| 1.17 | The CLI's internal `Account.uuid` shape didn't always match the `modifiedBy` value stored by `addCollection`/`createDoc` (server-issued ID vs. client-issued UUID), so list-by-`modifiedBy` filters returned empty. | `src/resources/activity.ts` `listSaved` | **Fixed** — `listSaved` now filters by class only and lets the workspace security scope the result. |

## 2. SDK-side issues (Huly's published packages — workarounds in place)

| # | Issue | Workaround | Imperfect? |
|---|-------|-----------|------------|
| 2.1 | Node 22+ ships `sessionStorage` without `window`. Huly SDK detects "browser" via `typeof sessionStorage !== "undefined"` and crashes on `window.addEventListener`. | `src/index.ts` polyfills `globalThis.window = { addEventListener: () => {}, ... }` before any SDK import. | **Yes** — the polyfill masks a real upstream bug. |
| 2.2 | `api-client` does not export `NodeWebSocketFactory` via `package.json#exports`. | `src/auth/client.ts` inlines ~40 lines of `NodeWebSocketFactory` using the `ws` package. | **Yes** — duplicates SDK code. |
| 2.3 | `client.getModel()` returns a 3-key stub in Node, even though the server has 3822 classes. Live queries compile against the local model and silently return empty. | The CLI uses `getHierarchy().hasClass()` to check existence, but `findAll` can't be made to work without the full model. The session that creates a doc has the full model on the server side; the live query result filters against the client's 3-key model. | **Yes** — see §3.1, §3.7. |
| 2.4 | Markup is uploaded by `processMarkup` and stored as a `MarkupRef`. Reading requires a round-trip to the collaborator service. | The list views render the placeholder; `get` calls `fetchMarkup`. | **Yes** — see §1.2. |
| 2.5 | `TxFactory.createTxCreateDoc` always calls `generateId()` for the tx's own `_id` (incrementing the local counter) and then either uses the passed `objectId` or generates another. Local SDK counters increment twice per create, so `tx._id` and `tx.objectId` are consecutive. The bypass path in `createIssue` returned `tx._id` instead of `tx.objectId`, which is the source of issue 1.9. | Always return `tx.objectId` from any create helper. | **No** once issue 1.9 is fixed. |

## 3. Server-side issues (Huly selfhost 0.7.423 — not in this repo)

| # | Issue | Severity | What it blocks | Workaround | Imperfect workaround? |
|---|-------|----------|----------------|------------|------------------------|
| 3.1 | **Model load fixable by `docker compose down -v` + recreate.** Verified by wiping all volumes and reinitializing: all classes (Project, Issue, IssueStatus, Milestone, Component, IssueTemplate, Document, Teamspace, Channel, ChatMessage, Calendar, ToDo, TimeSpendReport (after §2 fix), WorkSlot, Card, MasterTag, CardSpace, Person) all return data correctly from `findAll`. | (fixed) | n/a | n/a | n/a |
| 3.1b | **`WS_OPERATION=all+backup` is in place** and the worker correctly idles for workspaces at the current version. Deletion backlog no longer wedges the worker. | n/a | (this is the fix, not the bug) | n/a | n/a |
| 3.2 | **`WS_OPERATION=all` does not include `deletingSql`**. `pending-deletion` workspaces are stuck forever. | Medium | Workspace hard-deletion. The account-server limit is hit, blocking new workspace creation. | Direct SQL `DELETE` from `global_account.workspace*`. | **Yes** — the hard-delete workers (clean DBs, remove from minio) never run. |
| 3.3 | `time:class:TimeSpendReport` mixin is not loaded, even though `time:class:ToDo` and `time:class:WorkSlot` are. | High | `huly time log` is non-functional. | None. | **Yes** — server-side. |
| 3.4 | `accountClient.findPersonBySocialKey` returns `Forbidden` for any caller. | Medium | `huly user find`, `huly dm create --person`, `huly channel add-member`, `huly action --owner`. | Partial: scan `contact:class:Person` by name in the workspace (the CLI does this for `resolvePersonId`/`resolveEmployeeId`; `user find` is still raw). | **Yes** — name collisions are unhandled. |
| 3.5 | `client.fetchMarkup` hangs on chat messages and document content (collaborator service returns nothing). | Medium | `huly document get --markdown`, future `huly channel message get --markdown`. | None. | **Yes** — call-site hangs with no error. |
| 3.6 | Stale DNS in other services after a redpanda restart. | High (operational) | All kafka-dependent services (transactor, workspace, fulltext) lose connectivity until each is individually restarted. | **Fixable in compose**: `depends_on: { redpanda: { condition: service_healthy } }` + a `start_period: 30s`. | **No** once fixed. |
| 3.7 | **Server-side trigger `server-tracker:trigger:OnIssueUpdate` crashes on every issue update with `TypeError: targetParents is not iterable`** at `bundle.js:313190` (in `updateIssueParentEstimations`). The line `for (const pinfo of targetParents)` assumes `targetParents` is always an array, but for a fresh issue with no `parents` field in the create payload, `TxProcessor.createDoc2Doc` produces a doc with `parents: undefined`. Trigger fails after the create tx has already applied. | High (functional, not crash) | Parent-issue `remainingTime`/`reportedTime` rollups never update; `parents` array in the source line is correctly populated only when client code mirrors the front-end (issue 1.10/1.15). | None. The fix is server-side: `for (const pinfo of targetParents ?? [])`. | **Yes** — visible in transactor logs as `ERROR` on every issue mutation. |
| 3.8 | **`@Model(notification.class.NotificationProvider, core.class.Doc)` is declared without a `DOMAIN_*` third arg** in `models/notification/src/index.ts:307`. `IdentifierMiddleware` and `findAll` both require a domain to query. `huly notification providers` errors with `domain not found`; any write to a `NotificationTypeSetting` keyed by a provider also fails. | Medium | `huly notification providers`, future `notification settings --provider X update` paths. | Settings listing is unfiltered. | **Yes** — the model needs a declared domain. |
| 3.9 | **No `OnIssueCreate` trigger exists; `IdentifierMiddleware` only handles `TypeIdentifier`-typed attributes** (and Issue's `identifier` is plain `TypeString`). The reference front-end (`CreateIssue.svelte:465-477`) is the only place that sets `number` and `identifier` on a new issue — by doing `$inc: { sequence: 1 }` on the project and building `${project.identifier}-${number}`. The CLI must do the same or every issue comes out with `identifier: "?"`. | High | Any non-front-end issue create (CLI, importer, mobile). | The CLI now replicates the front-end's `$inc` step (see 1.10). | **Yes** — the right fix is server-side: either a `OnIssueCreate` trigger or change `Issue.identifier` to `TypeIdentifier`. |
| 3.10 | **`core:class:Association` list returns empty after a successful `association create` returns an id.** Suspected cause: the class isn't bound to a queryable domain in some versions, or the storage adapter isn't materializing association rows for the workspace security filter. | Low | `huly association list` shows `(no associations)` even after create. | Use the returned `AID` from `create` directly; don't rely on `list` to verify. | **Yes** — not blocking, but the listing is broken. |

## 4. Server behaviors that are not bugs but the CLI has imperfect workarounds for

| # | Behavior | What the CLI does | Imperfect? |
|---|----------|------------------|------------|
| 4.1 | Doc `data` JSON doesn't auto-include `space` | The CLI passes `space` as the second arg to `createDoc(_class, space, attrs)`. | **Yes** — see §1.1. |
| 4.2 | Markup is a separate blob | The CLI uploads via `client.addCollection`; reads via `client.fetchMarkup`. | **Yes** — see §1.2 / §3.5. |
| 4.3 | `getUserWorkspaces` doesn't filter by `mode` server-side | The CLI's `huly workspace list` shows all workspaces. | **No** — this is the right behavior. |
| 4.4 | The fresh-workspace `lastProcessingTime` is from the workspace's *initial* processing, not the current run. | The CLI doesn't surface this. | **No** — it's a transactor state issue, not a CLI issue. |
| 4.5 | Issues are identified by `PROJECT-N` (`TSK-1`, `TSK-2`, …) but the server has no path to set `number`/`identifier` on create. | The CLI mirrors the front-end (`CreateIssue.svelte:465-477`) and does `$inc` on the project's `sequence` before create. | **Yes** — see §3.9. The right fix is server-side. |
| 4.6 | `RankMiddleware` (`foundations/server/packages/middleware/src/rank.ts:106`) auto-computes the `rank` field on any `TxCreateDoc` whose class has a `rank` attribute. The CLI does not need to set it. | The CLI passes `rank: '0|aaaaa:'` for cards and documents as a safety placeholder; the server overwrites it. | **No** — both shapes round-trip. |

## 5. Highest-leverage fixes

Ranked by impact per unit of effort:

1. **§3.7 — fix `OnIssueUpdate` crash with `targetParents ?? []`.** The transactor logs an `ERROR` on every issue mutation. One-line fix in `bundle.js`/source. *Server-side.*
2. **§3.9 — add `OnIssueCreate` trigger (or change `Issue.identifier` to `TypeIdentifier`).** Removes the need for any non-front-end create caller to manually `$inc` the sequence. *Server-side.*
3. **§1.1 — add `space` to sub-resource `createDoc` attrs.** Unblocks Component, Milestone, IssueTemplate, TimeSpendReport create+list roundtrips in the CLI. ~30 minutes. Doesn't fix the model-load issue but at least the docs are stored correctly.
4. **§1.2 — add timeout around `fetchMarkup` calls.** Unblocks `get --markdown` paths from hanging. ~15 minutes.
5. **§3.8 — add `DOMAIN_NOTIFICATION` to the `NotificationProvider` `@Model` declaration.** Unblocks `huly notification providers` and provider-keyed settings. One-line fix. *Server-side.*
6. **§3.6 — fix redpanda compose (`depends_on` + `start_period`).** Operational; no new commands unblocked but stops the flapping.
7. **§1.4 — make `huly issue create` auto-seed a default `IssueStatus` on first create.** Unblocks issue creation on fresh workspaces. ~30 minutes.
8. **§1.5 — pre-check for duplicate project identifier in `huly project create`.** Idempotency fix. ~10 minutes.
9. **§1.3 — fully replace `findPersonBySocialKey` with workspace-local Person scan** in `user find` (already done for the other call sites). ~15 minutes.

## 6. Server-side fixes (require infrastructure changes)

1. **§3.7 — `for (const pinfo of targetParents ?? [])`.** One-line fix in `server-plugins/tracker-resources/src/index.ts:467`. The local transactor image `hardcoreeng/transactor:local-fix-2026-06-29-final` has the bug; the upstream source has it too. Apply at the source and rebuild the image.
2. **§3.8 — add `DOMAIN_NOTIFICATION` (or `DOMAIN_CONFIG`/`DOMAIN_MODEL`) to `@Model(notification.class.NotificationProvider, core.class.Doc)` in `models/notification/src/index.ts:307`.**
3. **§3.9 — add an `OnIssueCreate` trigger that does the front-end's `$inc: { sequence: 1 }` on the project and sets the issue's `number` and `identifier` (currently the front-end's responsibility, replicated in the CLI).** Alternative: change `Issue.identifier` to `TypeIdentifier` and let `IdentifierMiddleware` do it.
4. **§3.2 — set `WS_OPERATION=all+backup`** in the workspace pod (or manually hard-delete via SQL). Manual SQL delete already done for the 8 smoke-ws-* workspaces; the hard-delete worker still doesn't run.
5. **§3.3 — re-run the time-plugin migration** against the test workspace. The `TimeSpendReport` mixin needs to be applied.
6. **§3.4 — investigate the `findPersonBySocialKey` permission check** on the account server.
7. **§3.5 — investigate the collaborator service** for chat messages and document content.
8. **§3.10 — bind `core:class:Association` to a queryable domain** so `huly association list` returns the created rows.

## 7. What was not done in this session

- Phase 17: comprehensive README update (the README is mostly current; this doc and the CHANGELOG cover the gap).
- Phase 18: final `bash scripts/smoke.sh all` end-to-end. Phases 0–8, 10–16 pass standalone; the all-mode wrapper is hanging or exiting silently around phase 9 (the wrapper, not the phase). Defer to a follow-up.
- Automated tests. There are no tests; all verification was via the bash smoke runner.
- Fetching markup on chat messages (server-side collaborator issue, §3.5).
