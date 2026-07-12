# Platform behavior

Server-side cascades, triggers, permissions, and integrations. The
Huly server runs server-side triggers on most transactions, so a
single CLI command can cascade into side effects the user did not
explicitly request — auto-created `ProjectToDo`s, inbox notifications,
parent-estimate recomputations, cascade-deletes, and more. The CLI
is a thin wrapper over the SDK, so these behaviors apply equally
whether the action came from the CLI, the web UI, or an integration.

> **Gating:** many tracker / todo behaviors below only fire for
> projects whose `ProjectType.classic` is `true`. Default Tracker
> projects are classic; Recruit and Lead projects are not. There is
> no per-workspace toggle.

## Table of contents

- [Issues & ToDos (the cascade everyone hits)](#issues-todos-the-cascade-everyone-hits)
- [Tasks (action / Planner ToDos)](#tasks-action-planner-todos)
- [Projects, components, milestones, templates](#projects-components-milestones-templates)
- [Chat, channels, DMs, threads, comments](#chat-channels-dms-threads-comments)
- [Documents, controlled documents, training](#documents-controlled-documents-training)
- [Cards & types](#cards-types)
- [People, employees, contacts](#people-employees-contacts)
- [Notifications & inbox](#notifications-inbox)
- [Integrations](#integrations)
- [Roles & permissions](#roles-permissions-relevant-to-cli-scripting)
- [Calendar & recurring events](#calendar-recurring-events)
- [Search and indexing](#search-and-indexing)
- [Locking, audit, soft-delete](#locking-audit-soft-delete)
- [Cards & knowledge management (deep)](#cards-knowledge-management-deep)

---

## Issues & ToDos (the cascade everyone hits)

| User action (CLI) | Server-side side effect |
|---|---|
| `huly issue create --assignee <email>` (in a classic project, status `Todo`/`In Progress`) | Auto-creates a `ProjectToDo` for the assignee; sends inbox notification. |
| `huly issue create --assignee <email>` (status `Backlog` / `Done` / `Canceled`) | No auto-todo. Status must be `Todo` or `In Progress` (status **category**, not name). |
| `huly issue update <ref> --assignee <email>` (assignee changes) | Closes all open `ProjectToDo`s on the issue (`doneOn = now`), then creates a new `ProjectToDo` for the new assignee. |
| `huly issue update <ref> --status <name>` moving to `Done` / `Canceled` | All open `ProjectToDo`s on the issue are marked done. |
| `huly issue update <ref> --status <name>` moving to `Todo` / `In Progress` + assignee set + no todos exist | Creates the first `ProjectToDo`. |
| `huly action delete <ref>` (when this is the last open todo on its issue) | Issue status auto-rolls back to the previous un-started status in the workflow. |
| `huly action schedule <ref>` (first `WorkSlot` on a todo whose issue is `Backlog` / `Todo`) | Issue status auto-advances to the next `Active` status. |
| `huly action complete <ref>` (completing the last open todo) | May auto-advance the issue status past the last `Active` state (driven by `IssueToDoDone` mixin on classic projects). |
| `huly time report ...` (logging time on an issue with a parent) | Updates `reportedTime` / `remainingTime` on the issue **and walks up to parents** automatically (`OnIssueUpdate` recomputes the chain). |
| `huly issue update <ref> --title ...` | Propagates the new title into `parentTitle` on every sub-issue's `parents[]`. |
| `huly issue move <ref> --parent ...` | Rewrites the issue's `parents[]` chain; recomputes parent `childInfo`. |
| `huly issue create --parent <ref>` | The new issue inherits the parent's space and appears under it. |

---

## Tasks (action / Planner ToDos)

| User action | Side effect |
|---|---|
| `huly action create --attached-to <issueRef> --attached-to-class tracker:class:Issue` | Attaches to **one** parent only. Unlike server-auto-created todos (which use `createTxCollectionCUD` and live in both the issue's `todos` collection and `time.space.ToDos`), a CLI-created todo is a single-parent doc — it appears under the issue but **not** in the assignee's personal todo list unless you also `--owner <email>` and omit `--attached-to`. There is currently no CLI flag to mimic the dual-parent shape. |
| `huly action update <ref> --title / --description / --visibility` | Mirrors the change to all `WorkSlot`s of that todo (`OnToDoUpdate`). |
| `huly action complete <ref>` | Removes / crops future `WorkSlot`s; on an attached issue, may auto-advance status (`OnToDoUpdate` → `IssueToDoDone`). |
| `huly action delete <ref>` | Triggers `OnToDoRemove`. If it was the last open todo on an issue, the issue's status rolls back. |
| `huly action schedule <ref> --start ... --duration ...` | Creates a `WorkSlot` (`OnWorkSlotCreate`). The first `WorkSlot` on an issue-attached todo can auto-advance the issue's status. The todo's `visibility` change mirrors to the `WorkSlot` (`OnWorkSlotUpdate`). |
| `huly action unschedule <ref>` | Removes `WorkSlot`s; if the todo had a status that was auto-advanced by `OnWorkSlotCreate`, the rollback only happens via `OnToDoRemove`. |

---

## Projects, components, milestones, templates

| User action | Side effect |
|---|---|
| `huly project delete <ref>` | Cascade-deletes **all** `Issue`, `Component`, `Milestone`, `IssueTemplate` in the project; sets broadcast target filter to drop notifications (`OnProjectRemove`). |
| `huly component delete <ref>` | Every issue with that component gets `component: null` (orphans are detached, not deleted) (`OnComponentRemove`). |
| `huly project create --name X` | Identifier is auto-generated from the title and can be edited. Default space type is `Classic project`; default task type is `Issue` with states `Backlog` / `Todo` / `In Progress` / `Done` / `Canceled`. |
| `--auto-join` on a project / channel | Only **future** workspace members are added. Existing members are not retroactively added. |
| `huly issue-template` create / delete | Templates are project-scoped — usable only on issues in the project they were created in. |

---

## Chat, channels, DMs, threads, comments

| User action | Side effect |
|---|---|
| `huly channel message send` / `huly dm send` (alias for `dm message send`) / `huly thread add` | Auto-creates `ChatMessage`; sender + every `@`-mentioned person (parsed from the markup via `extractReferences`) are auto-added as `core.class.Collaborator` on the attached doc. On channel sends, the sender is auto-joined to the channel. Each collaborator and mention gets an inbox notification. |
| `huly comment add <issueRef> ...` | Issue comments are `ChatMessage`s stored in the issue's `comments` collection; same auto-collaborator + auto-notification rules apply. |
| `huly dm send --body "@alice ..."` | `@mention` resolves from workspace members by display name and creates a backlink; the recipient gets an inbox notification (subject to their notification prefs). |
| New workspace | `#general` and `#random` channels are auto-created; archiving them requires Spaces Admin. |
| `huly channel archive` | Allowed only for the owner/creator of the channel; for the auto-created system channels (`#general` / `#random`), Spaces Admin or Workspace Owner is required. |
| `huly channel update --private true` | Private channels still appear in the sidebar — users must request access. Use a group DM (not a channel) for hidden conversations. |
| `huly dm ...` "close conversation" | Hides from sidebar; message history is preserved. |
| Inline comments on issues / docs | **Not** linked to inbox notifications or chat; resolving an inline comment thread **deletes** all comments in it (cannot be undone). |

---

## Documents, controlled documents, training

| User action | Side effect |
|---|---|
| `huly document create` | Body is provided as Markdown (`--body` / `--body-file`) and converted by the CLI into a prosemirror-JSON markup blob stored as a `MarkupRef` in MinIO; collaborative reads use the lazily-created y-doc. See [CLI architecture — Markup handling](../advanced/architecture.md#markup-handling) for the round-trip. |
| `huly document update --state effective` (ControlledDocument → `Effective`) | All older `Effective` versions of the same template are auto-archived; `DocumentMeta.title` is rewritten to `"<code> <title>"`; if the document has `documents.mixin.DocumentTraining` enabled, `training.class.TrainingRequest` is auto-created per trainee. |
| Edit a ControlledDocument after review | The document must be re-reviewed before it can be approved (`OnDocTitleChanged` / `OnDocHasBecomeEffective`). Inline comments must be resolved before approval. |
| Author / Reviewer / Approver e-signatures | Order is enforced: **Author must sign before Reviewer/Approver** can sign. |
| `huly document create` (first in a workspace) | A "Records" Drive is pre-created; metadata (code / prefix / category) is editable only during the initial draft phase. |
| `huly document update --transfer` | Requires archive rights on source + create rights on destination; doc must be in current product version. |
| Training assigned before being released | Blocked — must `Release` the training first. |
| Trainee exhausts max attempts | No auto-retry; a new `TrainingRequest` must be issued. |

---

## Cards & types

| User action | Side effect |
|---|---|
| Add an attribute to one card of a Type/Tag | The field is added to **all existing cards** of that Type or Tag (`OnCardTag` mixin). |
| Define a Relation between Types A ↔ B | Bi-directional: shows up on both A and B cards automatically. |
| Define a Reference (not Relation) | One-directional on A; usable as sort/filter criterion; cannot be made back-link later. |
| Delete a Card Type | Cascade-deletes **all** cards of that Type — cannot be undone. |
| Delete the `File` Type | Refused (system type). |
| Upload a file to a File Card | The file is permanently attached — no delete. |
| Reparent a Card | Increments new parent's `children`, builds `parentInfo[]`, and **rolls back on cycle detection**. |
| Derive a Type from another | Sub-types auto-inherit all parent properties. |
| Save a filtered Card view | Can be Public (workspace-wide) or Private (only you). |

---

## People, employees, contacts

| User action | Side effect |
|---|---|
| Invite via invite link | New joiner is automatically added as `Employee` (`OnPersonCreate` → `OnEmployeeCreate`). |
| `huly user add <email>` (Employee creation) | Sends an invite email — user can only sign up with that email. |
| Deactivate / kick an Employee | Marks inactive, **retains the contact** for object integrity. Re-invite via "Resend Invite" rather than re-create. |
| Activate an Employee (`OnEmployeeCreate`) | Creates the user's private `PersonSpace`, auto-joins all `core.class.Space` with `autoJoin: true`, and (for `Owner` role) auto-assigns ownership of any `TypedSpace` / `CardSpace` with empty `owners`. Also auto-creates a default `Calendar` ("HULY"). |
| Activate an Employee (in HR-enabled workspaces) | Auto-adds `hr.mixin.Staff` with `department: Head`; walks the department hierarchy on `Staff.department` change. |
| GitHub integration collaborator | Auto-created as `Person` contact (no workspace access unless invited separately). |
| Merge Person + Employee | Combines into one record (use when same person joins from two paths). |
| Custom contact fields | Only `Contact` and `Task` classes are customizable. Supported types: URL, String, Boolean, Number, Date, Enum. Ref and Array are not yet implemented. |
| Hide vs Remove property | Hide keeps data; Remove deletes property and data. |

---

## Notifications & inbox

| User action | Side effect |
|---|---|
| Any `create` / `update` / `delete` via the CLI | Emits an `ActivityMessage` in the doc's `docUpdateMessages` and a collaborator inbox notification (`ActivityMessagesHandler`), unless the class has the `IgnoreActivity` mixin or is a `Card` with `serverCard.metadata.CommunicationEnabled`. |
| `@mention` someone in chat or a doc | Auto-resolves to a `Person` ref, creates a backlink in the recipient's notifications, and the recipient gets an inbox notification subject to their per-provider prefs. |
| Telegram reply to a notification | Appears in Huly as a thread reply in the originating message. |
| Per-thread unsubscribe (three-dot → unsubscribe) | Only available in the web UI; not currently exposed via the CLI. |
| Hover-peek in inbox | Lets you preview without marking the message Read. |
| Delete a `ChatMessage` | Removes all `InboxNotification` rows whose `attachedTo` points at it (no dangling notifications). |
| Web-push | Sends to recipient's `PushSubscription`s only when `serverNotification.metadata.WebPushUrl` is configured server-side. |

---

## Integrations

| Integration | Behavior |
|---|---|
| GitHub linked repo | Issues/comments/PRs sync bidirectionally; "Create issue without GitHub" override creates a Huly-only issue. |
| Gmail connected | Past emails with each contact back-fill onto the contact page on first connect. |
| Telegram | Multi-workspace requires `/sync_all_channels` in the bot menu; replies to notifications become thread replies in Huly. |
| Google Calendar sync | Pre-sync Huly events don't retroactively push to Google; visibility maps (`Public` ↔ `Visible to everyone`, `Private` ↔ `Only visible to you`). Disconnecting Google does not delete already-synced events. |
| Recording in a meeting | Auto-saves to Drive, visible to anyone with Drive access. |
| Live transcription (Hulia) | Currently workspace-wide visibility; privacy hardening planned. |
| `PublicLink` create with empty `url` | Server auto-fills `url` with a signed JWT — no CLI action needed. |

---

## Roles & permissions (relevant to CLI scripting)

| Role | CLI-relevant limits |
|---|---|
| `OWNER` | Required for `workspace delete`, `member`, `rename`, `guests`, `access-link`. Only OWNER/Maintainer can create spaces, projects, or manage task types. |
| `MAINTAINER` | Cannot delete the workspace, remove owners, or change their own role. |
| `GUEST` | Limited to spaces explicitly flagged as `Guest`-accessible; can only create/update/delete in those. |
| `READONLY` | All write attempts rejected. |
| `Spaces Admin` | Can archive system channels (`#general` / `#random`). |
| TraceX roles | `Qualified User`, `Manager`, `QARA` for controlled-document workflows. |
| Private space + `autoJoin` | New workspace members auto-added regardless of explicit member list. |
| Read-only guest | A magic UUID (`83bbed9a-0867-4851-be32-31d49d1d42ce`) represents the global read-only guest. When `workspace guests --read-only true` is set, all workspace members get re-granted to this identity; their notifications are force-read; sessions get `data.connection.readOnly = true`. |
| Per-space `Permission` records | Every TxCUD is checked against the space type's `Permission` matrix. There is no global role override; granting rights is per-space. |
| Disabling RBAC | Settings → General → disable RBAC for the whole workspace. Useful for scripting tests; do not leave enabled in production. |

---

## Calendar & recurring events

| Behavior | Notes |
|---|---|
| `--rrule` accepted on `huly calendar create` | iCalendar RRULE string (e.g. `FREQ=DAILY;COUNT=3`). Server coerces `BYDAY` / `BYMONTH` / `BYMONTHDAY` / `BYSETPOS` to numeric arrays. |
| Recurring exceptions (EXDATE) | **Not implemented.** The upstream class is misspelled `ReccuringEvent` in the SDK; it has no `exdates` field. Exception dates are silently ignored. There is no UI to skip a single occurrence. |
| Recurring instance model | Each instance is `RecurringInstance` (spelled `ReccuringInstance` in the SDK), carrying `recurringEventId` + `originalStartTime`. To list instances, query by `recurringEventId`. |
| `blockTime` defaults to false | Events don't block the user's calendar by default. Pass `--block-time` to set. |
| `visibility` mapping for Google sync | Google `transparency:transparent` ↔ Huly `visibility:freeBusy`; Huly `private` ↔ Google `private`. |
| Visibility levels | `public` (everyone sees title+time), `freeBusy` (only "Busy"), `private` (only you). Title is always shown to those with view rights. |
| `--time-zone` defaults to `UTC` | For recurring events, the RRULE is evaluated in the given TZ. Pass `--time-zone America/New_York` etc. |
| `WorkSlot` visibility mirrors to event | Changing `WorkSlot.visibility` mirrors back to the parent `ToDo` and derived calendar events. |

---

## Search and indexing

| Behavior | Notes |
|---|---|
| Full-text backend | Elasticsearch. `fulltextSummary` field is concatenated from markup text + all `isFullTextAttribute` fields + link preview metadata. |
| Searchable fields | Determined by `FullTextSearchContext` per class; default includes title, description, body. Custom attribute opt-in via `isFullTextAttribute: true`. |
| Operators | No Huly-specific DSL. ES `query_string` passes through: `AND`, `OR`, `NOT`, `+`, `-`, `"…"`, `*`, `~`, `field:value`. The CLI does not wrap queries. |
| Index cap | `fulltextSummary` capped at `textLimit` (~1 MB); huge bodies are truncated server-side. |
| Reindex | `fullReindex` workspace event triggers a clean rebuild (the CLI has no direct hook — you can call `huly ws` with `'[{"method":"triggerReindex","params":[…]}]'` if needed). |
| `domain: fulltext-blob` is excluded from backups | Transient; not restorable. |
| Indexing is per-workspace | Each workspace gets its own pipeline; queries are workspace-scoped. |

---

## Locking, audit, soft-delete

| Behavior | Notes |
|---|---|
| Concurrency model | Optimistic locking via `modifiedOn` / `modifiedBy`. No version counter. Last write wins. |
| Y-doc collaborative fields | Concurrent edits to rich text merge via Y.js CRDT (per-character). |
| Audit trail | The `tx` domain IS the audit log. Every `TxCreateDoc` / `TxUpdateDoc` / `TxRemoveDoc` / `TxMixin` is persisted with `modifiedBy` / `modifiedOn` / `objectId`. Query it with `huly ws findAll core.class.Tx --json` and filter by `objectId`. |
| Activity feed | User-visible summaries built from the tx stream by `ActivityMessagesHandler`. Excludes ActivityMessage / InboxNotification / DocNotifyContext. |
| Soft delete | `Card.removed:boolean`, `Project.archived`, `Vacancy.archived`, `Document.state ∈ {Deleted, Obsolete, Archived}`. Other entities are hard-deleted (`TxRemoveDoc`). |
| Workspace states | `pending-creation` → `creating` → `active`; `pending-upgrade` → `upgrading` → `active`; `pending-deletion` → `deleting`; `archiving-*` chain; `migration-*` chain; `pending-restore` → `restoring` → `active`. |
| `WS_OPERATION` env var (server-side) | `upgrade` (default) covers `pending-upgrade` (re-applies model-upgrade txs); `all` adds `pending-creation` + `pending-deletion`; `all+backup` adds archiving, migration, and `pending-restore`. For selfhost single-pod, set `all+backup` on the workspace pod. |
| Read-only guest data | The CLI's resolver cache is **client-scoped via a `WeakMap<PlatformClient, …>`**, so each connected workspace gets its own cache automatically and entries die with the connection. No cross-workspace data leakage. |

---

## Cards & knowledge management (deep)

| Behavior | Notes |
|---|---|
| Adding attribute to one Card | Adds to **every** Card of that Type or Tag (`OnCardTag`). Cannot be scoped. |
| Derived Type inheritance | Sub-types auto-inherit all parent properties; intermediate mixins apply automatically. |
| Tag application | Tag properties only appear after the Tag is applied; removing the Tag drops values. |
| Relation kinds | `1:1` / `1:N` / `N:N`. N:N is symmetric; 1:N has owner/child sides. Relations are bi-directional, References are not. |
| Reference vs Relation | Reference is a one-directional attribute, filterable and sortable. Relation is a separate `Relation` doc with cardinality rules. |
| Reproving Cards | Card Type can be re-assigned post-creation (re-organization without data loss). |
| Card hierarchy cycle detection | Reparenting a Card walks up the parent chain; cycles are detected and the tx is rolled back. |
| File Type undeletable | The default `File` MasterTag cannot be deleted; uploaded files on File-Cards are permanent. |
| Drive versioning | Re-uploading onto an existing file creates a new version automatically. All versions listed under the original. |
| Default Drive | Every new workspace ships with one Drive named `Records`. |
| Mermaid | Slash command → `Diagram`; valid MermaidJS auto-renders below editor. Press Delete to remove. |
| Drawing board | Slash command → `Drawing board`; multi-user real-time. Clear is irreversible. Scribble history tracks who drew what. |
| Backlinks | Paper-clip icon (top-right of doc) opens panel of every `@mention` pointing to the doc. |
| Notes on highlights | Highlight text → `Note` icon → color; persists as inline note. Re-highlight to edit. |
| Inline comments vs Activity comments | Inline comments are isolated to the doc/issue and DON'T notify. Resolving a thread **deletes all replies**. |
| Saved messages in chat | Bookmark any message → appears in `Saved` tab in Chat sidebar. |
| `[] ` action items in docs | Typing `[] ` at line start inserts a checkbox; assigning it creates a Planner todo + sends notification. |
