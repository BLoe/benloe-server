#!/bin/bash
# Tests backup-databases.sh against throwaway trees. It has to run as root
# (it gives files to other uids and drops to them), and root does not run
# code out of a tree another uid can write, so run it from a checkout made by
# benloe-promote:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/backup-databases.test.sh
# Started from /srv/benloe it refuses (see test-guard.sh).
#
# It reads nothing outside the directory it creates under /var/tmp (a place
# the unprivileged test uids can reach) and removes that directory on exit.
# The databases are owned by numeric uids that need no account: 61001-61005.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo "must run as root: it gives files to other uids" >&2; exit 1; }

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SCRIPT=$HERE/backup-databases.sh
# shellcheck source=infra/scripts/test-guard.sh
. "$HERE/test-guard.sh"
refuse_unsafe_tree "$HERE/backup-databases.test.sh" "$SCRIPT" "$HERE/test-guard.sh"
T=$(mktemp -d /var/tmp/backup-test.XXXXXX)
trap 'rm -rf -- "${T:?}"' EXIT
chmod 711 "$T"
checks=0
bad=0
ok() { checks=$((checks + 1)); }
no() { checks=$((checks + 1)); bad=$((bad + 1)); echo "NOT OK: $1"; }
has() { if grep -qF -- "$2" "$1"; then ok; else no "expected in $1: $2"; fi; }
hasnt() { if grep -qF -- "$2" "$1"; then no "not expected in $1: $2"; else ok; fi; }
is() { if [[ "$1" == "$2" ]]; then ok; else no "$3: got '$1', wanted '$2'"; fi; }

# <path> <uid> <rows> [wal|delete]   A database with a table t of that many rows.
mkdb() {
    python3 -I -c '
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("pragma journal_mode=" + sys.argv[3])
c.execute("create table t(x)")
c.executemany("insert into t values(?)", [("row %d" % i * 30,) for i in range(int(sys.argv[2]))])
c.commit()
' "$1" "$3" "${4:-wal}"
    chown "$2:$2" "$1"* "$(dirname "$1")"
}
rows() { python3 -I -c 'import sqlite3,sys; print(sqlite3.connect("file:"+sys.argv[1]+"?mode=ro", uri=True).execute("select count(*) from t").fetchone()[0])' "$1"; }
run() { # <name of this run> [VAR=value ...]; output in $T/<name>.log, exit status in $rc
    local name=$1; shift
    rc=0
    env BENLOE_DATA_DIR="$T/data" BENLOE_LIB_DIR="$T/lib" "$@" bash "${SCRIPT_UNDER_TEST:-$SCRIPT}" "$T/out" > "$T/$name.log" 2>&1 || rc=$?
    last=$(ls -d "$T"/out/2*_* | tail -1)
    sleep 1 # run folders are named to the second
}

mkdir -p "$T/data/sub" "$T/data/rootdir" "$T/lib/benloe-relay" "$T/lib/artanis" "$T/lib/benloe-secrets" "$T/out"
chmod 755 "$T/data" "$T/lib"
mkdb "$T/data/a.db" 61001 300
mkdb "$T/data/sub/b.db" 61001 20
mkdb "$T/data/artanis.db" 61001 7          # same file name as one under lib/
mkdb "$T/data/relay.db" 61001 8
mkdb "$T/data/rootdir/r.db" 0 40; chmod 755 "$T/data/rootdir"
mkdb "$T/lib/benloe-relay/relay.db" 61002 11; chmod 700 "$T/lib/benloe-relay"
mkdb "$T/lib/artanis/artanis.db" 61003 12 delete; chmod 700 "$T/lib/artanis"
mkdb "$T/lib/benloe-secrets/secrets.db" 61004 13; chmod 700 "$T/lib/benloe-secrets"
chown 61001 "$T/data"

