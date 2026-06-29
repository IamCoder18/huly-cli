# Open Issues (2026-06-29)

> Status snapshot of remaining issues as of 2026-06-29, excluding anything
> fixed on `~/platform` branch `fix/server-issues-2026-06` AND empirically
> verified to work end-to-end on the live selfhost.
>
> **Excludes (fixed AND verified):**
> - Fix #1 (`findPersonBySocialKey` accepts user tokens) — verified in
>   deployed `hardcoreeng/account:local-fix` bundle at
>   `findPersonBySocialKey` (lines containing `if (extra?.service !== void 0)`),
>   though the CLI no longer exercises this path.
> - Fix #2 (`getContent` 3s timeout) — verified by `huly document get --markdown`
>   returning within 5s instead of hanging indefinitely.
> - Fix #6 (nginx `resolver` + per-upstream vars) — verified by successful
>   recreate of transactor container without requests failing.
>
> **Not yet fully verified (kept in the list):**
> - Fix #3 (model-upgrade retry) — partial: helps on fresh workspace but
>   `no document found, failed to apply model transaction, skipping`
>   warnings still emit on every CLI command. Deeper investigation needed.
> - Fix #4 (doAccountCleanup drops account-db rows) — cannot be exercised:
>   `workspace delete` returns Forbidden from CLI before reaching the worker.
> - Fix #5 (WS_OPERATION=all includes deletingSql) — we use `all+backup` in
>   compose so the `all` case change is not exercised by the live selfhost.
>
> **Excluded categories:** phases 14-18 (not implemented). Cosmetic-only items
> that don't break functionality. Issues 100% in upstream that the CLI works
> around (e.g., the `window` polyfill).

---

## 1. CLI-side bugs (fixable in `~/huly-cli`)

