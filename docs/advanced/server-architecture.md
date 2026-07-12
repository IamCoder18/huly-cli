---
title: Server architecture (deep dive)
description: How huly-cli talks to the Huly server — services, database, transactions, backups, and upgrades for self-hosted workspaces.
---

# Server architecture (deep dive)

How the CLI interacts with the Huly server. Useful for debugging,
performance tuning, writing automation, and selfhost ops. For how
the CLI itself is wired together internally, see
[CLI architecture](architecture.md).

## Table of contents

- [Service map](#service-map)
- [Database layout (cockroach)](#database-layout-cockroach)
- [The model — class hierarchy and domain model](#the-model-class-hierarchy-and-domain-model)
- [Workspace lifecycle](#workspace-lifecycle)
- [The WebSocket protocol](#the-websocket-protocol)
- [Transaction model](#transaction-model)
- [Markup and y-docs](#markup-and-y-docs)
- [Account-server permission model](#account-server-permission-model)
- [Model-upgrade queue](#model-upgrade-queue)
- [The `dataId` quirk](#the-dataid-quirk)
- [Backup strategy](#backup-strategy)
- [Redpanda SASL bootstrap](#redpanda-sasl-bootstrap)
- [Workspace version sync](#workspace-version-sync)

---

## Service map

The selfhost has ~16 services. The CLI talks to **three** of them:

| Service | What the CLI does with it |
|---|---|
| `account` (port 3000) | Login, workspace ops, account token management |
| `transactor` (port 3333) | WebSocket RPC: `findAll`, `findOne`, `createDoc`, `updateDoc`, `tx`, `loadModel` |
| `collaborator` (port 3078) | Read path only: `fetchMarkup`, `getContent`. The CLI's read timeout (5s) covers this. |

The CLI never talks to `workspace`, `kvs`, `minio`, `redpanda`,
`elastic`, `cockroach`, or `front` directly. Those are server-internal.

---

## Database layout (cockroach)

CockroachDB holds everything. Two schemas per workspace:

**`defaultdb` (the account DB)** — global across the cluster:

- `global_account.workspace` — `uuid`, `name`, `dataId` (the
  workspace's DB name)
- `global_account.workspace_status` — mode, `is_disabled`,
  `processing_attempts`, `version_*`
- `global_account.workspace_members` — (`account_uuid`,
  `workspace_uuid`, `role`)
- `global_account.account`, `global_account.person`,
  `global_account.social_id`
- `global_account.region`, `global_account.invite`, etc.

**Per-workspace DB** (named after `workspace.dataId`):

- `public.tx` — the transaction log (every CUD as
  `TxCreateDoc`/`TxUpdateDoc`/`TxRemoveDoc`)
- `public.tracker` — `Project`, `Issue`, `Component`, `Milestone`,
  `IssueStatus`, etc.
- `public.document` — `Document`, `DocumentSnapshot`
- `public.calendar` — `Calendar`, `Event`, `Schedule`
- `public.chunter` — `Channel`, `ChatMessage`
- `public.time` — `ToDo`, `WorkSlot`
- `public.card` — `Card`, `CardSpace`, `MasterTag`
- `public.contact` — `Person`
- `public.config` — workspace config

To inspect a workspace's data directly:

```bash
docker exec -e PGPASSWORD=$CR_USER_PASSWORD huly_v7-cockroach-1 \
  /cockroach/cockroach sql --insecure -d defaultdb -u selfhost \
  -e "SELECT * FROM global_account.workspace_members LIMIT 5"
```

Use cockroach root (cert-based) for full access:

```bash
docker exec -u root huly_v7-cockroach-1 /cockroach/cockroach sql \
  --url 'postgresql://root@127.0.0.1:26257/defaultdb?sslcert=certs/client.root.crt&sslkey=certs/client.root.key&sslmode=verify-full&sslrootcert=certs/ca.crt'
```

---

## The model — class hierarchy and domain model

The Huly "model" is the sum of all classes registered in the
workspace. Classes are organized into **plugins** (`tracker`,
`calendar`, `chunter`, …). Each class has a **domain** (storage
bucket):

- `tracker` (`DOMAIN_TRACKER`): `Project`, `Issue`, `Component`,
  `Milestone`, `IssueStatus`, `IssueTemplate`, `TypeIssuePriority`,
  `TimeSpendReport`, `RelatedIssueTarget`
- `calendar` (`DOMAIN_CALENDAR`): `Calendar`, `Event`,
  `ReccuringEvent`, `ReccuringInstance`, `Schedule`
- `document` (`DOMAIN_DOCUMENT`): `Document`, `DocumentSnapshot`,
  `DocumentEmbedding`, `Teamspace`
- `chunter` (`DOMAIN_CHUNTER`): `Channel`, `ChatMessage`,
  `DirectMessage`, `Message`, `ThreadMessage`
- `time` (`DOMAIN_TIME`): `ToDo`, `WorkSlot`
- `card` (`DOMAIN_CARD`): `Card`, `CardSpace`, `MasterTag`
- `core` (`DOMAIN_MODEL`): `Type`, `Status`, `ArrOf`, `EmbValue`,
  and all base classes
- `contact` (`DOMAIN_CONTACT`): `Person`

The model's `findAll` behavior depends on the class's domain:

- `DOMAIN_MODEL` classes: query the local `ModelDb` (in-memory
  index).
- All other domains: query the server (via WebSocket).

---

## Workspace lifecycle

A workspace goes through these states (mode column):

```text
[created]      → pending-creation → creating → active
[upgraded]     → pending-upgrade → upgrading → active
[deleted]      → pending-deletion → deleting → [gone]
[archived]     → archiving-pending-backup → archiving-backup
                → archiving-pending-clean → archiving-clean → archived
[migrated]     → migration-pending-backup → migration-backup
                → migration-pending-cleanup → [deleted]
[restored]     → pending-restore → restoring → active
```

The workspace pod polls for pending workspaces and processes them.
`WS_OPERATION` env var controls which states the pod handles:

| `WS_OPERATION` value | Processes |
|---|---|
| `upgrade` (default) | only `pending-upgrade` (re-applies model-upgrade txs) |
| `all` | `pending-creation` + `pending-upgrade` + `pending-deletion` |
| `all+backup` | all of `all` + `migration-pending-*` + `archiving-pending-*` + `pending-restore` |

For self-hosted single-pod deployments, use `WS_OPERATION=all+backup`.

---

## The WebSocket protocol

The SDK connection speaks Huly's binary RPC protocol over WebSocket.
The CLI's raw `huly ws` escape hatch is a separate **text-JSON**
channel — the two are different transports to the transactor. Key
methods on the binary SDK side:

| Method | Direction | Purpose |
|---|---|---|
| `hello` | client → server | First message; identifies client (binary mode, compression) |
| `findAll` | client → server | Query; server returns array + total |
| `findOne` | client → server | Single-doc query |
| `loadModel` | client → server | Initial model load (returns txs since last hash) |
| `loadChunk` | client → server | Lazy-load a domain's documents |
| `tx` | client → server | Apply a transaction |
| `updateFromRemote` | server → client | Push a tx (server-initiated) |
| `ping` / `pong` | both | Keepalive |

Chunks are how the server streams large query results. The default
chunk size is whatever fits in a WebSocket frame (~64 KB compressed).

---

## Transaction model

Every write in Huly is a transaction (tx). A tx is one of:

- `TxCreateDoc` — new document.
- `TxUpdateDoc` — update document fields.
- `TxRemoveDoc` — delete document.
- `TxMixin` — attach/update a mixin.
- `TxApplyIf` — atomic tx group (commit-on-condition).

The CLI generates these via the SDK's `client.createDoc`,
`client.updateDoc`, etc. Each tx has:

- `_id` — tx UUID (generated client-side)
- `_class` — tx type class
- `space` — where the tx lives (`core:space:Tx`)
- `objectId` — the document being created/updated
- `objectClass` — the doc's class
- `objectSpace` — the doc's space
- `modifiedBy`, `modifiedOn` — actor + timestamp
- `attributes` — the create/update payload

The server applies txs in order, checking model consistency. A tx
can be rejected if:

- The `objectClass` doesn't exist in the model.
- A referenced object doesn't exist.
- The user lacks permission.
- The doc was deleted concurrently.

Rejected txs surface as `PlatformError`. The CLI surfaces these as
`CliError` (see [CLI behavior — Error messages](../reference/cli-behavior.md#error-messages-include-next-step-hints)).

---

## Markup and y-docs

For content-bearing fields (`description`, `body`, `content`), the
platform uses a **markup reference indirection**: the CLI's
`uploadMarkup` / `updateMarkup` helpers call the collaborator's RPCs
directly, producing a y-doc binary and a JSON prosemirror-markup
blob stored in MinIO. The doc field stores a `MarkupRef` pointing
at the blob instead of inline text. On read, `client.fetchMarkup(...)`
retrieves the blob, runs `markupToJSON` (prosemirror) and optionally
`markupToMarkdown`.

On `* create --body` the CLI calls both `uploadMarkup` (creates the
initial JSON blob) and lets the next `updateContent` create the
ydoc. On `* update --body` the CLI calls only `updateMarkup` (the
ydoc is the source of truth for collaborative reads; the JSON
blob is no longer uploaded per edit). For read commands,
`--markdown` requests markdown conversion and `--raw-markup` returns
the raw prosemirror-JSON string. See
[CLI architecture — Markup handling](architecture.md#markup-handling)
for the in-process pipeline.

---

## Account-server permission model

The account server gates every method by token type:

| Token type | `extra.service` | Granted methods |
|---|---|---|
| Login token (password / OAuth) | undefined | User-level methods only: `login`, `selectWorkspace`, `listWorkspaces`, `findPersonBySocialKey` (after Fix #1), `getWorkspaceInfo`, `getSocialIds`, etc. |
| Service token | `'tool' \| 'workspace' \| 'aibot' \| 'backup' \| 'payment' \| ...` | Service-level methods: `getPendingWorkspace`, `updateWorkspaceInfo`, etc. |
| Admin token | `admin === 'true'` | All methods |

The CLI uses login tokens. Service-to-service calls (e.g. the worker
calling `getPendingWorkspace`) use service tokens.

**Common pitfall:** calling a service-only method with a login
token returns Forbidden. Always use the right token type.

---

## Model-upgrade queue

When a workspace's `version_major/minor/patch` is less than the
server's current version, the workspace pod applies model-upgrade
txs:

1. Pod calls `getPendingWorkspace(this.region, this.version,
   'upgrade')`.
2. Account server returns workspaces where `version_* < current`.
3. Pod loads the model-upgrade txs from the platform's source tree.
4. Pod applies them in order.
5. Pod calls `updateWorkspaceInfo(workspace, 'upgrade-done',
   version)`.
6. Workspace's `version_*` is bumped, status becomes `active`.

The model-upgrade txs are auto-generated from the platform's
`@Model(...)` decorators in `~/platform/models/<m>/src/`. Each
plugin contributes a batch of class-creation txs.

---

## The `dataId` quirk

When you `createWorkspace`, the server assigns a `dataId` (a
cockroach DB name). All subsequent docs for this workspace go
into that DB.

**Bug:** if kafka replays a `workspace-deleted` event for a
workspace that was already hard-deleted (e.g. via direct SQL),
the worker re-creates the workspace row **without** a `dataId`.
Subsequent operations on this workspace fail because there's no
DB to write to.

**Workaround:** if you hard-delete via SQL, also delete the kafka
events for that workspace. Or just leave the workspace in
`pending-deletion` mode and let the worker process it eventually.

---

## Backup strategy

Backups are stored in the MinIO bucket `huly-backups`. The
CLI/server doesn't configure MinIO lifecycle, so backups
accumulate forever unless you set up ILM externally. **Before
running these commands in a real deployment, set non-default
credentials and rotate them** — the defaults below are examples
only:

```bash
# Configure MinIO credentials via env (NOT inline defaults in a real deploy)
export MC_HOST_local="http://${MINIO_USER}:${MINIO_PASSWORD}@localhost:9000"

docker exec huly_v7-minio-1 mc alias set local "$MC_HOST_local"
docker exec huly_v7-minio-1 mc mb --ignore-existing local/huly-backups
docker exec huly_v7-minio-1 mc ilm add local/huly-backups --expiry-days 14
```

This sets 14-day expiry on all backups. Adjust as needed for
compliance.

---

## Redpanda SASL bootstrap

The kafka broker (Redpanda) requires SASL auth. During initial
bootstrap, `rpk cluster info -X user=admin -X pass=...` returns
`ILLEGAL_SASL_STATE` because SASL isn't ready yet.

**Fix:** use an unauthenticated metadata probe:

```yaml
healthcheck:
  test: ['CMD-SHELL', 'rpk cluster info --brokers=localhost:9092 || exit 1']
  interval: 10s
  timeout: 5s
  retries: 20
  start_period: 30s
```

Then set `depends_on: { redpanda: { condition: service_healthy } }`
on every kafka-dependent service.

---

## Workspace version sync

The transactor and workspace pod must be at the same
**`MODEL_VERSION`** (derived from
`~/platform/common/scripts/version.txt`). If they drift, the
transactor's `sessionManager` rejects WebSocket connections:

```text
version mismatch: transactor 0.7.422 != workspace 0.7.423
```

**Fix:** keep `~/platform/common/scripts/version.txt` in sync
across builds. After bumping, rebuild all pods that consume the
version.

The CLI reads the version from `bundle.js` (the SDK). The server's
`hello` response includes `serverVersion`. The CLI logs
`Connected to server: <version>` on connect.
