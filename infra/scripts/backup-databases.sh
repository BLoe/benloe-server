#!/bin/bash
#
# Nightly snapshot of every SQLite database on the box.
#
#   /srv/benloe/data/*.db and one level of subdirectories (cabinet/, ...)
#   /var/lib/benloe-relay/relay.db   (the Benji <-> Claude message channel)
#   /var/lib/artanis/artanis.db      (sign-in accounts)
#   /var/lib/benloe-secrets/secrets.db (the encrypted secret store; ciphertext)
#
# Output: /var/backups/benloe/<timestamp>/, root-only, 14 days kept.
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
#   - A read or a check still running after STEP_SECS is killed.
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
STEP_SECS=90
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%d_%H%M%S)"

umask 077
mkdir -p "$BACKUP_DIR"
echo "$(date -u +%FT%TZ) backing up to $BACKUP_DIR"

count=0
failed=0
fail() { # <what, as it should appear in the log>
    echo "  FAIL  $1"
    failed=$((failed + 1))
}

# Run as the database's owner. On a WAL database that no process has open,
# even a read-only connection creates the -wal and -shm files, and it cannot
# remove them afterwards. SQLite gives them the database file's own mode
# (whatever the umask), and they are created by the database's owner with the
# database's group, so they are files the service could have made itself.
READER='
import sqlite3, sys, urllib.parse
try:
    c = sqlite3.connect("file:" + urllib.parse.quote(sys.argv[1]) + "?mode=ro", uri=True, timeout=5)
    sys.stdout.buffer.write(c.serialize())
    sys.stdout.buffer.flush()
except Exception as e:
    sys.exit("        read failed: %s" % e)
'

# Run as nobody, snapshot on stdin. A snapshot of a WAL-mode database carries
# that mode in its header (bytes 18 and 19 are 2) and SQLite refuses to open
# such an image from memory, so the in-memory copy is marked as rollback-mode
# (1) for the check. The file in the backup is not changed.
CHECKER='
import sqlite3, sys
try:
    data = bytearray(sys.stdin.buffer.read())
    if bytes(data[18:20]) == b"\x02\x02":
        data[18:20] = b"\x01\x01"
    c = sqlite3.connect(":memory:")
    c.deserialize(bytes(data))
    rows = c.execute("PRAGMA quick_check").fetchall()
except Exception as e:
    sys.exit("        check failed: %s" % e)
sys.exit(0 if rows == [("ok",)] else "        quick_check: %r" % (rows[:3],))
'

# Runs a command with an empty environment and kills it (SIGKILL, from this
# root process) if it is still going after STEP_SECS; exits 124 then. KILL
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
# -wal and -shm) is one that only root could have put there.
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
            exec /usr/bin/python3 -I -c "$4" "$2/$3"
        ' _ "$1" "$mnt" "$2" "$READER" || rc=$?
    rmdir "$mnt" || true
    return "$rc"
}

snapshot() { # <path of the database> <its name in the backup> <how the log names it>
    local path=$1 dest="$BACKUP_DIR/$2" label=$3 uid gid kind
    if [[ -e "$dest" || -L "$dest" ]]; then
        fail "$label (would overwrite $2)"
        return
    fi
    # stat without -L describes the name itself, not what a symlink points at.
    if ! read -r uid gid kind < <(stat -c '%u %g %F' -- "$path" 2>/dev/null); then
        fail "$label is missing"
        return
    fi
    if [[ "$kind" != "regular file" ]]; then
        fail "$label is not a database file (it is a $kind)"
        return
    fi
    local ok=0
    if [[ "$uid" -eq 0 ]]; then
        read_root_owned "$(dirname -- "$path")" "$(basename -- "$path")" > "$dest" || ok=$?
    else
        as_uid "$uid" "$gid" /usr/bin/python3 -I -c "$READER" "$path" > "$dest" || ok=$?
    fi
    if [[ $ok -eq 0 && ! -s "$dest" ]]; then
        echo "        the read produced nothing"
        ok=1
    fi
    if [[ $ok -eq 0 ]]; then
        as_uid 65534 65534 /usr/bin/python3 -I -c "$CHECKER" < "$dest" || ok=$?
    fi
    if [[ $ok -eq 124 ]]; then
        echo "        killed: still running after ${STEP_SECS}s"
    fi
    if [[ $ok -eq 0 ]]; then
        echo "  ok    $label"
        count=$((count + 1))
    else
        # $dest is a file root created in a directory only root can write.
        rm -f -- "$dest"
        fail "$label"
    fi
}

# ---- /srv/benloe/data --------------------------------------------------------

# A missing data folder is a failed backup, never "0 databases, fine". find
# does not follow symlinks, so a symlink in its place finds nothing either.
found=0
if [[ ! -d "$DATA_DIR" || -L "$DATA_DIR" ]]; then
    fail "$DATA_DIR is missing or is not a directory"
else
    # Everything named like a database is listed, whatever kind of file it is:
    # snapshot() refuses what is not a regular file, and says so.
    while IFS= read -r -d '' rel; do
        found=$((found + 1))
        # The name becomes a file name in the backup and a line in the log.
        if [[ ! "$rel" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$ ]]; then
            fail "data/$(printf '%q' "$rel") (name has characters this script does not accept)"
            continue
        fi
        # '__' for the folder separator, so data/a_b.db and data/a/b.db cannot land on one file.
        snapshot "$DATA_DIR/$rel" "${rel//\//__}" "data/$rel"
    done < <(find "$DATA_DIR" -mindepth 1 -maxdepth 2 \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -not -path "$DATA_DIR/backups/*" -printf '%P\0' 2>/dev/null | sort -z)
    if [[ $found -eq 0 ]]; then
        fail "no databases found under $DATA_DIR"
    fi
fi

# ---- databases under /var/lib, each in its service's own directory -----------

snapshot "$LIB_DIR/benloe-relay/relay.db" relay.db relay.db
# Sign-in accounts, and the encrypted secret store (ciphertext only; its key is not in the backup).
snapshot "$LIB_DIR/artanis/artanis.db" artanis.db artanis.db
snapshot "$LIB_DIR/benloe-secrets/secrets.db" benloe-secrets.db benloe-secrets.db

# Old snapshots are only cleared after a clean run: when backups are failing,
# the last good ones are what is left.
if [[ $failed -eq 0 ]]; then
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
else
    echo "  old snapshots kept: this run had failures"
fi

echo "$(date -u +%FT%TZ) $count database(s), $failed failure(s), $(du -sh "$BACKUP_DIR" | cut -f1)"
[[ $failed -eq 0 ]]
