#!/bin/bash
# Build, test and promote Kevin. Run as root, through benloe-promote:
#
#   benloe-promote $(git -C /srv/benloe rev-parse HEAD) apps/kevin/deploy.sh
#   benloe-promote $(git -C /srv/benloe rev-parse HEAD) apps/kevin/deploy.sh rollback
#
# What runs is a root-owned release under /opt/kevin, built from a root-owned
# checkout of one exact pushed commit. /srv/benloe is owned by another uid,
# and Kevin's process can read tax and medical records and the API key, so
# neither the code nor this script is ever taken from that working tree: read
# the diff, commit, push, promote.
#
# Each release is built into its own new directory, so nothing stale from an
# earlier build can ride along. Dependencies are installed fresh from the
# lockfiles. Old releases are left in place; this script says when there are
# more than five.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
ROOT=/opt/kevin

case "$SRC" in
  /opt/benloe-src/*) ;;
  *)
    echo "Run this through benloe-promote, from a pushed commit:" >&2
    echo "  benloe-promote \$(git -C /srv/benloe rev-parse HEAD) apps/kevin/deploy.sh" >&2
    exit 1
    ;;
esac

restart() {
  install -o root -g root -m 0644 "$SRC/ecosystem.config.cjs" /etc/benloe/ecosystem/kevin.config.js
  if pm2 describe kevin-api >/dev/null 2>&1; then pm2 delete kevin-api >/dev/null; fi
  pm2 start /etc/benloe/ecosystem/kevin.config.js >/dev/null
  pm2 save >/dev/null
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3016/api/me || true)
    # 401: up, and refusing a request with no session, which is what it should do.
    if [ "$code" = "401" ]; then
      echo "kevin-api is up ($(readlink $ROOT/current))"
      return 0
    fi
    sleep 0.5
  done
  echo "kevin-api did not come up; see /srv/benloe/logs/kevin-api-err*.log" >&2
  return 1
}

if [ "${1:-}" = "rollback" ]; then
  prev=$(find $ROOT/releases -mindepth 1 -maxdepth 1 -type d | sort | tail -n 2 | head -n 1)
  if [ -z "$prev" ] || [ "$prev" = "$(readlink -f $ROOT/current)" ]; then
    echo "no earlier release to roll back to" >&2
    exit 1
  fi
  ln -sfn "$prev" $ROOT/current
  restart
  exit
fi

REL=$ROOT/releases/$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$REL/server" "$REL/web"

echo "== server: typecheck, test, build"
cd "$SRC/server"
npm ci --silent --no-audit --no-fund
npm run -s typecheck
npm test --silent
npx tsc -p tsconfig.build.json --outDir "$REL/server/dist"

echo "== web: typecheck, test, build"
cd "$SRC/web"
npm ci --silent --no-audit --no-fund
npm run -s typecheck
npm test --silent
npx vite build --outDir "$REL/web/dist" --emptyOutDir >/dev/null

echo "== promote $REL"
cp "$SRC/server/package.json" "$SRC/server/package-lock.json" "$REL/server/"
cp -r "$SRC/server/node_modules" "$REL/server/node_modules"
(cd "$REL/server" && npm prune --omit=dev --silent >/dev/null 2>&1) || true
cp -r "$SRC/workspace" "$REL/workspace"
echo "${BENLOE_PROMOTED_COMMIT:-unknown}" > "$REL/COMMIT"
chown -R root:root "$REL"
chmod -R u=rwX,go=rX "$REL"
ln -sfn "$REL" $ROOT/current
restart

count=$(find $ROOT/releases -mindepth 1 -maxdepth 1 -type d | wc -l)
if [ "$count" -gt 5 ]; then
  echo "note: $count releases in $ROOT/releases; the oldest can be removed by hand."
fi
