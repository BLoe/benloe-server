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
# Sourcing test-guard.sh runs it, so as root it is checked here first, the
# way it then checks everything else: it, and every directory above it, must
# be root-owned and not writable by group or other (sticky directories
# aside). Until it passes, nothing from this tree but this script has run.
if [[ $(id -u) -eq 0 ]]; then
    p=$HERE/test-guard.sh
    while :; do
        if ! read -r u m < <(stat -c '%u %a' -- "$p" 2>/dev/null) || [[ "$u" -ne 0 ]] \
            || { (( 0$m & 022 )) && ! { [[ -d "$p" ]] && (( 0$m & 01000 )); }; }; then
            echo "Refusing to run as root: $p is not root's alone, so test-guard.sh is not sourced." >&2
            echo "Run it from a checkout made by benloe-promote instead, with the commit id taken from GitHub:" >&2
            echo "  benloe-promote \"\$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)\" <path of this test in the repo>" >&2
            exit 1
        fi
        [[ "$p" == / ]] && break
        p=$(dirname -- "$p")
    done
fi
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
hasnt() { if grep -qF -- "$2" "$1"; then no "not expected in $1: $2"; else ok; fi; }

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
run() { rc=0; (cd / && PATH="$T/stub:$PATH" bash "$@") > "$T/out.log" 2>&1 || rc=$?; }

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

