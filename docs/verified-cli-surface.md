# CLI Surface Verification Checklist

> Snapshot taken: 2026-06-29 14:58. The set of CLI commands that have
> been **verified working** end-to-end on this selfhost, that the next
> session should re-verify after applying server-side fixes.
>
> After implementation completes, ask: *"Are you 100% confident that
> every CLI command in this list works, excluding edge cases?"*

## Verified working (smoke-tested 2026-06-29 morning)

### Authentication
- `huly login --headless` — env-based password login
- `huly whoami [--json]` — current account + workspace identity

### Workspace
- `huly workspace list [--json]` — list accessible workspaces
- `huly workspace use <name>` — switch active workspace
- `huly workspace info [--json]` — show uuid, region, mode
- `huly workspace members [--role X]` — list members
- `huly workspace member add <account> --role X` — set member role
- `huly workspace regions` — list available regions
- `huly workspace create --name X --yes` — create workspace
- `huly workspace delete <name> --yes [--force]` — soft-delete (C6/C7 fixed)

### User
- `huly user get [--ref] [ref-positional]` — current or by id (N7)
- `huly user find <email>` — account-level + workspace-local scan
- `huly user update --city X` — update profile

### Project
- `huly project list [--limit N] [--offset N]` — list projects
- `huly project get <ref>` — by identifier/name/_id
- `huly project create --name X --identifier Y` — pre-checks duplicates (C5)
- `huly project update <ref> --set key=value` — update fields
- `huly project delete <ref> --yes` — delete (multiple)
- `huly project statuses --project X` — list statuses

### Issue (parts)
- `huly issue list [--project] [--status] [--status-category] [--assignee] [--label] [--limit]` — list issues
- `huly issue get <ref> [--markdown]` — get single issue (markdown tag returns raw body)
- **`huly issue create` — BLOCKED** (C3, server-side model routing bug)

### Component / Milestone / Issue-template (parts)
- `huly <resource> list --project X` — returns 0 even after create (**C2 bug, server-side**)
- `huly <resource> create --project X --label Y` — returns _id but list doesn't see it
- `huly <resource> get <ref> --markdown` — works for docs with body
- `huly <resource> update <ref> --label Y` — works
- `huly <resource> delete <ref> --yes` — works

### Comment
- `huly comment list --issue TSK-1` — list comments
- `huly comment add --issue TSK-1 --body X [--body-file]` — add
- `huly comment update <ref> --body X` — update
- `huly comment delete <ref> --yes` — delete

### Channel
- `huly channel list` — list channels
- `huly channel get <ref>` — get
- `huly channel create --name X [--topic] [--private] [--members]` — create
- `huly channel update <ref> --topic X` — update
- `huly channel archive <ref> [--value false]` — archive/unarchive
- `huly channel members <ref>` — list members
- `huly channel add-member <ref> --members email...` — add (N2 harmonized)
- `huly channel remove-member <ref> --members email...` — remove
- `huly channel message list <ref>` — list messages
- `huly channel message send <ref> --body X [--body-file]` — send (MarkupContent→string refactor)
- `huly channel message update/delete` — work

### DM
- `huly dm list` — list DM spaces
- `huly dm create --person <email>` — create DM
- `huly dm messages <dmRef>` — list messages
- `huly dm send <dmRef> --body X` — send (N1, with alias)
- `huly dm send --person <email> --body X` — auto-create + send (C12 fix)
- `huly dm message <list|send> <dmRef>` — alias (N1)

### Thread
- `huly thread list <targetRef>` — list replies
- `huly thread add <targetRef> --body X` — add
- `huly thread update <replyRef> --body X` — update
- `huly thread delete <replyRef> --yes` — delete

### Card
- `huly card list` — list cards
- `huly card get <ref> [--markdown]` — get
- `huly card create --master-tag X --title Y [--body]` — create (N9 documented)
- `huly card update <ref> [--title] [--description] [--body] [--body-file]` — update (C10 added --body-file)
- `huly card delete <ref> --yes` — delete

### Card-space
- `huly card-space list`, `get`, `create --name X`, `delete --yes` — all work

### Master-tag
- `huly master-tag list` — read-only

### Action (Planner ToDo)
- `huly action list [--completed] [--priority] [--owner]` — list
- `huly action get <ref>` — get
- `huly action create --title X [--due] [--priority] [--owner]` — create
- `huly action update <ref> --title X` — update
- `huly action complete <ref>` — mark done
- `huly action reopen <ref>` — clear done
- `huly action schedule <ref>` — create WorkSlot
- `huly action delete <ref> --yes` — delete

### Document
- `huly document list` — list
- `huly document create --title X [--body] [--body-file]` — create
  - **AUTO-CREATES** default `General` teamspace on fresh workspace (C8 fix)
- `huly document update <ref> [--title] [--body] [--body-file]` — update
- `huly document delete <ref> --yes` — delete
- `huly document snapshots <ref>` — list snapshots (N4)
- `huly document snapshot <ref> --snapshot-id X [--markdown]` — get one (N4)
- `huly document inline-comments <ref>` — list

### Teamspace
- `huly teamspace list`, `get`, `create --name X`, `delete --yes` — all work

### Calendar
- `huly calendar calendars [--json]` — list CALENDAR objects (N5)
- `huly calendar create-calendar --name X` — create calendar (Phase 17)
- `huly calendar delete-calendar <ref>` — delete
- `huly calendar list [--calendar X] [--start] [--end] [--limit]` — list EVENTS
- `huly calendar get <eventRef> [--markdown]` — get event (N5)
- `huly calendar create --title X --start ISO --end ISO [--rrule] [--attendee]` — create
- `huly calendar update <eventRef>` — update
- `huly calendar delete <eventRef> --yes` — delete
- `huly calendar recurring` — list recurring events
- `huly calendar recurring-instances <recRef>` — list instances

### Schedule
- `huly schedule list`, `create --owner X`, `update <ref>`, `delete --yes` — work

### Time
- `huly time log --issue TSK-1 --minutes N [--hours N] [--description]` — log time
- `huly time report --from ISO --to ISO [--user] [--project]` — report
- `huly time delete <ref> --yes` — delete

### Escape hatches
- `huly api <METHOD> <path> [--body json] [--query k=v]` — HTTP pass-through
- `huly ws <method> [params-json]` — WebSocket RPC pass-through

### Global flags (all commands)
- `--url <url>` — server URL
- `--workspace <name>` — active workspace (C1 implemented)
- `--json` / `--ci` — machine-readable output
- `--markdown` — output body as raw markdown
- `--dry-run` — print intended tx, don't apply
- `--minimal` — skip smart defaults
- `-y, --yes` — skip destructive confirmation
- `--non-interactive` — disable prompts

### Per-command help
- All commands (40+) have `Examples:`, enum/format/dep docs (C14-C17)
- Naming harmonized (N1-N9): `dm.message`, `workspace.member`, `calendar.calendars` etc.
