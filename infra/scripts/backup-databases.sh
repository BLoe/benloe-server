#!/bin/bash
#
# Nightly snapshot of the SQLite databases listed here, and of no others. A
# database anywhere else on the box (an app that keeps its data and its own
# backups under its own /var/lib directory, say) is not covered by this
# script until it is added below.
#
#   /srv/benloe/data/*.db and one level of subdirectories (cabinet/, ...)
#   /var/lib/benloe-relay/relay.db   (the Benji <-> Claude message channel)
#   /var/lib/artanis/artanis.db      (sign-in accounts)
#   /var/lib/benloe-secrets/secrets.db (the encrypted secret store; ciphertext)
#
# Output: /var/backups/benloe/<timestamp>/, root-only, laid out like the
# sources so that two databases can never want the same name:
#   data/<path under /srv/benloe/data>      e.g. data/cabinet/cabinet.db
#   var-lib/<directory>/<file>              e.g. var-lib/benloe-relay/relay.db
# A run in which every one of them was saved leaves a file named COMPLETE there.
#
# A database that was in the last COMPLETE run and is simply not found this
# time (moved deeper than one folder, renamed with another suffix, deleted)
# is a failure, not a smaller backup. If it was retired on purpose, add its
# path as it appears in the backup (data/old.db) as a line of
# /var/backups/benloe/RETIRED, and the run stops asking for it.
#
# Kept: 14 days. Older runs are deleted at the end of every run, whether or
# not it had failures, except that the newest three COMPLETE runs are kept
# however old they are. So through a long stretch of failing nights the
# backups stop growing after 14 days, and the last good copies are still
# there. Only folders in the backup root named like a run (YYYYMMDD_HHMMSS)
# are ever deleted; that includes runs left there by earlier revisions of
# this script, which have no COMPLETE file and go at 14 days. Nothing outside
# the backup root is touched: the script this one replaced wrote its runs to
# /srv/benloe/backups, and any still there are not cleaned up by this one.
#
# WHO HEARS ABOUT A FAILURE. Nobody is paged. A run with any failure exits 1,
# which fails benloe-db-backup.service; that starts
# benloe-db-backup-failed.service, which writes an error line to the journal
# and, if /var/backups is writable, /var/backups/benloe/LAST-RUN-FAILED. A
# clean run removes the file. It is there to be looked for: `systemctl
# is-failed benloe-db-backup.service`, or the file.
#
# Restore: stop the service; as the uid that owns the live database, remove
# its -wal and -shm and write the snapshot over it, keeping the live file's
# group and mode; start the service. (apps/relay/CLAUDE.md has the exact
# command for the relay's.)
#
# Runs from benloe-db-backup.timer as an INSTALLED copy,
# /usr/local/sbin/benloe-db-backup.sh. After editing this file, commit, push,
# and install it from GitHub, never from the working tree:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/install-db-backup.sh
#
# Usage: benloe-db-backup.sh [backup-root]
#
# HOW A DATABASE IS READ. Every one of these files sits in a directory some
# other uid controls: a service's own under /var/lib, claude-worker's under
# /srv/benloe/data. That uid can put anything at the path between two looks
# at it: a symlink, a FIFO, a directory. So, with the one exception at the end
# of this comment, root never opens the path, and it never creates, copies or
# deletes anything beside it:
#
#   - The file is read by a process running as the uid and gid that own it,
#     with no other groups. Whatever the path has become, that process can
#     only reach what the owner could already reach.
#   - The read is SQLite's own (read-only connection, serialize), so it is a
#     consistent snapshot of a live WAL database. It goes to stdout, which
#     root has opened on a new file in the root-only backup directory.
#   - The result is checked (PRAGMA quick_check) by a process running as
#     `nobody`, reading the snapshot on stdin. Root does not parse it.
#   - A read or a check still running after STEP_SECS is killed. Both hold
#     the whole database in memory, so both run under an address-space limit
#     (MEM_LIMIT_MB) and a database file over MAX_DB_MB is not attempted, so
#     a file somebody inflates fails its own backup instead of taking the
#     machine's memory.
#   - A snapshot that fails any step is deleted and logged as FAIL, and the
#     run goes on to the next database.
#
# A database owned by root (gavel's) is the one case root reads itself. Its
# path still runs through claude-worker's directories, so the directory is
# first pinned by a bind mount inside a private mount namespace, and it is
# read only if that pinned directory is root-owned and writable by nobody
# else. See read_root_owned.

