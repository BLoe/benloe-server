#!/bin/bash
# Tests the three installers that root runs through benloe-promote:
#   infra/scripts/install-promote.sh, infra/scripts/install-db-backup.sh,
#   apps/relay/install.sh
# Nothing is installed: each is run as a copy in which every destination is
# rewritten to a path inside a throwaway directory under /var/tmp, with
# systemctl replaced by a recorder. The relay part uses the real `relay` and
# `relay-cli` users for file ownership and is skipped, and reported as
# skipped, on a box that does not have them.
#
# It has to run as root, and root does not run code out of a tree another uid
# can write, so run it from a checkout made by benloe-promote:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/installers.test.sh
# Started from /srv/benloe it refuses (see test-guard.sh).
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo "must run as root: the installers check for it, and files are given to other uids" >&2; exit 1; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO=${HERE%/infra/scripts}
# shellcheck source=infra/scripts/test-guard.sh
. "$HERE/test-guard.sh"
refuse_unsafe_tree "$HERE/installers.test.sh" "$HERE/test-guard.sh" "$HERE/install-promote.sh" "$HERE/install-db-backup.sh" \
    "$HERE/benloe-promote.sh" "$HERE/backup-databases.sh" "$REPO/apps/relay/install.sh" "$REPO/apps/relay/cli.mjs" \
    "$REPO/apps/relay/db.mjs" "$REPO/apps/relay/server.mjs"

T=$(mktemp -d /var/tmp/installers-test.XXXXXX)
trap 'rm -rf -- "${T:?}"' EXIT
chmod 711 "$T"
checks=0
bad=0
skipped=0
ok() { checks=$((checks + 1)); }
no() { checks=$((checks + 1)); bad=$((bad + 1)); echo "NOT OK: $1"; }
is() { if [[ "$1" == "$2" ]]; then ok; else no "$3: got '$1', wanted '$2'"; fi; }
has() { if grep -qF -- "$2" "$1"; then ok; else no "expected in $1: $2"; fi; }

# A stand-in for a promoted checkout, and one for the working tree.
CK=$T/opt/benloe-src/0000000000000000000000000000000000000000
WT=$T/worktree
for tree in "$CK" "$WT"; do
    mkdir -p "$tree/infra/scripts" "$tree/infra/systemd" "$tree/apps/relay"
    cp "$HERE"/install-promote.sh "$HERE"/install-db-backup.sh "$HERE"/benloe-promote.sh "$HERE"/backup-databases.sh "$tree/infra/scripts/"
    cp "$REPO"/infra/systemd/benloe-db-backup* "$tree/infra/systemd/"
    cp "$REPO"/apps/relay/{install.sh,cli.mjs,db.mjs,server.mjs,ecosystem.config.cjs} "$tree/apps/relay/"
done
mkdir -p "$T/sbin" "$T/systemd" "$T/bin" "$T/etc" "$T/shim" "$T/stub"
printf '#!/bin/sh\necho "systemctl $*" >> "%s/systemctl.calls"\n' "$T" > "$T/stub/systemctl"
chmod 755 "$T/stub/systemctl"
# Every destination moved under $T; the location check moved to $T/opt/benloe-src.
for tree in "$CK" "$WT"; do
    sed -i -e "s|/opt/benloe-src/\*/|$T/opt/benloe-src/*/|" -e "s|/usr/local/sbin/|$T/sbin/|g" -e "s|/etc/systemd/system/|$T/systemd/|g" \
        "$tree/infra/scripts/install-promote.sh" "$tree/infra/scripts/install-db-backup.sh"
    sed -i -e "s|/opt/benloe-src/\*/|$T/opt/benloe-src/*/|" -e "s|^LIB=.*|LIB=$T/lib|" -e "s|^DATA=.*|DATA=$T/data|" \
        -e "s|/etc/benloe/ecosystem/relay.config.js|$T/etc/relay.config.js|g" -e "s|/usr/local/lib/benloe/node-as-relay|$T/shim/node-as-relay|g" \
        -e "s|/usr/local/bin/relay\b|$T/bin/relay|g" -e "s|/usr/local/lib/benloe/relay/cli.mjs|$T/lib/cli.mjs|" \
        -e "s|RELAY_DB:-/var/lib/benloe-relay/relay.db|RELAY_DB:-$T/data/relay.db|" \
        -e "s|HOME=/nonexistent LANG=C.UTF-8 \\\\|HOME=/nonexistent LANG=C.UTF-8 RELAY_DB=$T/data/relay.db \\\\|" "$tree/apps/relay/install.sh"
