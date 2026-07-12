# Commands — Accounts & workspaces

Login, signup, workspace, and user/identity operations.

## Table of contents

- [login / signup / whoami](#login-signup-whoami)
- [workspace](#workspace)
- [user](#user)

---

## login / signup / whoami

```bash
huly login                          # interactive
huly login --headless               # env-only
huly signup --email ... --password ... --first ... --last ...
huly signup --headless              # uses HULY_* env vars, no prompts
huly signup --create-workspace my-ws   # signup + first workspace
huly whoami                         # show current account + workspace
huly whoami --json                  # machine-readable
```

`whoami` output:

```text
URL:        https://huly.example.com
Account:    you@example.com
Workspace:  production  (uuid=..., mode=active)
```

See [Getting started — Authentication](../getting-started.md#authentication)
for the three auth modes and token-caching details.

---

## workspace

Workspace-level operations.

```bash
huly workspace list                 # list all accessible workspaces
huly workspace current              # show current workspace
huly workspace use <name>           # set active workspace
huly workspace create --name X      # create (requires --yes)
huly workspace delete --yes         # delete current (requires --yes)
huly workspace delete --yes --force # delete active workspace
huly workspace info                 # show uuid, region, mode
huly workspace members              # list members (OWNER role required)
huly workspace member add <account> --role MAINTAINER   # add / change role (requires OWNER)
huly workspace rename <new-name>    # rename current
huly workspace guests --read-only true           # toggle guest read-only
huly workspace guests --sign-up true             # toggle guest sign-up
huly workspace access-link --role GUEST          # create invite link
huly workspace regions              # list available regions
```

The pair sides (`workspace member remove`, `workspace member list`) are
intentionally not exposed as subcommands. List via `workspace members`
(filter with `--role Owner` / `--role Guest`); remove via the
account-server UI or the `accountClient` SDK call directly.

**Destructive:** `delete` requires `--yes`. Deleting the active
workspace additionally requires `--force`.

**Permissions:** `delete`, `member add`, `rename`, `guests`,
`access-link` require OWNER role. `members` (list), `info`, `list`,
`use`, `current`, `regions` require membership.

**Workspace lifecycle modes** — `pending-creation → creating → active`,
`pending-upgrade → upgrading → active`, `pending-deletion → deleting`,
the `archiving-*` chain, and the `migration-*` and `pending-restore`
chains. See
[Server architecture — Workspace lifecycle](../advanced/server-architecture.md#workspace-lifecycle).

---

## user

Account-level identity operations.

```bash
huly user get                       # current user profile
huly user get --ref <uuid>          # by account uuid
huly user update --city "Berlin"    # update profile fields
huly user find <email>              # look up by email (returns personUuid)
```

`user find` resolution order:

1. Try `accountClient.findPersonBySocialKey` (account-level).
2. Fall back to workspace-local `Person` scan (name match).

Both paths may fail if the user is not in your workspace. See
[Platform behavior — People](../reference/platform-behavior.md#people-employees-contacts)
for the `Person` / `Employee` cascade and invite-by-link rules.