echo "# 1. a clean run saves everything, each source under its own folder"
for old in 20200101_000000 20200102_000000 20200103_000000 20200104_000000; do mkdir "$T/out/$old"; touch "$T/out/$old/COMPLETE"; done
mkdir "$T/out/20200105_000000" "$T/out/keep-me" "$T/out/$(date -u +%Y%m%d)_000000"   # incomplete old, not a run, incomplete recent
echo "left by an earlier failure" > "$T/out/LAST-RUN-FAILED"
run clean
is "$rc" 0 "exit status of a clean run"
[[ ! -e "$T/out/LAST-RUN-FAILED" ]] && ok || no "a clean run removes LAST-RUN-FAILED"
has "$T/clean.log" "8 database(s), 0 failure(s)"
[[ -f "$last/COMPLETE" ]] && ok || no "a clean run leaves COMPLETE"
is "$(rows "$last/data/a.db")" 300 "rows in data/a.db"
is "$(rows "$last/data/sub/b.db")" 20 "rows in data/sub/b.db"
is "$(rows "$last/data/rootdir/r.db")" 40 "rows in the root-owned database"
is "$(rows "$last/data/artanis.db")" 7 "data/artanis.db is the data folder's"
is "$(rows "$last/var-lib/artanis/artanis.db")" 12 "var-lib/artanis/artanis.db is the service's"
is "$(rows "$last/data/relay.db")" 8 "data/relay.db is the data folder's"
is "$(rows "$last/var-lib/benloe-relay/relay.db")" 11 "var-lib/benloe-relay/relay.db is the service's"
is "$(rows "$last/var-lib/benloe-secrets/secrets.db")" 13 "rows in secrets.db"
is "$(find "$last" ! -user root -o -perm /077 | wc -l)" 0 "everything in the backup is root's alone"
is "$(stat -c '%u %a' "$T/lib/benloe-relay/relay.db")" "61002 644" "the source's owner and mode are as they were"
is "$(find "$T/data" "$T/lib" -user root ! -path "$T/data/rootdir*" ! -path "$T/lib" | wc -l)" 0 "root created nothing in the source folders"
echo "#    pruning on a clean run: this run and the two newest old COMPLETE ones stay"
is "$(cd "$T/out" && ls -d 2020* | tr '\n' ' ')" "20200103_000000 20200104_000000 " "old runs left"
[[ -d "$T/out/keep-me" && -d "$T/out/$(date -u +%Y%m%d)_000000" ]] && ok || no "a folder that is not an old run was deleted"
has "$T/clean.log" "pruned 3 run(s)"

