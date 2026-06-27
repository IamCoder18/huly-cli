# Manual smoke test plan

Goal: verify each command path works end-to-end with **no leftover data**. Every create is paired with a delete.

## Setup

```bash
export HULY_URL=https://huly.aaravlabs.com
export HULY_EMAIL=you@aaravlabs.com
export HULY_PASSWORD=...
export HULY_NONINTERACTIVE=0     # interactive mode
```

## Steps

### 0. Auth
```bash
huly login                       # interactive
huly login --headless            # with env vars set
huly whoami
```

### 1. Workspace
```bash
huly workspace list
huly workspace current
huly workspace use <name>        # sets active workspace
```

### 2. Raw escape hatches
```bash
huly api POST / --body '{"method":"login","params":[{"email":"'"$HULY_EMAIL"'","password":"'"$HULY_PASSWORD"'"}]}'
huly ws hello                    # auto handshake + ping/pong
huly ws findAll '["core:class:Space",{}]'
```

### 3. Per-resource smoke (create → get → delete)
Pick a real project identifier from `huly project list` and substitute `<pick>` below.

```bash
# 3a. Project
PID=$(huly project create --name "smoke-$(date +%s)" --identifier "SMK$(date +%s)" --json | jq -r '._id')
huly project get "$PID"
huly project delete "$PID"

# 3b. Issue
IID=$(huly issue create --project <pick> --title "smoke" --json | jq -r '._id')
huly issue get "$IID"
huly issue update "$IID" --set title="smoke-updated"
huly issue delete "$IID"

# 3c. Card (use --space if no default board)
CID=$(huly card create --title "smoke" --json | jq -r '._id')
huly card delete "$CID"

# 3d. Action (Task)
AID=$(huly action create --title "smoke" --json | jq -r '._id')
huly action delete "$AID"

# 3e. Document
DID=$(huly document create --title "smoke" --body "hello" --json | jq -r '._id')
huly document delete "$DID"

# 3f. Calendar event
EID=$(huly calendar create --title "smoke" --start "$(date -Iseconds)" --end "$(date -Iseconds -d '+1 hour')" --json | jq -r '._id')
huly calendar delete "$EID"
```

### 4. Ref resolution
```bash
export HULY_PROJECT=<pick>
huly issue create --title "ref-resolve" --json > /tmp/r.json
N=$(jq -r '._id' /tmp/r.json)
# raw _id
huly issue get "$N"
# human ref (resolves via HULY_PROJECT)
huly issue get 1           # tries HULY_PROJECT-1
```

### 5. --dry-run verification
```bash
huly issue create --project <pick> --title "dry" --dry-run
# Expect: prints would-be TxCreateDoc JSON, no actual write
```

### 6. Cleanup confirm
```bash
huly issue list --project <pick> --json | jq '[.[] | select(.title | test("smoke|dry|ref-resolve"))] | length'
# Expect: 0
```

Total time budget: ~5 minutes.