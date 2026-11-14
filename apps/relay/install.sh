#!/bin/sh
# Installs the local `relay` command. Run as root after any change to cli.mjs
# or db.mjs.
#
# The command is invoked by root (a Claude Code session), and /srv/benloe is
# owned by claude-worker, who could swap apps/ for a tree of its own. So the
# code root invokes is a root-owned copy outside the repo, and the wrapper
# drops to the `relay` user before node starts: no relay code runs as root.
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
LIB=/usr/local/lib/benloe/relay

id relay >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin relay
install -d -o relay -g relay -m 0700 /var/lib/benloe-relay
install -d -o root -g root -m 0755 "$LIB"
install -o root -g root -m 0644 "$SRC/cli.mjs" "$SRC/db.mjs" "$LIB/"
echo '{"type":"module"}' > "$LIB/package.json"
sed 's/__USER__/relay/g' "$SRC/../../infra/scripts/node-as.template.sh" > /usr/local/lib/benloe/node-as-relay
chmod 755 /usr/local/lib/benloe/node-as-relay

cat > /usr/local/bin/relay <<'WRAP'
#!/bin/sh
# Installed by /srv/benloe/apps/relay/install.sh. Do not edit in place.
cd /
exec /usr/bin/setpriv --reuid=relay --regid=relay --init-groups \
  /usr/local/bin/node --disable-warning=ExperimentalWarning /usr/local/lib/benloe/relay/cli.mjs "$@"
WRAP
chmod 755 /usr/local/bin/relay
echo "relay CLI installed in $LIB"
