# Changelog

All notable changes to the Huly CLI are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`huly signup`** — new command to create an account on the Huly server.
  Accepts `--headless` (use env vars only, no prompts) and `--create-workspace
  <name>` to create a workspace as part of signup. The interactive mode prompts
  for a workspace name by default and sets it as active. (#signup)
- **Phases 11, 14, 15, 16** of the 18-phase parity plan are now implemented:
  - **Phase 11 — Spaces / Associations / Relations / Task management**:
    `huly space`, `huly space-type`, `huly association`, `huly relation`,
    `huly project-type`, `huly task-type`, `huly issue-status` (sub-resources
    for the 18-phase parity plan). Space membership add/remove, owner-set,
    and permissions list all work end-to-end against the live Huly server.
  - **Phase 14 — Activity**: `huly activity list/get/pin`, `react
    --add/--list/--remove`, `reply add/list/update/delete`, `saved
    save/list/unsave`, `mentions`. All paths round-trip against the live
    Huly server.
  - **Phase 15 — Notifications**: `huly notification list/get`,
    `mark-read/unread/mark-all-read`, `archive/unarchive/delete`,
    `unread-count`, `contexts list/get/pin/hide`, `subscribe/unsubscribe`,
    `types`, `settings list/update`. `providers` is currently broken
    server-side (see `docs/issues.md` §3.8).
  - **Phase 16 — Approvals**: `huly approval list/get`, `request`,
    `comment`, `approve`, `reject`, `cancel`, `delete`. The full lifecycle
    — request → comment → approve (status `Completed`), request → reject
    (status `Rejected`), request → cancel (status `Cancelled`) — was
    verified against the live Huly server.
- `huly card create --parent <ref>` — sub-cards can now be created via the
  CLI; `parentInfo` is built from the parent's chain. (#parentInfo)

### Fixed

- **`huly issue create` returned an off-by-one id in the bypass path.** The
  bypass helper used `tx._id` instead of `tx.objectId`. Since
  `TxFactory.createTxCreateDoc` calls `generateId()` twice — once for the
  tx's own `_id` and once for the `objectId` (when no id is passed) — the
  two are consecutive counter values, and the local SDK was returning the
  earlier one. Consequence: every issue was created with an id that didn't
  match the actually-stored `_id`, and any subsequent `resolveRef` on the
  returned id failed. The smoke test had to fall back to list-by-title
  matching. Fixed: the bypass path now returns `tx.objectId`. (#1.9)
- **`huly issue create` did not set `number` or `identifier`.** The server's
  `OnIssueUpdate` trigger only computes parent estimations, never the
  sequence. The reference front-end (`CreateIssue.svelte:465-477`) is the
  only place that did the `$inc: { sequence: 1 }` + `identifier = ${
  project.identifier}-${number}` dance. The CLI now mirrors that step, so
  `huly issue create` returns `TSK-1`, `TSK-2`, etc. and `huly issue get
  TSK-1` resolves. (#1.10)
- **`huly project create` did not set `defaultTimeReportDay`,
  `defaultIssueStatus`, or `defaultAssignee`.** The `Project` interface
  declares all three as required-ish; the front-end's
  `CreateProject.svelte:133-137` always sets them. The CLI now sets them
  too. (#1.11)
- **`huly issue create` hardcoded `data.kind = 'tracker:issue:default'`.**
  Custom task-type projects don't have a default-issue ref. The CLI now
  queries the project's first `TaskType` and falls back to the hardcoded
  id only if the project has none. (#1.12)
- **`huly activity saved` used `addCollection` for `SavedMessage`**;
  `SavedMessage` extends `Preference`, not `AttachedDoc`, so the wrong space
  was used. Switched to `createDoc`/`removeDoc` against the message's own
  space. (#1.13)
- **`huly whoami` reported the first cached account on the URL**, not the
  one specified by the env vars. The CLI now prefers `env.email` over the
  cached account when resolving identity. (#1.14)
- **`huly issue create --parent <ref>` only set `data.parent`**, leaving
  the `parents` ancestor array as `[]`. Sub-issue hierarchies were broken
  for any client not mirroring the front-end. The CLI now walks the
  parent's `parents` array and prepends the immediate parent. (#1.15)
- **`huly issue create` human output printed the raw UUID** instead of
  `TSK-1`. Now re-fetches the issue to display the assigned identifier, and
  falls back to the UUID if the local server hasn't assigned one. (#1.10)

### Changed

- `scripts/smoke.sh` phase 11 no longer has the `sleep 1` + list-by-title
  workaround for the ID race. IDs returned from `issue create` now match
  the stored `_id` (see "Fixed" above). (#1.9)
- `scripts/smoke.sh` phase 9 (calendar) bootstrap logic was rewritten to
  use `jq 'length'` on the calendar list instead of `grep -q .`, which
  matched the table title "calendars" and never triggered the create. The
  smoke-cal cleanup is now wrapped in `set +e` / `set -e` so any best-effort
  failure doesn't abort the all-mode wrapper. (#smoke)
- `docs/issues.md` updated to reflect the new fixes (§1.9–§1.17 in the
  CLI-side bugs table) and the new server-side findings (§3.7
  `OnIssueUpdate` crash on `targetParents`, §3.8 `NotificationProvider` no
  domain, §3.9 no `OnIssueCreate` trigger / `Identifier` typed attribute
  pattern, §3.10 `core:class:Association` list empty).

### Known limitations (not in this release)

- `huly notification providers` errors with `domain not found`. Server-side:
  the `NotificationProvider` class has no domain registered (see
  `docs/issues.md` §3.8).
- `huly association list` shows `(no associations)` after a successful
  `create`. Server-side: the `core:class:Association` class isn't bound
  to a queryable domain (see `docs/issues.md` §3.10).
- `bash scripts/smoke.sh all` (the all-mode wrapper) exits silently
  around phase 9, even though `bash scripts/smoke.sh 9` standalone passes
  and all other phases (0–8, 10–16) pass individually. The wrapper, not
  the phases, needs investigation. See `scripts/smoke.sh` line ~281 (the
  `set +e`/`set -e` around the smoke-cal cleanup is a partial mitigation;
  the real fix is in the wrapper's pipefail handling). (#smoke)
