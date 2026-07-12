# Cards — the default for new knowledge content

Cards are the knowledge primitive you should reach for FIRST when the user asks to "save", "capture", "write down", "document a …", or create structured records. They organize by MasterTag (a Type/tag with custom attributes), not by Teamspace.

---

## Decision: Cards vs Documents

| Use Cards when… | Use Documents when… |
|---|---|
| You want a flat-by-Type organization | You want a nested wiki hierarchy (parent + rank) |
| You need custom typed attributes per MasterTag | You need versioned snapshots per doc |
| Knowledge is structured (record-like) | Knowledge is narrative (article-like) |
| The user said "note", "page", "record", "create a card" | The user said "document", "wiki", "article", "page with versions" |
| The user said "doc"/"page" without further specification | The user mentioned "ControlledDocument", e-signatures, or training |
| You want kanban-style by Type/Tag | You want sidebar-by-teamspace organization |

When in doubt, USE CARDS. The CLI surfaces card creation more conveniently, custom attributes are a major capability, and you can always migrate to Documents later if the structure demands it.

---

## Before you create the first card: verify a MasterTag and CardSpace exist

```bash
huly master-tag list --json | jq -r '.[].label'
huly card-space list --json | jq -r '.[].name'
```

If either is empty — STOP. Do not try to create the missing infrastructure via CLI; neither `master-tag create` nor `card-space update` is exposed. Tell the user they need to do a one-time setup in the web UI:

> "Create a MasterTag and (optionally) a Card Space in the Huly web UI: open the Cards sidebar, click **+ Card space**, then inside it click **+ Type** / **MasterTag**. Once they exist, I can populate them via the CLI."

The CLI surfaces `card`, `card-space` (RW), and `master-tag` (read-only).

---

## Card commands

### Discover

```bash
huly card list --json
huly card list --card-space "Engineering" --json
huly card list --master-tag "Bug" --json
huly card list --card-space "Engineering" --master-tag "Bug" --json
huly card get <ref> --json
huly card get <ref> --markdown        # body rendered as Markdown
huly card get <ref> --raw-markup      # body as raw prosemirror-JSON
```

### Create

```bash
huly card create \
  --master-tag "Bug" \
  --title "Memory leak in worker pool" \
  --card-space "Engineering" \
  --description "Short summary shown in cards list" \
  --body "## Steps to reproduce\n1. …\n2. …\n\n## Expected\n…"
```

**Required:** `--title`, `--master-tag`. The CLI resolves `--master-tag` by name or ref (run `master-tag list` first if unsure).

**Resolution:** `--master-tag foo` matches `foo` against `label`, `name`, or raw `_id`. Look at `master-tag list --json` to see what's available.

**Defaults silently applied:**
- `card-space`: With **opinionated defaults ON** (default; `HULY_OPINIONATED=1`): the CLI picks the first available `CardSpace` automatically (`findAll` returns the one created earliest). Pass `--card-space <name>` to override. With `HULY_OPINIONATED=0` or `--minimal`: literal `card:space:Default` — **this usually does not exist**; if you don't have a card space, the create will fail with `PLATFORM_NOT_FOUND`. Pass `--card-space <name>` explicitly in that mode.
- `parentInfo`: `[]` (no parent). Pass `--parent <card-ref>` to nest.
- `rank: '0|aaaaa:'`, `blobs: {}`.
- `_class`: the resolved MasterTag's id.

**`--body` vs `--description`:** body is the rich Markdown; description is the short summary. They are NOT mutually exclusive at create time, but on update `--description` without `--replace-content` AND without `--body|--body-file` throws `would overwrite the card body`. See update below.

**Body sources:** `--body "<md>"` and `--body-file <path>` are mutually exclusive at create (passes through the create call; conflict throws `ambiguous body input`).

### Update

```bash
huly card update <ref> --title "New title"
huly card update <ref> --body "Full new body content"           # full body replace
huly card update <ref> --description "Short new summary"
huly card update <ref> --description "Replaces body" --replace-content   # forces body overwrite
huly card update <ref> --body-file ./body.md
```

