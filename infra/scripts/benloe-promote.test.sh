#!/bin/bash
# Tests benloe-promote.sh against a repository it creates, standing in for
# GitHub. It never touches /var/lib/benloe-src.git or /opt/benloe-src, and
# nothing it promotes does more than print a line.
#
# How to run it:
#   - as an unprivileged user, from anywhere:
#       bash infra/scripts/benloe-promote.test.sh
#   - as root, only from a checkout made by benloe-promote (it refuses to run
#     as root out of a tree another uid can write, such as /srv/benloe):
#       benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/benloe-promote.test.sh
#
# benloe-promote.sh has its repository, store and checkout directory fixed in
# three lines and takes none of them from the environment. The test runs a
# copy in which exactly those three lines are rewritten, and checks that
# nothing else differs.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=infra/scripts/test-guard.sh
. "$HERE/test-guard.sh"
refuse_unsafe_tree "$HERE/benloe-promote.test.sh" "$HERE/benloe-promote.sh" "$HERE/test-guard.sh"

T=$(mktemp -d "${TMPDIR:-/tmp}/promote-test.XXXXXX")
trap 'rm -rf -- "${T:?}"' EXIT
checks=0
bad=0
ok() { checks=$((checks + 1)); }
no() { checks=$((checks + 1)); bad=$((bad + 1)); echo "NOT OK: $1"; }
is() { if [[ "$1" == "$2" ]]; then ok; else no "$3: got '$1', wanted '$2'"; fi; }

sed -e "s|^REPO_URL=.*|REPO_URL=file://$T/origin|" -e "s|^STORE=.*|STORE=$T/store.git|" -e "s|^ROOT=.*|ROOT=$T/checkouts|" "$HERE/benloe-promote.sh" > "$T/promote.sh"
is "$(diff "$HERE/benloe-promote.sh" "$T/promote.sh" | grep -c '^>')" 3 "lines changed in the copy under test"
is "$(grep -cE '^(REPO_URL|STORE|ROOT)=' "$T/promote.sh")" 3 "the three fixed paths"

# The stand-in for GitHub: main with three commits, and a branch off it.
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
git init -q -b main "$T/origin"
g() { git -C "$T/origin" "$@"; }
commit() { g add -A; g commit -q -m "$1"; g rev-parse HEAD; }
mkdir "$T/origin/tools"
cat > "$T/origin/tools/hello.sh" <<'HELLO'
#!/bin/bash
here=$(cd "$(dirname "$0")" && pwd)
echo "ran from $here commit=$BENLOE_PROMOTED_COMMIT args=$* data=$(cat "$here/data.txt")"
touch "$here/built"
HELLO
echo one > "$T/origin/tools/data.txt"
A=$(commit one)
echo two > "$T/origin/tools/data.txt"
B=$(commit two)
g checkout -q -b side
echo side > "$T/origin/tools/data.txt"
S=$(commit "on the side branch only")
g checkout -q main
echo outside > "$T/outside.txt"
ln -s "$T/outside.txt" "$T/origin/tools/abs-link"
L1=$(commit "stores a link to an absolute path")
g rm -q tools/abs-link
ln -s data.txt "$T/origin/tools/rel-link"
L2=$(commit "stores a link that stays inside the tree")
g rm -q tools/rel-link
ln -s hello.sh "$T/origin/tools/alias.sh"
L3=$(commit "the script itself is a link")
g rm -q tools/alias.sh
C=$(commit "no links again")

# <what> <expected exit status> <text expected in the output, or ''> <arguments...>
t() {
    local what=$1 want=$2 text=$3 out rc=0
    shift 3
    out=$(cd / && bash "$T/promote.sh" "$@" 2>&1) || rc=$?
    is "$rc" "$want" "$what: exit status"
    if [[ -n "$text" ]]; then
        if grep -qF -- "$text" <<<"$out"; then ok; else no "$what: expected '$text' in: $out"; fi
    fi
    last_out=$out
}
ran() { if grep -q '^ran from' <<<"$last_out"; then no "$1: the script ran"; else ok; fi; }

