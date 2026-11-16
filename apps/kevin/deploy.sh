#!/bin/bash
# Build, test and promote Kevin. Run as root, through benloe-promote:
#
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/kevin/deploy.sh
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/kevin/deploy.sh rollback
#
# What runs is a root-owned release under /opt/kevin, built from a root-owned
# checkout of one exact commit that is on GitHub's main. /srv/benloe is owned
# by another uid, and Kevin's process can read tax and medical records and the
# API key, so neither the code, nor this script, nor the commit id is taken
# from that working tree: the id comes from GitHub, and benloe-promote refuses
# a commit that is not on main (or on the branch named with --branch).
#
# Each release is built into its own new directory, so nothing stale from an
# earlier build can ride along. Dependencies are installed fresh from the
# lockfiles. The build happens in releases/.building-<time> and is renamed to
# releases/<time> only after the typecheck, tests and build have all passed, so
# every directory rollback can choose is a complete release. A failed build
# leaves its .building directory behind; it and old releases are left in place,
# and this script says when there is something to clear out.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
ROOT=/opt/kevin

case "$SRC" in
  /opt/benloe-src/*) ;;
  *)
    echo "Run this through benloe-promote, from a pushed commit:" >&2
    echo "  benloe-promote \"\$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)\" apps/kevin/deploy.sh" >&2
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

# Complete releases, oldest first. A release is complete when it has the COMMIT
# marker, which is the last thing written before it is renamed into place.
releases() {
  find $ROOT/releases -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' | sort | while read -r d; do
    [ -f "$d/COMMIT" ] && echo "$d"
  done
  return 0
}

if [ "${1:-}" = "rollback" ]; then
  # The newest complete release older than the one running now.
  cur=$(readlink -f $ROOT/current || true)
  prev=""
  for d in $(releases); do
    if [ -z "$cur" ] || [[ "$d" < "$cur" ]]; then prev=$d; fi
  done
  if [ -z "$prev" ]; then
    echo "no earlier complete release to roll back to" >&2
    exit 1
  fi
  ln -sfn "$prev" $ROOT/current
  restart
  exit
fi

STAMP=$(date -u +%Y%m%d-%H%M%S)
FINAL=$ROOT/releases/$STAMP
REL=$ROOT/releases/.building-$STAMP
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

echo "== promote $FINAL"
cp "$SRC/server/package.json" "$SRC/server/package-lock.json" "$REL/server/"
cp -r "$SRC/server/node_modules" "$REL/server/node_modules"
if ! (cd "$REL/server" && npm prune --omit=dev --silent >/dev/null); then
  echo "note: npm prune failed; this release still carries the dev dependencies." >&2
fi
cp -r "$SRC/workspace" "$REL/workspace"
chown -R root:root "$REL"
chmod -R u=rwX,go=rX "$REL"
echo "${BENLOE_PROMOTED_COMMIT:-unknown}" > "$REL/COMMIT"
mv "$REL" "$FINAL"
ln -sfn "$FINAL" $ROOT/current
restart

count=$(releases | wc -l)
if [ "$count" -gt 5 ]; then
  echo "note: $count releases in $ROOT/releases; the oldest can be removed by hand."
fi
failed=$(find $ROOT/releases -mindepth 1 -maxdepth 1 -type d -name '.building-*' | wc -l)
if [ "$failed" -gt 0 ]; then
  echo "note: $failed failed build(s) left in $ROOT/releases/.building-*; they can be removed by hand."
fi