set -euo pipefail

# The two source roots can be pointed elsewhere to test the script.
DATA_DIR="${BENLOE_DATA_DIR:-/srv/benloe/data}"
LIB_DIR="${BENLOE_LIB_DIR:-/var/lib}"
BACKUP_ROOT="${1:-/var/backups/benloe}"
KEEP_DAYS=14
KEEP_COMPLETE=3
STEP_SECS=90
MAX_DB_MB=512
MEM_LIMIT_MB=2048
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%d_%H%M%S)"

# Nothing below is run from, or hands on, whatever directory the caller was in.
cd /
# Run names are compared and sorted as plain bytes.
export LC_ALL=C
umask 077
mkdir -p "$BACKUP_DIR"
echo "$(date -u +%FT%TZ) backing up to $BACKUP_DIR"

count=0
failed=0
fail() { # <what, as it should appear in the log>
    echo "  FAIL  $1"
    failed=$((failed + 1))
}

# What the two snippets below print when they fail ends up in root's log, and
# an error from SQLite can quote names out of the database it was reading. It
# is printed with %r (quoted, control characters and newlines escaped) and cut
# at 300 characters, so a database cannot write a line of its own into the log.
#
# Run as the database's owner. On a WAL database that no process has open,
# even a read-only connection creates the -wal and -shm files, and it cannot
# remove them afterwards. SQLite gives them the database file's own mode
# (whatever the umask), and they are created by the database's owner with the
# database's group, so they are files the service could have made itself.
READER='
import resource, sqlite3, sys, urllib.parse
try:
    lim = int(sys.argv[2]) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (lim, lim))
    c = sqlite3.connect("file:" + urllib.parse.quote(sys.argv[1]) + "?mode=ro", uri=True, timeout=5)
    sys.stdout.buffer.write(c.serialize())
    sys.stdout.buffer.flush()
except BaseException as e:
    sys.exit("        read failed: %.300r" % (str(e) or type(e).__name__))
'

# Run as nobody, snapshot on stdin. A snapshot of a WAL-mode database carries
# that mode in its header (bytes 18 and 19 are 2) and SQLite refuses to open
# such an image from memory, so the in-memory copy is marked as rollback-mode
# (1) for the check. The file in the backup is not changed.
CHECKER='
import resource, sqlite3, sys
try:
    lim = int(sys.argv[1]) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (lim, lim))
    data = bytearray(sys.stdin.buffer.read())
    if bytes(data[18:20]) == b"\x02\x02":
        data[18:20] = b"\x01\x01"
    c = sqlite3.connect(":memory:")
    c.deserialize(data)
    del data
    rows = c.execute("PRAGMA quick_check").fetchall()
except BaseException as e:
    sys.exit("        check failed: %.300r" % (str(e) or type(e).__name__))
sys.exit(0 if rows == [("ok",)] else "        quick_check: %.300r" % (rows[:3],))
'

# Runs a command with only PATH in its environment and no open files beyond 0,
# 1 and 2 (subprocess closes the rest; every call below redirects 0 itself,
# to /dev/null or to the snapshot being checked), and kills it (SIGKILL, from
# this root process) if it is still going after STEP_SECS; exits 124 then. KILL
# and not TERM: another process with the reader's uid can stop it (SIGSTOP),
# and a stopped process never acts on TERM. coreutils' timeout is not used:
# the one this box ships (uutils 0.2.2) was seen to wait out a command that
# ignores TERM, with -k and with -s KILL alike.
LIMITER='
import subprocess, sys
try:
    sys.exit(subprocess.run(sys.argv[2:], timeout=float(sys.argv[1])).returncode)
