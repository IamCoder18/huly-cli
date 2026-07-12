# Commands — Knowledge

Cards, card-spaces, master-tags, documents, and teamspaces.

## Table of contents

- [card](#card)
- [card-space](#card-space)
- [master-tag](#master-tag)
- [document](#document)
- [teamspace](#teamspace)

---

## card

Card module (separate from tracker issues).

```bash
huly card list
huly card get <ref> [--markdown]
huly card create --master-tag <name|ref> --title "..." \
                  [--card-space <ref>] [--parent <ref>] \
                  [--description <text>] [--body <md>] [--body-file <path>]
huly card update <ref> [--title] [--description] [--body] [--body-file] [--replace-content]
huly card delete <ref...> [--yes]
```

**Master-tag:** cards MUST have a master-tag. The CLI resolves name
or ID. Use `huly master-tag list` to see available tags. First-card
setup typically requires using the web UI once to create a master-tag,
since the CLI doesn't expose master-tag creation.

**Best practices & side effects:** see
[Platform behavior — Cards & types](../reference/platform-behavior.md#cards-types)
and
[Cards & knowledge management](../reference/platform-behavior.md#cards-knowledge-management-deep).
Highlights: reparenting walks the parent chain and rolls back on
cycles; deleting a Card Type cascades and cannot be undone; the `File`
Type is undeletable; uploading a file to a File Card is permanent.

---

## card-space

```bash
huly card-space list
huly card-space get <ref>
huly card-space create --name "Engineering" [--description]
huly card-space delete <ref...> [--yes]
```


See [CLI behavior — Smart defaults](../reference/cli-behavior.md#smart-defaults-values-the-cli-fills-for-you)
for the auto-pick of the oldest non-archived CardSpace on
`huly card create --card-space` and what `--minimal` does to that
default.

---

## master-tag

```bash
huly master-tag list              # read-only on CLI
```

Master-tag creation is intentionally not exposed — see the
[card](#card) section above for the workaround.

---

## document

```bash
huly document list
huly document create --title "..." [--body <md>] [--body-file <path>] \
                      [--teamspace <name|id>] [--parent <ref|title>]
huly document update <ref> [--title] [--body] [--body-file]
                         [--old-text] [--new-text] [--replace-all] [--archived]
huly document delete <ref...> [--yes]
huly document snapshots <ref>    # list version snapshots
huly document snapshot <ref> --snapshot-id <id>     # get a specific snapshot
huly document inline-comments <ref>
```

**`--body` vs `--old-text/--new-text`:** mutually exclusive. Full body
replace with `--body`; targeted substitution with `--old-text` +
`--new-text`. The substitution throws if `--old-text` appears 0
times (unless `--replace-all`).

**Auto-teamspace:** On first document create in a workspace with no
teamspaces, the CLI auto-creates a default `General` teamspace.

**Best practices & side effects:**

- Body is stored as raw Markdown.
- Any `@mention` in the body creates a backlink and an inbox
  notification for the mentioned user (subject to their notification
  prefs).
- Documents created from `huly document create` are nested under a
  teamspace; if you want flat-by-Type organization, use cards
  instead (see the [card](#card) section above).
- For controlled documents, `--state` transitions are gated by an
  approval workflow: Author → Reviewer → Approver e-signatures are
  enforced in that order, and inline comments must be resolved
  before approval. See
  [Platform behavior — Documents](../reference/platform-behavior.md#documents-controlled-documents-training).

---

## teamspace

Document teamspaces.

```bash
huly teamspace list
huly teamspace get <ref>
huly teamspace create --name "Engineering" [--description] [--type public|private] [--private]
huly teamspace update <ref> [--name] [--description]
huly teamspace delete <ref...> [--yes]
```
