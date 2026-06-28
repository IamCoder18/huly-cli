# Issue Inventory

> Status snapshot of CLI + server-side issues as of 2026-06-27.
> Source: 18-phase parity plan implementation review against
> `~/huly-selfhost` (Huly 0.7.423, single-host dev install).
>
> Phases 0-13 implemented; phases 14-18 paused pending the resolution
> of the issues below.

This document is the source of truth for what works, what doesn't, and
what was done about it. When you fix something, update the relevant row
and bump the *Last verified* date.

---

## 1. CLI-side bugs (fixable in this repo)

| # | Issue | Where | Workaround in CLI | Imperfect? |
|---|-------|-------|-------------------|------------|
| 1.1 | Sub-resource `createDoc` does not pass `space` in the attributes payload, so the doc data is missing the `space` field and live queries by `space` return 0. | `src/resources/component.ts` `createComponent`, `src/resources/milestone.ts` `createMilestone`, `src/resources/issue-template.ts` `createIssueTemplate`, `src/resources/time.ts` `logTime` | None yet — the create returns success but findAll returns 0. | **Yes**, on the live server. ~5 commands broken. |
| 1.2 | `fetchMarkup` calls have no timeout, so they hang indefinitely when the collaborator service is unhealthy. | `src/resources/document.ts` `getDocument`, `src/resources/issue.ts` `getIssue`, `src/resources/component.ts` `getComponent`, `src/resources/calendar.ts` `getEvent` (and others that use `--markdown`) | None — list views show `(blob, use get --markdown)` but `get --markdown` itself hangs. | **Yes** — user-facing `get --markdown` is broken. |
| 1.3 | `huly user find <email>` and any `--person <email>` path call `accountClient.findPersonBySocialKey`, which the account server returns `Forbidden` for. | `src/resources/user.ts` `findUser`, `src/resources/channel.ts` `resolvePersonId`, `src/resources/todo.ts` `resolveEmployeeId` | None — `user find` errors out. | **Yes** — any "look up a person by email" path is broken. |
| 1.4 | `huly issue create` requires an `IssueStatus` in the target project, but fresh workspaces have none. The CLI throws `ExitCode.NotFound` rather than auto-seeding a default. | `src/resources/issue.ts` `createIssue` | None — user has to manually create statuses. | **Yes** — issue creation is broken on fresh workspaces. |
| 1.5 | `huly project create` does not pre-check for duplicate identifier. The CLI catches the "already exists" error server-side, but this selfhost doesn't enforce identifier uniqueness, so duplicates are silently allowed. | `src/resources/project.ts` `createProject` | None — duplicate identifier goes through. | **Yes** — idempotency is not idempotent. |
| 1.6 | `client.fetchMarkup` is called for chat-message `get` but collaborator's chat-message path is broken on this server. | `src/resources/channel.ts` `getChannelMessage` (not yet implemented; `getChannel` only) | None. | **Yes** if/when implemented. |
| 1.7 | `MarkupContent` stored as empty `{}` for chat messages — the body is the blob ref, not the text. | `src/output/format.ts` `COLUMNS.channelMessage` | Shows `(blob, use get --markdown)`. | **Yes** — column is misleading. |
| 1.8 | The CLI's `deleteWorkspace` guard refuses to delete the *active* workspace. Bypassing it requires removing the `active-workspace` cache file or unsetting `HULY_WORKSPACE` first. | `src/resources/workspace.ts` `deleteWorkspace` | The CLI can do it via direct account-client call (script). | **No** for live use; **yes** for automation. |

## 2. SDK-side issues (Huly's published packages — workarounds in place)

| # | Issue | Workaround | Imperfect? |
|---|-------|-----------|------------|
| 2.1 | Node 22+ ships `sessionStorage` without `window`. Huly SDK detects "browser" via `typeof sessionStorage !== "undefined"` and crashes on `window.addEventListener`. | `src/index.ts` polyfills `globalThis.window = { addEventListener: () => {}, ... }` before any SDK import. | **Yes** — the polyfill masks a real upstream bug. Filed nothing. |
| 2.2 | `api-client` does not export `NodeWebSocketFactory` via `package.json#exports`. | `src/auth/client.ts` inlines ~40 lines of `NodeWebSocketFactory` using the `ws` package. | **Yes** — duplicates SDK code. |
| 2.3 | `client.getModel()` returns a 3-key stub in Node, even though the server has 3822 classes. Live queries compile against the local model and silently return empty. | None. The CLI uses `getHierarchy().hasClass()` to check existence, but `findAll` can't be made to work without the full model. | **Yes** — see §3.1. |
| 2.4 | Markup is uploaded by `processMarkup` and stored as a `MarkupRef`. Reading requires a round-trip to the collaborator service. | The list views render the placeholder; `get` calls `fetchMarkup`. | **Yes** — see §1.2. |

## 3. Server-side issues (Huly selfhost 0.7.423 — not in this repo)

