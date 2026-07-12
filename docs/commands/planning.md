# Commands — Planning

Planner actions (todos), availability schedules, and time tracking.

## Table of contents

- [action](#action-planner-tasks-todos)
- [schedule](#schedule)
- [time](#time)

---

<a id="action-planner-tasks-todos"></a>

## action (Planner tasks / ToDos)

```bash
huly action list [--owner email@...] [--issue <ref>] [--title <q>]
                 [--priority High|Medium|Low|NoPriority|Urgent]
                 [--visibility public|busy|private]
                 [--due-from <iso>] [--due-to <iso>]
                 [--completed true|false|all] [--limit N] [--offset N]
huly action get <ref>
huly action create --title "..." [--description] [--body] [--body-file] \
                  [--due <iso>] [--priority <p>] \
                  [--owner email@...] [--attached-to <ref>] [--attached-to-class <class>]
huly action update <ref> [--title] [--description] [--body] [--body-file]
huly action complete <ref>       # sets doneOn=now
huly action reopen <ref>         # clears doneOn
huly action schedule <ref> --start <iso> --duration <minutes>     # creates a WorkSlot for the task
huly action unschedule <ref> [--slot-id <id>]                       # removes WorkSlots for the task
huly action delete <ref...> [--yes]
```

**`--completed` filter:** `true|false|all` (default `all`). `true` /
`false` match the value of `doneOn`; `all` returns both.

**Priority:** accepts any of `Urgent | High | Medium | Low |
NoPriority`. Match is case-insensitive. Unknown priorities throw a
**Validation** error (exit code 4).

**Best practices & side effects:**

- `--attached-to <ref>` + `--attached-to-class
  tracker:class:Issue` attaches the todo to one parent only. Unlike
  server-auto-created todos (which use `createTxCollectionCUD` and
  live under both the issue and `time.space.ToDos`), a CLI-created
  todo appears under the issue but **not** in the assignee's personal
  todo list. Use `--owner <email>` to additionally point `user` at a
  person, or omit `--attached-to` entirely to attach the todo to a
  `Person`.
- `complete` / `delete` may trigger issue status rollback or advance
  (when the todo is attached to an issue).
- `schedule` on a `Backlog`/`Todo` issue-attached todo can
  auto-advance the issue's status to the next `Active` state.

See
[Platform behavior — Tasks](../reference/platform-behavior.md#tasks-action-planner-todos)
for the full `OnToDoUpdate` / `OnToDoRemove` / `OnWorkSlotCreate`
chain. The cascade you almost always care about:

| What you do | What happens |
|---|---|
| `complete` last open todo on an issue | Issue may auto-advance past the last `Active` state. |
| `delete` last open todo on an issue | Issue rolls back to the previous un-started status. |
| `schedule` first `WorkSlot` on a `Backlog`/`Todo` issue | Issue auto-advances to the next `Active` status. |

---

## schedule

Calendar schedules (owner availability).

```bash
huly schedule list
huly schedule create --title <t> --owner <userUuid> --time-zone <tz> \
                     [--description <text>] [--duration 30] [--interval 15]
huly schedule update <ref> [--title] [--description] [--time-zone] [--duration] [--interval]
huly schedule delete <ref...> [--yes]
```

**`--owner`:** UUID of the account that owns the schedule (typically
the current user). Resolve via `huly user get --json | jq -r '._id'`.

Note: `--owner` does **not** have the substring fallback that
`--assignee` does — see
[CLI behavior — Ref resolution order](../reference/cli-behavior.md#ref-resolution-order-how-flag-values-resolve).

---

## time

Time tracking on issues.

```bash
huly time list [--issue <ref>] [--start <iso>] [--end <iso>] [--limit N] [--offset N]
huly time log --issue TSK-1 --minutes 30 --description "did thing"
huly time log --issue TSK-1 --hours 2 --description "pair programming"
huly time report <issueRef>                 # per-issue summary
huly time delete <entryRef...> [--yes]
```

> **Note:** `time report` takes a single positional issue ref.
> Earlier revisions of this README mistakenly documented
> `--from` / `--to` / `--user` / `--project` flags here, but the CLI
> never accepted them — the underlying SDK method is single-issue
> only. For workspace-wide or date-range aggregations, use
> `huly time list --json` and filter client-side, e.g.:
>
> ```bash
> huly time list --json | jq '[.[] | select(.date >= "2026-06-01")]'
> ```

**Best practices & side effects:** logging time on an issue updates
that issue's `reportedTime` and recomputes `remainingTime`. If the
issue has a parent, the change walks up the parent chain
automatically (`OnIssueUpdate`). There is no opt-out — script
accordingly.

The value passed to `--minutes` / `--hours` is rounded to the
nearest 15 minutes and stored as man-hours (`value = minutes/60`).
