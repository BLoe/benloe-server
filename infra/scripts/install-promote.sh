#!/bin/bash
# Installs benloe-promote itself: copies infra/scripts/benloe-promote.sh from
# the checkout this script is running in to /usr/local/sbin/benloe-promote.
#
# Run it through the benloe-promote that is already installed, so the new copy
# comes from a commit on GitHub and not from the working tree:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/install-promote.sh
#
# On a box that has no benloe-promote yet there is nothing to run it with.
# There, clone the repository from GitHub into a directory only root can
# write and copy the file from that clone by hand; that first copy is taken
# on trust in whatever main held at the time.
set -euo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# First, before anything is changed. This catches a mistake (running the
# working-tree copy), not an attacker: whoever can edit this file can delete
# the check. What makes the copy trustworthy is benloe-promote's checkout.
case "$SRC" in
    /opt/benloe-src/*/infra/scripts) ;;
    *)
        echo "Run this through benloe-promote, with the commit id taken from GitHub:" >&2
        echo "  benloe-promote \"\$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)\" infra/scripts/install-promote.sh" >&2
        exit 1
        ;;
esac
[[ $(id -u) -eq 0 ]] || { echo "install-promote: must run as root" >&2; exit 1; }

install -o root -g root -m 0755 "$SRC/benloe-promote.sh" /usr/local/sbin/benloe-promote
echo "installed /usr/local/sbin/benloe-promote from $SRC"
