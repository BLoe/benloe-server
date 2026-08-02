#!/bin/sh
# Root-owned PM2 interpreter shim: drop to an unprivileged uid, then exec node.
#
# Source of truth: infra/scripts/node-as.template.sh (git-tracked). INSTALLED
# and executed from /usr/local/lib/benloe/node-as-<role>, which is root:root
# inside a root:root directory — the agent can read it but cannot edit it, and
# cannot unlink it either (unlike anything under /srv/benloe/apps, where it
# owns the parent directory).
#
# WHY (2026-08-02 privilege-separation audit)
# Every PM2 app except cabinet-api ran as root while its code sat in
# /srv/benloe/apps/<name>/ owned by claude-worker — the uid the Cabinet agent
# executes as — and the agent is permitted `cabinet-privops pm2-restart <app>`.
# Write JS into a file you own, restart a service you're allowed to restart,
# and root runs it. That was true of six services, including artanis-auth,
# which issues the sessions guarding everything else.
#
# WHY setpriv AND NOT pm2's uid OPTION
# PM2's own uid/gid switching cannot work here: the daemon lives under /root
# (mode 700) and its ProcessContainerFork wrapper has to be readable by the
# target uid after the fork. setpriv drops before exec, so PM2 stays root, node
# starts already-unprivileged, and no app code ever evaluates with privilege.
#
# --init-groups sets the supplementary groups from /etc/group, which is how the
# app picks up benloe-data-style shared access; without it the process keeps
# root's group list, which is both wrong and dangerous.
#
# Installed by infra/scripts/install-privsep.sh. Do not edit in place.
set -eu
exec /usr/bin/setpriv --reuid=__USER__ --regid=__USER__ --init-groups /usr/local/bin/node "$@"