except subprocess.TimeoutExpired:
    sys.exit(124)
'
limited() { # <command...>
    /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -c "$LIMITER" "$STEP_SECS" "$@"
}

as_uid() { # <uid> <gid> <command...>
    local uid=$1 gid=$2
    shift 2
    limited /usr/bin/setpriv --reuid="$uid" --regid="$gid" --clear-groups "$@"
}

# <directory> <file name>. Snapshot to stdout, read by root.
#
# The directory is opened once and that one directory is bind-mounted at a
# path only root controls, inside a mount namespace of this command's own.
# Renaming or replacing things under /srv/benloe/data afterwards does not
# change what is mounted. It is then read only if it is root-owned and not
# writable by group or other, which means every name in it (the database, its
# -wal and -shm) is one that only root could have put there; and only if each
# of those three that exists is itself a regular file, root-owned and not
# writable by group or other, so that what root parses is something only
# root could have written.
read_root_owned() {
    local mnt rc=0
    mnt=$(mktemp -d "$BACKUP_DIR/.mnt.XXXXXX") || return 1
    # shellcheck disable=SC2016  # the inner script is single-quoted on purpose
    limited /usr/bin/unshare --mount --propagation private -- /bin/bash -c '
            exec 3<"$1" || exit 1
            mount --no-canonicalize --bind /proc/self/fd/3 "$2" || exit 1
            [[ "$(stat -L -c %d:%i /proc/self/fd/3)" == "$(stat -c %d:%i "$2")" ]] || exit 1
            [[ "$(stat -c %u "$2")" == 0 ]] || { echo "        its directory is not root-owned" >&2; exit 1; }
            (( (0$(stat -c %a "$2") & 022) == 0 )) || { echo "        its directory is writable by group or other" >&2; exit 1; }
            for f in "$2/$3" "$2/$3-wal" "$2/$3-shm"; do
                [[ -e "$f" || -L "$f" ]] || continue
                [[ "$(stat -c "%u %F" "$f")" == "0 regular"* ]] || { echo "        ${f##*/} is not a regular file owned by root" >&2; exit 1; }
                (( (0$(stat -c %a "$f") & 022) == 0 )) || { echo "        ${f##*/} is writable by group or other" >&2; exit 1; }
            done
            exec /usr/bin/python3 -I -c "$4" "$2/$3" "$5"
        ' _ "$1" "$mnt" "$2" "$READER" "$MEM_LIMIT_MB" < /dev/null || rc=$?
    # Empty again once the namespace is gone. If it will not go, say so: the
    # snapshot itself is not affected.
    rmdir "$mnt" || echo "        could not remove $mnt" >&2
    return "$rc"
}

# Every path this run looked for, saved or not.
declare -A attempted=()

