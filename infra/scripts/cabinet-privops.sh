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
    # 2026-08-02: this used to accept /srv/benloe/apps/<name>/ecosystem.config.js
    # — a JavaScript file inside a directory the agent owns, which root PM2
    # then EVALUATES. That was arbitrary root code execution via the documented
    # workflow, and chown'ing the file was not a fix: the agent owns the parent
    # directory, so it can unlink a root-owned file and write its own in place
    # (verified, 2026-08-02).
    #
    # Configs now load only from /etc/benloe/ecosystem/, which is root:root all
    # the way up. The repo copy under apps/<name>/ecosystem.config.js stays the
    # reviewable, git-tracked source of truth; root installs it here with
    # `cabinet-privops install-ecosystem` after reading the diff. Same
    # repo-is-source / root-installs pattern as this script and the systemd
    # units in infra/systemd.
    name="${1:-}"
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "usage: pm2-start <app-name>" >&2; exit 1; }
    real="/etc/benloe/ecosystem/$name.config.js"
    [[ -f "$real" ]] || { echo "no installed ecosystem config for '$name' (expected $real)" >&2; exit 1; }
    # Belt and braces: refuse anything that is not root-owned, in case the
    # directory protections are ever loosened by hand.
    owner="$(stat -c '%U:%G' "$real")"
    [[ "$owner" == "root:root" ]] || { echo "refusing: $real is owned by $owner, expected root:root" >&2; exit 1; }
    log "pm2-start $real"
    exec "$PM2" start "$real"
    ;;
  install-ecosystem)
    # Root-only promotion step: copy the repo's reviewable config into the
    # root-owned location PM2 actually reads. Deliberately NOT reachable by the
    # agent — sudoers grants claude-worker this script, so the guard below is
    # what keeps "install" out of the agent's hands. Ben runs it as real root.
    [[ "${SUDO_UID:-$UID}" == "0" && "$UID" == "0" && -z "${SUDO_USER:-}" ]] \
      || { echo "install-ecosystem must be run as real root, not via sudo from a service account" >&2; exit 1; }
    name="${1:-}"
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "usage: install-ecosystem <app-name>" >&2; exit 1; }
    src="/srv/benloe/apps/$name/ecosystem.config.js"
    [[ -f "$src" ]] || { echo "no such repo config: $src" >&2; exit 1; }
    dst="/etc/benloe/ecosystem/$name.config.js"
    if [[ -f "$dst" ]] && diff -q "$src" "$dst" >/dev/null; then echo "unchanged: $dst"; exit 0; fi
    diff -u "$dst" "$src" 2>/dev/null || true
    install -o root -g root -m 644 "$src" "$dst"
    log "install-ecosystem $name"
    echo "installed: $dst"
    ;;
  pm2-save)
    log "pm2-save"
    exec "$PM2" save
    ;;
  caddy-reload)
    log "caddy-reload"
    # Validate AS THE SERVICE ACCOUNT, not as root (2026-08-04).
    #
    # `caddy validate` does not merely parse — it instantiates every log writer,
    # which OPENS (and therefore CREATES) each site's access-log file. Run as
    # root, a brand-new log file is created root:root 0600; the daemon then runs
    # as User=caddy, cannot open its own log, and the reload fails — after this
    # script has already printed "Valid configuration". The orphaned root-owned
    # file makes the failure permanent, and nothing short of real root can clear
    # it, so the trap re-arms on every retry.
    #
    # Dropping to caddy fixes the cause rather than the symptom, and is strictly
    # more faithful besides: validation now exercises the same uid/gid that has
    # to serve the config, so a path the daemon could not read fails here
    # instead of at reload time. `set -e` means a failed validate exits before
    # the reload — this stays fail-closed, and the running config is untouched.
    setpriv --reuid=caddy --regid=caddy --clear-groups \
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
    echo "usage: cabinet-privops {pm2-list|pm2-restart <name>|pm2-start <name>|pm2-save|caddy-reload|redeploy <name>}" >&2
    echo "  pm2-start reads /etc/benloe/ecosystem/<name>.config.js (root-owned)" >&2
    echo "  install-ecosystem <name> promotes the repo config there — real root only" >&2
    echo "  (__drain-restart is internal — use redeploy)" >&2
    exit 1
    ;;
esac
