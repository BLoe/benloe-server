#!/bin/sh
# gh, authenticated as benloe-carpenter.
#
# benloe-carpenter is the GitHub App identity for Claude Code sessions on this
# box, deliberately distinct from Cabinet's App and from benloe-pr-reviewer's so
# that an action on the repo is attributable to which system took it, and so
# each carries only the permissions its job needs.
#
# WHY A WRAPPER AND NOT `gh auth login`. These are App INSTALLATION tokens and
# expire after an hour, so there is nothing durable to store. The two long-lived
# tokens that were in ~/.config/gh/hosts.yml had both expired unnoticed, and the
# result was that the first repo question of a session failed with "Bad
# credentials" and got worked around rather than fixed. Minting on demand has no
# such failure mode. carpenter-token caches in /run until ten minutes before
# expiry, so this costs one API call an hour rather than one per command.
#
# WHY THIS IS SAFE FOR THE OTHER IDENTITIES. /usr/local/bin is also on the PATH
# of the pr-reviewer systemd unit, so shadowing gh could in principle swap that
# service onto an identity holding contents:write — precisely what the reviewer
# is designed never to have. Three things prevent it: pr-reviewer talks to the
# REST API directly and never invokes this CLI; its unit puts
# /run/benloe-secrets in InaccessiblePaths, so the guard below fails and falls
# through; and any caller that has already chosen a token keeps it.
#
# Every fallback path runs the real gh unchanged, so a broken carpenter set
# degrades to today's behaviour instead of blocking work.
REAL=/usr/bin/gh

# A caller that already picked an identity keeps it.
if [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
  exec "$REAL" "$@"
fi

# Not readable means: not root, or inside a unit that fences the render off.
if [ ! -r /run/benloe-secrets/carpenter.env ]; then
  exec "$REAL" "$@"
fi

_token=$(/usr/local/bin/carpenter-token 2>/dev/null) || _token=''
if [ -z "$_token" ]; then
  exec "$REAL" "$@"
fi

GH_TOKEN="$_token" exec "$REAL" "$@"