snapshot() { # <path of the database> <its path inside the backup, which is also its name in the log>
    local path=$1 label=$2 dest="$BACKUP_DIR/$2" uid gid size kind
    attempted[$label]=1
    # Cannot happen while the two source roots have their own folders in the
    # backup; if it ever does, nothing is overwritten.
    if [[ -e "$dest" || -L "$dest" ]]; then
        fail "$label (already in this backup)"
        return
    fi
    # stat without -L describes the name itself, not what a symlink points at.
    if ! read -r uid gid size kind < <(stat -c '%u %g %s %F' -- "$path" 2>/dev/null); then
        fail "$label is missing"
        return
    fi
    if [[ "$kind" != "regular file" ]]; then
        fail "$label is not a database file (it is a $kind)"
        return
    fi
    if (( size > MAX_DB_MB * 1024 * 1024 )); then
        fail "$label is $((size / 1024 / 1024)) MB; this script stops at $MAX_DB_MB MB"
        return
    fi
    if ! mkdir -p -- "$(dirname -- "$dest")"; then
        fail "$label (could not create its folder in the backup)"
        return
    fi
    local ok=0
    if [[ "$uid" -eq 0 ]]; then
        read_root_owned "$(dirname -- "$path")" "$(basename -- "$path")" > "$dest" || ok=$?
    else
        as_uid "$uid" "$gid" /usr/bin/python3 -I -c "$READER" "$path" "$MEM_LIMIT_MB" > "$dest" < /dev/null || ok=$?
    fi
    if [[ $ok -eq 0 && ! -s "$dest" ]]; then
        echo "        the read produced nothing"
        ok=1
    fi
    if [[ $ok -eq 0 ]]; then
        as_uid 65534 65534 /usr/bin/python3 -I -c "$CHECKER" "$MEM_LIMIT_MB" < "$dest" || ok=$?
    fi
    if [[ $ok -eq 124 ]]; then
        echo "        killed: still running after ${STEP_SECS}s"
    fi
    if [[ $ok -eq 0 ]]; then
        echo "  ok    $label"
        count=$((count + 1))
    else
        # $dest is a file root created in a directory only root can write.
        rm -f -- "$dest" || echo "        could not remove the failed snapshot $dest" >&2
        fail "$label"
    fi
}

# ---- /srv/benloe/data --------------------------------------------------------

# A missing data folder is a failed backup, never "0 databases, fine". find
# does not follow symlinks, so a symlink in its place finds nothing either.
if [[ ! -d "$DATA_DIR" || -L "$DATA_DIR" ]]; then
    fail "$DATA_DIR is missing or is not a directory"
else
    # Everything named like a database is listed, whatever kind of file it is:
    # snapshot() refuses what is not a regular file, and says so. The list
    # goes to a file so that find's own failure is seen: a folder it could not
    # read would otherwise just be databases missing from the backup.
    list="$BACKUP_DIR/.list"
    if ! find "$DATA_DIR" -mindepth 1 -maxdepth 2 \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -not -path "$DATA_DIR/backups/*" -printf '%P\0' > "$list"; then
        fail "listing $DATA_DIR (find reported an error; whatever it could not read is not in this backup)"
    fi
    found=0
    if ! sort -z -o "$list" "$list"; then
        fail "sorting the list of databases under $DATA_DIR"
    fi
    # Read on descriptor 3, so nothing run inside the loop can take it for input.
    while IFS= read -r -d '' -u 3 rel; do
        found=$((found + 1))
        # The name becomes a path in the backup and a line in the log.
        if [[ ! "$rel" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$ || "$rel" =~ (^|/)\.\.?(/|$) ]]; then
            fail "data/$(printf '%q' "$rel") (name has characters this script does not accept)"
            continue
        fi
        snapshot "$DATA_DIR/$rel" "data/$rel"
    done 3< "$list"
    rm -f -- "$list" || fail "removing $list"
    if [[ $found -eq 0 ]]; then
        fail "no databases found under $DATA_DIR"
    fi
fi

# ---- databases under /var/lib, each in its service's own directory -----------

snapshot "$LIB_DIR/benloe-relay/relay.db" var-lib/benloe-relay/relay.db
# Sign-in accounts, and the encrypted secret store (ciphertext only; its key is not in the backup).
snapshot "$LIB_DIR/artanis/artanis.db" var-lib/artanis/artanis.db
snapshot "$LIB_DIR/benloe-secrets/secrets.db" var-lib/benloe-secrets/secrets.db

# ---- what the last complete run had that this one did not look for ----------

# Folders named like runs sort oldest first; the newest COMPLETE one before
# this run is what this run is compared with.
previous=
for d in "$BACKUP_ROOT"/[0-9]*_[0-9]*; do
    [[ "${d##*/}" =~ ^[0-9]{8}_[0-9]{6}$ && "$d" != "$BACKUP_DIR" && -f "$d/COMPLETE" && ! -L "$d" ]] && previous=$d
