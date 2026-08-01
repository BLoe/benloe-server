#!/usr/bin/env bash
# cabinet-privops — the ONLY root-privileged surface exposed to the Cabinet agent.
# Canonical copy is installed at /usr/local/sbin/cabinet-privops (root:root 755);
# this repo file is the source of truth. After editing: re-copy and verify.
# Design: docs/AgentArchitectureV2.md §13.2. Every invocation is logged.
set -euo pipefail

LOG=/var/log/cabinet-privops.log
log() { printf '%s uid=%s %s\n' "$(date -Is)" "${SUDO_UID:-$UID}" "$*" >> "$LOG"; }

# pm2 lives in root's nvm; resolve the newest install and give its node to PATH.
PM2="$(ls -1 /root/.nvm/versions/node/*/bin/pm2 2>/dev/null | sort -V | tail -1)"
[[ -n "$PM2" && -x "$PM2" ]] || { echo "cabinet-privops: pm2 not found" >&2; exit 1; }
export PATH="$(dirname "$PM2"):/usr/local/bin:/usr/bin:/bin"

cmd="${1:-}"; shift || true
case "$cmd" in
  pm2-list)
    log "pm2-list"
    exec "$PM2" jlist
    ;;
  pm2-restart)
    name="${1:-}"
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "invalid app name" >&2; exit 1; }
    "$PM2" jlist | grep -q "\"name\":\"$name\"" || { echo "unknown app: $name" >&2; exit 1; }
    log "pm2-restart $name"
    exec "$PM2" restart "$name" --update-env
    ;;
  pm2-start)
    path="${1:-}"
    [[ "$path" =~ ^/srv/benloe/apps/[a-z0-9][a-z0-9-]{0,40}/ecosystem\.config\.js$ ]] \
      || { echo "path must be /srv/benloe/apps/<name>/ecosystem.config.js" >&2; exit 1; }
    real="$(realpath "$path")"
    [[ "$real" == "$path" ]] || { echo "symlinked paths refused" >&2; exit 1; }
    [[ -f "$real" ]] || { echo "no such file" >&2; exit 1; }
    log "pm2-start $real"
    exec "$PM2" start "$real"
    ;;
  pm2-save)
    log "pm2-save"
    exec "$PM2" save
    ;;
  caddy-reload)
    log "caddy-reload"
    /usr/bin/caddy validate --config /etc/caddy/Caddyfile >&2
    exec /usr/bin/systemctl reload caddy
    ;;
  redeploy)
    name="${1:-}"
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "invalid app name" >&2; exit 1; }
    "$PM2" jlist | grep -q "\"name\":\"$name\"" || { echo "unknown app: $name" >&2; exit 1; }
    log "redeploy $name (drain-then-restart scheduled)"
    # setsid reparents the restarter to init (pid 1) in a new session, so when
    # pm2 tears down THIS app's process tree (which includes the agent turn that
    # invoked us) the restarter survives and completes.
    #
    # 2026-08-01: this used to be `sleep 3` and nothing else, which only worked
    # if redeploy was the LAST thing a turn did. It never is — Cabinet keeps
    # working after triggering a deploy (its own PLATFORM.md told it to verify
    # healthz afterwards), so the restart routinely landed mid-turn and killed
    # the conversation. Observed: a 14-minute turn of Ben's died at 23:04 with
    # zero reply persisted.
    #
    # Now the restarter DRAINS instead: it polls the unauthenticated
    # /healthz queueDepth and waits for a moment when no turn is in flight.
    # The turn that asked for the deploy therefore gets to finish speaking
    # first, and the restart lands in the gap between turns. If the app never
    # goes quiet within the cap we restart anyway — the pending-turn resume
    # (server/src/gateway/pendingTurn.ts) is the net for that case, and a
    # deploy that can never land is worse than one that interrupts.
    if [[ "$name" == "cabinet-api" ]]; then
      setsid bash -c "'$0' __drain-restart '$name' >> '$LOG' 2>&1" </dev/null >>"$LOG" 2>&1 &
      echo "redeploy: $name will restart at the next quiet moment (waits for the current turn to finish, ${DRAIN_CAP_S:-600}s cap)"
    else
      # Other apps have no turn to protect.
      setsid bash -c "sleep 3; '$PM2' restart '$name' --update-env >> '$LOG' 2>&1" </dev/null >>"$LOG" 2>&1 &
      echo "redeploy: $name scheduled for detached restart in ~3s"
    fi
    exit 0
    ;;
  __drain-restart)
    # Internal, re-entrant call from `redeploy` above — never invoked by the
    # agent directly (and harmless if it were: same effect as redeploy).
    name="${1:-}"
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || exit 1
    port=3008
    data_dir=/srv/benloe/data/cabinet
    cap="${DRAIN_CAP_S:-600}"
    poll=2

    # What we're moving FROM (the build currently answering) and TO (what the
    # working tree has committed). Both best-effort: a deploy must not be
    # blocked because git or curl had a bad moment.
    from_sha="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/healthz" 2>/dev/null | jq -r '.buildMarker // empty' || true)"
    to_sha="$(git -C /srv/benloe log -1 --format=%H 2>/dev/null || true)"
    subject="$(git -C /srv/benloe log -1 --format=%s 2>/dev/null || true)"

    waited=0
    drained=false
    while (( waited < cap )); do
      depth="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/healthz" 2>/dev/null | jq -r '.queueDepth // empty' || true)"
      # Unreachable/unparseable → nothing to drain (app already down, or
      # wedged). Restarting is the right move either way.
      if [[ -z "$depth" || "$depth" == "null" ]]; then drained=true; break; fi
      if [[ "$depth" == "0" ]]; then drained=true; break; fi
      sleep "$poll"
      waited=$(( waited + poll ))
    done

    log "__drain-restart $name: drained=$drained waited=${waited}s from=${from_sha:-?} to=${to_sha:-?}"

    # Hand the outcome to the process that is about to boot, so it can report
    # a VERIFIED result in Ben's chat instead of him watching a dead stream.
    # Read back and consumed by server/src/deploy/deployIntent.ts.
    python3 - "$data_dir/deploy-intent.json" "$name" "$from_sha" "$to_sha" "$subject" "$drained" "$waited" <<'PY' || true
import json, sys, datetime
path, app, from_sha, to_sha, subject, drained, waited = sys.argv[1:8]
json.dump({
    "app": app,
    "requestedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "fromSha": from_sha or None,
    "toSha": to_sha or None,
    "subject": subject or None,
    "drained": drained == "true",
    "waitedSeconds": int(waited),
}, open(path, "w"), indent=2)
PY
    # The gateway runs as claude-worker and must be able to consume/delete it.
    chown claude-worker:claude-worker "$data_dir/deploy-intent.json" 2>/dev/null || true

    exec "$PM2" restart "$name" --update-env
    ;;
  *)
    echo "cabinet-privops: unknown or missing subcommand: '$cmd'" >&2
    echo "usage: cabinet-privops {pm2-list|pm2-restart <name>|pm2-start <path>|pm2-save|caddy-reload|redeploy <name>}" >&2
    echo "  (__drain-restart is internal — use redeploy)" >&2
    exit 1
    ;;
esac