| # | Severity | Issue | Affected commands | Imperfect? |
|---|----------|-------|-------------------|------------|
| C1 | **High** | `--workspace` documented as a global option in every `--help` output, but `attachGlobalOpts(program)` is never called (see `src/cli.ts:1061`). Every `huly --workspace foo <cmd>` errors with `unknown option --workspace`. The only working path is `huly workspace use foo` then `huly <cmd>`. | All commands | **Yes** — help text is misleading and the flag is silently dropped. |
| C2 | **High** | `Component`/`Milestone`/`IssueTemplate`/`TimeSpendReport` create succeeds but the corresponding `list` returns `0` results. Root cause: `createDoc` in `src/resources/{component,milestone,issue-template,time}.ts` does not pass `space` in the attrs payload, so live `findAll` queries by `space` miss them. | `component list`, `milestone list`, `issue-template list`, `time log --list` | **Yes** — silent failure. ~5 commands broken on the live server. |
| C3 | **High** | `huly issue create` requires an `IssueStatus` in the target project, but fresh workspaces (and many real ones) have none. The CLI throws `ExitCode.NotFound` rather than auto-seeding a default. There is no `huly project status create` command either. | `issue create` | **Yes** — issue creation broken on fresh workspaces. |
| C4 | **High** | `huly user find <email>` and any `--person <email>` / `--assignee <email>` / `--owner <email>` / `--member <email>` path: server's `findPersonBySocialKey` returned Forbidden before Fix #1, but the CLI never calls it now — it does a workspace-local `Person` scan that fails on name collisions and on accounts that haven't joined the workspace. | `user find`, `dm create --person`, `channel add-member --member`, `issue create --assignee`, `action create --owner` | **Yes** — most person lookups fail or return wrong results. |
| C5 | **High** | `huly project create` does not pre-check for duplicate identifier. The selfhost doesn't enforce uniqueness server-side, so duplicates are silently created. | `project create` | **Yes** — idempotency broken. |
| C6 | **High** | `huly workspace delete <name> --yes --force` always returns `Forbidden` from the account server. The error comes from `~/platform/server/account`, not CLI logic. Affects **every** workspace deletion including fresh test workspaces. | `workspace delete` | **Yes** — fully broken. Workaround: direct SQL DELETE. |
| C7 | **Medium** | `huly workspace delete <name> --yes --force` cannot target a workspace by UUID, only by URL name. Workspaces with no cached CLI token (e.g. the 6 leftover `smoke-ws-*`) cannot be deleted at all from CLI. | `workspace delete` | **Yes** — no way to clean up orphans. |
| C8 | **Medium** | `huly document create --title X --body Y` requires a teamspace (`document create` errors with `no teamspaces found` if there are none). The CLI does not auto-create a default teamspace. New workspaces have no teamspaces by default. | `document create` | **Yes** — first doc create fails on fresh workspace. |
| C9 | **Medium** | `get --markdown` returns the raw body string for CLI-created docs (works). For legacy docs created via web UI (with markup refs to y-docs), it prints the ref string instead of resolving it. This selfhost has no such legacy docs. | `document get --markdown`, `card get --markdown`, `comment get --markdown`, `channel message get --markdown`, `component get --markdown`, `issue-template get --markdown`, `milestone get --markdown`, `todo get --markdown` | **Yes** — works for our data, would fail on web-UI-created data. |
| C10 | **Medium** | The `card` `update` does not accept `--body-file` (unlike `document update` / `comment update` / `action update`). Inconsistent across resources. | `card update` | **Yes** — UX inconsistency. |
| C11 | **Medium** | `channel message` lifecycle is partially working. `create` works; `list` returns empty for many cases; `delete` may fail if message is the channel's last. Tested in smoke phase 7. | `channel message list`, `channel message delete` | **Yes** — list missing items. |
| C12 | **Medium** | `dm send --body X` requires a DM ID; the user has to first run `dm create --person <email>` (broken per C4), then `dm send <dmId>`. No way to send a DM in one command. | `dm send` | **Yes** — multi-step required. |
| C13 | **Medium** | `time log --issue <ref>` requires the issue to already exist (fine), but also requires the project to have a `tracker:class:TimeSpendReport` mixin. This is not guaranteed. No error from CLI tells the user why logging failed. | `time log` | **Yes** — opaque failures. |
| C14 | **Low** | Help text never includes usage examples. Every `huly <cmd> --help` lists flags but no `EXAMPLES` section. | All commands | **Yes** — discoverability problem. |
| C15 | **Low** | No enum value documentation. `--priority High` works but `--priority Foo` fails with a cryptic server error. Help doesn't say "valid: Urgent, High, Medium, Low, None". | `action create --priority`, `issue create --priority` | **Yes** — poor error UX. |
| C16 | **Low** | No format documentation. `--start <iso>` doesn't show a sample (`2026-07-01T14:00:00Z`). Users hit parse errors. | `calendar create --start`, `calendar create --end`, `issue create --due`, `action create --due` | **Yes** — poor error UX. |
| C17 | **Low** | No dependency documentation. `--assignee <email>` doesn't mention "requires the user to be a workspace member". | All `--assignee` / `--owner` / `--member` paths | **Yes** — poor error UX. |
| C18 | **Low** | `channel get` returns the channel metadata but not member count; `channel members <ref>` is a separate command. No way to get a single combined view. | `channel get`, `channel members` | **Yes** — UX, not breakage. |
| C19 | **Low** | `document update --body X --old-text Y --new-text Z` is ambiguous (CLI correctly errors), but the error message doesn't tell you which flag to drop. | `document update` | **Yes** — UX. |
| C20 | **Low** | `card-space` is the only resource where `--name` is required AND `--type` is optional with no default; the created card-space has no master-tag, so `card create --master-tag` cannot find a valid space without manual setup. | `card create` | **Yes** — first-card UX is hostile. |
| C21 | **Low** | `action schedule <ref>` creates a `WorkSlot` but doesn't accept `--start`/`--end`. The slot is 30 minutes starting now. No way to customize. | `action schedule` | **Yes** — limited. |
| C22 | **Low** | `huly api` and `huly ws` escape hatches have minimal help. No examples of method names. Users have to read SDK source. | `api`, `ws` | **Yes** — escape hatches are undocumented. |

## 2. Server-side bugs in `~/platform` (NOT yet fixed OR fix not verified)