done
if [[ -n "$previous" ]]; then
    was="$BACKUP_DIR/.previous"
    # Its snapshots, and not the -wal, -shm or -journal that SQLite leaves
    # beside one when somebody opens it to look.
    if ! (cd "$previous" && find . -type f ! -name COMPLETE ! -name '*-wal' ! -name '*-shm' ! -name '*-journal' -printf '%P\0') > "$was" \
        || ! sort -z -o "$was" "$was"; then
        fail "listing the last complete backup, $previous"
    fi
    while IFS= read -r -d '' -u 3 rel; do
        [[ -n "${attempted[$rel]:-}" ]] && continue
        if [[ -f "$BACKUP_ROOT/RETIRED" ]] && grep -qxF -- "$rel" "$BACKUP_ROOT/RETIRED"; then
            continue
        fi
        fail "$(printf '%q' "$rel") was in the last complete backup (${previous##*/}) and was not found this time; if it was retired on purpose, add that path as a line to $BACKUP_ROOT/RETIRED"
    done 3< "$was"
    rm -f -- "$was" || fail "removing $was"
fi

# ---- mark, prune, report -----------------------------------------------------

if [[ $failed -eq 0 ]]; then
    echo "$count database(s) at $(date -u +%FT%TZ)" > "$BACKUP_DIR/COMPLETE" || fail "writing $BACKUP_DIR/COMPLETE"
fi
if [[ $failed -eq 0 ]]; then
    # Left by benloe-db-backup-failed.service after a run that failed.
    rm -f -- "$BACKUP_ROOT/LAST-RUN-FAILED" || fail "removing $BACKUP_ROOT/LAST-RUN-FAILED"
fi

# Runs are folders named by their UTC start time, so names compare as times.
# Only folders with such a name are ever considered. Newest first: the first
# KEEP_COMPLETE that are COMPLETE are kept whatever their age; any other run
# that started more than KEEP_DAYS ago is deleted. This happens on every run,
# failures or not.
cutoff=$(date -u -d "$KEEP_DAYS days ago" +%Y%m%d_%H%M%S) || cutoff=
if [[ ! "$cutoff" =~ ^[0-9]{8}_[0-9]{6}$ ]]; then
    fail "pruning (could not work out the date $KEEP_DAYS days ago; nothing was deleted)"
else
    kept=0
    pruned=0
    # A glob, not a command whose failure could go unnoticed; it sorts oldest
    # first, so walk it backwards.
    runs=("$BACKUP_ROOT"/[0-9]*_[0-9]*)
    for ((i = ${#runs[@]} - 1; i >= 0; i--)); do
        name=${runs[i]##*/}
        [[ "$name" =~ ^[0-9]{8}_[0-9]{6}$ && -d "$BACKUP_ROOT/$name" && ! -L "$BACKUP_ROOT/$name" ]] || continue
        if [[ -f "$BACKUP_ROOT/$name/COMPLETE" && $kept -lt $KEEP_COMPLETE ]]; then
            kept=$((kept + 1))
            continue
        fi
        if [[ "$name" < "$cutoff" ]]; then
            if rm -rf -- "${BACKUP_ROOT:?}/$name"; then
                pruned=$((pruned + 1))
            else
                fail "pruning $BACKUP_ROOT/$name"
            fi
        fi
    done
    if [[ $pruned -gt 0 ]]; then
        echo "  pruned $pruned run(s) older than $KEEP_DAYS days"
    fi
fi

size=$(du -sh -- "$BACKUP_DIR" 2>/dev/null | cut -f1) || size='?'
echo "$(date -u +%FT%TZ) $count database(s), $failed failure(s), ${size:-?}"
[[ $failed -eq 0 ]]
