# Projects, components, milestones, issue templates

The Tracker scaffolding around issues. Most of these are simple CRUD; the gotchas are around cascade-delete behavior and project-type migration constraints.

---

## Before you touch a project: confirm scope and identifier

```bash
huly whoami --json                   # which workspace
huly project list --json | jq -r '.[] | "\(.identifier)\t\(.name)"'
```

ALWAYS use the project's short `identifier` (e.g. `TSK`), not its UUID, in subsequent commands. Bare-digit issue refs (`huly issue get 1`) compose with `HULY_PROJECT` to form `TSK-1`.

---

## Project commands

### Discover

```bash
huly project list --json
huly project list --limit 50 --offset 0 --json     # in-memory slice
huly project get TSK --json                        # by identifier
huly project get "Q3 Initiative" --json            # by name
huly project get tracker:project:DefaultProject --json   # raw _id
huly project statuses --project TSK --json          # what's seedable
huly project target-preferences --project TSK --json
huly project target-preference upsert \
  --project TSK --props platform=gitlab --props tier=critical
```

The `target-preferences` are arbitrary key-value metadata on a project (e.g. an external system label). Use `upsert` to merge, not replace.

### Create

```bash
huly project create \
  --name "Q3 Initiative" \
  --identifier Q3I \
  --description "Q3 goals" \
  --private false \
  --yes
```

**Identifier rules:** uppercase letters and digits only, 1-5 chars typical. Unique per workspace. The CLI pre-checks for duplicates (`findAll({ identifier })` before create) — if found, returns the existing project's `_id` (idempotent). Selfhost's server does not enforce uniqueness, so this is a defense-in-depth check.

**Smart defaults you cannot skip:**
- `members: [<current-user>]` is injected (required by `SpaceSecurityMiddleware` so the creator can `findAll` their own project). `--minimal` does NOT drop this — it's security-critical.
- `sequence: 0` (incremented by `$inc` on every `huly issue create` to mint the next number).
- `archived: false`, `defaultTimeReportDay: 0`, `defaultAssignee: null`.

**Opinionated defaults (gated by `HULY_OPINIONATED`, default `1`):**
- `type: tracker:ids:ClassingProjectType` — pins the project to the classic tracker ProjectType so it participates in the issue↔action cascade (auto-create `ProjectToDo` on `--assignee`, status auto-advance/rollback on todo lifecycle). Note the server-side typo "Classing" (not "Classic") — preserved verbatim in the platform's model. Without this default, projects may be created without a `type` and miss the cascade. Disable with `--minimal` or `HULY_OPINIONATED=0`.

**`--minimal` / `HULY_OPINIONATED=0` skip:** `description`, `type` pin. **Do NOT skip:** `members` injection (security-critical), `sequence`, `defaultTimeReportDay`, `defaultAssignee` (schema-required).

**Returns:** `created project <name> <id>` or `project exists: <id>` (idempotent path).

### Update

```bash
huly project update TSK --description "New desc"
huly project update TSK --private true
huly project update TSK --set description="…" --set custom="…"    # auto-coerced
huly project update TSK --unset description
```

`--set key=value` auto-coercion: `null` clears, `true`/`false` boolean, numeric → `Number`, else `String`. Reserved keys (silently stripped): `set, unset, json, ci, markdown, dryRun, minimal, yes, workspace, url, defaultProjectIdentifier`.

### Delete (CATASTROPHIC — cascade-deletes every Issue, Component, Milestone, IssueTemplate in the project)

```bash
huly project delete TSK                          # single ref, no --yes required (still validates)
huly project delete TSK TSK2 --yes               # multiple, REQUIRED --yes
```

There is no `--dry-run` preview; you must `huly project get TSK --json` first to inspect what will be lost. The cascade is handled server-side by `OnProjectRemove`. No undo.

### Decision: can I migrate an existing project's type?

**No.** Custom space types and custom task types can ONLY be applied to **new** projects. If you need a Recruit/Lead project or a different task-type setup, create a new project and migrate the issues manually (copy + delete originals — see "Bulk-archive old issues safely" in SKILL.md).

---

## Components

```bash
huly component list --project TSK --json
huly component get Backend --json                 # by label
huly component create --project TSK --label "Backend" --description "…"
huly component update Backend --label "Backend v2"
huly component delete Backend
huly component delete Backend Web --yes           # multiple
```

**Cascade-on-delete:** `component delete` sets `component: null` on every issue that had it (orphans are DETACHED, not deleted). No preview, no confirmation prompt for single delete.

---

## Milestones

```bash
huly milestone list --project TSK --json
huly milestone get "v1.0" --json
huly milestone create --project TSK --label "v1.0" \
                       --target-date 2026-09-30 --description "…"
huly milestone update "v1.0" --target-date 2026-10-15
huly milestone delete "v1.0"
```

**Smart defaults:**
- `status: 'planned'` (raw string, NO state-machine validation client-side)
- `targetDate: Date.now() + 30 days` if `--target-date` omitted
- `description: ''` if omitted
- `comments: 0`

**Locked to project:** you cannot transfer a milestone between projects after creation. Delete and recreate.

**Cascade:** `milestone delete` sets `milestone: null` on every issue referencing it (orphans are detached, not deleted).

---

## Issue templates

