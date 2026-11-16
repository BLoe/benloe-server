#!/bin/bash
# Installs the nightly database backup: the script root runs, and the systemd
# service and timer that run it. All three are copied from the checkout this
# script is running in.
#
#   infra/scripts/backup-databases.sh      -> /usr/local/sbin/benloe-db-backup.sh
#   infra/systemd/benloe-db-backup.service -> /etc/systemd/system/
#   infra/systemd/benloe-db-backup.timer   -> /etc/systemd/system/
#
# Then: systemctl daemon-reload, and the timer is enabled and started.
#
# Run it through benloe-promote, after any change to those three files and on
# a new box, so that what root will run every night comes from a commit on
# GitHub and not from the claude-worker-owned working tree:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/install-db-backup.sh
set -euo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# First, before anything is changed. This catches a mistake (running the
# working-tree copy), not an attacker: whoever can edit this file can delete
# the check. What makes the copies trustworthy is benloe-promote's checkout.
case "$SRC" in
    /opt/benloe-src/*/infra/scripts) ;;
    *)
        echo "Run this through benloe-promote, with the commit id taken from GitHub:" >&2
        echo "  benloe-promote \"\$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)\" infra/scripts/install-db-backup.sh" >&2
        exit 1
        ;;
esac
[[ $(id -u) -eq 0 ]] || { echo "install-db-backup: must run as root" >&2; exit 1; }
UNITS=${SRC%/scripts}/systemd

install -o root -g root -m 0755 "$SRC/backup-databases.sh" /usr/local/sbin/benloe-db-backup.sh
install -o root -g root -m 0644 "$UNITS/benloe-db-backup.service" "$UNITS/benloe-db-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now benloe-db-backup.timer
echo "installed /usr/local/sbin/benloe-db-backup.sh and benloe-db-backup.{service,timer} from $SRC; timer enabled"
