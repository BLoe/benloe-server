#!/bin/sh
# Promotes relay's code to the root-owned copies that actually run. Run as
# root, through benloe-promote, after any change to server.mjs, cli.mjs,
# db.mjs or the ecosystem config; then `pm2 restart relay-api` if the server
# changed:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/relay/install.sh
#
# Nothing relay executes is loaded from the repo. /srv/benloe is owned by
# claude-worker, who can swap apps/ for a tree of its own and is allowed to
# restart PM2 apps; code run from there as the `relay` uid could forge local
# messages and read every bearer token, and code root invokes from there would
# simply be root. So: root-owned copies outside the repo, a PM2 config in
# /etc/benloe/ecosystem, and wrappers that drop privileges and replace the
# environment with a fixed few variables before node starts.
#
# THIS SCRIPT IS THE PROMOTION STEP. What it copies becomes trusted.
set -eu

# First, before anything is changed: this script copies files into places
# root trusts, so it must itself come from somewhere nobody else can write: a
# root-owned checkout of a commit on GitHub, made by benloe-promote. From the
# working tree it refuses, because that tree can be swapped under it between
# any check and any copy. The check catches a mistake, not an attacker:
# whoever can edit this file can delete it. What makes the copies trustworthy
# is benloe-promote's checkout.
SRC=$(cd "$(dirname "$0")" && pwd -P)
case "$SRC" in
  /opt/benloe-src/*/apps/relay) ;;
  *)
    echo "Run this through benloe-promote, with the commit id taken from GitHub:" >&2
    echo "  benloe-promote \"\$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)\" apps/relay/install.sh" >&2
    exit 1
    ;;
esac
[ "$(id -u)" = 0 ] || { echo "install.sh: must run as root" >&2; exit 1; }

LIB=/usr/local/lib/benloe/relay
DATA=/var/lib/benloe-relay

# Two uids, one group.
#   relay      the internet-facing server.
#   relay-cli  the local `relay` command, which a root session runs and reads
#              the output of.
# They are separate so that a compromised server has nothing in common with
# the command except the database. As the same uid it could stop or kill the
# command part-way through printing, read its environment, and, were
# kernel.yama.ptrace_scope ever set to 0, attach to it and write its output
# for it, past the escaping. Across uids the kernel refuses all three.
# (Tested here, 2026-11: writing into the command's stdout by reopening
# /proc/<pid>/fd/1 was refused even for the same uid when that stdout was a
# pipe or a file root had opened. The split does not depend on that.)
# Both have `relay` as their group, and that group is how they share the
# database.
id relay >/dev/null 2>&1 || useradd --system --user-group --no-create-home --shell /usr/sbin/nologin relay
id relay-cli >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --gid relay relay-cli
if [ "$(id -gn relay)" != relay ] || [ "$(id -gn relay-cli)" != relay ]; then
  echo "install.sh: users relay and relay-cli must both have primary group relay. Nothing was installed." >&2
  exit 1
fi

# The data directory: the server's, writable by the group, setgid so that
# whatever either uid creates in it gets group `relay`, closed to everyone
# else. On an install made before relay-cli existed this is what changes it
# from 0700. (/var/lib is root-owned, so `relay` cannot have replaced this
# name with something else for root to chown.)
install -d -o relay -g relay -m 2770 "$DATA"

# Files already in it were created 0600 by the earlier version. They are
# opened to the group by the `relay` uid itself, not by root: root does not
# follow a path inside a directory the server's uid can write. As `relay`,
# a chmod can only ever reach a file `relay` owns. Files `relay` does not own
# (made by relay-cli) are left alone here; cli.mjs and server.mjs create them
# 0660 themselves.
#
# That shell is a process of the server's uid, which the server can inspect
# (its environment) and signal. So it gets none of root's environment, no
# terminal on its input, and / as its directory. If the server stops it
# (SIGSTOP), this script waits there until interrupted, having copied no
# code yet.
cd /
/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/setpriv --reuid=relay --regid=relay --clear-groups /bin/sh -c '
  cd "$1" || exit 1
  for f in relay.db relay.db-wal relay.db-shm; do
    if [ -f "$f" ] && [ ! -L "$f" ] && [ -O "$f" ]; then chmod 0660 "$f" || exit 1; fi
  done
' sh "$DATA" < /dev/null
# Then root looks, without opening or changing anything (find does not follow
# symlinks): each of the three that exists must now be a regular file, group
# relay, mode 0660. If one is not, the two uids cannot share the database and
# this stops and says so.
wrong=$(find "$DATA" -maxdepth 1 \( -name relay.db -o -name relay.db-wal -o -name relay.db-shm \) ! \( -type f -group relay -perm 0660 \) -print)
if [ -n "$wrong" ]; then
  echo "install.sh: not a regular file with group relay and mode 0660:" >&2
  echo "$wrong" >&2
  echo "Nothing was installed. Stop relay-api, fix these by hand, and run this again." >&2
  exit 1
fi

install -d -o root -g root -m 0755 "$LIB"
install -o root -g root -m 0644 "$SRC/server.mjs" "$SRC/cli.mjs" "$SRC/db.mjs" "$LIB/"
echo '{"type":"module"}' > "$LIB/package.json"
install -o root -g root -m 0644 "$SRC/ecosystem.config.cjs" /etc/benloe/ecosystem/relay.config.js

# PM2's interpreter for relay-api: root execs this, it drops, then node starts
# with five variables (PATH, HOME, NODE_ENV, and the two the server reads,
# PORT and RELAY_DB), not the PM2 daemon's environment. Written literally
# here, not rendered from a repo template.
cat > /usr/local/lib/benloe/node-as-relay <<'SHIM'
#!/bin/sh
# Installed by apps/relay/install.sh. Do not edit in place.
set -eu
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent \
  NODE_ENV="${NODE_ENV:-production}" PORT="${PORT:-3015}" RELAY_DB="${RELAY_DB:-/var/lib/benloe-relay/relay.db}" \
  /usr/bin/setpriv --reuid=relay --regid=relay --clear-groups /usr/local/bin/node "$@"
SHIM
chmod 755 /usr/local/lib/benloe/node-as-relay

# The local command. It runs as relay-cli, never as root and never as `relay`
# (see above), with group `relay` for the database. env -i: the caller is a
# root session whose environment can hold credentials, and none of it should
# reach a process that reads a database an internet-facing service writes.
#
# What the server's uid can still do to this command is whatever it can do
# through the database, which it can write, replace or delete: put any text
# in any row (cli.mjs escapes every string it prints for that reason), or
# make the command fail or hang. Getting further than that would take a bug
# in node or SQLite that a crafted database file can reach, and would land in
# relay-cli, an unprivileged uid that owns nothing, not in root.
cat > /usr/local/bin/relay <<'WRAP'
#!/bin/sh
# Installed by apps/relay/install.sh. Do not edit in place.
cd /
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 \
  /usr/bin/setpriv --reuid=relay-cli --regid=relay --clear-groups \
  /usr/local/bin/node --disable-warning=ExperimentalWarning /usr/local/lib/benloe/relay/cli.mjs "$@"
WRAP
chmod 755 /usr/local/bin/relay

# A new install has no database, and neither the server nor any other command
# will make one (an empty database appearing where the real one went missing
# would look like a quiet channel). `relay init` creates it if it is not
# there, as relay-cli, and changes nothing if it is.
/usr/local/bin/relay init
echo "relay installed: $LIB, /etc/benloe/ecosystem/relay.config.js, /usr/local/lib/benloe/node-as-relay, /usr/local/bin/relay"
echo "Restart the server so it runs the new code: pm2 restart relay-api"
