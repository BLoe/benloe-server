#!/bin/bash
# Runs an install or deploy script from a root-owned checkout of one exact,
# already-pushed commit.
#
#   benloe-promote <40-char commit> <script path in the repo> [args...]
#   benloe-promote 5c2a405c4f45b38ae46bbf201babc8927bd154f6 apps/relay/install.sh
#
# WHY. /srv/benloe is owned by claude-worker, the uid another agent on this
# box runs as. A script that root runs from there, or that copies files from
# there, can be swapped between the moment the diff was read and the moment it
# runs; checking a file and then copying it does not close that gap. A commit
# id does: its contents cannot change. So the commit is fetched from GitHub
# (not from the local working tree), unpacked into a directory only root can
# write, and the script runs from that copy. What was reviewed is what runs.
#
# Installed copy: /usr/local/sbin/benloe-promote. After editing this file:
#   install -m 0755 infra/scripts/benloe-promote.sh /usr/local/sbin/benloe-promote
# (that one step is, unavoidably, taken on trust: read the diff first).
set -euo pipefail

REPO_URL=https://github.com/BLoe/benloe-server.git
STORE=/var/lib/benloe-src.git
ROOT=/opt/benloe-src

if [[ $# -lt 2 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: benloe-promote <full 40-character commit id> <script path in the repo> [args...]" >&2
    exit 2
fi
sha=$1
script=$2
shift 2
if [[ "$script" = /* || "$script" == *..* ]]; then
    echo "benloe-promote: the script path is relative to the repo root" >&2
    exit 2
fi

umask 022
dir=$ROOT/$sha
if [[ ! -d "$dir" ]]; then
    [[ -d "$STORE" ]] || git init -q --bare "$STORE"
    # Root's own git settings only; nothing from any working tree is consulted.
    GIT_CONFIG_GLOBAL=/dev/null git --git-dir="$STORE" fetch -q --depth 1 "$REPO_URL" "$sha" \
        || { echo "benloe-promote: commit $sha is not on GitHub. Push it first." >&2; exit 1; }
    got=$(git --git-dir="$STORE" rev-parse --verify -q "FETCH_HEAD^{commit}")
    [[ "$got" == "$sha" ]] || { echo "benloe-promote: fetched $got, wanted $sha" >&2; exit 1; }
    tmp=$(mktemp -d "$ROOT.XXXXXX")
    git --git-dir="$STORE" archive "$sha" | tar -x -C "$tmp"
    mkdir -p "$ROOT"
    mv "$tmp" "$dir"
    chmod 755 "$dir"
fi
[[ -f "$dir/$script" && ! -L "$dir/$script" ]] || { echo "benloe-promote: no $script in $sha" >&2; exit 1; }

echo "benloe-promote: running $script from $dir"
export BENLOE_PROMOTED_COMMIT=$sha
exec bash "$dir/$script" "$@"
