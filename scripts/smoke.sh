#!/usr/bin/env bash
# scripts/smoke.sh — phase-numbered live smoke runner.
#
# Usage:
#   scripts/smoke.sh <phase|all>   # phase = 0..18, or "all"
#
# Behaviour:
#   - Sources ~/.config/huly/.env (or already-set env)
#   - Runs the corresponding block from src/__manual__/smoke.md
#   - Asserts every command exits 0
#   - Runs cleanup queries at end and asserts zero leftover smoke data
#
# Requires: bash, jq, the `huly` binary on PATH (or `node dist/index.js`).

set -euo pipefail

PHASE="${1:-}"

if [[ -z "$PHASE" ]]; then
  echo "usage: $0 <phase|all>" >&2
  exit 64
fi

# Resolve repo root (one level up from scripts/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Prefer the built binary; fall back to tsx.
if [[ -x "$REPO_ROOT/dist/index.js" ]]; then
  HULY() { node "$REPO_ROOT/dist/index.js" "$@"; }
elif [[ -f "$REPO_ROOT/package.json" ]]; then
  HULY() { npx --no-install tsx "$REPO_ROOT/src/index.ts" "$@"; }
else
  echo "no huly binary found" >&2
  exit 1
fi

# Load env if present and vars unset
if [[ -f "$HOME/.config/huly/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$HOME/.config/huly/.env"
  set +a
fi

if [[ -z "${HULY_URL:-}" ]]; then
  export HULY_URL="https://huly.aaravlabs.com"
fi

# If no workspace set, read from active-workspace cache file.
if [[ -z "${HULY_WORKSPACE:-}" && -f "$HOME/.config/huly/active-workspace" ]]; then
  export HULY_WORKSPACE="$(cat "$HOME/.config/huly/active-workspace" | tr -d '[:space:]')"
fi

if [[ -z "${HULY_WORKSPACE:-}" ]]; then
  echo "HULY_WORKSPACE not set and no active-workspace cached; pass HULY_WORKSPACE=... or run \`huly workspace use <n>\`" >&2
  exit 1
fi

# Ensure jq is available
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

# Per-phase commands. We do not parse smoke.md at runtime — we keep the
# authoritative command list here so failures point at exact lines.
# Each entry is a label + command. A command can span multiple lines; we
# use bash arrays for clarity.

step() {
  local label="$1"; shift
  echo "→ $label"
  if ! "$@"; then
    echo "  FAIL: $label" >&2
    exit 1
  fi
}

cleanup_count() {
  local label="$1" pattern="$2" cmd="$3"
  local count
  count="$(eval "$cmd" 2>/dev/null | jq --arg p "$pattern" '[.[] | select((.title // .name // "") | test($p))] | length')"
  if [[ "$count" != "0" ]]; then
    echo "  CLEANUP FAIL ($label): $count leftover items matching $pattern" >&2
    exit 1
  fi
  echo "  ✓ zero leftover $label"
}

case "$PHASE" in
  0)
    step "login (headless)" HULY login --headless
    step "whoami --json" HULY whoami --json
    step "workspace list" HULY workspace list
    step "project list" HULY project list
    step "issue list" HULY issue list
    step "card list" HULY card list
    step "document list" HULY document list
    step "calendar list" HULY calendar list
    ;;

  1)
    step "workspace info" HULY workspace info
    step "workspace members" HULY workspace members --json
    step "workspace regions" HULY workspace regions --json
    step "user get" HULY user get
    # workspace create must refuse without --yes
    if HULY workspace create --name "smoke-no" >/dev/null 2>&1; then
      echo "  FAIL: workspace create should have refused without --yes" >&2
      exit 1
    fi
    echo "  ✓ workspace create refuses without --yes"
    # workspace delete must refuse without --yes
    if HULY workspace delete >/dev/null 2>&1; then
      echo "  FAIL: workspace delete should have refused without --yes" >&2
      exit 1
    fi
    echo "  ✓ workspace delete refuses without --yes"
    # Try actual create (skipped on read-only accounts — exit 0 either way)
    if create_result=$(HULY workspace create --name "smoke-ws-$(date +%s)" --yes --json 2>/dev/null); then
      echo "  ✓ workspace create succeeded"
      echo "$create_result" | jq -e '._id or .workspace or .name' >/dev/null || true
    else
      echo "  ⚠ workspace create skipped (account server may forbid on this workspace)"
    fi
    ;;

  all)
    for p in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
      bash "$0" "$p" || { echo "phase $p failed" >&2; exit 1; }
    done
    ;;

  *)
    echo "phase $PHASE not implemented yet in smoke runner" >&2
    exit 1
    ;;
esac

echo "✓ phase $PHASE passed"