**Mutual-exclusion rules on update:**
- `--body` + `--body-file` → error.
- `--body|--body-file` + `--description` → error (use one or the other).
- `--description` without `--replace-content` AND without `--body|--body-file` → "would overwrite the card body" guard.

So:
- Replace the rich body: `--body "…"` OR `--body-file <path>`.
- Replace the short summary: `--description "…"` (this changes a summary field — the `description` attribute — NOT the body).
- Force `--description` to mean "new body content": `--replace-content`.

**Update is single-write:** updateMarkup writes the ydoc binary directly (the source
of truth for collaborative reads). It does NOT also upload a new JSON blob for
each edit. Storage grows by one snapshot per edit, but no longer two.

### Reparent and move

The CLI's `huly card update` does NOT accept `--parent`. There is no `card move` command. To reparent a card, do it via `huly ws updateDoc` or via the web UI.

Cycle detection is server-side: parent walks up; the tx is rolled back on cycle.

### Delete

```bash
huly card delete <ref>                            # single, no --yes
huly card delete <ref1> <ref2> <ref3> --yes       # bulk, REQUIRED --yes
```

A 100ms sleep between deletes throttles the server.

---

## Card-Space commands

```bash
huly card-space list --json
huly card-space get "Engineering" --json
huly card-space create --name "Engineering" --description "…" --private false --yes
huly card-space delete <ref>                       # cascade-deletes all cards inside
huly card-space delete <ref1> <ref2> --yes
```

**Defaults:** `description: ''`, `private: false`, `archived: false`, `types: []` (no MasterTags linked).

There is NO `card-space update` command. Rename / change description via the web UI or via `huly ws updateDoc` directly.

**Cascade-on-delete:** server-side deletes every Card in the space. Unrecoverable.

---

## Master-Tag commands (read-only on CLI)

```bash
huly master-tag list --json
huly master-tag list --card-space "Engineering" --json   # filter to one space
```

No `create`, `update`, or `delete` exposed. The CLI cannot add a MasterTag. Web UI only.

---

## Critical server-side side effects you cannot avoid

### Adding any attribute to one card adds it to ALL cards of that MasterTag

This is the master-tag `OnCardTag` mixin. The CLI never directly modifies the MasterTag — it just writes fields on the card. But the platform automatically propagates new attributes from one card to all existing and future cards of the same MasterTag.

**Implication for AI agents:** if the user wants to test custom attributes, do it on a sample MasterTag (or in a sandbox project), not on a Tag already in production.

### Deleting a Card Type/MasterTag cascade-deletes all cards of that type

Cannot be undone. There is no `master-tag delete` in the CLI — but if you were to reach for `huly ws removeDoc '["card:class:MasterTag", "<space>", "<id>"]'`, the platform cascade-deletes every card of that type. There is no confirmation prompt via raw RPC.

### File Type is undeletable; uploads are permanent

The platform's `File` MasterTag cannot be deleted. Files uploaded to a File-card are permanent — there is no "delete file" command. Don't rely on cleanup.

### Reparenting a card walks the parent chain; rolls back on cycle

If you `huly ws updateDoc` a card to set a parent that would create a cycle in the chain, the tx is rejected.

### Sub-types inherit parent properties automatically

When a Type derives from another, all parent attributes propagate. The CLI has no `huly card-type derive` command; this happens via web UI setup.

### Bi-directional relations, one-directional references

| Type | One-way or Bi-directional? |
|---|---|
| Relation between Types A↔B | Bi-directional (both cards see each other) |
| Reference on Type A | One-directional (only on A); can be made into a sort/filter criterion |

The CLI has no command for managing card relations. Web UI only.

### Saved card views can be Public or Private

Public = workspace-wide. Private = only you. No CLI exposure; this is a web UI feature.

---

## Common task recipes

### "Save this to the workspace"

