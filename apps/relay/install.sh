#!/bin/sh
# Promotes relay's code to the root-owned copies that actually run. Run as
# root after any change to server.mjs, cli.mjs, db.mjs or the ecosystem
# config, then `pm2 restart relay-api` if the server changed.
#
# Nothing relay executes is loaded from the repo. /srv/benloe is owned by
# claude-worker, who can swap apps/ for a tree of its own and is allowed to
# restart PM2 apps; code run from here as the `relay` uid could forge local
# messages and read every bearer token, and code root invokes from here would
# simply be root. So: root-owned copies outside the repo, a PM2 config in
# /etc/benloe/ecosystem, and a wrapper that drops to `relay` with an empty
# environment before node starts.
#
# THIS SCRIPT IS THE PROMOTION STEP. What it copies becomes trusted. Read
# `git diff` for this directory before running it.
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
LIB=/usr/local/lib/benloe/relay

id relay >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin relay
install -d -o relay -g relay -m 0700 /var/lib/benloe-relay
install -d -o root -g root -m 0755 "$LIB"
install -o root -g root -m 0644 "$SRC/server.mjs" "$SRC/cli.mjs" "$SRC/db.mjs" "$LIB/"
echo '{"type":"module"}' > "$LIB/package.json"
install -o root -g root -m 0644 "$SRC/ecosystem.config.cjs" /etc/benloe/ecosystem/relay.config.js

# PM2's interpreter for relay-api: root execs this, it drops, then node starts
# with only the three variables the server reads, not the PM2 daemon's
# environment. Written literally here, not rendered from a repo template.
cat > /usr/local/lib/benloe/node-as-relay <<'SHIM'
#!/bin/sh
# Installed by apps/relay/install.sh. Do not edit in place.
set -eu
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent \
  NODE_ENV="${NODE_ENV:-production}" PORT="${PORT:-3015}" RELAY_DB="${RELAY_DB:-/var/lib/benloe-relay/relay.db}" \
  /usr/bin/setpriv --reuid=relay --regid=relay --init-groups /usr/local/bin/node "$@"
SHIM
chmod 755 /usr/local/lib/benloe/node-as-relay

# The local command runs as the same `relay` uid as the server, on purpose: the
# database is the one thing both must write, and a second uid sharing it by
# group would hold exactly the same data. What keeps a compromised server from
# reaching the root session that runs this command is that the code here is
# root-owned, starts with an empty environment, and escapes every field it
# prints. env -i: the caller is a root session whose environment
# can hold credentials, and a process running as `relay` can read the
# environment of any other.
cat > /usr/local/bin/relay <<'WRAP'
#!/bin/sh
# Installed by apps/relay/install.sh. Do not edit in place.
cd /
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 \
  /usr/bin/setpriv --reuid=relay --regid=relay --init-groups \
  /usr/local/bin/node --disable-warning=ExperimentalWarning /usr/local/lib/benloe/relay/cli.mjs "$@"
WRAP
chmod 755 /usr/local/bin/relay
echo "relay installed: $LIB, /etc/benloe/ecosystem/relay.config.js, /usr/local/bin/relay"
