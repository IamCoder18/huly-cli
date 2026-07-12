# Usage

Conventions that apply to every command in `huly-cli`. Anything
specific to a single surface lives under
[Commands](commands/).

## Table of contents

1. [Global flags](#global-flags)
2. [Output modes](#output-modes)
3. [Ref resolution](#ref-resolution)
4. [Writing markup: `--body` / `--description` layout rules](#writing-markup-body-description-layout-rules)

---

## Global flags

These flags work on every command. They may be placed before or after
the subcommand:

```bash
huly --workspace prod issue list
huly issue list --workspace prod        # equivalent
```

| Flag | Description |
|---|---|
| `--url <url>` | Server URL (overrides `HULY_URL`) |
| `--workspace <name>` | Active workspace (overrides `HULY_WORKSPACE`). Name or UUID. |
| `--json` | Output machine-readable JSON |
| `--ci` | Alias for `--json`. Same effect; signals non-interactive intent. |
| `--markdown` | Output body content as rendered Markdown (read commands). Falls back to raw prosemirror-JSON with a stderr warning if conversion fails. |
| `--dry-run` | Print the tx that would be applied, do not apply |
| `--minimal` | Skip smart defaults (no auto-Teamspace, no auto-IssueStatus, no project-type pinning, no opinionated status/assignee/card-space defaults). Equivalent to setting `HULY_OPINIONATED=0` for this invocation only. |
| `-y, --yes` | Skip confirmation prompts (required for destructive ops) |
| `--non-interactive` | Same as `--yes` + disable any interactive prompts |

### Precedence rules

- A flag on the subcommand overrides the flag on the parent.
- A flag after the subcommand overrides the flag before.
- `--workspace prod issue list` ≡ `issue list --workspace prod`.
- `huly login --workspace prod` is a no-op — login is workspace-independent.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic error (uncaught exception, network failure, etc.) |
| 2 | Validation error (missing required arg, invalid ref, etc.) |
| 3 | Not found (ref doesn't exist) |
| 4 | Forbidden (insufficient permissions) |
| 64 | Usage error (no command given, unknown subcommand) |

All errors are exit-coded; pipe-friendly. `set -e` works as expected.
For the full error-hint table, see
[CLI behavior — Error messages](reference/cli-behavior.md#error-messages-include-next-step-hints).

---

## Output modes

### Table (default)

Designed for humans. Auto-sizes columns, truncates long fields, hides
uninteresting ones:

```
ID    NAME       DESCRIPTION              _ID
────  ─────────  ───────────────────────  ────────────
TSK   Default    Default project          faultProject
DEMO  Demo       Demo project             emoProject
```

### JSON (`--json` / `--ci`)

Full objects, arrays for lists. Designed for `jq` / `xargs`:

```json
[
  {
    "_id": "tracker:project:DefaultProject",
    "_class": "tracker:class:Project",
    "name": "Default",
    "identifier": "TSK",
    "description": "Default project",
    "private": false,
    "archived": false,
    "members": [],
    "modifiedBy": "core:account:System",
    "modifiedOn": 1782697470759
  }
]
```

### CI mode (`--ci`)

Identical to `--json`. Use `--ci` in shell scripts to signal "I expect
machine-readable output, do not prompt for input" — helps future
maintainers understand intent. (Currently no behavioral difference;
reserved for future strict-mode behavior.)

### Markdown body (`--markdown`)

For resources that have body content (documents, comments, channel
messages, issue descriptions), `--markdown` returns the rendered
Markdown text:

```bash
huly document get <ref> --markdown
# prints: # Hello
#         This is the document body in Markdown.
```

The CLI's read path catches markup conversion failures. If
`markupToMarkdown` fails server-side, `--markdown` falls back to the
raw prosemirror-JSON string and prints a warning to stderr; CI
scripts can detect this by setting `HULY_MARKDOWN_FALLBACK_FAIL=1` to
make non-zero exit. See the `[HULY_MARKDOWN_FALLBACK_FAIL]` note in
[CLI architecture — Markup handling](advanced/architecture.md#markup-handling).

### Raw prosemirror-JSON (`--raw-markup`)

For debugging or scripting against the stored blob format, `--raw-markup`
returns the literal prosemirror-JSON string from MinIO (the same
string that goes into `client.markup.uploadMarkup`):

```bash
huly document get <ref> --raw-markup
# prints: {"type":"doc","content":[{"type":"paragraph",...}]}
```

`--raw-markup` is read-only: available on `card get`, `issue get`,
`document get`, `document snapshot --snapshot-id`, and `calendar get`.
Using it on create/update returns `unknown option --raw-markup`.

### When to use `--json`

Use `--json` whenever:

- You're piping to `jq`, `xargs`, or another tool
- You're writing a script that needs the `_id` field
- You want to assert specific fields in CI
- You want full objects instead of truncated table rows

Avoid `--json` when:

- You're interactively exploring (tables are more readable)
- You want body content (use `--markdown` instead)

---

## Ref resolution

References to documents can be specified in several ways. The CLI
tries each in order.

### 1. Raw `_id`

The full class-prefixed ID. Always works, slowest:

```bash
huly issue get tracker:issue:6a41527f12a078ec98cf64d5
```

### 2. Prefixed form

For issues: `<PROJECT_IDENTIFIER>-<NUMBER>`. Resolved via the local
index of issues:

```bash
huly issue get TSK-1
```

### 3. Bare number

If `HULY_PROJECT` is set, bare numbers resolve against that project's
issues:

```bash
export HULY_PROJECT=TSK
huly issue get 1       # equivalent to TSK-1
```

### 4. Title match

Case-insensitive match on the document's title. Used for documents,
teamspaces, projects, etc. (not issues):

```bash
huly document get "My design doc"
```

### Resolution algorithm

1. Check if it matches `_id` regex (`<prefix>:<prefix>:<id>`)
2. Check if it matches prefixed issue form (`[A-Z]+-\d+`)
3. Check if it's a bare number with `HULY_PROJECT` set
4. Look up in the local class index (built from prior `findAll`)
5. Try `findOne` by name/title
6. Throw `NotFound` with candidate suggestions

The local index is **invalidated automatically after writes** to the
same class. Cross-class writes (e.g. updating an issue doesn't
invalidate the project index) require a fresh process. The full
**resolver cache** is per-`PlatformClient` (a `WeakMap`), so
workspace switches get a fresh cache automatically. For the full
order used by `--assignee`, `--owner`, `--person`, and friends, see
[CLI behavior — Ref resolution order](reference/cli-behavior.md#ref-resolution-order-how-flag-values-resolve).

---

## Writing markup: `--body` / `--description` layout rules

The CLI converts your HTML markup into prosemirror JSON before storing
it. One layout rule still matters; the newline rule is no longer a
hard requirement.

- **Newlines are auto-stripped.** The CLI normalizes
  `<h1>x</h1>\n<p>y</p>` to `<h1>x</h1><p>y</p>` before parsing, so
  embedded `\n` no longer creates phantom empty paragraphs. Pass
  `--body-file ./body.html` if you prefer, but multi-line inline
  strings are now safe.
- **Nested HTML must be properly nested, not flat.** A nested list
  needs `<li>...<ul><li>...</li></ul></li>`, not
  `<li>...</li><ul><li>...</li></ul>`. Same for blockquotes in lists,
  code blocks in table cells, etc. — the prosemirror parser
  validates structure and silently drops malformed siblings.

Examples of correct markup:

```bash
# OK — multi-line (newlines auto-stripped)
huly card create --body "<h1>Title</h1>
<p>Body</p>"

# OK — single line also works
huly card create --body "<h1>Title</h1><p>Body</p>"

# BAD — flat nesting is silently dropped
huly card create --body "<ul><li>A</li><ul><li>B</li></ul></ul>"

# GOOD — proper nesting
huly card create --body "<ul><li>A<ul><li>B</li></ul></li></ul>"
```

For the round-trip pipeline (which markup path runs on create vs.
update, when ydocs are built, and what `markupToJSON` →
`markupToMarkdown` actually returns), see
[CLI architecture — Markup handling](advanced/architecture.md#markup-handling).
