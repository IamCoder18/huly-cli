# Workflows

End-to-end recipes that combine multiple commands. For per-command
syntax, see [Commands](../commands/).

## Table of contents

- [Bootstrap a new project](#bootstrap-a-new-project)
- [Bulk-archive old issues](#bulk-archive-old-issues)
- [Daily activity report](#daily-activity-report)
- [Migration: copy issues between projects](#migration-copy-issues-between-projects)
- [Find and fix orphan docs](#find-and-fix-orphan-docs)
- [Recipes (CI, standup, digest, audit, backup)](#recipes)

---

## Bootstrap a new project

```bash
# Create the project
huly project create --name "Q3 Initiative" --identifier Q3I --description "Q3 goals"

# Add statuses (web UI recommended — CLI doesn't expose status creation)
# Add components
huly component create --project Q3I --label "API"
huly component create --project Q3I --label "Web"

# Add milestones
huly milestone create --project Q3I --label "v1.0" --target-date 2026-09-30

# Create the first issue
huly issue create --project Q3I --title "Set up CI pipeline" --priority High \
                   --assignee alice@example.com --label backend
```

Default space type is `Classic project`; default task type is `Issue`
with states `Backlog`/`Todo`/`In Progress`/`Done`/`Canceled`. See
[Tracker — project](../commands/tracker.md#project) for full
semantics.

---

## Bulk-archive old issues

The CLI doesn't expose an `issue archive` operation. The script
below re-parents each `Won` issue to the top level so it sorts under
the project's "Done" view; it does **not** change status or delete
the issue. For workspaces with >1000 matching issues, paginate with
`--limit N --offset M` in batches.

```bash
huly issue list --status-category Won --limit 1000 --json \
  | jq -r '.[]._id' \
  | xargs -I{} huly issue move {} --parent null --yes
```

This re-parents every batch of up to 1000 `Won` issues to the top
level. Run again with `--offset 1000` for the next batch.

---

## Daily activity report

```bash
# Issues created today (issue list has no --since filter; use jq)
TODAY_MS=$(date -u -d 'today 00:00:00' +%s)000
huly issue list --limit 1000 --json | \
  jq -r --argjson t "$TODAY_MS" \
    '.[] | select(.createdOn >= $t) | "\(.identifier): \(.title)"'

# Time logged today (time list has --start/--end date filters)
huly time list --start "$(date -u +%Y-%m-%dT00:00:00Z)" --json --limit 1000
```

> **Tip:** `huly time report <issueRef>` is per-issue only. See
> [Planning — time](../commands/planning.md#time) for why, and how
> to do workspace-wide / date-range aggregations with `jq`.

---

## Migration: copy issues between projects

The Huly platform does not let you change an issue's `space`
(project) after creation — the SDK has no method for it. The CLI
exposes `huly issue move <ref> --parent <ref|null>` for re-parenting
**inside the same project** only. To "move" issues between projects,
copy them and delete the originals:

```bash
set -e
SOURCE=OLD
DEST=NEW
IDS=$(huly issue list --project "$SOURCE" --json | jq -r '.[]._id')
for id in $IDS; do
  issue=$(huly issue get "$id" --json)
  title=$(echo "$issue"   | jq -r .title)
  desc=$(echo "$issue"    | jq -r .description)
  prio=$(echo "$issue"    | jq -r .priority)
  asg=$(echo "$issue"     | jq -r '.assignee // empty')
  huly issue create --project "$DEST" --title "$title" \
                     --description "$desc" \
                     --priority "$prio" \
                     ${asg:+--assignee "$asg"} \
                     --yes
  echo "copied: $id"
done
# Then delete the originals in a second pass (after you verify the copies):
# for id in $IDS; do huly issue delete "$id" --yes; done
```

---

## Find and fix orphan docs

```bash
# Documents whose teamspace was deleted
huly document list --json | \
  jq -r '.[] | select(.space == null) | ._id' \
  | xargs -I{} huly document delete {} --yes
```

Repeat the same pattern for any other field — `createdBy`, `assignee`,
etc. — to surface orphans.

---

## Recipes

### Recipe: CI integration

```yaml
# .github/workflows/huly-sync.yml
name: Sync CI status to Huly
on: [push]
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @iamcoder18/huly-cli
      - name: Sync status to Huly
        env:
          HULY_URL: ${{ secrets.HULY_URL }}
          HULY_TOKEN: ${{ secrets.HULY_TOKEN }}
          HULY_WORKSPACE: ${{ vars.HULY_WORKSPACE }}
        run: |
          COMMIT_MSG=$(git log -1 --pretty=%B)
          # Use the GitHub-provided source branch — git rev-parse returns
          # HEAD in detached checkouts, which is not the PR branch.
          BRANCH="${{ github.event.pull_request.head.ref || github.ref_name }}"
          huly issue create --project CI --title "$BRANCH: $COMMIT_MSG" \
                            --label auto --label ci --yes
```

### Recipe: Daily standup bot

```bash
#!/bin/bash
# standup.sh — runs daily, posts to #standup channel
set -e

# Get issues modified into "Done" during yesterday's window.
# (The platform doesn't expose a closure timestamp, so this is a
# "recently-modified Done" report — rename if that's misleading.)
YESTERDAY_START_MS=$(date -u -d 'yesterday 00:00:00' +%s)000
TODAY_START_MS=$(date -u -d 'today 00:00:00' +%s)000
CLOSED=$(huly issue list --status Done --json | \
  jq -r --argjson y "$YESTERDAY_START_MS" --argjson t "$TODAY_START_MS" \
    '.[] | select(.modifiedOn >= $y and .modifiedOn < $t) | "- #\(.identifier) \(.title)"')

# Post to channel
huly channel message send "standup" --body "Yesterday I closed:
$CLOSED
"
```

### Recipe: Bulk-migrate issues

```bash
#!/bin/bash
# migrate-issues.sh — copy issues from one project to another
set -e

SOURCE=$1
DEST=$2
STATUS="ToDo"   # --status-category accepts: UnStarted | ToDo | Active | Won | Lost

IDS=$(huly issue list --project "$SOURCE" --status-category "$STATUS" --json | jq -r '.[]._id')

for id in $IDS; do
  # Get full issue
  issue=$(huly issue get "$id" --json)
  title=$(echo "$issue" | jq -r .title)
  desc=$(echo "$issue" | jq -r .description)

  # Create in dest
  huly issue create --project "$DEST" --title "$title" --description "$desc" --yes

  echo "migrated: $id ($title)"
done
```

### Recipe: Weekly digest email

```bash
#!/bin/bash
# weekly-digest.sh
set -e

WEEK_AGO_MS=$(date -u -d '7 days ago' +%s)000

# Issues created this week (issue list has no --since; jq filters on createdOn)
NEW=$(huly issue list --limit 1000 --json | \
  jq -r --argjson t "$WEEK_AGO_MS" \
    '.[] | select(.createdOn >= $t) | "- #\(.identifier) \(.title) (\(.assignee // "unassigned"))"')

# Issues closed this week (status filter + jq on modifiedOn)
CLOSED=$(huly issue list --status Done --limit 1000 --json | \
  jq -r --argjson t "$WEEK_AGO_MS" \
    '.[] | select(.modifiedOn >= $t) | "- #\(.identifier) \(.title)"')

# Send via your mailer (here we use sendmail)
{
  echo "Subject: Huly Weekly Digest"
  echo
  echo "This week:"
  echo "$NEW"
  echo
  echo "Closed:"
  echo "$CLOSED"
} | sendmail -t
```

### Recipe: Audit orphan documents

```bash
# Find documents with no teamspace
huly document list --json | jq -r '.[] | select(.space == null) | ._id' | \
  xargs -I{} echo "orphan doc: {}"

# Find documents with no author
huly document list --json | jq -r '.[] | select(.createdBy == null) | ._id' | \
  xargs -I{} echo "no-author doc: {}"
```

### Recipe: Workspace health check via cron

This runs every night and logs a line if `huly` can reach the
workspace. It is a **health check, not a backup** — for actual data
export, use the Huly server's own backup mechanism (see
[Server architecture — Backup strategy](../advanced/server-architecture.md#backup-strategy)).

```cron
# /etc/cron.d/huly-health
0 2 * * * huly user get > /dev/null && echo "workspace OK at $(date)" >> /var/log/huly-health.log
```

### Recipe: Generate report for management

```bash
#!/bin/bash
# management-report.sh
set -e

cat <<EOF
Weekly Status Report — $(date +%Y-%m-%d)

Open issues: $(huly issue list --status-category Active --json | jq length)

Top contributors (issues created this week):
$(huly issue list --limit 1000 --json | \
  jq -r --argjson t "$(date -u -d '7 days ago' +%s)000" \
    '[.[] | select(.createdOn >= $t) | .assignee // "(unassigned)"] | group_by(.) | map({k:.[0], n:length}) | sort_by(-.n) | .[0:5] | .[] | "  \(.n)\t\(.k)"')
EOF
```
