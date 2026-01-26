#!/bin/bash
#
# Backup SQLite databases to a timestamped directory
#
# Usage:
#   ./backup-databases.sh              # Backup to /srv/benloe/backups/
#   ./backup-databases.sh /path/to    # Backup to custom location
#
# Recommended: Run via cron for automatic backups
#   0 3 * * * /srv/benloe/infra/scripts/backup-databases.sh
#

set -euo pipefail

REPO_DIR="/srv/benloe"
DATA_DIR="$REPO_DIR/data"
BACKUP_ROOT="${1:-$REPO_DIR/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

echo "Backing up databases to: $BACKUP_DIR"

mkdir -p "$BACKUP_DIR"

# Find and backup all SQLite databases
shopt -s nullglob
db_count=0

for db in "$DATA_DIR"/*.db "$DATA_DIR"/*.sqlite "$DATA_DIR"/*.sqlite3; do
    if [[ -f "$db" ]]; then
        db_name=$(basename "$db")
        echo "  Backing up: $db_name"

        # Use sqlite3 backup command for consistency (handles locks properly)
        sqlite3 "$db" ".backup '$BACKUP_DIR/$db_name'"

        ((db_count++))
    fi
done

if [[ $db_count -eq 0 ]]; then
    echo "  No databases found in $DATA_DIR"
    rmdir "$BACKUP_DIR"
    exit 0
fi

echo ""
echo "Backed up $db_count database(s)"
echo ""

# Cleanup old backups (keep last 7 days)
echo "Cleaning up backups older than 7 days..."
find "$BACKUP_ROOT" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null || true

echo "Done!"
