#!/usr/bin/env bash
# pals-privops — the ONLY root-privileged surface exposed to the PALS agent.
# Canonical copy is installed at /usr/local/sbin/pals-privops (root:root 755);
# this repo file is the source of truth. After editing: re-copy and verify.
# Design: docs/AgentArchitectureV2.md §13.2. Every invocation is logged.
set -euo pipefail

LOG=/var/log/pals-privops.log
log() { printf '%s uid=%s %s\n' "$(date -Is)" "${SUDO_UID:-$UID}" "$*" >> "$LOG"; }

# pm2 lives in root's nvm; resolve the newest install and give its node to PATH.
PM2="$(ls -1 /root/.nvm/versions/node/*/bin/pm2 2>/dev/null | sort -V | tail -1)"
[[ -n "$PM2" && -x "$PM2" ]] || { echo "pals-privops: pm2 not found" >&2; exit 1; }
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
  *)
    echo "pals-privops: unknown or missing subcommand: '$cmd'" >&2
    echo "usage: pals-privops {pm2-list|pm2-restart <name>|pm2-start <path>|pm2-save|caddy-reload}" >&2
    exit 1
    ;;
esac
