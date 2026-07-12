# Security model

The CLI is a thin shell over the Huly SDK with one job: make workspace
operations scriptable. The trust boundary is your shell, your
filesystem, and your Huly server — not the CLI itself.

## What the CLI does

- Loads credentials from env or `~/.config/huly/.env` (mode 0600).
- Caches JWTs to `~/.config/huly/credentials.json` (mode 0600).
- Connects over TLS to the server (no plaintext HTTP).
- Never logs tokens (not even at debug level).
- Validates server certs (no self-signed bypass) unless
  `HULY_INSECURE_TLS=1` is set explicitly.

## What the CLI does NOT do

- Does NOT handle password rotation — the CLI just reads
  `HULY_PASSWORD` whenever you set it.
- Does NOT enforce workspace-level RBAC — the server does. The CLI
  surfaces 403s as `ExitCode.Forbidden(4)`.
- Does NOT store secrets in source control. Use `.env` outside git.
- Does NOT support OAuth or SSO — password login only.
- Does NOT support TOTP / 2FA login (server-side only).
- Does NOT auto-reconnect a dropped WebSocket mid-command — a long
  ping timeout means the call may fail with no retry.

## Credential storage recommendations

### Personal use (default)

The defaults are fine. Tokens live at `~/.config/huly/credentials.json`
with mode 0600. `.env` ships at 0600 recommended (the CLI does not
chmod it for you).

### Shared CI runners

Use `HULY_TOKEN` with a **service-account JWT**, never embed
passwords. Set short TTLs on the token. Pass
`HULY_NONINTERACTIVE=1` so a stuck prompt can't hang a CI run.

### Production automation

Consider a secrets manager (Vault, AWS Secrets Manager, GCP Secret
Manager, etc.) that injects env vars at runtime. Avoid writing the
`.env` file to disk in container images — mount it from the secret
store instead.

### Threat model assumptions

The CLI assumes:

- The server is trusted (you run it on your own infrastructure).
- The local filesystem is trusted (no other users can read
  `~/.config/huly/`).
- The shell environment is trusted (env vars may be logged by parent
  processes — `ps e`, systemd journal, etc.).

If any of those don't hold, the CLI's threat model is violated. The
mitigations above are the ones the CLI directly enables; for
anything deeper (keychain integration, FIDO unlock, etc.) you'd need
a wrapper.

## Related references

- [Environment variables — credential file locations](reference/environment.md)
- [Getting started — token caching and logout](getting-started.md#token-caching)
- [Platform behavior — Roles & permissions](reference/platform-behavior.md#roles-permissions-relevant-to-cli-scripting)
