# Learnings — `huly-cli` and Huly selfhost development

> Comprehensive, everything-collected reference. **Append to this file as
> you learn more** — don't delete entries, just add new ones with
> dated headings.
>
> Last full review: 2026-06-28

---

## 0. The big picture: what is `huly-cli`?

`~/huly-cli` is **not** the Huly server. It's a third-party CLI that talks to a Huly server. There are three repos in play:

| Repo | Purpose | Default branch |
|---|---|---|
| `~/huly-cli` (this repo) | The CLI tool we build and ship. One command per Huly MCP tool. | `feat/feature-parity` (during parity work) |
| `~/platform` | The Huly server source (rush monorepo). | `develop` |
| `~/huly-selfhost` | Self-host docker compose, nginx, caddy. The "live server". | `main` |

**Flow:** CLI → sends REST/JSON-RPC to `account` for auth → opens a WebSocket to `transactor` for live queries → reads model classes + documents from there.

The "parity plan" at `~/platform/.kilo/plans/1782509790047-partial-feature-parity-plan.md` has 18 phases that map Huly's MCP tool surface to CLI commands. The current branch has phases 0–13 implemented.

---

## 1. Critical environment facts

### Node version
- The CLI was developed on Node v26.4.0 (latest). It works on 22+.
- **The Huly server source (`~/platform`) requires Node 20-24** — `rush.json` says `"nodeSupportedVersionRange": ">=20.0.0 <25.0.0"`. Node 26 fails the version check.
- For platform builds we use `~/platform` with `PATH=/tmp/node22/bin:$PATH` (Node 22.11.0 from a tarball at `/tmp/node22.tar.xz`).

### Build systems
- The CLI: simple `npm run build` (tsc).
- The Huly server: rush monorepo. To build a pod:
  ```bash
  export PATH=/tmp/node22/bin:$PATH
  cd ~/platform/pods/<podname>     # e.g. account, workspace, collaborator
  node ../../common/scripts/install-run-rush.js bundle
  DOCKER_VERSION=local-fix docker build -t "hardcoreeng/<podname>:local-fix" .
  ```
- The "bundle" step produces `bundle/bundle.js` which the Dockerfile copies in. **Without this, `docker build` will fail with COPY of a missing file.**

### The CLI is run from `node dist/index.js`
- Build with `npm run build` → `dist/` contains the compiled output.
- Run with `node dist/index.js <cmd>` or symlink `bin/huly` into PATH.
- Source entry: `src/index.ts` does polyfills BEFORE any SDK import (see §4).

### File locations
- CLI runtime state: `~/.config/huly/`
  - `credentials.json` — account tokens, mode 0600
  - `active-account` — last email per host
  - `active-workspace` — last `huly workspace use <name>`
- Selfhost env: `~/huly-selfhost/.env`
- Plan doc: `~/platform/.kilo/plans/1782509790047-partial-feature-parity-plan.md`

---

## 2. Huly server architecture (deep)

### Services
| Service | Port | Role |
|---|---|---|
| `nginx` (container) | 80 | internal HTTP reverse proxy (serves Front, proxies /_accounts, /_transactor, etc.) |
| `caddy` (host) | 443 (TLS) | TLS terminator → nginx |
| `front` | 8080 | static SPA, REST proxy |
| `account` | 3000 | account server: auth, workspace mgmt, role checks |
| `transactor` | 3333 | WebSocket + REST API for live queries and tx application |
| `workspace` | — | worker: model-upgrade, migration, deletion queues |
| `collaborator` | 3078 | y-doc server, markup blob storage |
| `kvs` | 8094 | key-value store |
| `minio` | 9000 | blob storage (S3-compatible) |
| `redpanda` | 9092 | Kafka broker |
| `cockroach` | 26257 | primary database (account db + per-workspace sharded dbs) |
| `elastic` | 9200 | fulltext search |
| `stats` / `rekoni` | various | observability |
| `account-1` (the docker service) | 3000 | account server container |

### Database layout
- **CockroachDB** is the primary store.
- `global_account.*` tables (in the `defaultdb` schema) hold account-level data:
  - `workspace` — workspace records (uuid, name)
  - `workspace_status` — mode, is_disabled, processing_attempts, last_processing_time, version_*, processing_message
  - `workspace_members` — per-workspace members
  - `social_id` — social IDs (email:foo, etc.)
  - `account` — account records
  - `region`, `invite`, etc.