echo "# 2. things that cannot be backed up fail one by one; the rest are still saved"
ln -s /etc/passwd "$T/data/link.db"
ln -s "$T/lib/artanis/artanis.db" "$T/data/link2.db"
mkfifo "$T/data/fifo.db"
mkdir "$T/data/dir.db"
: > "$T/data/empty.db"
head -c 20000 /dev/urandom > "$T/data/garbage.db"
python3 -I -c 'import sys; b=bytearray(open(sys.argv[1],"rb").read()); b[4096*3:4096*3+300]=b"\xff"*300; open(sys.argv[2],"wb").write(b)' "$last/data/a.db" "$T/data/corrupt.db"
truncate -s 600M "$T/data/huge.db"
# A database that passes the read and fails the check with a message that
# quotes a column name, and a column name made of a newline and a fake log line.
python3 -I -c '
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("create table t(\"c\n  ok    forged/line.db\")")
c.execute("insert into t values (NULL)")
c.execute("pragma writable_schema=on")
c.execute("update sqlite_master set sql = replace(sql, \")\", \" NOT NULL)\")")
c.commit()
' "$T/data/forger.db"
cp "$last/data/a.db" "$T/data/odd name.db"
cp "$last/data/a.db" "$T/data/rootfile.db"           # root-owned, in a folder another uid can write
chown 61001 "$T/data/empty.db" "$T/data/garbage.db" "$T/data/corrupt.db" "$T/data/huge.db" "$T/data/odd name.db" "$T/data/forger.db"
mv "$T/lib/artanis/artanis.db" "$T/lib/artanis/gone"
mkdir "$T/out/20200106_000000"                        # old and incomplete
echo "left by an earlier failure" > "$T/out/LAST-RUN-FAILED"
run hostile
is "$rc" 1 "exit status of a run with failures"
[[ -e "$T/out/LAST-RUN-FAILED" ]] && ok || no "a failed run leaves LAST-RUN-FAILED alone"
rm "$T/out/LAST-RUN-FAILED"
has "$T/hostile.log" "FAIL  data/link.db is not a database file (it is a symbolic link)"
has "$T/hostile.log" "FAIL  data/link2.db is not a database file (it is a symbolic link)"
has "$T/hostile.log" "FAIL  data/fifo.db is not a database file (it is a fifo)"
has "$T/hostile.log" "FAIL  data/dir.db is not a database file (it is a directory)"
has "$T/hostile.log" "FAIL  data/empty.db is not a database file (it is a regular empty file)"
has "$T/hostile.log" "FAIL  data/garbage.db"
has "$T/hostile.log" "check failed"
has "$T/hostile.log" "FAIL  data/corrupt.db"
has "$T/hostile.log" "FAIL  data/huge.db is 600 MB; this script stops at 512 MB"
has "$T/hostile.log" "FAIL  data/odd\\ name.db (name has characters this script does not accept)"
has "$T/hostile.log" "its directory is not root-owned"
has "$T/hostile.log" "FAIL  data/rootfile.db"
has "$T/hostile.log" "FAIL  var-lib/artanis/artanis.db is missing"
has "$T/hostile.log" "FAIL  data/forger.db"
has "$T/hostile.log" 'NULL value in t.c\n  ok    forged/line.db'
is "$(grep -c '^  ok    forged' "$T/hostile.log" || true)" 0 "text from inside a database starts no line of the log"
has "$T/hostile.log" "7 database(s), 12 failure(s)"
has "$T/hostile.log" "ok    var-lib/benloe-secrets/secrets.db"
[[ ! -e "$last/COMPLETE" ]] && ok || no "a run with failures must not be marked COMPLETE"
is "$(cd "$last" && find . -type f | sort | tr '\n' ' ')" "./data/a.db ./data/artanis.db ./data/relay.db ./data/rootdir/r.db ./data/sub/b.db ./var-lib/benloe-relay/relay.db ./var-lib/benloe-secrets/secrets.db " "files in a failed run: the good ones only, no leftovers"
is "$(rows "$last/data/artanis.db")" 7 "the data folder's artanis.db did not take the missing service database's place"
echo "#    pruning on a failed run still happens, and keeps the three newest COMPLETE runs"
[[ ! -e "$T/out/20200106_000000" ]] && ok || no "an old incomplete run survived a failing night"
is "$(cd "$T/out" && ls -d 2020* | tr '\n' ' ')" "20200103_000000 20200104_000000 " "old COMPLETE runs left after a failed run"
mv "$T/lib/artanis/gone" "$T/lib/artanis/artanis.db"
rm -rf "$T/data/"{link.db,link2.db,fifo.db,dir.db,empty.db,garbage.db,corrupt.db,huge.db,"odd name.db",rootfile.db,forger.db}

echo "# 3. a root-owned database is not read from a folder its group can write"
chmod 775 "$T/data/rootdir"
run groupwritable
has "$T/groupwritable.log" "its directory is writable by group or other"
has "$T/groupwritable.log" "FAIL  data/rootdir/r.db"
chmod 755 "$T/data/rootdir"
echo "#    nor a database, -wal or -shm that somebody else could have written"
for f in r.db r.db-wal r.db-shm; do
    [[ -e "$T/data/rootdir/$f" ]] || { no "the test expected $f to exist"; continue; }
    chmod 664 "$T/data/rootdir/$f"
    run "writable-$f"
    has "$T/writable-$f.log" "$f is writable by group or other"
    has "$T/writable-$f.log" "FAIL  data/rootdir/r.db"
    chmod 644 "$T/data/rootdir/$f"
    [[ $f == r.db ]] && continue   # a database another uid owns is simply read as that uid
    chown 61001 "$T/data/rootdir/$f"
    run "owned-$f"
    has "$T/owned-$f.log" "$f is not a regular file owned by root"
    has "$T/owned-$f.log" "FAIL  data/rootdir/r.db"
    chown 0 "$T/data/rootdir/$f"
