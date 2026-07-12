# Commands — Platform

Lower-level surfaces — spaces, types, relations, notifications, and
approvals. Most users reach for the high-level surfaces (tracker,
calendar, knowledge) first; these are for when you need to script
the platform primitives directly.

## Table of contents

- [space / space-type](#space-space-type)
- [association / relation](#association-relation)
- [project-type / task-type / issue-status](#project-type-task-type-issue-status)
- [notification](#notification)
- [approval](#approval)

---

<a id="space-space-type"></a>

## space / space-type

Core `Space` containers (typed buckets that hold issues, channels,
projects, etc.). Most workspaces expose this via tracker projects,
calendar calendars, and chunter channels — these commands target the
raw `space` documents.

```bash
huly space list [--type <id>] [--archived <bool>] [--private <bool>]
huly space get <ref>
huly space update <ref> [--name <n>] [--description <text>] [--private <bool>] [--archived <bool>]
huly space permissions <ref>
# `space members` is the management surface — the trio below take the
# required `--members <email...>` option:
huly space add-member    <ref> --members <email...>
huly space remove-member <ref> --members <email...>
huly space set-owners    <ref> --members <email...>
```

```bash
huly space-type list
huly space-type get <ref>
```

---

<a id="association-relation"></a>

## association / relation

Bi-directional associations between any two docs (A↔B). Underlying
primitive for relations of kind `N:N`.

```bash
huly association list [--a <ref>] [--b <ref>] [--a-class <id>] [--b-class <id>]
huly association create --a <ref> --b <ref> [--a-class <id>] [--b-class <id>]
huly association delete <ref...> [--yes]
```

Asymmetric relations (A→B with a parent side) — the underlying
primitive for `tracker:class:IssueRelation`. Prefer
`huly issue relation` for the high-level ergonomic interface.

```bash
huly relation list [--source <ref>] [--source-class <id>] [--target <ref>]
huly relation create --source <ref> --target <ref> \
                     [--source-class <id>] [--target-class <id>] [--name <n>]
huly relation delete <ref...> [--yes]
```

---

<a id="project-type-task-type-issue-status"></a>

## project-type / task-type / issue-status

Tracker project types (Classic, Recruit, Lead, …).

```bash
huly project-type list
huly project-type get <ref>
```

Task types used by projects (e.g. `Issue`, `Pull request`).

```bash
huly task-type list [--project-type <ref>]
huly task-type create --project-type <ref> --label <name> [--description <text>]
```

`--project-type` and `--label` are required.

Tracker issue statuses (the names appear in `huly issue status`
filters and `huly project statuses`).

```bash
huly issue-status create \
  --project-type <ref> \
  --name "Blocked" \
  --category Active \
  [--task-type <ref>] \
  [--description <text>] \
  [--rank <r>]
# alias: huly issue-statuses create ...
```

`--project-type`, `--name`, and `--category` are required.
`--category` accepts: `UnStarted | ToDo | Active | Won | Lost`.
`--task-type` defaults to the project type's default task type when
omitted.

---

## notification

Inbox notifications, contexts, providers, types, and per-target
subscribe state.

```bash
huly notification list [--read|--unread] [--archived <bool>] [--limit N]
huly notification get <ref>
huly notification mark-read <ref...>
huly notification mark-unread <ref...>
huly notification mark-all-read
huly notification archive <ref...>
huly notification unarchive <ref...>
huly notification archive-all
huly notification delete <ref...> [--yes]
huly notification unread-count
huly notification providers
huly notification types
huly notification contexts list
huly notification contexts get <ref>
huly notification contexts pin <ref> [--unpin]
huly notification contexts hide <ref> [--unhide]
huly notification subscribe --target <ref> [--target-class <id>]
huly notification unsubscribe --target <ref> [--target-class <id>]
huly notification settings list [--provider <ref>]
huly notification settings update --provider <ref> --type <ref> --enabled true|false
```

For the per-action notification rules (when a chat send fires an
inbox notif, when `@mentions` resolve, when a thread reply shows up),
see
[Platform behavior — Notifications & inbox](../reference/platform-behavior.md#notifications-inbox).

---

## approval

Approval requests attached to any target doc.

```bash
huly approval list [--status Active|Completed|Rejected|Cancelled] [--attached-to <ref>]
huly approval get <ref>
# Create an approval request (one or more approvers)
huly approval request \
  --attached-to <ref> \
  --requested <emails...> \
  [--attached-to-class <ref>] [--required-count <n>] [--tx <json>]
huly approval comment <ref> --body "..." [--decision approve|reject|comment]
# `--decision` is OPTIONAL. When omitted, the comment is a plain comment
# with no vote (same effect as `--decision comment`). The CLI accepts
# `--decision comment` to mirror the upstream enum verbatim, but the
# preferred form is to omit the flag entirely.
huly approval approve <ref> [--comment "..."]
huly approval reject <ref> --comment "..." [--rejected-tx <json>]
huly approval cancel <ref>           # requester only
huly approval delete <ref...> [--yes]
```