echo "#    the installed failure unit's commands, run in order the way systemd runs them"
# Each ExecStart= line of the installed copy, with a "-" prefix honoured (its
# failure does not stop the next line) and "%%" unescaped, under the unit's
# UMask; logger is replaced by a recorder and /var/backups moved under $T.
# The shell's quoting stands in for systemd's, which these lines use alike.
printf '#!/bin/sh\necho "$*" >> "%s/logger.calls"\n' "$T" > "$T/stub/logger"
chmod 755 "$T/stub/logger"
run_failure_unit() {
    local line cmd ignore
    while IFS= read -r line; do
        cmd=${line#ExecStart=}
        ignore=0
        [[ "$cmd" == -* ]] && { ignore=1; cmd=${cmd#-}; }
        cmd=${cmd//%%/%}
        cmd=${cmd//\/usr\/bin\/logger/$T/stub/logger}
        cmd=${cmd//\/var\/backups/$T/backups}
        if ! (umask 0077 && eval "$cmd") 2>/dev/null && [[ $ignore -eq 0 ]]; then return 1; fi
    done < <(grep '^ExecStart=' "$T/systemd/benloe-db-backup-failed.service")
}
touch "$T/backups" # a file where the directory should be: the marker cannot be written
rc=0; run_failure_unit || rc=$?
is "$(cat "$T/logger.calls" 2>/dev/null)" "-p daemon.err -t benloe-db-backup the nightly database backup failed; see /var/log/benloe-db-backup.log" \
    "the journal line, when the marker cannot be written"
is "$rc" 0 "the unit's result when only the marker failed"
rm -f -- "$T/backups" "$T/logger.calls"
run_failure_unit
[[ -s "$T/logger.calls" ]] && ok || no "no journal line on a normal failure"
grep -qE '^failed [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z; see /var/log/benloe-db-backup.log$' "$T/backups/benloe/LAST-RUN-FAILED" && ok \
    || no "LAST-RUN-FAILED does not say when: $(cat "$T/backups/benloe/LAST-RUN-FAILED" 2>&1)"
is "$(stat -c %a "$T/backups/benloe/LAST-RUN-FAILED")" 600 "the marker's mode under UMask=0077"

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
    echo "#    a kernel that lets anyone push input into their terminal (TIOCSTI) stops it first"
    sed "s|/proc/sys/dev/tty/legacy_tiocsti|$T/legacy_tiocsti|" "$CK/apps/relay/install.sh" > "$CK/apps/relay/install-tiocsti.sh"
    cmp -s "$CK/apps/relay/install.sh" "$CK/apps/relay/install-tiocsti.sh" && no "the test could not point install.sh at its own legacy_tiocsti" || ok
    # Every value but 0 refuses, and so does a kernel that has no such setting.
    for value in 1 2 "" missing; do
        rm -f -- "$T/legacy_tiocsti"
        [[ $value == missing ]] || echo "$value" > "$T/legacy_tiocsti"
        run "$CK/apps/relay/install-tiocsti.sh"
        is "$rc" 1 "exit status with legacy_tiocsti '$value'"
        has "$T/out.log" "dev.tty.legacy_tiocsti is $([[ $value == missing ]] && echo "not there" || echo "$value"), not 0"
        [[ ! -e "$T/lib" && ! -e "$T/data" ]] && ok || no "something was installed with legacy_tiocsti '$value'"
    done
    rm -f -- "$CK/apps/relay/install-tiocsti.sh" "$T/legacy_tiocsti"
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

    echo "#    the server's shim, run for real: who node runs as, and what it inherits"
    # Started the way PM2 starts it: by root, with an environment of its own.
    (cd / && env SECRET_FROM_PM2=leak PORT=4999 "$T/shim/node-as-relay" -e '
const env = Object.entries(process.env).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(" ");
const caps = require("fs").readFileSync("/proc/self/status", "utf8").match(/^CapEff:\s*(\S+)/m)[1];
console.log(`${process.getuid()} ${process.getgid()} [${process.getgroups()}] caps=${caps} ${env}`);') > "$T/shim.log" 2>&1 || true
    r=$(id -u relay); g=$(id -g relay)
    is "$(cat "$T/shim.log")" "$r $g [$g] caps=0000000000000000 HOME=/nonexistent NODE_ENV=production PATH=/usr/bin:/bin PORT=4999 RELAY_DB=$T/data/relay.db" \
        "uid, gid, groups and the whole environment node gets through the shim"
    # And the installed server itself, through the shim, answering on a port of its own.
    (cd / && PORT=0 exec "$T/shim/node-as-relay" --disable-warning=ExperimentalWarning "$T/lib/server.mjs") > "$T/server.log" 2>&1 &
    spid=$!
    for _ in $(seq 100); do grep -q 'relay listening' "$T/server.log" && break; sleep 0.1; done
    is "$(awk '/^Uid:/ { print $2, $3, $4, $5 }' "/proc/$spid/status" 2>/dev/null)" "$r $r $r $r" "the server process's real, effective, saved and filesystem uid"
    port=$(grep -o 'relay listening on 127.0.0.1:[0-9]*' "$T/server.log" | cut -d: -f2)
    is "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port:-1}/v1/whoami")" 401 "the server, started through the shim, answers"
    kill "$spid" 2>/dev/null || true
    wait "$spid" 2>/dev/null || true

    # What PM2 is told to run: the installed server, through the shim. Without
    # the interpreter line PM2 would start relay-api as root.
    is "$(/usr/local/bin/node -e '
const [app, ...rest] = require(process.argv[1]).apps;
console.log(rest.length, app.name, app.interpreter, app.script, app.cwd);' "$T/etc/relay.config.js")" \
        "0 relay-api /usr/local/lib/benloe/node-as-relay /usr/local/lib/benloe/relay/server.mjs /usr/local/lib/benloe/relay" \
        "the installed PM2 config: one app, run through the shim install.sh writes, from the code it installs"
    grep -q '^SHIM=/usr/local/lib/benloe/node-as-relay$' <(sed -n 's|^cat > \(/usr/local/lib/benloe/node-as-relay\) <<.SHIM.$|SHIM=\1|p' "$REPO/apps/relay/install.sh") && ok \
        || no "install.sh does not write the shim where the PM2 config expects it"

    echo "#    the relay command's wrapper, run for real: the process it leaves behind"
    # `relay send -` waits on its input, which holds it still to be looked at.
    mkfifo "$T/fifo"
    (cd /tmp && exec env SECRET_FROM_ROOT=leak "$T/bin/relay" send - < "$T/fifo" > "$T/wsend.log" 2>&1) &
    wpid=$!
    exec 8> "$T/fifo"
    for _ in $(seq 100); do grep -q cli.mjs "/proc/$wpid/cmdline" 2>/dev/null && break; sleep 0.1; done
    c=$(id -u relay-cli); g=$(id -g relay)
    is "$(awk '/^(Uid|Gid|Groups|CapEff):/ { $1 = ""; printf "%s;", $0 }' "/proc/$wpid/status")" " $c $c $c $c; $g $g $g $g;; 0000000000000000;" \
        "the command's uids, gids, groups and capabilities"
    is "$(tr '\0' ' ' < "/proc/$wpid/environ")" "PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 RELAY_DB=$T/data/relay.db " "its whole environment"
    is "$(readlink "/proc/$wpid/cwd")" / "its working directory"
    echo "held still" >&8
    exec 8>&-
    wait "$wpid" || true
    has "$T/wsend.log" "as claude."

    echo "#    again, over the install just made"
    run "$CK/apps/relay/install.sh"
    is "$rc" 0 "exit status of a second run"
    hasnt "$T/out.log" "Created"
    "$T/bin/relay" log > "$T/log.log" 2>&1 || true
    has "$T/log.log" "written through the installed command"

    echo "#    a re-install that finds the data directory but no database refuses, and creates nothing"
    for f in relay.db relay.db-wal relay.db-shm; do rm -f -- "${T:?}/data/$f"; done
    rm -f -- "$T/lib/cli.mjs" # to see whether any code is copied
    run "$CK/apps/relay/install.sh"
    is "$rc" 1 "exit status with the database gone"
    has "$T/out.log" "holds no relay.db. relay has been installed on this box"
    has "$T/out.log" "Restore it from the newest backup"
    [[ ! -e "$T/data/relay.db" ]] && ok || no "a database was created in place of the lost one"
    [[ ! -e "$T/lib/cli.mjs" ]] && ok || no "code was installed although the database was missing"
    run "$CK/apps/relay/install.sh" --init --init
    is "$rc" 2 "exit status with two arguments"
    run "$CK/apps/relay/install.sh" --inti
    is "$rc" 2 "exit status with a mistyped --init"
    [[ ! -e "$T/data/relay.db" ]] && ok || no "a refused argument created a database"
    echo "#    --init says there never was one: it is created"
    run "$CK/apps/relay/install.sh" --init
    is "$rc" 0 "exit status with --init"
    has "$T/out.log" "Created $T/data/relay.db"
    is "$(mode "$T/data/relay.db")" "relay-cli:relay 660" "the database --init created"
    echo "#    --init over a database that is there changes nothing"
    "$T/bin/relay" send "kept through --init" > /dev/null 2>&1 || true
    run "$CK/apps/relay/install.sh" --init
    is "$rc" 0 "exit status"
    has "$T/out.log" "is already there; nothing was changed"
    "$T/bin/relay" log > "$T/log.log" 2>&1 || true
    has "$T/log.log" "kept through --init"

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
    # (-wal and -shm are still there: the install does not open the database.)
    [[ -f "$T/data/relay.db-wal" && -f "$T/data/relay.db-shm" ]] && ok || no "-wal or -shm is gone: something opened the database"
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
echo "#    a test-guard.sh that another uid owns is refused before it is sourced"
chown -R root:root "$G"; chmod -R go-w "$G"
printf 'touch %q\nrefuse_unsafe_tree() { :; }\n' "$T/foreign-guard-ran" > "$G/infra/scripts/test-guard.sh"
chown 61001 "$G/infra/scripts/test-guard.sh"
# (Not this script itself, as above: were its check ever lost, it would
# run this part again inside itself.)
for test in benloe-promote.test.sh backup-databases.test.sh; do
    rc=0
    (cd / && bash "$G/infra/scripts/$test") > "$T/guard.log" 2>&1 || rc=$?
    is "$rc" 1 "$test with a foreign test-guard.sh: exit status"
    has "$T/guard.log" "test-guard.sh is not root's alone, so test-guard.sh is not sourced"
    [[ ! -e "$T/foreign-guard-ran" ]] && ok || no "$test sourced a test-guard.sh that another uid owns"
    rm -f -- "$T/foreign-guard-ran"
done
cp "$HERE/test-guard.sh" "$G/infra/scripts/test-guard.sh"
chown -R root:root "$G"; chmod -R go-w "$G"
rc=0
(cd / && bash "$G/infra/scripts/benloe-promote.test.sh") > "$T/guard.log" 2>&1 || rc=$?
is "$rc" 0 "the same tree, once it is root's alone, runs"

echo "$checks checks, $bad failed, $skipped part(s) skipped"
[[ $bad -eq 0 ]]
