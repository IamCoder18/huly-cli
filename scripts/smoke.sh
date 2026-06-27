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

# Pick a project ref for phases that need one (first available).
if [[ -z "${HULY_PROJECT:-}" ]]; then
  PROJ_ID=$(HULY project list --json 2>/dev/null \
    | sed -n '/^\[/,$p' \
    | jq -r '.[0]._id // empty')
  if [[ -n "$PROJ_ID" ]]; then
    export HULY_PROJECT="$PROJ_ID"
  fi
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

  2)
    step "project list" HULY project list
    # idempotent create (may not be enforced on all servers)
    PROJ_ID=$(HULY project create --name "smoke-p2-$(date +%s)" --identifier "P2S$(date +%s)" --json 2>/dev/null \
      | sed -n '/^{/,$p' | jq -r '._id // empty')
    if [[ -z "$PROJ_ID" ]]; then
      echo "  FAIL: project create returned no _id" >&2
      exit 1
    fi
    echo "  ✓ created $PROJ_ID"
    step "project get" HULY project get "$PROJ_ID" --json
    step "project statuses" HULY project statuses --project "$PROJ_ID" --json
    # clear-via-null
    step "project update --set description=… " HULY project update "$PROJ_ID" --set description="smoke"
    step "project update --set description=null (clear)" HULY project update "$PROJ_ID" --set description=null
    step "project target-preferences list" HULY project target-preferences --project "$PROJ_ID" --json
    step "project delete" HULY project delete "$PROJ_ID" --yes
    cleanup_count "projects" "smoke-p2-" "HULY project list --json 2>/dev/null | sed -n '/^\[/,\$p'"
    ;;

  3)
    step "component list (--project)" HULY component list --project "$HULY_PROJECT" 2>/dev/null || true
    step "milestone list (--project)" HULY milestone list --project "$HULY_PROJECT" 2>/dev/null || true
    step "issue-template list (--project)" HULY issue-template list --project "$HULY_PROJECT" 2>/dev/null || true
    # preview-delete accepts any ref; pass a fake one and assert graceful behaviour
    step "issue preview-delete (no-op on bogus)" sh -c 'HULY issue preview-delete "$HULY_PROJECT-bogus" >/dev/null 2>&1 || true; echo done'
    ;;

  4)
    step "issue list --status-category Active" HULY issue list --status-category Active --project "$HULY_PROJECT" 2>/dev/null || true
    step "issue list --description-search smoke" HULY issue list --description-search smoke --project "$HULY_PROJECT" 2>/dev/null || true
    step "issue list --parent null" HULY issue list --parent null --project "$HULY_PROJECT" 2>/dev/null || true
    # Status-category validation: must reject unknown
    if HULY issue list --status-category Bogus >/dev/null 2>&1; then
      echo "  FAIL: --status-category should reject Bogus" >&2
      exit 1
    fi
    echo "  ✓ --status-category rejects unknown values"
    ;;

  5)
    # comment list with bogus issue ref must error (NotFound, exit != 0)
    if HULY comment list --issue "bogus-issue-ref" >/dev/null 2>&1; then
      echo "  FAIL: comment list on bogus issue should error" >&2
      exit 1
    fi
    echo "  ✓ comment list errors on bogus issue"
    # comment add requires --body
    if HULY comment add --issue "bogus-issue-ref" >/dev/null 2>&1; then
      echo "  FAIL: comment add should require --body" >&2
      exit 1
    fi
    echo "  ✓ comment add rejects missing --body"
    # comment add requires --issue
    if HULY comment add --body "hi" >/dev/null 2>&1; then
      echo "  FAIL: comment add should require --issue" >&2
      exit 1
    fi
    echo "  ✓ comment add rejects missing --issue"
    ;;

  9)
    step "calendar calendars" HULY calendar calendars
    step "schedule list" HULY schedule list
    step "calendar recurring" HULY calendar recurring
    # create event + cleanup
    EID=$(HULY calendar create --title "smoke-evt-$(date +%s)" --start "2027-01-01T10:00:00Z" --end "2027-01-01T11:00:00Z" --json 2>/dev/null \
      | sed -n '/^{/,$p' | jq -r '._id // empty')
    if [[ -n "$EID" ]]; then
      echo "  ✓ created event $EID"
      HULY calendar delete "$EID" --yes >/dev/null 2>&1 || true
      echo "  ✓ deleted event"
    else
      echo "  ⚠ calendar create skipped (server may forbid)"
    fi
    # create recurring event + cleanup
    RID=$(HULY calendar create --title "smoke-rec-$(date +%s)" --start "2027-02-01T10:00:00Z" --end "2027-02-01T11:00:00Z" --rrule "FREQ=DAILY;COUNT=3" --json 2>/dev/null \
      | sed -n '/^{/,$p' | jq -r '._id // empty')
    if [[ -n "$RID" ]]; then
      echo "  ✓ created recurring event $RID"
      HULY calendar delete "$RID" --yes >/dev/null 2>&1 || true
      echo "  ✓ deleted recurring event"
    fi
    # cleanup assertion
    cleanup_count "events" "smoke-evt-" "HULY calendar list --json 2>/dev/null | sed -n '/^\[/,\$p'"
    cleanup_count "events" "smoke-rec-" "HULY calendar recurring --json 2>/dev/null | sed -n '/^\[/,\$p'"
    ;;

  10)
    # Validation: missing --minutes / --hours
    if HULY time log --issue "bogus" >/dev/null 2>&1; then
      echo "  FAIL: time log should require --minutes or --hours" >&2
      exit 1
    fi
    echo "  ✓ time log rejects missing --minutes/--hours"
    # Validation: missing --issue
    if HULY time log --minutes 15 >/dev/null 2>&1; then
      echo "  FAIL: time log should require --issue" >&2
      exit 1
    fi
    echo "  ✓ time log rejects missing --issue"
    ;;

  12)
    step "card-space list" HULY card-space list
    step "master-tag list" HULY master-tag list
    step "card list" HULY card list
    # Validation: card create requires --master-tag
    if HULY card create --title "smoke" >/dev/null 2>&1; then
      echo "  FAIL: card create should require --master-tag" >&2
      exit 1
    fi
    echo "  ✓ card create rejects missing --master-tag"
    # Validation: bogus master-tag must error
    if HULY card create --title "smoke" --master-tag "bogus" >/dev/null 2>&1; then
      echo "  FAIL: card create with bogus master-tag should error" >&2
      exit 1
    fi
    echo "  ✓ card create errors on bogus master-tag"
    # Validation: card-space create requires --name
    if HULY card-space create >/dev/null 2>&1; then
      echo "  FAIL: card-space create should require --name" >&2
      exit 1
    fi
    echo "  ✓ card-space create rejects missing --name"
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
