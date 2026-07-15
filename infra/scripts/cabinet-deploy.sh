#!/usr/bin/env bash
# cabinet-deploy.sh — the ONE command that fuses build + commit + push +
# detached restart + verify for cabinet-api.
#
# Replaces the old four-separate-actions sequence (npm run build; git
# commit; git push; sudo cabinet-privops redeploy cabinet-api) where the
# last step was a distinct action easy to forget after the first three
# succeeded — the exact trap that shipped a stale buildMarker 3x during the
# chat-UX work. This script does build+commit+push in the foreground (so
# failures are observed in-turn), then hands off to exactly ONE detached
# child (cabinet-deploy-watch.sh, via setsid) that does the actual restart +
# healthz poll + one self-heal re-fire + status-file write. The startup side
# (apps/cabinet/server/src/deploy/pendingConfirmation.ts) reads that status
# file on the next boot and posts an in-thread confirmation.
#
# Usage: infra/scripts/cabinet-deploy.sh -m "commit subject" [--allow <prefix>]... [--all] [--note "..."]
#   -m/--message   required if there are staged changes to commit
#   --allow <p>    add an extra path prefix to the clean-tree guard's allow-list
#   --all          bypass the clean-tree guard entirely (rare escape hatch)
#   --note "..."   extra text appended to the in-thread confirmation message
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$REPO_ROOT/apps/cabinet/server"
LOG="$REPO_ROOT/logs/cabinet-deploy.log"
WATCH_SCRIPT="$REPO_ROOT/infra/scripts/cabinet-deploy-watch.sh"

MESSAGE=""
NOTE=""
GUARD_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message) MESSAGE="$2"; shift 2 ;;
    --note) NOTE="$2"; shift 2 ;;
    --allow) GUARD_ARGS+=(--allow "$2"); shift 2 ;;
    --all) GUARD_ARGS+=(--all); shift ;;
    *) echo "cabinet-deploy: unknown arg '$1'" >&2; exit 1 ;;
  esac
done

cd "$REPO_ROOT"

echo "cabinet-deploy: guard..."
HOME=/home/claude-worker node "$SERVER_DIR/scripts/deploy-guard.mjs" "${GUARD_ARGS[@]}"

# Commit BEFORE build, not after: write-build-info.mjs stamps build-info.json
# from `git rev-parse HEAD` + a `git status --porcelain` dirty-check at the
# moment `npm run build` runs. Building first meant it always captured the
# PREVIOUS commit's sha with a "-dirty" suffix instead of the new commit's
# clean sha (caught in this wrapper's own first real run — 638fa871b255-dirty
# instead of the actual new commit). Committing first means the tree is
# already clean and HEAD already points at the new commit by the time
# write-build-info.mjs looks.
#
# Stage only the paths this wrapper owns — never `git add -A`.
HOME=/home/claude-worker git add apps/cabinet infra/scripts
if ! git diff --cached --quiet; then
  [[ -n "$MESSAGE" ]] || { echo "cabinet-deploy: staged changes present but no -m \"message\" given" >&2; exit 1; }
  HOME=/home/claude-worker git commit -m "$MESSAGE"
else
  echo "cabinet-deploy: nothing staged — rebuilding/redeploying current HEAD"
fi

HOME=/home/claude-worker git push

echo "cabinet-deploy: build..."
(cd "$SERVER_DIR" && HOME=/home/claude-worker npm run build)

echo "cabinet-deploy: build web..."
(cd "$REPO_ROOT/apps/cabinet/web" && HOME=/home/claude-worker npm run build)

TARGET_SHA="$(node -p "require('$SERVER_DIR/dist/build-info.json').sha")"

# Defense-in-depth: with the reorder above this should never trip, but a
# "-dirty" marker defeats the entire point of buildMarker (proving what's
# live maps to a real pushed commit) — refuse to ship one rather than let a
# deploy silently verify against an unverifiable sha.
if [[ "$TARGET_SHA" == *-dirty ]]; then
  echo "cabinet-deploy: refusing — build-info reports a dirty tree (sha=$TARGET_SHA)." >&2
  echo "  something is uncommitted after the commit step above; investigate before retrying." >&2
  exit 1
fi

COMMIT_SUBJECT="$(HOME=/home/claude-worker git log -1 --format=%s)"
[[ -n "$NOTE" ]] && COMMIT_SUBJECT="$COMMIT_SUBJECT — $NOTE"

mkdir -p "$(dirname "$LOG")"
echo "$(date -Is) cabinet-deploy: launching detached watch for sha=$TARGET_SHA" >>"$LOG"

setsid bash "$WATCH_SCRIPT" "$TARGET_SHA" "$COMMIT_SUBJECT" </dev/null >>"$LOG" 2>&1 &
disown

echo "build ✓ sha=$TARGET_SHA; restart+verify running detached (log: $LOG)"