- **Per-workspace** sharded databases (also in cockroach, named after the workspace's `dataId`): `public.*` tables
  - `tx` — tx log: every operation as `TxCreateDoc`/`TxUpdateDoc`/`TxRemoveDoc`/`TxMixin`
  - `tracker` — Project, Issue, Component, Milestone, IssueTemplate, IssueStatus, TimeSpendReport, etc.
  - `document` — Document
  - `calendar` — Calendar, Event, etc.
  - `chunter` — Channel, ChatMessage
  - `time` — ToDo, WorkSlot
  - `card` — Card, CardSpace, MasterTag
  - `contact` — Person
  - `config` — workspace config
  - `derivedTx` — derived events

**To inspect a workspace's data directly:**
```bash
docker exec -e PGPASSWORD=bfaa9bb7e4c4b5ff0c525f9210c711ce52c82989c2919bfeb7535c693b619bb6 \
  huly_v7-cockroach-1 /cockroach/cockroach sql --insecure -d defaultdb -u selfhost
# global_account.workspace* for account-level
# public.* (set DB) for workspace data — the workspace DB name is global_account.workspace.dataId
```

### Workspace lifecycle states
- `pending-creation` → `creating` → `active` (normal)
- `pending-upgrade` → `upgrading` → `active` (when version mismatch)
- `pending-deletion` → `deleting` (terminal)
- `archiving-pending-backup` → `archiving-backup` → `archiving-pending-clean` → `archiving-clean` → `archived`
- `migration-pending-backup` → `migration-backup` → `migration-pending-cleanup` (then deleted)
- `pending-restore` → `restoring` → `active`

**Critical insight:** `WS_OPERATION=all+backup` covers all of these. `WS_OPERATION=all` (the default) covers only `pending-creation` + `pending-upgrade` + `pending-deletion` (after the fix in §11).

### The model-upgrade queue
- Workspace pod worker polls `getPendingWorkspace(this.region, this.version, this.operation)`.
- For workspaces where `version_major/minor/patch < current`, applies all model-upgrade txs from the platform's source tree.
- This is how new plugin classes get registered: when a workspace is created, all txs in the build's `bundle.js` get replayed.

---

## 3. The 18 MCP surfaces, where they live, what's wired

| Phase | Surface | CLI file | Class IDs | Status (2026-06-28) |
|---|---|---|---|---|
| 0 | foundation | `src/resources/_helpers.ts`, `src/transport/identifiers.ts`, `scripts/smoke.sh` | n/a | ✅ done |
| 1 | Auth & Workspace | `src/resources/workspace.ts`, `src/resources/user.ts` | `account:class:Account` | ✅ done (CLI) |
| 2 | Projects | `src/resources/project.ts` | `tracker:class:Project`, `tracker:class:ProjectType`, `tracker:class:ProjectTargetPreference` | ✅ done |
| 3 | Issues sub-surfaces | `src/resources/component.ts`, `milestone.ts`, `issue-template.ts` | `tracker:class:Component`, etc. | ✅ done (CLI) |
| 4 | Issues depth | `src/resources/issue.ts` (filters) | `tracker:class:Issue` | ✅ done |
| 5 | Comments | `src/resources/comment.ts` | `chunter:class:ChatMessage` (collection='comments' on Issue) | ✅ done |
| 6 | Documents depth | `src/resources/document.ts` | `document:class:Document`, `document:class:Teamspace`, `document:class:DocumentSnapshot` | ✅ done |
| 7 | Channels CRUD + members | `src/resources/channel.ts` | `chunter:class:Channel` | ✅ done |
| 8 | Channels messages + DMs + threads | same file | `chunter:class:ChatMessage`, `ThreadMessage`, `DirectMessage` | ✅ done |
| 9 | Calendar | `src/resources/calendar.ts` | `calendar:class:Event`, `Calendar`, `ReccuringEvent`, `ReccuringInstance` | ✅ done (had to add `calendar create` per §11) |
| 10 | Time tracking | `src/resources/time.ts` | `tracker:class:TimeSpendReport` (NOTE: tracker, NOT time), `time:class:WorkSlot` | ✅ done |
| 11 | Associations + Spaces + Task | (paused — would extend workspace + project resources) | `core:class:Space`, `tracker:class:TaskType` | ⏸ paused |
| 12 | Cards (Card module) | `src/resources/card.ts` | `card:class:Card`, `CardSpace`, `MasterTag` | ✅ done |
| 13 | Planner (action/ToDo) | `src/resources/todo.ts` | `time:class:ToDo` | ✅ done |
| 14 | Activity | n/a | `activity:class:ActivityMessage` | ⏸ paused |
| 15 | Notifications | n/a | `notification:class:Notification` | ⏸ paused |
| 16 | Approvals | n/a | `request:class:Request` | ⏸ paused |
| 17 | Comprehensive README | n/a | n/a | ⏸ paused |
| 18 | Final polish | n/a | n/a | ⏸ paused |

**13/18 phases done.** Remaining 5 paused pending the model-load fix verification.

---

## 4. Critical CLI-side technical facts

### Polyfills in `src/index.ts` (top of file, BEFORE any other import)
The Huly SDK misdetects Node 22+ as a browser because Node 22 ships `globalThis.sessionStorage` (no `window`). The SDK's connection code at `node_modules/@hcengineering/client-resources/lib/connection.js:88` does `window.addEventListener` and crashes with `ReferenceError: window is not defined`.

**Fix in `src/index.ts`:**
```ts
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const wsModule = require('ws') as typeof import('ws')

const g = globalThis as { window?: unknown; WebSocket?: unknown }
if (g.window === undefined) {
  g.window = { addEventListener: () => {}, removeEventListener: () => {}, location: { href: '' } }
}
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = wsModule.WebSocket
}
```
This **must** be the first import in `src/index.ts` (no, the polyfills are after `import { createRequire }` but before any SDK import — that's the order they need).

### `NodeWebSocketFactory` is not exported
`@hcengineering/api-client` ships a working factory at `lib/socket/node.js` but its `package.json#exports` doesn't expose it. We can't import it via the package name. Solution: **inline a ~40-line factory** in `src/auth/client.ts` that uses `ws.WebSocket` and adapts to the `ClientSocket` interface.

The `ClientSocket` interface needs: `readyState` (getter), `send(data)`, `close(code?)`, plus event-handler properties `onmessage`, `onopen`, `onclose`, `onerror` (set externally by the SDK).

### `getModel()` returns 3 keys in Node
**This is a known symptom, not a bug in the CLI.** The transactor's full model (4080+ classes) is on the server. The local `client.getModel()` is a stub. The SDK uses `getHierarchy()` (which works) for class lookups, but live queries (`findAll`) may silently return empty on classes whose mixins haven't been applied server-side.

The fix is server-side: trigger the model-upgrade queue to actually apply the model. (See §10.)

### Connection flow
1. `client.login(email, password)` via account REST → returns account token
2. `client.selectWorkspace(token, 'workspace-url')` → returns workspace token + endpoint
3. `client.connect(endpoint, token)` via WebSocket → returns PlatformClient
4. `client.findAll(classId, query)` → live query via WebSocket

The CLI bundles these in `src/auth/client.ts → connectPlatform()`.

### Account tokens are NOT the workspace token
A login returns an *account* token, used to call `selectWorkspace`. The `selectWorkspace` returns a *workspace* token (for the specific workspace). The CLI caches both: account token in `credentials.json.accountToken`, workspace token in `credentials.json.workspaces[url].token`.

If you use the account token against the transactor, you'll get `Unauthorized`. Use the workspace token. (See §9 for cache logic.)

### `requiresInit` flag in CLI command names
The CLI command namespacing convention: most commands have an explicit name + action (e.g. `huly workspace create --name X`). Some have child commands (e.g. `huly workspace member add` — though we renamed to `huly workspace add-member` to avoid commander parent/child conflicts).

### `--force` for `deleteWorkspace`
The CLI's `deleteWorkspace` has a safety check that prevents deleting the *active* workspace (the one in `HULY_WORKSPACE` or `~/.config/huly/active-workspace`). Bypass with `--force --yes`. Without `--force` you get:
> `cannot delete workspace life while it is the active --workspace/HULY_WORKSPACE`

After delete, the worker should fully clean up (with Fix #4 from §10). If the worker fails, the workspace becomes stuck in `pending-deletion` mode — you'll need to:
1. Re-create it (the kafka replay will create a new row)
2. Wait for the worker to process it
3. Or hard-delete from postgres directly

---

## 5. Critical server-side technical facts

### The `client.createDoc` returns a client-generated id BEFORE the server processes it
The `TxOperations.createDoc` in `~/platform/foundations/core/packages/core/lib/operations.js:80` generates a UUID locally, builds the `TxCreateDoc`, calls `this.tx(tx)` which sends via the connection. If the server fails to apply the tx (e.g., class hierarchy missing), the create call **may still return success** with the local id. The actual persistence is async.

**This is why the CLI's `createDoc` appears to "succeed" but `findAll` returns 0 — the tx is queued client-side, sent, the server can't apply it (model incomplete), and the response confirms the local id. The doc is in `public.tx` (the tx log) but not in the model storage (`public.tracker`, etc.).**

### MarkupContent ref → MarkupBlob → text
- `MarkupContent` is stored in the doc's `data` JSON as a ref object (`{ content: 'blobId' }` or similar).
- The actual text is in **y-doc** (collaborative doc) stored in the collaborator service's storage.
- `client.fetchMarkup(class, id, attr, ref, format)` returns the rendered text.
- For `tracker:class:Component.lead`, `time:class:ToDo.description`, `tracker:class:Issue.description`, the y-doc may or may not exist depending on whether `uploadMarkup` was called.
- **The collaborator `getContent` RPC can hang forever** waiting for a y-doc that doesn't exist. Wrap in timeout. (See Fix #2 in §10.)

### `findPersonBySocialKey` permission gate
The account server's `findPersonBySocialKey` requires the JWT to have a `service` field matching one of `['tool', 'workspace', 'aibot', ...integrationServices]`. Regular login tokens have **no service field** → `Forbidden`.

Fix: allow undefined service (login tokens):
```ts
if (extra?.service !== undefined) {
  verifyAllowedServices(['tool', 'workspace', 'aibot', ...integrationServices], extra)
}
```

### Workspace `dataId` is the per-workspace DB name
When you `createWorkspace`, the server assigns a `dataId` (a DB name in cockroach). All subsequent docs are in that DB. The destroy adapter uses this `dataId` to know which DB to drop.

If `dataId` is empty (e.g. kafka replay re-created the workspace row without one), `doCleanup` fails silently.

### Pending-deletion worker behavior
When `mode='pending-deletion'`, the worker:
1. Calls `sendTransactorMaitenance` (force-close sessions) — this is what the "sending event" logs are
2. Calls `doCleanup` which drops rows from `public.*` tables
3. (After Fix #4) Also drops rows from `global_account.workspace*`
4. Publishes `workspaceEvents.deleted()`

If `doCleanup` fails, the worker logs `Analytics.handleError(err)` (silent) and **returns** — the row remains in `pending-deletion` state, and the worker picks it up again next cycle, **incrementing `processing_attempts`**.

### `WS_OPERATION=all` (default) does not process pending-deletion
Per `~/platform/server/account/src/collections/postgres/postgres.ts:994-1007`, the operation-specific SQL:
```ts
case 'all':
  operationSql = `(${pendingCreationSql} OR ${pendingUpgradeSql})`
  break
case 'all+backup':
  operationSql = `(${pendingCreationSql} OR ${pendingUpgradeSql} OR ${migrationSql} OR ${archivingSql} OR ${restoringSql} OR ${deletingSql})`
  break
```
After Fix #5, `'all'` includes `deletingSql` too — single-pod deployments work without needing to set `'all+backup'`. Original `deletingSql` exclusion was a TODO (comment line 1018: "support returning pending deletion workspaces when we will actually want to clear them with the worker").

### MinIO bucket lifecycle is NOT in the platform
The platform's `server/backup/src/storage.ts` has no TTL/cleanup. Backups accumulate forever in the bucket unless you set up MinIO's ILM externally:
```bash
docker exec huly_v7-minio-1 mc alias set local http://localhost:9000 minioadmin minioadmin
docker exec huly_v7-minio-1 mc mb --ignore-existing local/huly-backups
docker exec huly_v7-minio-1 mc ilm add local/huly-backups --expiry-days 14
```

### Redpanda healthcheck has SASL bootstrap issue
`rpk cluster info -X user=... -X pass=...` returns `ILLEGAL_SASL_STATE` during SASL bootstrap. The fix is to use the unauthenticated metadata probe:
```yaml
healthcheck:
  test: ['CMD-SHELL', 'rpk cluster info --brokers=localhost:9092 || exit 1']
  interval: 10s
  timeout: 5s
  retries: 20
  start_period: 30s
```

### Stale DNS in services
Docker compose's `depends_on: condition: service_healthy` makes cold starts work. But after a service restart, **the IP may have changed** and other services cache the old IP. The only fix is:
1. Add `resolver 127.0.0.11 valid=10s;` to nginx (covered in Fix #6 in §10)
2. **Or restart all dependents** after a service restart

### nginx `proxy_pass` with variables
Once you have `resolver 127.0.0.11 valid=10s;`, you must use **variables** in `proxy_pass`:
```nginx
set $transactor http://transactor:3333;
location /_transactor { proxy_pass $transactor; }
```
Direct `proxy_pass http://transactor:3333;` is not re-resolved (it gets resolved once at config load).

### `accountClient.signUp` exists
`accountClient.signUp(email, password, firstName, lastName)` creates a new account. Useful when `login` returns `AccountNotFound`. `signUpOtp` and `signUpJoin` are alternatives.

### Account-server workspace limit
`WORKSPACE_LIMIT_PER_USER` defaults to 10. If you hit it, you get `WorkspaceLimitReached`. You can either:
- Increase the env var on the account pod
- Delete some workspaces (which requires `all+backup` to actually clean them up — see §5)

---

## 6. Common pitfalls and gotchas

### SDK class ID strings are precise
- `time:class:ToDo` is correct (time plugin)
- `time:class:WorkSlot` is correct
- **`tracker:class:TimeSpendReport` is correct** (NOT `time:class:TimeSpendReport`) — the class lives in the tracker's namespace per `~/platform/models/tracker/src/types.ts:325`
- `tracker:class:Project` not `project:class:Project` (no separate project plugin; tracker owns it)

Always check the source: `grep -rn "@Model.*<className>"` in `~/platform/models/`.

### `findAll` returns 0 but `findOne` by `_id` also returns undefined
This is a model-load issue. The local model has only 3 keys. The live query compiles against the model and skips docs whose class isn't in it. **Even when the doc is in the postgres table, the SDK can't materialize it.**

### `findAll` works for some classes, returns 0 for others
- **Works:** Project, IssueStatus, ProjectTargetPreference, Channel, Card, MasterTag, CardSpace, Person
- **Returns 0:** Component, Milestone, IssueTemplate, Issue, Document, Teamspace, ChatMessage, Event, ToDo, WorkSlot
- **Domain not found:** TimeSpendReport

The pattern: classes that have only a model `TxCreateDoc` (no mixin) load fine. Classes that need a `TxMixin` to apply their attributes (e.g., `TrackerDoc.add({reports: CollectionSize<TimeSpendReport>})` in tracker/src/index.ts:212) require the mixin tx to apply — and if the mixin fails (e.g. parent class missing), the entire class registration is incomplete.

After Fix #3 (retry model-upgrade txs in dependency order), this should improve. But on the live test workspace, only a fresh `docker compose down -v + up + signUp + workspace create` (which is what we did) makes the model load fully.

### `fetchMarkup` hangs forever on certain classes
The collaborator's `getContent` calls `hocuspocus.openDirectConnection(documentName, context)`. If the y-doc doesn't exist (e.g., chat message whose MarkupContent was stored but the y-doc was never uploaded), this hangs. **After Fix #2** the server returns empty content after 3s timeout.

### `npm run build` and the polyfill
The CLI build is `tsc -p tsconfig.build.json`. If polyfills are added after SDK imports, they don't help (imports are hoisted). **Polyfills must be at the top of the entry file before any SDK import.** The `import { createRequire }` line is the only import allowed before the polyfill assignments.

### The CLI's `deleteWorkspace` only marks pending
A successful `huly workspace delete --force --yes` only sets `is_disabled=true, mode='pending-deletion'`. **It does not actually drop the workspace.** The worker does that. If the worker fails (e.g., kafka replay created a phantom row), the workspace becomes a zombie.

After Fix #4, the worker also drops the account-db rows, so the next kafka replay creates a fresh row.

### Selfhost `WS_OPERATION=all` is the default
If you don't set `WS_OPERATION=all+backup` in compose, only `pending-creation` + `pending-upgrade` workspaces are processed. **Before Fix #5**, `pending-deletion` was excluded. The user must explicitly set `all+backup` to process deletions, migrations, archiving, restoring.

### Caddy is on the host, not in compose
`huly_v7-nginx-1` is a container, but the actual TLS terminator is `caddy` running on the host (via systemd). `systemctl restart caddy` doesn't restart nginx. The caddy Caddyfile is at `/etc/caddy/Caddyfile`.

### Cockroach `selfhost` user is missing the `CREATE` privilege on `defaultdb` after a fresh DB
**Why it matters:** The account service connects to cockroach as user `selfhost` (per `CR_USERNAME=selfhost` in `~/huly-selfhost/.env`). On first start, `PostgresDbCollection._init()` in `~/platform/server/account/src/collections/postgres/postgres.ts:730-734` runs:
```sql
CREATE SCHEMA IF NOT EXISTS global_account;
```
(`global_account` is the default namespace — `ns = 'global_account'` in `postgres.ts:546`.) In cockroach, `CREATE SCHEMA` requires the `CREATE` privilege on the database — which the `selfhost` user does NOT have by default (only `root` does). The account service crashes on startup with a `permission denied to create schema` error from cockroach.

**Fix (run once after every `docker compose down -v` that recreates the cockroach volume):**
```bash
docker exec -e PGPASSWORD=bfaa9bb7e4c4b5ff0c525f9210c711ce52c82989c2919bfeb7535c693b619bb6 \
  huly_v7-cockroach-1 /cockroach/cockroach sql --insecure -d defaultdb -u root \
  -e "GRANT CREATE ON DATABASE defaultdb TO selfhost"
```
The password in `PGPASSWORD` is `CR_USER_PASSWORD` from `.env`. After granting, restart the account pod (`docker compose up -d --force-recreate account`).

**Verification (once cockroach is up):**
```bash
docker exec huly_v7-cockroach-1 /cockroach/cockroach sql --insecure -d defaultdb -u selfhost \
  -e "CREATE SCHEMA IF NOT EXISTS smoke_test;"   # should succeed
docker exec huly_v7-cockroach-1 /cockroach/cockroach sql --insecure -d defaultdb -u selfhost \
  -e "DROP SCHEMA smoke_test;"
```
Without the grant, the first command errors with `SQLSTATE 42501` (`permission denied to create schema`).

**Why it's not just a one-time issue:** cockroach's `CREATE` privilege on a database is granted to `root` only. `selfhost` is created by the compose init but does not inherit `CREATE`. The platform never calls `CREATE DATABASE` from runtime — but it DOES call `CREATE SCHEMA` (for `global_account`, and per-workspace schemas later). Both require the same privilege. The bug exists in upstream `PostgresDbCollection._init()`; an upstream PR-worthy fix would be to either: (a) explicitly check for schema existence before creating, or (b) grant the `CREATE` privilege to the runtime user in the platform's own startup sequence, or (c) let `root` create the schema and then `selfhost` only needs to read/write tables. None of these are done today.

### Selfhost sign-up
There's no `huly signup` CLI command. You must call `accountClient.signUp` directly. `login --headless` doesn't create an account.

---

## 7. The selfhost compose file (`~/huly-selfhost/compose.yml`)

### Structure
- Network: `huly_net`
- 16 services (cockroach, redpanda, minio, elastic, kvs, account, transactor, workspace, fulltext, collaborator, front, account-1 (old account service), nginx, ...)
- Volumes: redpanda, files (minio), elastic, cr_data, cr_certs

### Key env vars (`.env`)
- `HULY_VERSION=v0.7.423`
- `SECRET=...` (token signing key)
- `CR_DB_URL=postgresql://...@cockroach:26257/defaultdb?sslmode=disable`
- `REDPANDA_ADMIN_USER`/`REDPANDA_ADMIN_PWD`
- `HOST_ADDRESS=https://huly.aaravlabs.com` (used by transactor-url)

### `MODEL_ENABLED=*` (on workspace pod)
- `*` means "all model classes loaded"
- This is the default, no need to override

### `BACKUP_STORAGE`/`BACKUP_BUCKET`
- Only consumed by `'all+backup'` mode
- Points to minio
- `BACKUP_BUCKET=huly-backups` (must exist; we create via `mc mb`)

### `MIGRATION_CLEANUP` (DO NOT SET unless intentional)
- Default unset
- If set to `'true'`, the worker removes old DBs after region migration
- For selfhost single-region, **leave unset**

---

## 8. Smoke testing patterns

### The bash smoke runner (`scripts/smoke.sh`)
- `scripts/smoke.sh <phase|all>`
- Reads `~/.config/huly/.env` automatically
- For each phase, runs a series of `step` and `cleanup_count` checks
- `cleanup_count` makes a list query and counts items matching a pattern — must return 0
- Pattern: every `create` must be paired with a `delete` to keep the workspace clean

### Smoke shell idiom for handling noise
The CLI prints a lot of `Generate new SessionId`, `Connected to server`, `findfull model N` to stderr. The smoke uses `2>&1 | grep -v` to filter:
```bash
HULY calendar list 2>&1 | grep -vE "no document|Generate|Connected|findfull|client websocket|ExperimentalWarning|trace-warnings|use \`node"
```

### When smoke fails on `pending-deletion` workspaces
The smoke for phase 9 (calendar) creates events and expects `findAll` to return them. If `findAll` returns 0 (the model-load bug), the test still passes the `create` step but fails the `cleanup_count` (which also returns 0, but should return 0 with no items). **The smoke is overly optimistic** in this state.

### The `pending-deletion` and kafka replay
After `huly workspace delete`:
- CLI sets `is_disabled=true, mode='pending-deletion'`
- The worker tries to drop the workspace data
- The kafka queue replays deletion events
- A new `workspace` row appears with the same uuid, same name
- The worker tries again, fails (no `dataId`), increments `processing_attempts`
- The CLI's `getUserWorkspaces` filters out `is_disabled=true` workspaces, so they're hidden from the user
- But they're not actually gone

**Until Fix #4 lands, the only reliable hard-delete is direct SQL.**

---

## 9. Building and deploying local fixes

### Step-by-step (workspace pod, as an example)
```bash
export PATH=/tmp/node22/bin:$PATH
cd /home/aarav/platform/pods/workspace
# 1. Make your code change in src/
# 2. Bundle (esbuild produces bundle/bundle.js)
node ../../common/scripts/install-run-rush.js bundle
# 3. Build docker image
DOCKER_VERSION=local-fix docker build -t "hardcoreeng/workspace:local-fix" .
# 4. Update compose to use the new tag
# Edit ~/huly-selfhost/compose.yml:
#   image: hardcoreeng/workspace:local-fix   (was ${HULY_VERSION})
# 5. Recreate the container
cd ~/huly-selfhost
docker compose up -d --force-recreate workspace
# 6. Verify
docker logs huly_v7-workspace-1 --tail 30
```

### Building the whole patched server
```bash
export PATH=/tmp/node22/bin:$PATH
cd /home/aarav/platform
node common/scripts/install-run-rush.js install       # ~1 min
# Build each patched pod:
for pod in account workspace collaborator; do
  cd ~/platform/pods/$pod
  node ../../common/scripts/install-run-rush.js bundle
  DOCKER_VERSION=local-fix docker build -t "hardcoreeng/$pod:local-fix" .
done
```

### Switching back to upstream
- Revert the image tags in `compose.yml` from `local-fix` back to `${HULY_VERSION}`
- `docker compose up -d --force-recreate <service>`

---

## 10. The fixes (2026-06-28) and their commits

All on branch `fix/server-issues-2026-06` in `~/platform`, plus `~/huly-selfhost/.huly.nginx` (also committed on the same branch via the selfhost repo).

### Fix #1: `findPersonBySocialKey` accepts user tokens
**File:** `~/platform/server/account/src/serviceOperations.ts:1002-1004`
**Commit:** `68549b06`
**Change:**
```ts
// was: verifyAllowedServices(['tool', 'workspace', 'aibot', ...integrationServices], extra)
// now: only verify when caller identifies as a service
if (extra?.service !== undefined) {
  verifyAllowedServices(['tool', 'workspace', 'aibot', ...integrationServices], extra)
}
```
**Why:** The function returns just a `PersonUuid`, not sensitive data. Login tokens don't have a `service` field, so they were rejected. The CLI was working around this with workspace-local Person scan, but the proper fix is in the server.

### Fix #2: `getContent` connection timeout
**File:** `~/platform/server/collaborator/src/rpc/methods/getContent.ts`
**Commit:** `5fdb0814`
**Change:** Race the `openDirectConnection` call against a 3-second timeout. On timeout, return `{ content: {} }` and log a warning.
**Why:** Hocuspocus `openDirectConnection` can hang forever waiting for a y-doc that was never persisted (e.g., chat messages whose MarkupContent ref was never uploaded). The client retries 3×50ms → 3+ minutes of hang per call.

### Fix #3: model-upgrade tx retry
**File:** `~/platform/foundations/core/packages/core/src/memdb.ts:328-413`
**Commit:** `2600ea1a`
**Change:** Two-pass approach. Apply all txs once, then collect update/mixin/remove txes that failed (objectId not found) and retry them. By the second pass, classes created in the first pass are visible.
**Why:** Upgrade batches may have update/mixin txes that reference classes not yet in `findObject`. With ordering dependencies not guaranteed, the first pass fails. Retrying makes the model load deterministic.

### Fix #4: workspace deletion also drops account-db rows
**File:** `~/platform/server/workspace-service/src/service.ts:431-477` (new `doAccountCleanup` method), invoked at line 524
**Commit:** `69020e73`
**Change:** After `doCleanup` succeeds, also DELETE FROM `global_account.workspace_members`, `workspace_status`, `workspace` (in that order). Uses `ACCOUNTS_DB_URL` env var.
**Why:** The account server's `deleteWorkspace` only sets `is_disabled=true, mode='pending-deletion'`. The worker used to only clean the workspace data (`public.*` tables). The account-db rows hung around, and the worker kept re-pulling the workspace. This completes the deletion.

### Fix #5: `WS_OPERATION=all` includes `deletingSql`
**File:** `~/platform/server/account/src/collections/postgres/postgres.ts:994-1003`
**Commit:** `3ca9a21f`
**Change:** Added `OR ${deletingSql}` to the `'all'` case's `operationSql`.
**Why:** The previous `'all'` case only matched `pendingCreation OR pendingUpgrade`, explicitly leaving `pending-deletion` for the (then-unwritten) `'all+backup'`. Single-pod deployments couldn't hard-delete workspaces without setting `'all+backup'`.

### Fix #6: nginx resolver
**File:** `~/huly-selfhost/.huly.nginx`
**Commit:** `360ddd8` (in `~/huly-selfhost`)
**Change:** Added `resolver 127.0.0.11 valid=10s ipv6=off;` to the server block. Defined `set $transactor http://transactor:3333;` etc. for every upstream. Changed every `proxy_pass http://host:port;` to `proxy_pass $host;` (using the variables).
**Why:** Without `resolver`, nginx caches upstream DNS at config load. Recreating any upstream container (especially transactor after a `docker compose restart`) strands the proxy against the old IP.

---

## 11. The CLI fixes (2026-06-27 to 2026-06-28) and their commits

All on branch `feat/feature-parity` in `~/huly-cli`. Commits listed chronologically.

| # | Fix | Files | Commit |
|---|---|---|---|
| §1.1 | `space` in sub-resource `createDoc` attrs (component, milestone, issue-template, issue, time) | component.ts, milestone.ts, issue-template.ts, issue.ts, time.ts | b42c6f1 |
| §1.2 | 5s `withTimeout` around `client.fetchMarkup` calls | format.ts + 6 resources | b42c6f1 |
| §1.4 | Auto-seed default IssueStatus on first issue create | issue.ts | b42c6f1 |
| §1.5 | Pre-check duplicate project identifier | project.ts | b42c6f1 |
| §1.3 | Replace `findPersonBySocialKey` with workspace-local Person scan | channel.ts, todo.ts, user.ts | b42c6f1 |
| §1.7 | Better `channelMessage` column placeholder | format.ts | b42c6f1 |
| §1.8 | `--force` flag for `deleteWorkspace` | workspace.ts, cli.ts | b42c6f1 |
| §2 | `tracker:class:TimeSpendReport` (was `time:class:...`) | identifiers.ts | e0fe8e6 |
| n/a | `huly calendar create` and `huly calendar delete` commands (in progress when paused) | calendar.ts, cli.ts | not committed |

The `withTimeout` helper:
```ts
// src/output/format.ts
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
```

---

## 12. The compose changes (2026-06-27 to 2026-06-28)

All on `main` branch in `~/huly-selfhost`.

| Commit | Change |
|---|---|
| (root) | Initial setup |
| 360ddd8 | `fix(nginx): add resolver + use variables for proxy_pass` |
| 2374573 | `compose: switch account/workspace/collaborator to locally-built local-fix images` |

The compose's `WS_OPERATION` setup:
```yaml
workspace:
  environment:
    - WS_OPERATION=all+backup
    - BACKUP_STORAGE=minio|minio?accessKey=minioadmin&secretKey=minioadmin
    - BACKUP_BUCKET=huly-backups
  depends_on:
    redpanda: { condition: service_healthy }
    transactor: { condition: service_started }
  # MIGRATION_CLEANUP is intentionally NOT set
```

---

## 13. Documentation files in `~/huly-cli/docs/`

- `issues.md` — structured inventory of bugs/workarounds. Updated after every fix session.
- (This file) `learnings.md` — what you're reading. Append to it as you learn more.

---

## 14. Tools and tricks

### Inspect the live server
```bash
# Account-level DB:
docker exec -e PGPASSWORD=bfaa9bb7e4c4b5ff0c525f9210c711ce52c82989c2919bfeb7535c693b619bb6 \
  huly_v7-cockroach-1 /cockroach/cockroach sql --insecure -d defaultdb -u selfhost
# > SELECT count(*) FROM workspace;
# > SELECT uuid, name, mode, processing_attempts, is_disabled FROM workspace_status;

# Per-workspace data (use the dataId from workspace table):
# ... same command, but with the workspace's dataId as the database name.

# MinIO:
docker exec huly_v7-minio-1 mc alias set local http://localhost:9000 minioadmin minioadmin
docker exec huly_v7-minio-1 mc ls local/

# Redpanda:
docker exec huly_v7-redpanda-1 rpk cluster info --brokers=localhost:9092

# Tail logs:
docker logs huly_v7-transactor-1 --tail 100 2>&1 | tail -30
docker logs huly_v7-workspace-1 --tail 100 2>&1 | tail -30
```

### Force-delete a stuck pending-deletion workspace
```sql
DELETE FROM global_account.workspace_status WHERE workspace_uuid = '<uuid>';
DELETE FROM global_account.workspace_members WHERE workspace_uuid = '<uuid>';
DELETE FROM global_account.workspace WHERE uuid = '<uuid>';
```
After Fix #4, the worker's `doAccountCleanup` does this automatically. Before Fix #4, this is the manual workaround.

### Test the CLI from scratch
```bash
# Reset CLI state:
rm -f ~/.config/huly/credentials.json ~/.config/huly/active-* ~/.config/huly/cached_accounts
# Re-login
node dist/index.js login --headless
# Create a fresh workspace
node dist/index.js workspace create --name "smoke-test" --yes
# Wait for the worker to apply model
sleep 30
# Run smoke
bash scripts/smoke.sh all
# Cleanup
node dist/index.js workspace delete --force --yes
```

### Quickly check class load
```bash
node -e "
import('./dist/auth/client.js').then(async (m) => {
  const c = await m.connectPlatform({ workspace: 'life' });
  const h = c.getHierarchy();
  for (const cls of ['tracker:class:Component', 'time:class:ToDo', 'tracker:class:TimeSpendReport']) {
    console.log(cls, h.hasClass(cls));
  }
  await c.close();
})
" 2>&1 | tail -5
```

### Override HULY_PASSWORD temporarily
```bash
HULY_URL=https://huly.aaravlabs.com HULY_EMAIL=... HULY_PASSWORD=... node dist/index.js login --headless
```

---

## 15. Phase 14-18 status (paused)

| Phase | Surface | Class IDs | Work needed |
|---|---|---|---|
| 14 | Activity | `activity:class:ActivityMessage` | New `src/resources/activity.ts` with list/get/pin/reactions/replies/saved/mentions. ~10 commands. |
| 15 | Notifications | `notification:class:Notification` | New `src/resources/notifications.ts`. ~8 commands. |
| 16 | Approvals | `request:class:Request` | New `src/resources/approval.ts`. ~5 commands. |
| 17 | Comprehensive README | n/a | Rewrite `README.md` with the full command list, env vars, and architecture. |
| 18 | Final smoke + polish | n/a | Run `bash scripts/smoke.sh all` end-to-end with proper live verification. |

To resume, the user must verify Fixes #1-#6 actually work via:
1. `docker compose down -v` (recreate from scratch)
2. `docker compose up -d` (with the new local-fix images)
3. `signUp` new account
4. `workspace create`
5. Run smoke
6. If all pass, proceed to phases 14-18

If any of Fixes #1-#6 don't actually work, more investigation is needed.

---

## 16. Open questions / things I didn't get to

- **Is Fix #3 (model-upgrade retry) enough by itself?** Or is there a deeper issue in the transactor's model storage? The retry helps for batches with internal dependency order issues, but if a class is genuinely missing from the version's tx set, the retry won't help.
- **Why does `getUserWorkspaces` exclude `is_disabled=true` workspaces but `getPendingWorkspace` doesn't?** Should the pending-deletion check be on the worker side, not the SQL side? Per `service.ts:323-332`, `_upgradeWorkspace` already checks `isDisabled` and bails. So at least the upgrade path is safe.
- **The `addCollection` for messages** stores the message in the `core:space:Configuration` or similar (not the channel itself), with the channel as the `attachedTo`. The y-doc for the message body is created in the collaborator. If we never call `uploadMarkup`, the y-doc doesn't exist, and `fetchMarkup` hangs.
- **Calendar recreation**: the example template doesn't seed a Calendar. Users have to create one via web UI or (now) CLI.

---

## 17. To-dos for the next session

- [ ] Verify Fixes #1-#6 by `docker compose down -v && up -d` then signUp + create workspace
- [ ] If all fixes work, complete `huly calendar create` + `huly calendar delete` CLI commands
- [ ] Add `huly calendar calendars` verification to the smoke
- [ ] Update `docs/issues.md` to mark the fixes as verified
- [ ] Resume phases 14-18
- [ ] (skipped — user does not want PRs for the fixes; they're kept locally on branch `fix/server-issues-2026-06`)

---

## 18. Specific lessons learned (categorized)

### Architecture
- The Huly server uses a "model as transactions" architecture. The "model" isn't just config — it's the union of all model-mutation txs applied to the in-memory model storage.
- "Model storage" and "live-query layer" are the same on the transactor but separate in the SDK. The local SDK model is always a stub.
- The model-upgrade queue is a per-workspace Kafka event stream. Each new plugin version ships a new set of model txs.

### Operational
- After `docker compose restart transactor`, **always restart nginx** too (until the resolver fix is in).
- MinIO needs a manual `mc ilm add` for retention. The platform doesn't do this.
- `docker compose down -v` is the nuclear option when the model state is wedged. All workspace data is lost.

### Design
- Service-to-service auth (`verifyAllowedServices`) is too restrictive when the same function is also useful for user-facing features.
- A two-pass approach (apply, then retry-failed) is more robust than single-pass for dependency-ordered batches.
- Cleanup should be idempotent and complete: a partial cleanup leaves zombies.

### Gotchas
- `signUp` not `signup` (capital U).
- The SDK class IDs have specific namespaces — `tracker:class:TimeSpendReport` not `time:class:...`.
- The CLI's `getModel()` returning 3 keys is a stub, not a real model. Don't rely on it.
- `docker compose restart <svc>` only restarts the named service. To restart dependents, list them all.
- The `force-close` transactor event the workspace pod sends is for telling the transactor to drop in-memory sessions, not the actual data cleanup.

### Useful commands
```bash
# Huly CLI build:
cd ~/huly-cli && npm run build

# Platform pod build (account/workspace/collaborator):
cd ~/platform/pods/<pod>
node ../../common/scripts/install-run-rush.js bundle
DOCKER_VERSION=local-fix docker build -t "hardcoreeng/<pod>:local-fix" .

# Selfhost recreate (full):
cd ~/huly-selfhost && docker compose down -v && docker compose up -d

# Selfhost recreate one service:
docker compose up -d --force-recreate <service>

# Watch the worker:
docker logs huly_v7-workspace-1 --tail 200 2>&1 | grep -vE "^\[32m|^sending" | tail -20

# Inspect a workspace's data via postgres (replace <workspace> with the workspace name):
docker exec -e PGPASSWORD=bfaa9bb7e4c4b5ff0c525f9210c711ce52c82989c2919bfeb7535c693b619bb6 \
  huly_v7-cockroach-1 /cockroach/cockroach sql --insecure -d defaultdb -u selfhost
# > SELECT uuid, name, mode, processing_attempts, is_disabled, version_major, version_minor, version_patch FROM global_account.workspace_status;

# MinIO lifecycle:
docker exec huly_v7-minio-1 mc ilm add local/huly-backups --expiry-days 14

# Sign up (no CLI for this):
node -e "
import('./dist/auth/client.js').then(async (m) => {
  const ac = await m.accountClient('https://huly.aaravlabs.com');
  await ac.signUp(process.env.HULY_EMAIL, process.env.HULY_PASSWORD, 'Aarav', 'Sharma');
  console.log('signed up');
})
"
```

## 19. Handover document

The file `docs/HANDOVER.md` is the most important starting point for the next session. It contains:
- Current state of all 3 repos (CLI, platform, selfhost)
- 4-6 hours of remaining work
- Resume instructions
- Env vars and shell setup
- File locations cheat sheet
- Class ID reference
- Image version mapping
- Common pitfalls (12 items)

If the session gets cut short, write or update HANDOVER.md. The next session should read HANDOVER.md, issues.md, and learnings.md in that order.

## 20. Refactor: `new MarkupContent(X, 'markdown')` → `X`

The SDK's `processMarkup` (in `node_modules/@hcengineering/api-client/lib/client.js`) tries to upload any `MarkupContent` instance to the collaborator service. The collaborator throws on this selfhost, breaking every CLI command that creates a doc/comment/channel-message etc. with a body.

**Workaround applied in this session (unverified):** Python script in `HANDOVER.md` replaced `new MarkupContent(X, 'markdown')` with `X` (raw string) in 9 resource files. The SDK's processMarkup's else branch passes strings through. Trade-off: `get --markdown` won't be able to convert markup ref → text (it'll show the raw string).

**Proper fix (not done):** apply the same 3s timeout fix from `getContent` to `createMarkup` in `~/platform/server/collaborator/src/rpc/methods/` (look for the file that handles `createMarkup` RPC). Then revert the MarkupContent → string refactor.

## 21. Smoke runner fixes

Two real bugs in `scripts/smoke.sh` that took hours to find:

1. `sed -n '/^\[/,$p'` only captures the first line `[`, leaving the rest of the array for jq to fail on with `Unfinished JSON term at EOF`. **Replace with `awk '/^\[/,0'`** which captures from `[` to end-of-input.
2. `sed -n '/^{/,$p'` has the same issue for single objects. The fix was to **remove the grep entirely** since the noise filter already strips the SDK output and jq can handle the remaining JSON.

3. The `filter_huly_noise` shell function (added) is necessary because the SDK uses `console.log` for `Generate new SessionId`, `Connected to server:`, `findfull model`, etc. — these go to **stdout** (not stderr), so `2>/dev/null` doesn't suppress them. The `grep -vE` filter must explicitly skip them.
