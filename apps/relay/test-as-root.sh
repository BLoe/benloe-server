#!/bin/sh
# Runs relay's test suite as root, which is what the tests that use two
# unprivileged uids need. Root does not run code out of /srv/benloe, so this
# is run through benloe-promote, from a checkout only root can write:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/relay/test-as-root.sh
# Run from anywhere else as root, the test file itself refuses (see its top).
# The tests create and remove their own directories under /tmp and touch
# nothing of the installed relay.
set -eu
cd "$(dirname "$0")"
exec /usr/local/bin/node --disable-warning=ExperimentalWarning --test