echo "# arguments that are refused before anything is fetched"
t "no arguments" 2 "usage:";                                            ran "no arguments"
t "one argument" 2 "usage:" "$A";                                       ran "one argument"
t "short commit id" 2 "usage:" "${A:0:12}" tools/hello.sh;              ran "short id"
t "upper-case commit id" 2 "usage:" "${A^^}" tools/hello.sh;            ran "upper-case id"
t "a branch name for a commit id" 2 "usage:" main tools/hello.sh;       ran "branch as id"
t "absolute script path" 2 "relative to the repo root" "$A" /bin/true;  ran "absolute path"
t "script path with .." 2 "relative to the repo root" "$A" tools/../tools/hello.sh; ran ".. in path"
t "--branch with nothing after" 2 "usage:" --branch;                    ran "--branch alone"
t "--branch with too little after" 2 "usage:" --branch side "$S";       ran "--branch short"
t "branch name with .." 2 "not a branch name" --branch a/../main "$A" tools/hello.sh; ran "branch .."
t "branch name that is an option" 2 "not a branch name" --branch --upload-pack=x "$A" tools/hello.sh; ran "branch option"
t "branch name with a space" 2 "not a branch name" --branch "main side" "$A" tools/hello.sh; ran "branch space"
[[ ! -e "$T/checkouts" ]] && ok || no "a refused command created the checkout directory"

echo "# the commit must be on the branch as the remote has it now"
t "main's tip" 0 "is on GitHub's main (tip $C)" "$C" tools/hello.sh one two
grep -qF "ran from $T/checkouts/$C/tools commit=$C args=one two data=two" <<<"$last_out" && ok || no "ran from the checkout, with its arguments and the commit id: $last_out"
t "an ancestor of main" 0 "data=one" "$A" tools/hello.sh
t "a commit on another branch" 1 "is not on GitHub's main" "$S" tools/hello.sh;        ran "side commit on main"
t "that commit, with its branch named" 0 "is on GitHub's side (tip $S)" --branch side "$S" tools/hello.sh
grep -qF "data=side" <<<"$last_out" && ok || no "--branch ran the branch's file"
t "the same commit against main again, now that the store holds it" 1 "is not on GitHub's main" "$S" tools/hello.sh; ran "side commit, second time"
t "a commit of main checked against the branch that forked before it" 1 "is not on GitHub's side" --branch side "$C" tools/hello.sh; ran "main-only commit on side"
t "a commit id that exists nowhere" 1 "is not on GitHub's main" 0123456789abcdef0123456789abcdef01234567 tools/hello.sh; ran "unknown id"
t "a branch that does not exist" 1 "could not fetch branch nope" --branch nope "$A" tools/hello.sh; ran "unknown branch"
t "a script that is not in the commit" 1 "no tools/missing.sh in $A" "$A" tools/missing.sh; ran "missing script"
t "a directory given as the script" 1 "no tools in $A" "$A" tools;      ran "directory as script"

echo "# a commit that stores a symbolic link is refused, whatever the link points at"
t "link to an absolute path" 1 "stores a symbolic link" "$L1" tools/hello.sh;  ran "absolute link"
t "link inside the tree" 1 "stores a symbolic link" "$L2" tools/hello.sh;      ran "relative link"
t "the script is a link" 1 "stores a symbolic link" "$L3" tools/alias.sh;      ran "script link"
for c in "$L1" "$L2" "$L3"; do [[ ! -e "$T/checkouts/$c" ]] && ok || no "a refused commit was unpacked"; done

echo "# an existing checkout is used again, and a link planted where the script is stops it"
[[ -e "$T/checkouts/$A/tools/built" ]] && ok || no "the first run's script left its file"
t "the same commit a second time" 0 "data=one" "$A" tools/hello.sh
ln -s hello.sh "$T/checkouts/$A/tools/planted.sh"
t "a link in the checkout given as the script" 1 "no tools/planted.sh in $A" "$A" tools/planted.sh; ran "planted link"
is "$(find "$T/checkouts" -maxdepth 1 -mindepth 1 | wc -l)" 3 "checkouts made (A, C and the side commit)"
is "$(find "$T/checkouts/$C" -perm /022 | wc -l)" 0 "nothing in a checkout is writable by group or other"

echo "# a commit that has left the branch is refused even though its checkout exists"
g reset -q --hard "$B"
t "main's old tip after main was rewound" 1 "is not on GitHub's main" "$C" tools/hello.sh; ran "rewound commit"
t "what main is now" 0 "data=two" "$B" tools/hello.sh

echo "# a second run waits for the first to finish with the store"
( exec 9> "$T/store.git/promote.lock"; flock 9; sleep 3 ) &
sleep 0.5
start=$(date +%s)
t "run while the lock is held" 0 "data=two" "$B" tools/hello.sh
took=$(( $(date +%s) - start ))
wait
(( took >= 2 )) && ok || no "the run did not wait for the lock (it took ${took}s)"

echo "$checks checks, $bad failed"
[[ $bad -eq 0 ]]
