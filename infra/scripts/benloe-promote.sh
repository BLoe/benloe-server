#!/bin/bash
# Runs an install or deploy script from a root-owned checkout of one exact
# commit that is on GitHub's main (or, when asked, on another named branch).
#
#   benloe-promote [--branch <name>] <40-char commit> <script path in the repo> [args...]
#
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/relay/install.sh
#   benloe-promote --branch relay 5c2a405c4f45b38ae46bbf201babc8927bd154f6 apps/relay/install.sh
#
# WHY. /srv/benloe is owned by claude-worker, the uid another agent on this
# box runs as. A script that root runs from there, or that copies files from
# there, can be swapped between the moment the diff was read and the moment it
# runs; checking a file and then copying it does not close that gap. A commit
# id does: its contents cannot change. So the commit is fetched from GitHub
# (not from the local working tree), unpacked into a directory only root can
# write, and the script runs from that copy.
#
# WHERE THE COMMIT ID COMES FROM matters as much. Do not read it out of
# /srv/benloe (`git -C /srv/benloe rev-parse HEAD`): that repository belongs to
# claude-worker too, and its HEAD can be pointed at any commit claude-worker
# has pushed to a branch of its own. Ask GitHub, as in the first example
# (/usr/local/bin/gh is root-owned), or copy the id from the review of the
# commit that was read.
#
# WHAT IS CHECKED. On every run the branch is fetched from GitHub, and the
# commit must be that branch's tip or one of its ancestors as of that fetch.
# The branch is main unless --branch names another, and the one used is
# printed.
#
# A commit that stores a symbolic link anywhere in its tree is refused (see
# below, at the check).
#
# WHAT THAT DOES AND DOES NOT PROVE. With the default, the commit is part of
# main's history on GitHub at that moment: it was merged or pushed there.
# main is not a protected branch, so this is exactly as strong as "who can
# write to main on GitHub", and it says nothing about whether anyone read the
# commit. --branch lowers the bar to "is on that branch", which anyone who can
# push a branch can arrange; it exists to try an install from a pull request
# before merging, and is only as good as the reading of that exact commit.
#
# Installed copy: /usr/local/sbin/benloe-promote. After editing this file,
# the installed copy promotes its own replacement:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/install-promote.sh
#
# Tests: infra/scripts/benloe-promote.test.sh (its header says how to run it).
# The three paths below are fixed on purpose: nothing in the environment can
# point an installed benloe-promote at another repository or store. The test
# runs a copy of this file with those three lines rewritten.
set -euo pipefail

REPO_URL=https://github.com/BLoe/benloe-server.git
STORE=/var/lib/benloe-src.git
ROOT=/opt/benloe-src

usage() {
    echo "usage: benloe-promote [--branch <name>] <full 40-character commit id> <script path in the repo> [args...]" >&2
    exit 2
}

branch=main
if [[ "${1:-}" == --branch ]]; then
    [[ $# -ge 2 ]] || usage
    branch=$2
    shift 2
fi
[[ $# -ge 2 && "$1" =~ ^[0-9a-f]{40}$ ]] || usage
sha=$1
script=$2
shift 2
if [[ "$script" = /* || "$script" == *..* ]]; then
    echo "benloe-promote: the script path is relative to the repo root" >&2
    exit 2
fi
if [[ ! "$branch" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ || "$branch" == *..* ]]; then
    echo "benloe-promote: \"$branch\" is not a branch name this accepts" >&2
    exit 2
fi

umask 022
# --git-dir names the store outright, so no repository is discovered from the
# current directory, and root's ~/.gitconfig is not read either: the only
# configuration in play is the store's own and /etc/gitconfig.
export GIT_CONFIG_GLOBAL=/dev/null
store() { git --git-dir="$STORE" "$@"; }

[[ -d "$STORE" ]] || git init -q --bare "$STORE"
# One run at a time from here to the point where the script starts. Every run
# fetches into the same ref and may unpack into the same directory; without
# this, a second run fetching another branch in between could have this one
# compare its commit against the wrong branch. The lock is let go just before
# the script is started, so a long install does not hold up the next promote.
exec 9> "$STORE/promote.lock"
flock 9
# A store left shallow by an earlier version has history cut off at the
# commits it fetched, which would make an ancestor look unrelated. Complete it.
deepen=()
[[ -f "$STORE/shallow" ]] && deepen=(--unshallow)
store fetch -q "${deepen[@]}" "$REPO_URL" "+refs/heads/$branch:refs/promote/branch" \
    || { echo "benloe-promote: could not fetch branch $branch from GitHub" >&2; exit 1; }
tip=$(store rev-parse --verify -q "refs/promote/branch^{commit}") \
    || { echo "benloe-promote: branch $branch did not resolve to a commit" >&2; exit 1; }
if ! store cat-file -e "$sha^{commit}" 2>/dev/null || ! store merge-base --is-ancestor "$sha" "$tip"; then
    echo "benloe-promote: $sha is not on GitHub's $branch (tip ${tip})." >&2
    echo "  Nothing was run. Merge it, or name the branch it is on with --branch." >&2
    exit 1
fi
echo "benloe-promote: $sha is on GitHub's $branch (tip ${tip})"

# A commit can store symbolic links, and unpacking recreates them. One that
# points into /srv/benloe would make an install script copy whatever
# claude-worker has there at this moment instead of a file from the commit.
# The repository has no symbolic links, so a commit that stores one, anywhere
# in its tree, is refused outright. It is the commit that is examined, on
# every run, not the unpacked directory: a deploy script that builds inside
# its checkout leaves links of its own there (node_modules/.bin).
tree=$(store ls-tree -r "$sha") || { echo "benloe-promote: could not list the files of $sha" >&2; exit 1; }
if grep -q '^120000 ' <<<"$tree"; then
    echo "benloe-promote: $sha stores a symbolic link. Nothing was run. The first:" >&2
    grep -m 1 '^120000 ' <<<"$tree" >&2
    exit 1
fi

# A checkout that already exists is used as it stands, with whatever an
# earlier run of a script built or changed inside it; only root can write
# there. Remove the directory to start again from the commit alone.
dir=$ROOT/$sha
if [[ ! -d "$dir" ]]; then
    mkdir -p "$ROOT"
    tmp=$(mktemp -d "$ROOT/.unpack.XXXXXX")
    # Not the modes and owners recorded in the archive: root's umask (022) decides.
    if ! store archive "$sha" | tar -x --no-same-owner --no-same-permissions -C "$tmp"; then
        rm -rf "$tmp"
        echo "benloe-promote: could not unpack $sha" >&2
        exit 1
    fi
    chmod 755 "$tmp"
    mv "$tmp" "$dir"
fi
[[ -f "$dir/$script" && ! -L "$dir/$script" ]] || { echo "benloe-promote: no $script in $sha" >&2; exit 1; }

echo "benloe-promote: running $script from $dir"
exec 9>&-
export BENLOE_PROMOTED_COMMIT=$sha
exec bash "$dir/$script" "$@"
