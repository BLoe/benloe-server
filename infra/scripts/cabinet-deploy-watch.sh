#!/usr/bin/env bash
# The ONE detached child cabinet-deploy.sh spawns via setsid. Runs OUTSIDE
# cabinet-api's process tree (reparented to init) so it survives the very
# pm2 restart it triggers — same reason cabinet-privops' own `redeploy` case
# uses setsid internally.
#
# Drains first (waits for /healthz.presence=='idle', bounded + fail-open —
# see wait_for_idle below) so an in-flight turn, including the one that
# triggered this very deploy, finishes emitting its response before the kill.
# Then calls the already-allowed `cabinet-privops redeploy` privop (no
# privop/sudoers change — this is claude-worker-owned orchestration of a
# command we're already permitted to run), polls the public /healthz for the
# new buildMarker, self-heals with ONE re-fire if the first restart doesn't
# take within budget (no re-drain before that retry — the process is already
# down/restarting, draining a dead process is pointless), and writes the
# verified outcome to last-deploy.json for pendingConfirmation.ts to read on
# the next process startup.
#
# Args: $1 = TARGET_SHA (required), $2 = COMMIT_SUBJECT (optional)
set -uo pipefail  # deliberately NOT -e: a failed curl/poll must fall through to write_status, not abort silently

TARGET_SHA="${1:?TARGET_SHA required}"
COMMIT_SUBJECT="${2:-}"
DATA_DIR="${CABINET_DATA_DIR:-/srv/benloe/data/cabinet}"
STATUS_FILE="$DATA_DIR/last-deploy.json"
HEALTHZ_URL="http://127.0.0.1:3008/healthz"
POLL_INTERVAL=2
POLL_TIMEOUT=60
DRAIN_TIMEOUT=120

# Drain before the kill: cabinet-privops redeploy SIGKILLs cabinet-api, which
# aborts whatever turn is in flight (including, on a self-deploy, the very
# turn that triggered this watcher — it hasn't emitted its final text yet).
# This watcher runs concurrently with cabinet-api (setsid child, survives the
# restart), so waiting here for presence=='idle' naturally lets any in-flight
# turn finish emitting its response before we pull the trigger. Bounded and
# fail-open: a stuck/long-running turn must not wedge deploys forever — after
# DRAIN_TIMEOUT we log and restart anyway.
wait_for_idle() {
  local start=$SECONDS
  local deadline=$((SECONDS + DRAIN_TIMEOUT))
  local last_depth="?"
  while [[ $SECONDS -lt $deadline ]]; do
    local status
    status="$(curl -fsS --max-time 3 "$HEALTHZ_URL" 2>/dev/null | node -e "
      let d=''; process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{ try { const j=JSON.parse(d); process.stdout.write((j.presence||'')+' '+(j.queueDepth??'?')); } catch { /* empty */ } });
    " 2>/dev/null)"
    if [[ "$status" == idle* ]]; then
      echo "$(date -Is) watch: drained (idle) after $((SECONDS - start))s"
      return 0
    fi
    [[ -n "$status" ]] && last_depth="${status#* }"
    sleep "$POLL_INTERVAL"
  done
  echo "$(date -Is) watch: drain timed out after ${DRAIN_TIMEOUT}s — queueDepth=$last_depth still active, restarting anyway"
  return 1
}

poll_for_sha() {
  local deadline=$((SECONDS + POLL_TIMEOUT))
  while [[ $SECONDS -lt $deadline ]]; do
    local marker
    marker="$(curl -fsS --max-time 3 "$HEALTHZ_URL" 2>/dev/null | node -e "
      let d=''; process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{ try { process.stdout.write(JSON.parse(d).buildMarker||''); } catch { /* empty */ } });
    " 2>/dev/null)"
    if [[ "$marker" == "$TARGET_SHA" ]]; then
      echo "$marker"
      return 0
    fi
    sleep "$POLL_INTERVAL"
  done
  echo ""
  return 1
}

write_status() {
  local confirmed="$1" ok="$2" attempts="$3"
  mkdir -p "$DATA_DIR"
  node -e "
    const fs = require('fs');
    fs.writeFileSync(process.argv[1], JSON.stringify({
      targetSha: process.argv[2],
      confirmedSha: process.argv[3] || null,
      ok: process.argv[4] === 'true',
      ts: new Date().toISOString(),
      attempts: Number(process.argv[5]),
      commitSubject: process.argv[6],
      acked: false,
    }, null, 2));
  " "$STATUS_FILE" "$TARGET_SHA" "$confirmed" "$ok" "$attempts" "$COMMIT_SUBJECT"
}

wait_for_idle || true  # fail-open: timeout already logged above, proceed regardless

echo "$(date -Is) watch: redeploy attempt 1 for sha=$TARGET_SHA"
sudo -n /usr/local/sbin/cabinet-privops redeploy cabinet-api

CONFIRMED="$(poll_for_sha)"
if [[ -n "$CONFIRMED" ]]; then
  echo "$(date -Is) watch: confirmed sha=$CONFIRMED on attempt 1"
  write_status "$CONFIRMED" true 1
  exit 0
fi

echo "$(date -Is) watch: attempt 1 timed out after ${POLL_TIMEOUT}s — self-healing, redeploy attempt 2"
sudo -n /usr/local/sbin/cabinet-privops redeploy cabinet-api

CONFIRMED="$(poll_for_sha)"
if [[ -n "$CONFIRMED" ]]; then
  echo "$(date -Is) watch: confirmed sha=$CONFIRMED on attempt 2"
  write_status "$CONFIRMED" true 2
  exit 0
fi

echo "$(date -Is) watch: FAILED — buildMarker never matched sha=$TARGET_SHA after 2 attempts"
write_status "" false 2
exit 1
