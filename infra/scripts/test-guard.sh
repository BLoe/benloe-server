# Sourced by the test scripts in this directory. Not run on its own.
#
# A test is code like any other, and root must not run code out of a tree
# another uid can write (/srv/benloe is claude-worker's). So: when the caller
# is root, every file named, the directory holding it and every directory
# above that must be root-owned and not writable by group or other (a sticky
# directory such as /tmp is accepted: nobody else can replace root's entry in
# one). A benloe-promote checkout under /opt/benloe-src passes; the working
# tree in /srv/benloe does not. An unprivileged caller may run tests from
# anywhere: it can lose nothing it does not already have.
#
# Like the installers' location check, this catches a mistake, not an
# attacker: a tree somebody else controls could simply not contain it.
#
#   refuse_unsafe_tree <file>...     exits 1 with the right command if not safe
refuse_unsafe_tree() {
    [[ $(id -u) -eq 0 ]] || return 0
    local f d u m
    for f in "$@"; do
        d=$f
        while :; do
            if ! read -r u m < <(stat -c '%u %a' -- "$d" 2>/dev/null) || [[ "$u" -ne 0 ]] \
                || { (( 0$m & 022 )) && ! { [[ -d "$d" ]] && (( 0$m & 01000 )); }; }; then
                echo "Refusing to run as root: $d is not root's alone, so $f could be replaced by another uid." >&2
                echo "Run it from a checkout made by benloe-promote instead, with the commit id taken from GitHub:" >&2
                echo "  benloe-promote \"\$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)\" <path of this test in the repo>" >&2
                exit 1
            fi
            [[ "$d" == / ]] && break
            d=$(dirname -- "$d")
        done
    done
}
