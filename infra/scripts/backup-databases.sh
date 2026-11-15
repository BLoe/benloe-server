#!/bin/bash
#
# Nightly snapshot of every SQLite database on the box.
#
#   /srv/benloe/data/*.db and one level of subdirectories (cabinet/, ...)
#   /var/lib/benloe-relay/relay.db   (the Benji <-> Claude message channel)
#
# Output: /var/backups/benloe/<timestamp>/, root-only, 14 days kept.
# Restore: stop the service, copy the file back over the live one (remove
# its -wal and -shm), start the service.
#
# Runs from benloe-db-backup.timer as an INSTALLED copy,
# /usr/local/sbin/benloe-db-backup.sh; after editing this file:
#   install -m 0755 infra/scripts/backup-databases.sh /usr/local/sbin/benloe-db-backup.sh
#
# Usage: benloe-db-backup.sh [backup-root]

set -euo pipefail

DATA_DIR="${BENLOE_DATA_DIR:-/srv/benloe/data}"       # overridable for testing only
RELAY_DIR="${BENLOE_RELAY_DIR:-/var/lib/benloe-relay}"
BACKUP_ROOT="${1:-/var/backups/benloe}"
KEEP_DAYS=14
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%d_%H%M%S)"

umask 077
mkdir -p "$BACKUP_DIR"
echo "$(date -u +%FT%TZ) backing up to $BACKUP_DIR"

count=0
failed=0

# A missing or unreadable data folder is a failed backup, never "0 databases, fine".
if [[ ! -d "$DATA_DIR" || ! -r "$DATA_DIR" ]]; then
    echo "  FAIL  $DATA_DIR is missing or unreadable"
    failed=$((failed + 1))
fi

# sqlite3's .backup takes a consistent snapshot of a live WAL database.
# These directories are writable by other uids: find does not follow
# symlinks and -type f skips them. Names with a quote would break the
# .backup argument, so they are skipped and counted as failures.
while IFS= read -r -d '' db; do
    # '__' for the folder separator, so data/a_b.db and data/a/b.db cannot land on one file.
    name=$(realpath --relative-to="$DATA_DIR" "$db" | sed 's#/#__#g')
    if [[ -e "$BACKUP_DIR/$name" ]]; then
        echo "  FAIL  $db (would overwrite $name)"
        failed=$((failed + 1))
        continue
    fi
    if [[ "$db" == *"'"* || -L "$db" ]]; then
        echo "  FAIL  $db (unsafe name)"
        failed=$((failed + 1))
        continue
    fi
    if sqlite3 "$db" ".timeout 5000" ".backup '$BACKUP_DIR/$name'"; then
        echo "  ok    data/${name}"
        count=$((count + 1))
    else
        echo "  FAIL  $db"
        failed=$((failed + 1))
    fi
done < <(find "$DATA_DIR" -maxdepth 2 -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -not -path '*/backups/*' -print0 2>/dev/null | sort -z)

if [[ $count -eq 0 && $failed -eq 0 ]]; then
    echo "  FAIL  no databases found under $DATA_DIR"
    failed=$((failed + 1))
fi

# The relay database is read as its own uid: root opening a WAL database can
# leave root-owned -wal/-shm files that lock the service out of it.
if [[ -f "$RELAY_DIR/relay.db" && ! -L "$RELAY_DIR/relay.db" ]]; then
    tmp="$RELAY_DIR/.backup.tmp"
    rm -f "$tmp"
    if setpriv --reuid=relay --regid=relay --init-groups --reset-env \
        /usr/bin/sqlite3 "$RELAY_DIR/relay.db" ".timeout 5000" ".backup '$tmp'" \
        && [[ -f "$tmp" && ! -L "$tmp" ]] && cp --no-dereference "$tmp" "$BACKUP_DIR/relay.db" \
        && [[ -f "$BACKUP_DIR/relay.db" && ! -L "$BACKUP_DIR/relay.db" ]]; then
        echo "  ok    relay.db"
        count=$((count + 1))
    else
        echo "  FAIL  $RELAY_DIR/relay.db"
        failed=$((failed + 1))
    fi
    rm -f "$tmp"
else
    # The relay database is expected on this box; its absence is not a quiet skip.
    echo "  FAIL  $RELAY_DIR/relay.db is missing or is a symlink"
    failed=$((failed + 1))
fi

# Every snapshot must open and pass a check, or it is not a backup.
for f in "$BACKUP_DIR"/*; do
    [[ -f "$f" ]] || continue
    if [[ "$(sqlite3 "$f" 'PRAGMA quick_check;' 2>&1 | head -n1)" != "ok" ]]; then
        echo "  FAIL  $(basename "$f") did not pass quick_check"
        failed=$((failed + 1))
    fi
done

# Old snapshots are only cleared after a clean run: when backups are failing,
# the last good ones are what is left.
if [[ $failed -eq 0 ]]; then
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
else
    echo "  old snapshots kept: this run had failures"
fi

echo "$(date -u +%FT%TZ) $count database(s), $failed failure(s), $(du -sh "$BACKUP_DIR" | cut -f1)"
[[ $failed -eq 0 ]]