| # | Issue | Severity | What it blocks | Workaround | Imperfect workaround? |
|---|-------|----------|----------------|------------|------------------------|
| 3.1 | **Model-upgrade queue is broken.** Transactor logs `no document found, failed to apply model transaction, skipping` for ~thousands of `TxUpdateDoc` records per minute. The transactor tries to apply new mixins/attributes for classes that don't exist yet (chicken-and-egg with broken model load). | High | Tracker subclasses (`Component`, `Milestone`, `IssueTemplate`, `TimeSpendReport`) and any class loaded via mixin — `findAll` returns empty even for docs the SDK just created. **~30% of the CLI surface.** | None. | **Yes** — unfixable from CLI; needs transactor/workspace-pod reconfiguration. |
| 3.2 | **`WS_OPERATION=all` does not include `deletingSql`** (`platform/server/account/src/collections/postgres/postgres.ts:1002`). `pending-deletion` workspaces are stuck forever. Source comment on line 1018: `// TODO: support returning pending deletion workspaces when we will actually want to clear them with the worker.` | Medium | Workspace hard-deletion. The account-server limit is hit, blocking new workspace creation. | Direct SQL `DELETE` from `global_account.workspace`, `global_account.workspace_status`, `global_account.workspace_members`. | **Yes** — the hard-delete workers (clean DBs, remove from minio) never run, so leftover data sits in those places. |
| 3.3 | `time:class:TimeSpendReport` mixin is not loaded, even though `time:class:ToDo` and `time:class:WorkSlot` are. | High | `huly time log` is non-functional. | None. | **Yes** — server-side. |
| 3.4 | `accountClient.findPersonBySocialKey` returns `Forbidden` for any caller. | Medium | `huly user find`, `huly dm create --person`, `huly channel add-member`, `huly action --owner`. | Partial: scan `contact:class:Person` by name in the workspace. Fuzzy; may give wrong results. | **Yes** — name collisions are unhandled. |
| 3.5 | `client.fetchMarkup` hangs on chat messages and document content (collaborator service returns nothing). | Medium | `huly document get --markdown`, future `huly channel message get --markdown`. | None. | **Yes** — call-site hangs with no error. |
| 3.6 | Stale DNS in other services after a redpanda restart. | High (operational) | All kafka-dependent services (transactor, workspace, fulltext) lose connectivity until each is individually restarted. | **Fixable in compose**: `depends_on: { redpanda: { condition: service_healthy } }` + a `start_period: 30s` on the healthcheck. | **No** once fixed. |

## 4. Server behaviors that are not bugs but the CLI has imperfect workarounds for

| # | Behavior | What the CLI does | Imperfect? |
|---|----------|------------------|------------|
| 4.1 | Doc `data` JSON doesn't auto-include `space` | The CLI passes `space` as the second arg to `createDoc(_class, space, attrs)`. | **Yes** — see §1.1. |
| 4.2 | Markup is a separate blob | The CLI uploads via `client.addCollection`; reads via `client.fetchMarkup`. | **Yes** — see §1.2 / §3.5. |
| 4.3 | `getUserWorkspaces` doesn't filter by `mode` server-side | The CLI's `huly workspace list` shows all workspaces. | **No** — this is the right behavior. |
| 4.4 | The fresh-workspace `lastProcessingTime` is from the workspace's *initial* processing, not the current run. | The CLI doesn't surface this. | **No** — it's a transactor state issue, not a CLI issue. |

## 5. Highest-leverage fixes

Ranked by impact per unit of effort:

1. **§1.1 — add `space` to sub-resource `createDoc` attrs.** Unblocks Component, Milestone, IssueTemplate, TimeSpendReport create+list roundtrips in the CLI. ~30 minutes. Doesn't fix the model-load issue but at least the docs are stored correctly.
2. **§1.2 — add timeout around `fetchMarkup` calls.** Unblocks `get --markdown` paths from hanging. ~15 minutes.
3. **§3.6 — fix redpanda compose (`depends_on` + `start_period`).** Operational; no new commands unblocked but stops the flapping.
4. **§1.4 — make `huly issue create` auto-seed a default `IssueStatus` on first create.** Unblocks issue creation on fresh workspaces. ~30 minutes.
5. **§1.5 — pre-check for duplicate project identifier in `huly project create`.** Idempotency fix. ~10 minutes.
6. **§1.3 — replace `findPersonBySocialKey` with workspace-local Person scan.** Unblocks `user find`, `dm create --person`, etc. ~30 minutes.

## 6. Server-side fixes (require infrastructure changes)

1. **§3.1 — fix model-upgrade queue.** Restart the workspace pod with `WS_OPERATION=upgrade`, let the model-upgrade queue drain, then revert to `all`. Requires ~30 min of downtime and infra change to the workspace pod.
2. **§3.2 — set `WS_OPERATION=all+backup`** in the workspace pod (or manually hard-delete via SQL). Manual SQL delete already done for the 8 smoke-ws-* workspaces; the hard-delete worker still doesn't run.
3. **§3.3 — re-run the time-plugin migration** against the test workspace. The `TimeSpendReport` mixin needs to be applied.
4. **§3.4 — investigate the `findPersonBySocialKey` permission check** on the account server. This requires reading the account-server source for the permission gate.
5. **§3.5 — investigate the collaborator service** for chat messages and document content. Probably a separate broken path that needs a fix in the collaborator pod.

## 7. What was not done in this session

- Phases 14-18 of the parity plan: Activity, Notifications, Approvals, README finalization, final smoke.
- Full CRUD verification of Phase 0-13 surfaces against a healthy workspace (requires §3.1 to be fixed server-side first).
- Automated tests. There are no tests; all verification was via the bash smoke runner.
- Fetching markup on chat messages (server-side collaborator issue).
