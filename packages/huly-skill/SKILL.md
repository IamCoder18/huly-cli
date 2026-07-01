---
name: huly
description: AI-agent-first CLI for self-hosted Huly — use this skill to drive Huly workspaces, projects, issues, documents, calendars, channels, and more through the `huly` command.
---

# huly

The huly command-line tool exposes a self-hosted Huly workspace to AI agents. Use this skill whenever you need to read or modify data in a Huly workspace (issues, projects, documents, calendars, channels, DMs, teamspaces, time tracking, etc.).

## When to use

Activate this skill when the user asks you to interact with Huly — create or update issues, list projects, post to channels, log time, draft documents, search the workspace, or anything similar. Prefer the `huly` CLI over raw HTTP/WebSocket calls; the CLI handles auth, ref resolution, output formatting, and error handling.

## Instructions

1. Verify the CLI is installed and on `PATH` (`huly --version`); install with `npm i -g @iamcoder18/huly-cli` if missing.
2. Ensure the user is authenticated (`huly whoami`). If not, prompt them to run `huly login` interactively or set `HULY_EMAIL` + `HULY_PASSWORD` and run `huly login --headless`.
3. Pick the right output mode: `--json` for machine parsing, `--ci` for non-interactive scripts (no prompts, exits non-zero on error), table output for humans.
4. Resolve refs by ID, prefix, bare number, or title — the CLI tries them in that order.
5. Use the escape hatches `huly api` (HTTP) and `huly ws` (raw transactions) only when a command is missing.

Detailed references live in the package's `README.md` at <https://github.com/IamCoder18/huly-cli> and in the local `packages/cli/README.md` once installed.