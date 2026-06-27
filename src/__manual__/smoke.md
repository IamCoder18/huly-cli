# Manual smoke test plan

Goal: verify each command path works end-to-end with **no leftover data**. Every create is paired with a delete.

Run a single phase with `./scripts/smoke.sh <phase>` or all phases with `./scripts/smoke.sh all`.

## Setup

```bash
export HULY_URL=https://huly.aaravlabs.com
export HULY_EMAIL=you@aaravlabs.com
export HULY_PASSWORD=...
export HULY_WORKSPACE=<your-workspace-url>
export HULY_PROJECT=<your-tracker-project-identifier>
```

`HULY_NONINTERACTIVE=1` is recommended for CI smoke runs.

## Phase 0 — Foundation

```bash
huly login --headless
huly whoami --json
huly workspace list
huly project list
huly issue list
huly card list
huly document list
huly calendar list
```

Cleanup: none (read-only).

## Phase 1 — Auth & Workspace

```bash
# workspace create (then immediately delete)
PID=$(huly workspace create --name "smoke-ws-$(date +%s)" --json | jq -r '._id')
huly workspace members
huly workspace delete "$PID" --yes
```

Cleanup: `huly workspace list | grep smoke-ws` returns 0.

## Phase 2 — Projects depth

```bash
PID=$(huly project create --name "smoke-prj" --identifier "SMK$(date +%s)" --json | jq -r '._id')
huly project get "$PID"
huly project statuses --project "$PID"
huly project target-preferences --project "$PID"
huly project update "$PID" --set description=smoke
huly project delete "$PID" --yes
```

Cleanup: `huly project list --json | jq '[.[] | select(.name=="smoke-prj")] | length'` = 0.

## Phase 3 — Issues sub-surfaces

```bash
huly component create --project <pick> --label "smoke-comp"
huly milestone create --project <pick> --label "smoke-ms" --target-date 2027-01-01
huly issue-template create --project <pick> --title "smoke-tmpl"
huly issue label <issue-ref> add --label bug
huly issue relation <issue-ref> add --type blocks --target <other-issue-ref>
huly issue move <issue-ref> --parent null
```

Cleanup: per-resource list filters return 0.

## Phase 4 — Issues depth

```bash
huly issue list --project <pick> --status-category Active
huly issue list --project <pick> --description-search smoke
huly issue create --project <pick> --title "smoke-task-type" --task-type Task
```

Cleanup: `huly issue list --project <pick> --json | jq '[.[] | select(.title | test("smoke"))] | length'` = 0.

## Phase 5 — Comments

```bash
huly comment add --issue <issue-ref> --body "smoke comment"
huly comment list --issue <issue-ref>
```

Cleanup: `huly comment list --issue <issue-ref> --json | jq '[.[] | select(.message | test("smoke"))] | length'` = 0.

## Phase 6 — Documents depth

```bash
huly teamspace list
DID=$(huly document create --teamspace <ref> --title "smoke-doc" --body "hi" --json | jq -r '._id')
huly document update "$DID" --body "updated body"
huly document snapshots "$DID"
huly document inline-comments "$DID"
huly document delete "$DID" --yes
```

Cleanup: `huly document list --json | jq '[.[] | select(.title=="smoke-doc")] | length'` = 0.

## Phase 7 — Channels CRUD

```bash
CID=$(huly channel create --name "smoke-chn-$(date +%s)" --json | jq -r '._id')
huly channel members --channel "$CID"
huly channel archive --channel "$CID"
huly channel unarchive --channel "$CID"
huly channel delete "$CID" --yes
```

Cleanup: `huly channel list --json | jq '[.[] | select(.name | test("smoke-chn"))] | length'` = 0.

## Phase 8 — Channels messages + DMs

```bash
huly channel message send --channel <ref> --message "smoke msg"
huly dm create --person <email>
huly thread list --target <message-id>
```

Cleanup: message-listing filters return 0.

## Phase 9 — Calendar depth

```bash
huly calendar calendars
huly schedule list
EID=$(huly calendar recurring create --title "smoke-rec" --start 2027-01-01T10:00:00Z --duration 60 --rrule "FREQ=DAILY;COUNT=3" --json | jq -r '._id')
huly calendar recurring-instances "$EID"
huly calendar delete "$EID" --yes
```

Cleanup: calendar list returns 0 smoke entries.

## Phase 10 — Time tracking

```bash
huly time log --issue <ref> --minutes 15 --description "smoke time"
huly time report <ref>
huly time timer start --issue <ref>
huly time timer stop --issue <ref>
```

Cleanup: `huly time entries --json | jq '[.[] | select(.description | test("smoke time"))] | length'` = 0.

## Phase 11 — Associations, Spaces, Task Management

```bash
huly space list
huly space-type list
huly project-type list
huly task-type list --project-type <ref>
huly issue-status create --project-type <ref> --task-type <ref> --name smoke-status --category ToDo
huly association create --source <a> --target <b>
```

Cleanup: per-resource filters return 0.

## Phase 12 — Cards (Card module)

```bash
huly card-space list
huly master-tag list --card-space <ref>
CID=$(huly card create --space <ref> --master-tag <ref> --title "smoke-card" --json | jq -r '._id')
huly card get "$CID" --markdown
huly card delete "$CID" --yes
```

Cleanup: `huly card list --json | jq '[.[] | select(.title=="smoke-card")] | length'` = 0.

## Phase 13 — Planner (action item)

```bash
AID=$(huly action create --title "smoke-action" --json | jq -r '._id')
huly action complete "$AID"
huly action reopen "$AID"
huly action schedule "$AID" --start 2027-01-01T10:00:00Z --duration 60
huly action delete "$AID" --yes
```

Cleanup: action list returns 0 smoke entries.

## Phase 14 — Activity

```bash
huly activity list --target <ref>
huly activity filters
huly activity references --target <ref>
huly activity mentions
```

Cleanup: none (read-only against live data).

## Phase 15 — Notifications

```bash
huly notification list
huly notification unread-count
huly notification providers
huly notification settings
```

Cleanup: none (read-only).

## Phase 16 — Approvals

```bash
huly approval list
AID=$(huly approval request --attached-to <ref> --request <people> --tx '{}' --json | jq -r '._id')
huly approval approve "$AID" --comment "smoke ok"
```

Cleanup: `huly approval list --json | jq '[.[] | select(.status=="Approved")] | length'` decreases as expected.

## Phases 17–18 — Docs + final polish

Build the comprehensive README, expand smoke.md with full coverage, then run `./scripts/smoke.sh all` end-to-end with `HULY_NONINTERACTIVE=0` and `=1`.

## Final cleanup assertion

```bash
huly issue list --project <pick> --json | jq '[.[] | select(.title | test("smoke|dry|ref-resolve"))] | length'
# Expect: 0
```