done
grep -q "RELAY_DB=$T/data/relay.db" "$CK/apps/relay/install.sh" && ok || no "the test could not point the installed command at its own database"
# What is left that names a real place must be a comment, a message, or the node binary.
for f in infra/scripts/install-promote.sh infra/scripts/install-db-backup.sh apps/relay/install.sh; do
    left=$(grep -nE '(/usr/local|/etc/|/var/lib|/opt/benloe-src)' "$CK/$f" | grep -vE "^[0-9]+:\s*#|echo |$T|/usr/local/bin/node" || true)
    if [[ -n "$left" ]]; then no "$f still names a real destination after rewriting: $left"; else ok; fi
done
run() { rc=0; (cd / && PATH="$T/stub:$PATH" bash "$1") > "$T/out.log" 2>&1 || rc=$?; }

echo "# 1. run from anywhere but a promoted checkout, each refuses before changing anything"
for f in infra/scripts/install-promote.sh infra/scripts/install-db-backup.sh apps/relay/install.sh; do
    run "$WT/$f"
    is "$rc" 1 "$f from a working tree: exit status"
    has "$T/out.log" "Run this through benloe-promote, with the commit id taken from GitHub"
done
is "$(find "$T/sbin" "$T/systemd" "$T/bin" "$T/etc" "$T/shim" -mindepth 1 | wc -l)" 0 "files installed by refused runs"
[[ ! -e "$T/lib" && ! -e "$T/data" && ! -e "$T/systemctl.calls" ]] && ok || no "a refused run created something"

echo "# 2. install-promote.sh"
run "$CK/infra/scripts/install-promote.sh"
is "$rc" 0 "exit status"
cmp -s "$T/sbin/benloe-promote" "$HERE/benloe-promote.sh" && ok || no "the installed benloe-promote is not the checkout's"
is "$(stat -c '%U:%G %a' "$T/sbin/benloe-promote")" "root:root 755" "its owner and mode"

echo "# 3. install-db-backup.sh"
run "$CK/infra/scripts/install-db-backup.sh"
is "$rc" 0 "exit status"
cmp -s "$T/sbin/benloe-db-backup.sh" "$HERE/backup-databases.sh" && ok || no "the installed backup script is not the checkout's"
is "$(stat -c '%U:%G %a' "$T/sbin/benloe-db-backup.sh")" "root:root 755" "its owner and mode"
for u in benloe-db-backup.service benloe-db-backup-failed.service benloe-db-backup.timer; do
    cmp -s "$T/systemd/$u" "$REPO/infra/systemd/$u" && ok || no "$u was not installed from the checkout"
    is "$(stat -c '%U:%G %a' "$T/systemd/$u" 2>/dev/null)" "root:root 644" "$u owner and mode"
done
is "$(cat "$T/systemctl.calls")" "systemctl daemon-reload
systemctl enable --now benloe-db-backup.timer" "what it asked systemd to do"
# Every unit the service file refers to is one the installer installs.
for u in $(grep -ohE '^(OnFailure|Requires|Wants)=.*' "$REPO/infra/systemd/benloe-db-backup.service" | cut -d= -f2); do
    [[ -f "$T/systemd/$u" ]] && ok || no "benloe-db-backup.service names $u, which the installer does not install"
done

echo "# 4. apps/relay/install.sh"
# No command it gives to setpriv may inherit root's environment.
if python3 -I -c '
import sys
text = open(sys.argv[1]).read().replace("\\\n", " ")
bad = [l for l in text.split("\n") if "/usr/bin/setpriv" in l and not l.lstrip().startswith("#") and "/usr/bin/env -i" not in l]
sys.exit(1 if bad else 0)' "$REPO/apps/relay/install.sh"; then ok; else no "a setpriv command in install.sh does not start from env -i"; fi
if ! id relay > /dev/null 2>&1 || ! id relay-cli > /dev/null 2>&1 || [[ ! -x /usr/local/bin/node ]]; then
    skipped=$((skipped + 1))
    echo "SKIPPED: the rest of part 4 needs the relay and relay-cli users and /usr/local/bin/node"