```bash
# 1. Verify a card-space + master-tag exist
huly card-space list --json | jq -r '.[].name'
huly master-tag list --json | jq -r '.[].label'

# 2. Create the card
huly card create --master-tag "Note" --card-space "General" \
  --title "ABC" --body "<content the user gave you>"
```

If you don't know what MasterTag to use, ASK. If you don't know what CardSpace to use, ASK or pick the first one and tell the user.

### "Update card TSK-1 with this new info"

```bash
# 1. Verify the card exists and see current state
huly card get <ref> --json

# 2. Apply the update
huly card update <ref> --body "…full new body…"
# OR for targeted edits, use --description + --replace-content, or via huly ws:
# huly ws updateDoc '["card:class:Card", "<space>", "<id>", {"$set":{"<field>":"…"}}]'
```

### "Move this card to another space"

The CLI cannot. Tell the user:

> "Reparenting a card between CardSpaces isn't exposed in the CLI. Open the card in the web UI and drag it to the new space."

Or use `huly ws updateDoc '["card:class:Card", "<new-space>", "<id>", {"$set":{"space":"<new-space>","parent":null}}]'`.

### Build a card from structured user input

```bash
huly card create --master-tag "Customer" --card-space "Sales" \
  --title "$COMPANY_NAME" \
  --body "## Summary
$ONE_LINE

## Contacts
$(printf -- '- %s\n' "${CONTACTS[@]}")

## Notes
$FREEFORM"
```

---

## Gotchas

- **MasterTag creation requires the web UI.** Don't try `huly ws createDoc '["card:class:MasterTag", "<space>", {...}]'` unless you're prepared to set the attribute schema manually.
- **Default CardSpace `card:space:Default` likely doesn't exist.** Pass `--card-space <name>` explicitly.
- **Attribute changes on one card propagate to ALL cards of the MasterTag.** This is intended platform behavior; warn users before they think they're "just adding a field to this one card".
- **`--description` on update is a guard.** It changes the card's short summary field, not the body. If you mean "set the body", use `--body` or `--replace-content`.
- **No reparent on the CLI.** `card update` doesn't accept `--parent`. Use `huly ws`.
- **No `card-space update`.** Rename, change description, change `private` via web UI.
- **No card relations on the CLI.** Web UI only.
- **Bulk delete cascade-deletes child cards.** Run `huly card list --card-space <space> --json | jq length` first to see what's at risk.
- **Newlines in `--body` are auto-stripped.** The CLI's `normalizeMarkupInput` strips newlines (and adjacent whitespace) before the prosemirror parser runs, so `<h1>Title</h1>\n<p>Body</p>` round-trips cleanly into one heading and one paragraph with no phantom empty paragraphs. (Earlier versions warned against embedded `\n`; that restriction is now lifted.)
- **Nested HTML must be properly nested, not flat.** A nested list needs `<li>...<ul><li>...</li></ul></li>`, not `<li>...</li><ul><li>...</li></ul>`. Same for blockquotes inside lists, code blocks inside table cells, etc. — the prosemirror parser validates structure and silently drops malformed siblings.
- **`--raw-markup` is read-only.** Use `--raw-markup` only on `card get` (and `issue get` / `document get`) to dump raw prosemirror-JSON. Using it on `card create` / `update` returns `unknown option`.
- **`--markdown` may fall back to raw markup.** If the server's markdown converter is unavailable, `--markdown` returns the raw prosemirror-JSON string and prints a warning to stderr. Set `HULY_MARKDOWN_FALLBACK_FAIL=1` to make this exit non-zero so CI scripts can detect it.

---

## When to migrate a card to a document (or vice versa)

| Move from cards to documents if… | Move from documents to cards if… |
|---|---|
| Need versioned snapshots per item | Need fine-grained per-type attributes |
| Need to enforce Approver/Reviewer workflow | Need kanban-by-Type organization |
| Need inline comments with notification | Want flexible, user-defined schema |
| Need nesting beyond 2 levels | Have minimal hierarchy needs |

There is no migration command. Plan the right primitive up front.
