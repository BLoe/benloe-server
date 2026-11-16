#!/bin/sh
# Promotes relay's code to the root-owned copies that actually run. Run as
# root, through benloe-promote, after any change to server.mjs, cli.mjs,
# db.mjs or the ecosystem config:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/relay/install.sh
# It creates the database only on a first install (no /var/lib/benloe-relay
# yet) or with --init at the end; the comment above `init=` says why.
# Then, if server.mjs or db.mjs changed: pm2 restart relay-api
# If ecosystem.config.cjs changed, a restart does not read it; instead:
#   pm2 delete relay-api && pm2 start /etc/benloe/ecosystem/relay.config.js && pm2 save
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

# The `relay` command runs as relay-cli on the caller's terminal, when there
# is one (see the wrapper below). TIOCSTI, which pushes characters into a
# terminal's input, would let a relay-cli process type a command into root's
# shell. This kernel allows it only to CAP_SYS_ADMIN while
# dev.tty.legacy_tiocsti is 0; a kernel without that setting allows it to
# anyone on their own controlling terminal. Either way, nothing is installed.
tiocsti=$(cat /proc/sys/dev/tty/legacy_tiocsti 2>/dev/null || echo "not there")
if [ "$tiocsti" != 0 ]; then
  echo "install.sh: dev.tty.legacy_tiocsti is $tiocsti, not 0, so a relay-cli process could type into root's terminal. Nothing was installed." >&2
  exit 1
fi

LIB=/usr/local/lib/benloe/relay
DATA=/var/lib/benloe-relay

# First install or not, decided here, before anything is changed, by whether
# the data directory exists. Only a first install creates the database
# (relay init, at the end). On a box that has had relay, a missing database
# has been lost, and an empty one in its place would hide that: the server
# would start on it, and the nightly backup would save it as a complete run
# and, 14 days on, prune every run that held the real one. So that stops
# here, unless --init says there never was a database to lose.
init=
case $# in
  0) ;;
  1) [ "$1" = --init ] && init=1 ;;
esac
if [ $# -gt 1 ] || { [ $# -eq 1 ] && [ -z "$init" ]; }; then
  echo "usage: install.sh [--init]" >&2
  exit 2
fi
if [ ! -e "$DATA" ] && [ ! -L "$DATA" ]; then
  init=1
elif [ -z "$init" ] && [ -z "$(find "$DATA" -maxdepth 1 -name relay.db -print)" ]; then
  echo "install.sh: $DATA is there but holds no relay.db. relay has been installed on this box" >&2
  echo "before, so its database has been lost (deleted or moved). Nothing was installed or created." >&2
  echo "Restore it from the newest backup (apps/relay/CLAUDE.md, Backups): stop relay-api, write" >&2
  echo "/var/backups/benloe/<timestamp>/var-lib/benloe-relay/relay.db back as the relay uid, then run this again." >&2
  echo "Only if there has never been a database here (a first install that stopped before making it)," >&2
  echo "run this again with --init at the end." >&2
  exit 1
fi

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
# What node does get from PM2 besides: uid and gid relay with no
# supplementary groups and no capabilities (setpriv); the working directory
# PM2 sets from the config (/usr/local/lib/benloe/relay); PM2's umask (db.mjs
# sets its own, 007); PM2's resource limits and ignored signals; no
# controlling terminal; and the descriptors PM2 opens for it: 0-2, sockets
# to the PM2 daemon, which writes 1 and 2 to the log files, and 3, PM2's IPC
# channel, which node does not take up as
# one because NODE_CHANNEL_FD is not passed. A process of the server's uid
# could still write messages to it, which PM2 hands to its event bus.
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
# What it gets from the caller, exactly: an environment of PATH, HOME and
# LANG only; / as its directory; uid relay-cli and gid relay, no supplementary
# groups, no capabilities. Inherited unchanged: every descriptor the caller
# left open (0-2 at least: a terminal, pipes or files), the caller's
# controlling terminal, session and process group if it has them, its umask
# (db.mjs sets its own, 007), resource limits and ignored signals.
#
# What the server's uid can still do to this command is whatever it can do
# through the database, which it can write, replace or delete: put any text
# in any row (cli.mjs escapes every string it prints for that reason), or
# make the command fail or hang. Getting further than that would take a bug
# in node or SQLite that a crafted database file can reach, and would land in
# relay-cli, an unprivileged uid that owns nothing, not in root. But it would
# land with the descriptors above. On a terminal it could then write raw
# escape sequences past the escaping, read what is typed while it runs, and
# change the terminal's settings, through 0-2 or /dev/tty; it could not type
# into root's shell (TIOCSTI, checked at the top). Through pipes or files it
# could write whatever it liked into the caller's output. It is not given a
# session of its own (setsid) because then Ctrl-C would stop the wrapper and
# leave it running, still reading the terminal.
cat > /usr/local/bin/relay <<'WRAP'
#!/bin/sh
# Installed by apps/relay/install.sh. Do not edit in place.
cd /
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 \
  /usr/bin/setpriv --reuid=relay-cli --regid=relay --clear-groups \
  /usr/local/bin/node --disable-warning=ExperimentalWarning /usr/local/lib/benloe/relay/cli.mjs "$@"
WRAP
chmod 755 /usr/local/bin/relay

# A first install has no database, and neither the server nor any other
# command will make one (an empty database appearing where the real one went
# missing would look like a quiet channel). On a first install, or with
# --init, `relay init` creates it as relay-cli; it changes nothing if one is
# there. On any other install this was checked at the top.
if [ -n "$init" ]; then
  /usr/local/bin/relay init
fi
echo "relay installed: $LIB, /etc/benloe/ecosystem/relay.config.js, /usr/local/lib/benloe/node-as-relay, /usr/local/bin/relay"
echo "If server.mjs or db.mjs changed: pm2 restart relay-api"
echo "If the ecosystem config changed (a restart does not read it): pm2 delete relay-api && pm2 start /etc/benloe/ecosystem/relay.config.js && pm2 save"