```bash
huly issue-template list --project TSK --json
huly issue-template get "Bug template" --json
huly issue-template create --project TSK --title "Bug template" --body "Steps to reproduce: …"
huly issue-template update "Bug template" --body "Steps to reproduce (revised): …"
huly issue-template delete "Bug template"
huly issue-template add-child "Epic template" "Story template"
huly issue-template remove-child "Epic template" "Story template"
```

**`children[]`** stores entries as `{ id }` (NOT `{ _id }` like most relation arrays). Templates are project-scoped — usable only on issues in the project they were created in.

---

## Related-target config (per-project)

```bash
huly issue related-targets --project TSK --json
huly issue related-target set --project TSK --source "Tracker issue" --target "Pull request"
```

`RelatedIssueTarget` is a per-project configuration doc holding `{source, target}` **strings** that describe which issue types a project's issues can be related to. NOT actual relations.

---

## Common task recipes

### Bootstrap a project from scratch

```bash
# 1. Create
huly project create --name "Q3 Initiative" --identifier Q3I --description "Q3 goals" --yes

# 2. Verify default statuses (often already seeded)
huly project statuses --project Q3I --json | jq -r '.[].name'

# 3. Components (optional)
huly component create --project Q3I --label "API"
huly component create --project Q3I --label "Web"

# 4. Milestones (optional)
huly milestone create --project Q3I --label "v1.0" --target-date 2026-09-30

# 5. First issue
huly issue create --project Q3I --title "Set up CI pipeline" \
  --priority High --assignee alice@example.com --label backend
```

### Check whether a project is "classic" (enables the issue↔action cascade)

```bash
# Get the project's project-type ref from the project doc
huly project get TSK --json | jq '.type'
# Then:
huly project-type get <type-ref> --json | jq '.classic'
# "classic": true → cascades fire.
# "classic": false (Recruit/Lead) → no auto-todo creation/closure on status changes.
```

There is NO CLI command to change `ProjectType.classic` post-creation. The value is set when the ProjectType is created.

### Find orphan issues (issues whose parent was deleted)

```bash
# parents[] may contain refs that no longer resolve
huly issue list --json | jq -r '.[] | select(.parent != null) | ._id'
# Then for each candidate:
huly issue get <ref> --json | jq '.parents'
```

### Audit a project's recent activity

```bash
# Audit trail: tx log for a project over a date range
huly ws findAll '["core:class:Tx",{"space":"<project-space-id>","modifiedOn":{"$gte":<ms>}}]' \
  --json | jq '[.[] | {by: .modifiedBy, on: .modifiedOn, objectId, ops: .attributes}]'
```

---

## Gotchas

- **Identifier uniqueness:** the CLI pre-checks but the server doesn't (on selfhost). If you bypass the CLI and POST a duplicate identifier via `huly ws createDoc`, you'll get two projects with the same identifier — the resolver will pick the first one alphabetically.
- **`project delete` has NO preview**, unlike `issue preview-delete`. Inspect with `huly project get <ref> --json` first and confirm counts.
- **`component delete`** is reversible-ish: orphans get `component: null` (detached, not deleted). You can manually reassign by listing and updating.
- **`milestone --status`** stores raw strings. The CLI doesn't enforce a state machine; the platform may reject invalid statuses at update time. Verify with `huly milestone get --json` if unsure.
- **`issue-template --body` vs `--description`:** like issue, body takes precedence. They are NOT mutually exclusive at the resource level — but empty `description` with `--body` works fine.
- **`issue-template add-child`** uses `{ id }` in `children[]`, but other trackers' relations usually use `{ _id }`. Don't apply cross-template patterns blindly.
- **`project create --sequence 0`** is automatic. Don't try to override it; the issue-number minting depends on it.
- **`project create --members <emails>` does NOT exist.** The CLI auto-injects the current user as `members[0]`. There is no flag to override. If you want additional members, use `huly workspace members --role Admin` for global or `huly space add-member` for per-space (on channels / DMs).
- **`--minimal` and `--description`:** with opinionated defaults ON (default), `project create` stores `description: ''` (empty string) when `--description` is omitted. With `--minimal` / `HULY_OPINIONATED=0`, an *omitted* `--description` is omitted from the create payload entirely; an *explicit* `--description ''` is still preserved verbatim. So if a downstream consumer distinguishes "missing" from "empty", pass `--description ''` explicitly when running with `--minimal`.
- **Custom space types are only available on NEW projects.** Create a new project if you need to change the type.

---

## Migration: copying issues between projects (the SDK has no cross-project move)

```bash
set -e
SOURCE=Q3-2025
DEST=Q3-2026
IDS=$(huly issue list --project "$SOURCE" --json | jq -r '.[]._id')
for id in $IDS; do
  issue=$(huly issue get "$id" --json)
  title=$(jq -r .title <<<"$issue")
  prio=$(jq -r .priority <<<"$issue")
  asg=$(jq -r '.assignee // empty' <<<"$issue")
  huly issue create --project "$DEST" --title "$title" \
                     --priority "$prio" \
                     ${asg:+--assignee "$asg"} --yes
done
# Delete originals after verifying copies:
# for id in $IDS; do huly issue delete "$id" --yes; done
```

Comments, time entries, sub-issues, and labels do NOT carry over with this recipe. For richer migration, write a script that fetches each issue with `comments` / `subIssues` / `labels` and reconstructs them.