done

echo "# 4. find failing is a failure, and what it did list is still saved"
mkdir "$T/fakebin"
printf '#!/bin/bash\nprintf "a.db\\0"\necho "find: cannot read sub: Input/output error" >&2\nexit 1\n' > "$T/fakebin/find"
chmod 755 "$T/fakebin/find"
run findfails PATH="$T/fakebin:$PATH"
is "$rc" 1 "exit status when find fails"
has "$T/findfails.log" "FAIL  listing $T/data"
has "$T/findfails.log" "ok    data/a.db"

echo "# 5. a read that never finishes is killed, logged, and the run goes on"
mkdb "$T/data/locked.db" 61001 5 delete
setpriv --reuid=61001 --regid=61001 --clear-groups python3 -I -c '
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1], isolation_level=None)
c.execute("begin exclusive")
print("locked", flush=True)
time.sleep(30)
' "$T/data/locked.db" > "$T/locker.out" &
locker=$!
for _ in $(seq 50); do grep -q locked "$T/locker.out" && break; sleep 0.1; done
sed 's/^STEP_SECS=90$/STEP_SECS=2/' "$SCRIPT" > "$T/quick.sh"
cmp -s "$SCRIPT" "$T/quick.sh" && no "the test could not shorten STEP_SECS" || ok
SCRIPT_UNDER_TEST="$T/quick.sh" run stuck
kill "$locker" 2>/dev/null || true
wait "$locker" 2>/dev/null || true
has "$T/stuck.log" "killed: still running after 2s"
has "$T/stuck.log" "FAIL  data/locked.db"
has "$T/stuck.log" "ok    var-lib/benloe-relay/relay.db"
has "$T/stuck.log" "8 database(s), 1 failure(s)"
is "$(pgrep -u 61001 -c || true)" 0 "no reader left running"

echo "# 6. no data folder, or a symlink where it should be"
ln -s "$T/data" "$T/datalink"
run nodata BENLOE_DATA_DIR="$T/datalink"
has "$T/nodata.log" "FAIL  $T/datalink is missing or is not a directory"
has "$T/nodata.log" "FAIL  data/a.db was in the last complete backup"
has "$T/nodata.log" "3 database(s), 6 failure(s)"

echo "# 7. a database the last complete run had, and this run cannot find, is a failure until it is retired"
rm -f "$T/data/locked.db"*
run again
is "$rc" 0 "exit status of a clean run after the failures"
has "$T/again.log" "8 database(s), 0 failure(s)"
complete_before=$last
mkdir "$T/data/sub/deeper"
mv "$T/data/sub/"b.db* "$T/data/sub/deeper/"          # two folders down: outside what the script looks at
chown 61001 "$T/data/sub/deeper"
run moved
is "$rc" 1 "exit status when a database has gone missing from the list"
has "$T/moved.log" "FAIL  data/sub/b.db was in the last complete backup (${complete_before##*/}) and was not found this time"
has "$T/moved.log" "7 database(s), 1 failure(s)"
[[ ! -e "$last/COMPLETE" ]] && ok || no "a run that lost a database must not be COMPLETE"
run moved-again
has "$T/moved-again.log" "FAIL  data/sub/b.db was in the last complete backup (${complete_before##*/})"
echo "data/sub/b.db" > "$T/out/RETIRED"
run retired
is "$rc" 0 "exit status once the missing database is listed in RETIRED"
has "$T/retired.log" "7 database(s), 0 failure(s)"
[[ -f "$last/COMPLETE" ]] && ok || no "COMPLETE after retiring"

echo "$checks checks, $bad failed"
[[ $bad -eq 0 ]]
