# huly-cli

AI-agent-first CLI for self-hosted Huly (`https://huly.aaravlabs.com`).

Built with Node + TypeScript. Single binary, smart defaults, raw API as escape hatch.

## Install

```bash
git clone <repo> ~/huly-cli
cd ~/huly-cli
npm install
npm run build
# optional: symlink to PATH
ln -sf "$(pwd)/bin/huly" ~/.local/bin/huly
```

## Quick start

```bash
export HULY_URL=https://huly.aaravlabs.com
export HULY_EMAIL=you@example.com
export HULY_PASSWORD=...
huly login                    # interactive first time; cached after
huly workspace use myteam
huly project list
huly issue create --project MYPROJ --title "fix the thing"
```

## Commands

```
huly login [--headless]
huly whoami
huly workspace {list,current,use <name>}
huly project   {list,get,create,update,delete}
huly issue     {list,get,create,update,delete}
huly card      {list,get,create,delete}
huly action    {list,create,delete}        # task:class:Task
huly document  {list,create,delete}
huly calendar  {list,create,delete}
huly api <method> <path> [--body <json>]
huly ws <method> [params-json]
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `HULY_URL` | `https://huly.aaravlabs.com` | Server URL |
| `HULY_EMAIL` / `HULY_PASSWORD` | — | Used by `login` |
| `HULY_TOKEN` | — | Pre-issued account token (skips login) |
| `HULY_WORKSPACE` | — | Default workspace URL name or UUID |
| `HULY_PROJECT` | — | Default tracker project (for `--project` default) |
| `HULY_NONINTERACTIVE` | — | `1` disables every prompt (also `--non-interactive` flag) |
| `HULY_INSECURE_TLS` | — | `1` disables TLS verification for `huly ws` (dev only) |
| `CI` | — | Auto-set by CI runners; treated as non-interactive |
| `NO_COLOR` | — | Disable color |

## Ref formats

`<ref>` accepts any of:
- Raw `_id` (`tracker:issue:abc123`)
- Human identifier (`HULY-123`)
- Bare number (`123`) — resolves as `<HULY_PROJECT>-<n>`

## Output

- Default: pretty table on TTY, plain text otherwise
- `--json` / `--ci` / `CI` env: JSON to stdout
- Errors: `error: <code>: <message>` + `hint: ...` on stderr

## Files

- `~/.config/huly/credentials.json` — cached login tokens (mode 0600)
- `~/.config/huly/active-account` — last email per host
- `~/.config/huly/active-workspace` — last `huly workspace use <name>`

## Tests

There are no automated tests. Manual smoke plan: `src/__manual__/smoke.md`.

## Architecture

```
src/
  cli.ts           # Commander command tree
  index.ts         # entry
  auth/            # env, cache, client, prompts
  transport/       # SDK wrapper, ref resolver, class IDs
  resources/       # one file per resource (project, issue, card, ...)
  raw/             # `huly api`, `huly ws` escape hatches
  commands/        # shared create/list/get helpers
  output/          # format (tables/JSON), progress (spinner), errors
```