# Development

How the CLI is built, how to add a new command, and the conventions
that keep it consistent.

## Project conventions

- **TypeScript** in strict mode (no `any` except at API boundaries).
- **camelCase** functions, **PascalCase** classes, **SCREAMING_SNAKE**
  constants.
- **One resource per file** under `src/resources/`.
- **New class IDs** go in `src/transport/identifiers.ts`.
- **Help text MUST describe each flag**, even if obvious — designers
  ship `--help` output verbatim to docs.
- **Errors throw `throw new CliError(ExitCode.X, msg, hint?)`** —
  never raw `Error`. See `src/output/errors.ts` for the enum.

## Build commands

```bash
# Install deps
pnpm install

# Build the CLI (emits dist/)
pnpm --filter @iamcoder18/huly-cli build

# Run from source
pnpm --filter @iamcoder18/huly-cli start -- --help

# Run the phased smoke test (13 phases; see scripts/smoke.sh)
bash scripts/smoke.sh
```

`dist/index.js` is the bundled artifact that npm publishes. The CLI's
`bin/huly` is a 1-line wrapper: `node dist/index.js "$@"`.

## Adding a new command

1. Add the resource function under `src/resources/<surface>.ts` —
   see the existing resources (`project.ts`, `issue.ts`, `action.ts`,
   `calendar.ts`) for the helper-driven pattern.
2. Add the class ID to `src/transport/identifiers.ts`.
3. Wire the command in `src/cli.ts` (find the relevant
   `program.command(...)` block for the surface).
4. Document it — add the surface group to
   [docs/commands/](commands/) (or update the existing entry) and
   link it from the [docs index](README.md).
5. Build and verify:

   ```bash
   pnpm --filter @iamcoder18/huly-cli build
   pnpm --filter @iamcoder18/huly-cli start -- <resource> --help
   ```

## Repository layout

```text
src/
  cli.ts              # top-level command registration
  index.ts            # entry point + Node shims (window, localStorage)
  auth/
    client.ts         # login, accountClient, connectPlatform
    cache.ts          # token cache (credentials.json)
    env.ts            # env var loading
  resources/
    _helpers.ts       # shared command helpers
    _project-resolve.ts
    project.ts        # project CRUD
    issue.ts          # issue CRUD + relations + labels + moves
    component.ts      # component CRUD
    milestone.ts      # milestone CRUD
    issue-template.ts
    comment.ts
    channel.ts        # channel CRUD + members + messages
    # dm.ts / thread.ts live in channel.ts
    card.ts           # card module (# card-space.ts, master-tag.ts)
    action.ts         # planner tasks
    document.ts       # documents + teamspaces + snapshots (# teamspace.ts)
    calendar.ts       # events + recurring + calendars + schedules (# schedule.ts)
    time.ts           # time tracking
    user.ts           # profile + person lookup
    workspace.ts      # workspace ops
    todo.ts           # legacy todo (replaced by action)
    project.parse.ts  # project parsing helpers
    misc.ts           # misc utilities
  transport/
    sdk.ts            # connectCli, connectAccountCli, resolveWorkspace
    identifiers.ts    # CLASS, CLASS_ICON, ref helpers
    ref-resolver.ts   # ref → Ref<Doc> resolution
  output/
    format.ts         # table, json, kv, withTimeout
    progress.ts       # withSpinner
    errors.ts         # CliError, ExitCode
  commands/
    dry-run.ts        # dry-run helpers
scripts/
  smoke.sh            # phase-based smoke test (13 phases)
docs/                 # this directory
```

For the runtime view (how `--workspace` becomes a connected
`PlatformClient`, where markup lives, and how caches key off clients),
see [CLI architecture](advanced/architecture.md).

## Publishing

The publish pipeline uses the monorepo root README as the npm package
README. The CLI lives in `packages/cli/` and is published as
`@iamcoder18/huly-cli`. See `commit history` for the most recent
publish-fix commits (`fix: copy monorepo README into package before
publish`, etc.) if you need to bump the README on npm.

## License

This project follows the upstream Huly platform license. Attribution
and header at the top of `src/cli.ts`.
