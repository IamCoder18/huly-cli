# Commands — Tracker

Projects, issues, components, milestones, and issue templates — the
core tracker surface.

## Table of contents

- [project](#project)
- [issue](#issue)
- [component](#component)
- [milestone](#milestone)
- [issue-template](#issue-template)

---

## project

Tracker project operations.

```bash
huly project list [--limit N] [--offset N]
huly project get <ref>              # by identifier, name, or _id
huly project create --name X --identifier BACKEND [--description] [--private]
huly project update <ref> --set description="..."
huly project update <ref> --set description=null    # clear field
huly project update <ref> --set private=true
huly project delete <ref...> [--yes]
huly project statuses --project TSK
huly project target-preferences --project TSK
huly project target-preference upsert --project TSK --props key=value [--props ...]   # --props is repeatable
```

**Identifier rules:**

- Must be uppercase letters and digits only.
- 1–5 characters typical.
- Unique per workspace (CLI pre-checks for duplicates; this selfhost's
  server does not enforce uniqueness server-side).

**`--set` semantics:** Pass `key=value` to set, `key=null` to clear.
Anything else is left unchanged. See
[CLI behavior — Auto-coercion in `--set key=value`](../reference/cli-behavior.md#auto-coercion-in-set-keyvalue).

**Smart defaults on create** — see
[CLI behavior](../reference/cli-behavior.md#smart-defaults-values-the-cli-fills-for-you).

**Best practices & side effects:**

- `delete` is **destructive**: cascade-deletes all `Issue`, `Component`,
  `Milestone`, and `IssueTemplate` in the project (`OnProjectRemove`).
  Use `huly project get <ref> --json` first to inspect the project.
- The CLI does not expose **project-type** creation. (`status` and
  `task-type` creation are exposed — see
[Platform — issue-status](platform.md#project-type-task-type-issue-status)
and [task-type](platform.md#project-type-task-type-issue-status).)
  Custom space types and custom task types can only be applied to
  **new** projects — you cannot migrate an existing project to a
  different type.
- New projects are created with `ProjectType.classic = true` (Tracker
  default); Recruit/Lead space types set `classic: false`, which
  disables the issue/todo cascade automation. See
  [Platform behavior — Projects](../reference/platform-behavior.md#projects-components-milestones-templates).

---

## issue

Tracker issue operations — the most-used surface.

```bash
huly issue list [--project TSK] [--status <name>] [--status-category Active]
                [--assignee <email>] [--label bug] [--parent <ref>|null]
                [--description-search <q>] [--limit N] [--offset N]

huly issue get <ref> [--markdown]   # by prefixed (TSK-1), bare (1), or _id
huly issue create --project TSK --title "..." [--description] [--body <md>]
                  [--body-file <path>] [--status <name>] [--priority <p>]
                  [--assignee <email>] [--label bug --label auth]
                  [--due 2026-07-01T14:00:00Z] [--parent <ref>]
                  [--task-type <name>]
huly issue update <ref> --title "..."  # any combination of updatable fields
huly issue delete <ref...> [--yes]
huly issue preview-delete <ref...>     # show what delete would affect

huly issue label <ref> add --label <name>
huly issue label <ref> remove --label <name>

huly issue relation <ref> add --type <t> --target <ref>      # type: blocks|isBlockedBy|relatesTo
huly issue relation <ref> remove --type <t> --target <ref>
huly issue relation <ref> list

huly issue link-document <ref> --document <docRef>
huly issue unlink-document <ref> --document <docRef>

huly issue move <ref> --parent <parentRef>      # set parent
huly issue move <ref> --parent null             # clear parent

huly issue related-targets --project TSK
huly issue related-target set --project TSK --source <ref> --target <ref>
```

**Status categories:** `UnStarted | ToDo | Active | Won | Lost`. Used by
the kanban-style status filters.

**Priorities:** `Urgent | High | Normal | Low | None`. Server-side enum;
the CLI auto-matches case-insensitively.

**Body format:** Markdown. Stored as prosemirror-JSON markup via
`client.markup.uploadMarkup`. The blob ref is stored in the issue's
`description` field; the ydoc is created lazily on first read/edit.

**`--markdown` on get:** returns the body as rendered Markdown. For
CLI-created documents (which store prosemirror-JSON markup) this works
correctly. For web-UI-created documents with embed / mention nodes,
the markdown conversion may produce partial output; the CLI warns to
stderr if it falls back to raw prosemirror-JSON. Use `--raw-markup`
to dump the stored prosemirror-JSON blob directly.

**Best practices & side effects:** assigning an issue or changing its
status may auto-create, auto-close, or auto-rollback attached
`ProjectToDo`s and auto-advance the issue's status when the first
`WorkSlot` starts (classic projects only). See
[Platform behavior — Issues & ToDos](../reference/platform-behavior.md#issues-todos-the-cascade-everyone-hits)
for the full cascade table. To inspect side effects after a
mutation, use `huly action list --issue <ref>` and
`huly issue get <ref> --json`.

**Move semantics:** the platform does not let you change an issue's
`space` (project) after creation. `huly issue move <ref> --parent
<ref|null>` re-parents inside the same project only. To "move" issues
between projects, see the [Copy issues between projects](../guides/workflows.md#migration-copy-issues-between-projects)
workflow.

---

## component

```bash
huly component list --project TSK
huly component get <ref>
huly component create --project TSK --label "Backend"
huly component update <ref> --label "New Name"
huly component delete <ref...> [--yes]
```

**Best practices & side effects:** `delete` cascades — every issue
that has this component gets `component: null` set automatically
(orphans are detached, not deleted). See
[Platform behavior — Projects](../reference/platform-behavior.md#projects-components-milestones-templates).

---

## milestone

```bash
huly milestone list --project TSK
huly milestone get <ref>
huly milestone create --project TSK --label "v1.0" [--target-date 2026-08-01] [--description <text>]
huly milestone update <ref> [--label <name>] [--description <text>] [--target-date 2026-08-15] [--status <s>]
huly milestone delete <ref...> [--yes]
```

**Best practices & side effects:** milestones are project-locked; you
cannot transfer a milestone to another project after creation.
`delete` cascades — all issues referencing the milestone get
`milestone: null`.

---

## issue-template

```bash
huly issue-template list --project TSK
huly issue-template get <ref>
huly issue-template create --project TSK --title "Bug template"
huly issue-template update <ref> --title "..."
huly issue-template delete <ref...> [--yes]
huly issue-template add-child <templateRef> --child <childRef>    # template refs can include other templates
huly issue-template remove-child <templateRef> --child <childRef>
```