| # | Severity | Issue | Affects | Workaround | Imperfect? |
|---|----------|-------|---------|------------|------------|
| S1 | **High** | `huly workspace delete` returns `Forbidden` from the account server (`accountClient.deleteWorkspace` path). Source: `~/platform/server/account/src/serviceOperations.ts`. CLI-side Fix #6 (per-branch `fix/server-issues-2026-06`) was attempted but not in scope here; the actual fix needs an account-server change to allow the workspace owner to delete. | `workspace delete` (server side) | Direct SQL DELETE FROM `global_account.workspace` WHERE name LIKE 'smoke-ws-%' | **Yes** — no CLI path. |
| S2 | **High** | `accountClient.findPersonBySocialKey` is exercised only by callers that haven't moved to workspace-local scan. Fix #1 is in the deployed bundle but unused by the CLI. The proper fix needs to (a) expose an account-level method that doesn't require service role, OR (b) extend CLI to call `findPersonBySocialKey` (now safe) for workspace-external lookups. | `user find`, `--person`, `--assignee` paths | Workspace-local `Person` scan in CLI (limited) | **Yes** — person lookup still mostly broken. |
| S3 | **High** | The collaborator's `uploadMarkup` / `createMarkup` RPC throws (same root cause as Fix #2's `getContent` hang). The CLI works around via `MarkupContent → string` refactor in 9 resource files. The proper fix is the same 3s `Promise.race` timeout pattern applied to `createMarkup.ts`. | Every CLI command that creates a doc with a body | `MarkupContent → string` refactor in CLI | **Yes** — proper server-side fix not done. |
| S4 | **Medium** | Model-upgrade tx retry (Fix #3) helps on fresh workspace creation but the `no document found, failed to apply model transaction, skipping _class="core:class:TxUpdateDoc" objectId="..."` warnings still emit on every CLI command. The retry is 1-pass and may need more passes for deeply-ordered tx batches. | All CLI commands (cosmetic only — doesn't affect functionality) | None — purely log noise | **Yes** — log noise, possibly correct. |
| S5 | **Medium** | `doAccountCleanup` (Fix #4) deletes from `global_account.workspace*` but the workspace-delete path is blocked upstream (S1), so the fix is unreachable. | `workspace delete` | n/a | **Yes** — unexercised. |
| S6 | **Medium** | `WS_OPERATION=all` includes `deletingSql` after Fix #5, but the live selfhost uses `WS_OPERATION=all+backup` in compose (which already includes `deletingSql`). The `'all'` case change is not exercised. | n/a (verified by source review only) | n/a | **Yes** — unexercised. |
| S7 | **Low** | `time:class:TimeSpendReport` mixin is not loaded automatically; the CLI works around via class-id correction (`tracker:class:TimeSpendReport`). The proper fix is to ensure the time plugin migration runs on workspace init. | `time log --list` | CLI class-id fix | **Yes** — server-side. |
| S8 | **Low** | The account server requires the `selfhost` cockroach user to have `CREATE` privilege on `defaultdb` (so `CREATE SCHEMA IF NOT EXISTS global_account` works in `PostgresDbCollection._init()`). This is missing by default after `docker compose down -v` and must be granted manually. | Account pod startup | `GRANT CREATE ON DATABASE defaultdb TO selfhost` (manual) | **Yes** — operational bug. |

## 3. Configuration / selfhost issues (`~/huly-selfhost`)

| # | Severity | Issue | Affects | Workaround | Imperfect? |
|---|----------|-------|---------|------------|------------|
| CF1 | **Operational** | `docker compose down -v` wipes cockroach and recreates without granting `CREATE` to `selfhost`. The account pod crashes on startup. | First-time setup after `down -v` | Manual `GRANT CREATE ON DATABASE defaultdb TO selfhost` | **Yes** — easy to miss. |
| CF2 | **Operational** | Redpanda's SASL bootstrap race causes `rpk cluster info -X user=... -X pass=...` to return `ILLEGAL_SASL_STATE` during healthcheck. Already fixed locally with unauthenticated metadata probe + `start_period: 30s`. | `docker compose up` | Already fixed locally | **No** — fixed in current selfhost. |
| CF3 | **Operational** | Stale `smoke-ws-*` workspaces accumulate (currently 6 visible). The hard-delete worker is blocked by Fix #5 (now fixed) but Fix #4 isn't deployed and S1 blocks CLI deletion. | `workspace list` | Direct SQL | **Yes** — clutter. |
| CF4 | **Operational** | Transactor `MODEL_VERSION` mismatch with workspace pod rejects WebSocket connections. Currently both at 0.7.423 (matched). Easy to drift. | All CLI commands | Bump `~/platform/common/scripts/version.txt` and rebuild | **Yes** — fragile. |
| CF5 | **Operational** | MinIO bucket has no lifecycle policy by default. Backups accumulate forever. Already fixed locally with `mc ilm add local/huly-backups --expiry-days 14`. | Disk usage | `mc ilm add ... --expiry-days 14` | **No** — fixed in current selfhost. |
| CF6 | **Operational** | The `no document found, failed to apply model transaction, skipping` warnings emit on every CLI command. See S4. | Log noise | None | **Yes** — log noise. |
| CF7 | **Cosmetic** | Caddy runs on the host, not in compose. `systemctl restart caddy` doesn't restart nginx. | TLS | Manual `systemctl restart caddy` | **Yes** — easy to confuse. |

## 4. Naming / UX inconsistencies

| # | Pattern A | Pattern B | Issue |
|---|-----------|-----------|-------|
| N1 | `channel message <verb>` | `dm send` | Channel uses nested `message` subcommand; DM uses flat `dm send`. No `dm message` exists. |
| N2 | `channel add-member`, `channel remove-member` | `workspace member <account>` | Channel uses verb-noun; workspace uses noun-as-command. Both update a single field. |
| N3 | `workspace guests` (plural) | `workspace member` (singular) | Both update settings on one entity but use different pluralization. |
| N4 | `document snapshot <ref>` (singular — get one) | `document snapshots <ref>` (plural — list all) | Inconsistent pluralization in subcommand names. |
| N5 | `calendar get <ref>` (for events) | `calendar calendars` (list of calendars) | Confusing: `get` is for events, no `calendar get <calId>` exists. |
| N6 | `time log --minutes X` | `action schedule --start <iso>` | Time uses duration units; action uses ISO dates. Different conventions for similar concepts. |
| N7 | `user get --ref <id>` (flag) | `project get <ref>` (positional) | Inconsistent ref-specification style. |
| N8 | `--json` and `--ci` both exist | Same effect (JSON output) | Two flags with identical behavior. Documented but redundant. |
| N9 | `card create --master-tag X` requires existing master-tag | No way to create master-tags from CLI | First-card UX requires using the web UI once. |

## 5. Help documentation gaps

| # | Issue |
|---|-------|
| H1 | No `EXAMPLES` block in any command's `--help`. Users have to read source. |
| H2 | No enum value documentation (`--priority` valid values, `--status-category` valid values). |
| H3 | No format documentation (`--start <iso>` sample, `--due <iso>` sample). |
| H4 | No dependency documentation (`--assignee <email>` requires workspace membership). |
| H5 | `api` and `ws` escape hatches have minimal help. No list of valid methods. |
| H6 | No top-level `docs/CLI_REFERENCE.md` cheatsheet. |

---

## What was fixed and verified (excluded from this list)

- **Fix #1 — `findPersonBySocialKey` accepts user tokens.** Deployed in `hardcoreeng/account:local-fix` (verified by inspecting `bundle.js` for the `if (extra?.service !== void 0)` guard). CLI doesn't exercise the path anymore, but the server-side fix is verified deployed and correct.
- **Fix #2 — `getContent` 3s timeout.** Verified by `huly document get --markdown` returning within 5s on docs whose y-doc doesn't exist (would otherwise hang 3+ minutes).
- **Fix #6 — nginx resolver + per-upstream variables.** Verified by `docker compose restart transactor` and observing requests succeed (no stale-DNS failure).