else
    mode() { stat -c '%U:%G %a' "$1"; }
    echo "#    a new install"
    run "$CK/apps/relay/install.sh"
    is "$rc" 0 "exit status"
    is "$(mode "$T/data")" "relay:relay 2770" "the data directory"
    is "$(mode "$T/data/relay.db")" "relay-cli:relay 660" "the database relay init created"
    for f in cli.mjs db.mjs server.mjs; do cmp -s "$T/lib/$f" "$REPO/apps/relay/$f" && ok || no "$f was not installed from the checkout"; done
    is "$(find "$T/lib" "$T/bin" "$T/shim" "$T/etc" ! -user root -o -perm /022 | wc -l)" 0 "installed code that is not root's alone"
    is "$(mode "$T/bin/relay") $(mode "$T/shim/node-as-relay")" "root:root 755 root:root 755" "the two wrappers"
    "$T/bin/relay" send "written through the installed command" > "$T/send.log" 2>&1 || true
    has "$T/send.log" "Sent #1 as claude."
    is "$(mode "$T/data/relay.db")" "relay-cli:relay 660" "the database after a write"
    echo "#    again, over the install just made"
    run "$CK/apps/relay/install.sh"
    is "$rc" 0 "exit status of a second run"
    has "$T/out.log" "is already there; nothing was changed"
    "$T/bin/relay" log > "$T/log.log" 2>&1 || true
    has "$T/log.log" "written through the installed command"

    echo "#    over an install made before relay-cli existed: 0700, files 0600, owned by relay"
    rm -rf -- "${T:?}/data" "${T:?}/lib"
    install -d -o relay -g relay -m 0700 "$T/data"
    /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/setpriv --reuid=relay --regid=relay --clear-groups /usr/bin/python3 -I -c '
import os, sqlite3, sys
os.umask(0o077)
c = sqlite3.connect(sys.argv[1])
c.execute("pragma journal_mode=wal")
c.execute("create table messages (id integer primary key autoincrement, sender text not null, body text not null, created_at text not null, token_id text, ip text)")
c.execute("insert into messages (sender, body, created_at, token_id, ip) values (\"benji\", \"from before the migration\", \"t\", \"tok\", \"1.1.1.1\")")
c.commit()
os._exit(0)   # like a server that was killed: -wal and -shm stay behind
' "$T/data/relay.db" < /dev/null
    is "$(mode "$T/data/relay.db") $(mode "$T/data/relay.db-wal")" "relay:relay 600 relay:relay 600" "the old layout, before"
    run "$CK/apps/relay/install.sh"
    is "$rc" 0 "exit status of the migration"
    is "$(mode "$T/data")" "relay:relay 2770" "the data directory after"
    is "$(mode "$T/data/relay.db")" "relay:relay 660" "relay.db after"
    # (relay init, at the end of the install, opened and closed the database, which removes -wal and -shm.)
    is "$(find "$T/data" -type f ! -perm 0660 | wc -l)" 0 "files in the data directory that are not 0660"
    "$T/bin/relay" inbox --peek > "$T/inbox.log" 2>&1 || true
    has "$T/inbox.log" "from before the migration"

    echo "#    a file there that is not what it should be stops the install before any code is copied"
    rm -rf -- "${T:?}/lib"
    echo "root's file" > "$T/roots-file"
    chmod 600 "$T/roots-file"
    rm -f -- "${T:?}/data/relay.db-shm"
    ln -s "$T/roots-file" "$T/data/relay.db-shm"
    run "$CK/apps/relay/install.sh"
    is "$rc" 1 "exit status with a symlink where -shm should be"
    has "$T/out.log" "not a regular file with group relay and mode 0660"
    [[ ! -e "$T/lib" ]] && ok || no "code was copied although the check failed"
    is "$(stat -c '%U %a' "$T/roots-file")" "root 600" "the file the symlink pointed at"
fi

echo "# 5. the tests themselves refuse to run as root from a tree another uid can write"
G=$T/someone-elses-tree
mkdir -p "$G/infra/scripts"
cp "$HERE"/*.sh "$G/infra/scripts/"
for case in "the tree belongs to another uid" "one script in it belongs to another uid" "a directory above it is group-writable"; do
    chown -R root:root "$G"; chmod -R go-w "$G"
    case $case in
        "the tree belongs"*) chown -R 61001 "$G" ;;
        "one script"*) chown 61001 "$G/infra/scripts/benloe-promote.sh" "$G/infra/scripts/backup-databases.sh" "$G/infra/scripts/install-promote.sh" ;;
        "a directory"*) chmod 775 "$G/infra" ;;
    esac
    # (Not this script itself: it uses the same guard, and would run this part again inside itself.)
    for test in benloe-promote.test.sh backup-databases.test.sh; do
        rc=0
        (cd / && bash "$G/infra/scripts/$test") > "$T/guard.log" 2>&1 || rc=$?
        is "$rc" 1 "$test when $case: exit status"
        has "$T/guard.log" "Refusing to run as root"
        is "$(wc -l < "$T/guard.log")" 3 "$test when $case: lines printed (the refusal and nothing else)"
    done
done
chown -R root:root "$G"; chmod -R go-w "$G"
rc=0
(cd / && bash "$G/infra/scripts/benloe-promote.test.sh") > "$T/guard.log" 2>&1 || rc=$?
is "$rc" 0 "the same tree, once it is root's alone, runs"

echo "$checks checks, $bad failed, $skipped part(s) skipped"
[[ $bad -eq 0 ]]
