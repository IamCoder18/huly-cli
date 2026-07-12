---
title: Documentation
description: Full reference index for huly-cli — every command, guide, and reference page for the AI-agent-first CLI for self-hosted Huly.
---

# Documentation

This index lists every file in `docs/`. The README lives at the repo
root and links here for anything beyond install + quickstart.

## Onboarding

- [Getting started](getting-started.md) — config files, auth modes,
  signup, the Agent Skill, troubleshooting first-run
- [Usage](usage.md) — global flags, output modes, ref resolution,
  writing markup correctly
- [Security](security.md) — what the CLI does and doesn't do,
  credential storage, threat model

## Commands

- [Accounts & workspaces](commands/accounts-workspaces.md) —
  `login`, `signup`, `whoami`, `workspace`, `user`
- [Tracker](commands/tracker.md) — `project`, `issue`, `component`,
  `milestone`, `issue-template`
- [Collaboration](commands/collaboration.md) — `comment`, `channel`,
  `dm`, `thread`, `activity`
- [Knowledge](commands/knowledge.md) — `card`, `card-space`,
  `master-tag`, `document`, `teamspace`
- [Planning](commands/planning.md) — `action`, `schedule`, `time`
- [Calendar](commands/calendar.md) — `calendar`, recurring events
- [Platform](commands/platform.md) — `space`, `space-type`,
  `association`, `relation`, `project-type`, `task-type`,
  `issue-status`, `notification`, `approval`

## Guides

- [Workflows](guides/workflows.md) — bootstrap a project, bulk-archive,
  daily report, copy issues between projects, orphan cleanup
- [Migration](guides/migration.md) — from `huly-mcp`, the SDK,
  the REST API, or the web UI

## Reference

- [CLI behavior](reference/cli-behavior.md) — smart defaults, caches,
  filtering, idempotency, error exits, prompts, pooling
- [Platform behavior](reference/platform-behavior.md) — cascades,
  triggers, permissions, integrations, calendar quirks, locking
- [Environment variables](reference/environment.md) — every
  `HULY_*` var, credential file locations, reset recipe
- [Model surface](reference/model.md) — class ID reference and
  plugin/surface map

## Advanced

- [Escape hatches](advanced/escape-hatches.md) — `huly api` and
  `huly ws` for raw RPCs
- [CLI architecture](advanced/architecture.md) — source layout,
  connection flow, markup handling
- [Server architecture](advanced/server-architecture.md) — services,
  database, transactions, backups, upgrades

## Contributing

- [Development](development.md) — conventions, adding a new command,
  build commands
