---
title: Model surface
description: Huly class IDs and plugin-to-CLI mapping — the canonical reference for every model huly-cli touches in a self-hosted workspace.
---

# Model surface

Class IDs and plugin-to-CLI mapping. The CLI's canonical class IDs
live in `src/transport/identifiers.ts` — that's the reference for
escape-hatch use ([`huly ws findAll ...`](../advanced/escape-hatches.md#websocket-huly-ws)).

## Table of contents

- [Class ID reference](#class-id-reference)
<a id="plugin-cli-surface-map"></a>

- [Plugin / CLI surface map](#plugin-cli-surface-map)

---

## Class ID reference

The platform's class hierarchy. Used as `_class` in JSON, as class
IDs in escape-hatch calls, and as class filters in queries.

| Plugin | Class ID pattern | Examples |
|---|---|---|
| `core` | `core:class:*` | `Account`, `Space`, `Type`, `Doc`, `Obj` |
| `contact` | `contact:class:*` | `Person` |
| `tracker` | `tracker:class:*` | `Project`, `Issue`, `IssueStatus`, `Component`, `Milestone`, `IssueTemplate`, `TimeSpendReport`, `TypeIssuePriority` |
| `task` | `task:class:*` | `Task` |
| `board` | `board:class:*` | `Card` |
| `card` | `card:class:*` | `CardSpace`, `MasterTag` |
| `calendar` | `calendar:class:*` | `Event`, `ReccuringEvent`, `ReccuringInstance`, `Calendar`, `Schedule` |
| `document` | `document:class:*` | `Document`, `DocumentSnapshot`, `DocumentEmbedding`, `Teamspace` |
| `chunter` | `chunter:class:*` | `Channel`, `ChatMessage`, `DirectMessage`, `Message`, `ThreadMessage` |
| `time` | `time:class:*` | `ToDo`, `WorkSlot` |
| `notification` | `notification:class:*` | `Notification`, `NotificationContext`, `InboxNotification` (Phase 15 — not yet in CLI) |
| `activity` | `activity:class:*` | `ActivityMessage`, `Reaction`, `SavedMessage` (Phase 14 — not yet in CLI) |
| `approval` | `approval:class:*` | `ApprovalRequest`, `Approval` (Phase 16 — not yet in CLI) |

---

## Plugin / CLI surface map

For each plugin, what classes the CLI exposes and which are
read-only:

| Plugin | CLI surface | Read | Write |
|---|---|---|---|
| core | (used internally) | — | — |
| contact | `user` | `get`, `find` | — |
| tracker | `project`, `issue`, `component`, `milestone`, `issue-template`, `time` | All | All |
| task | `action` (alias for `todo`) | All | All |
| board | `card` | All | All |
| card | `card-space`, `master-tag` | All | `card-space` only (master-tags are read-only) |
| calendar | `calendar`, `schedule` | All | All |
| document | `document`, `teamspace` | All | All |
| chunter | `channel`, `dm`, `thread` | All | All |
| time | (used by `time` commands) | — | — |
| notification | (Phase 15 — not implemented) | — | — |
| activity | (Phase 14 — not implemented) | — | — |
| approval | (Phase 16 — not implemented) | — | — |
