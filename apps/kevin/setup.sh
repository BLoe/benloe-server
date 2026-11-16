#!/bin/bash
# System setup for Kevin. Run as root; idempotent, safe to re-run.
#
#   kevin      runs the server. Owns /var/lib/kevin (0700): database, documents, uploads.
#   kevin-sh   the uid of the sandbox, where commands a model wrote are run. Owns only
#              its workspace, /var/lib/kevin-sh/workspace.
#
# The split matters because the shell executes commands a model wrote, and the
# model reads web pages. A command running as `kevin` could read the API key
# from the server's environment and the tax documents from its data folder.
#
# How the server reaches the sandbox: it connects to a unix socket that only the
# kevin uid can open, and systemd starts one short-lived service per connection
# (kevin-shell@.service for the shell and file tools, kevin-extract@.service for
# reading text out of uploaded PDFs). The server runs nothing as another uid
# itself: there is no sudo rule. The unit is what confines a command; what it
# does and does not take away is listed next to it below, and in CLAUDE.md.
set -euo pipefail

# Like deploy.sh, this is run from a root-owned checkout of a pushed commit:
#   benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/kevin/setup.sh
SRC=$(cd "$(dirname "$0")" && pwd -P)
case "$SRC" in
  /opt/benloe-src/*) ;;
  *) echo "Run this through benloe-promote (see the comment above)." >&2; exit 1 ;;
esac

id kevin >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin kevin
id kevin-sh >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin kevin-sh
# kevin is deliberately not in kevin-sh's group: the server never opens anything in the workspace
# itself. (An early version of this script added it; this takes it out again. A running server
# keeps the groups it started with until it is restarted.)
case " $(id -nG kevin) " in *" kevin-sh "*) gpasswd -d kevin kevin-sh >/dev/null ;; esac

install -d -o kevin -g kevin -m 0700 /var/lib/kevin
install -d -o root -g root -m 0755 /var/lib/kevin-sh
install -d -o root -g root -m 0755 /opt/kevin /opt/kevin/releases /usr/local/lib/benloe

# ---- the workspace: its own small filesystem ---------------------------------------------
# A command in the sandbox can write as much as it likes into its workspace. So the workspace is
# a 2 GB ext4 image mounted over the folder: filling it fills the image, not the disk every
# other app and Kevin's own database share. nosuid and nodev: nothing in it gains privileges.
WS=/var/lib/kevin-sh/workspace
IMG=/var/lib/kevin-sh/workspace.img
MOUNT_UNIT=$(systemd-escape -p --suffix=mount "$WS")
install -d -o kevin-sh -g kevin-sh -m 0700 "$WS"
if [ ! -f "$IMG" ]; then
  truncate -s 2G "$IMG.new"
  chmod 0600 "$IMG.new"
  mkfs.ext4 -q -m 0 -L kevin-sh "$IMG.new"
  # What was in the folder before goes into the image. cp -a copies a symlink as a symlink and
  # never follows one, which matters here: the folder was writable by the sandbox.
  stage=$(mktemp -d)
  mount -o loop,nosuid,nodev "$IMG.new" "$stage"
  cp -a "$WS/." "$stage/" 2>/dev/null || echo "note: some old workspace files could not be copied; they remain under the mount point" >&2
  # Files an early version of the file tools left owned by kevin are handed to the sandbox uid.
  # -h acts on a link itself, never on what it points to; nothing else can write here while it is staged.
  chown -hR kevin-sh:kevin-sh "$stage"
  chmod 0700 "$stage"
  umount "$stage"
  rmdir "$stage"
  mv "$IMG.new" "$IMG"
fi
cat > "/etc/systemd/system/$MOUNT_UNIT" <<UNIT
[Unit]
Description=Workspace of Kevin's sandbox (a size-limited filesystem)

[Mount]
What=$IMG
Where=$WS
Type=ext4
Options=loop,nosuid,nodev,noatime

[Install]
WantedBy=multi-user.target
UNIT

# ---- the sandbox runner and its units ------------------------------------------------------
install -o root -g root -m 0755 "$SRC/sandbox/kevin-sandbox-run" /usr/local/lib/benloe/kevin-sandbox-run
install -o root -g root -m 0755 "$SRC/sandbox/selfcheck.py" /usr/local/lib/benloe/kevin-sandbox-selfcheck

# What every sandboxed command runs under. In the unit's own words:
#   - the kevin-sh uid, no capabilities, no way to gain privileges;
#   - no network at all: its own network namespace with only a loopback device that reaches
#     nothing, so no TCP, UDP or DNS, and no local service on 127.0.0.1;
#   - /run is replaced by an empty folder, so the unix sockets of other services (the system
#     resolver, D-Bus, anything else there) do not exist for it. Those sockets are how a process
#     without network can otherwise still ask a daemon to make a lookup on its behalf;
#   - /var, /srv, /opt, /home, /root, /boot and /mnt are empty for it, as are /etc/benloe,
#     /etc/caddy and /etc/ssh; /tmp is private to the one command. It can read the rest of
#     /etc and /usr (programs and libraries), which hold no data of Ben's;
#   - other processes are not visible in /proc;
#   - memory, process count and CPU are capped, and after HARD_SECONDS systemd kills every
#     process in the unit, whatever those processes do about signals or sessions. The same
#     happens the moment the runner exits, so nothing a command started outlives the call.
# Not taken away: the command can use its CPU and memory share for its whole time limit, and
# it can read world-readable files under /etc and /usr.
HARD_SECONDS=130
sandbox_service() { # $1 description, $2 "workspace" or "none"
  cat <<UNIT
[Unit]
Description=$1
CollectMode=inactive-or-failed
$(if [ "$2" = workspace ]; then echo "RequiresMountsFor=$WS"; fi)

[Service]
ExecStart=/usr/local/lib/benloe/kevin-sandbox-run
StandardInput=socket
StandardOutput=socket
StandardError=journal
User=kevin-sh
Group=kevin-sh
UMask=0077
RuntimeMaxSec=$HARD_SECONDS
TimeoutStopSec=5
KillMode=control-group
KillSignal=SIGKILL

PrivateNetwork=yes
IPAddressDeny=any
RestrictAddressFamilies=AF_UNIX
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictNamespaces=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @mount
SystemCallErrorNumber=EPERM

ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectProc=invisible
ProcSubset=pid
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
TemporaryFileSystem=/run:ro /var:ro /srv:ro /opt:ro /boot:ro /mnt:ro /media:ro
InaccessiblePaths=-/etc/benloe -/etc/caddy -/etc/ssh

MemoryMax=2G
MemorySwapMax=0
OOMPolicy=continue
TasksMax=128
CPUQuota=200%
LimitFSIZE=1G
LimitCORE=0
UNIT
  if [ "$2" = workspace ]; then
    cat <<UNIT
BindPaths=$WS
WorkingDirectory=$WS
Environment=KEVIN_SHELL_DIR=$WS
UNIT
  else
    # Nothing writable at all: this one only turns bytes on its input into text on its output.
    echo "WorkingDirectory=/"
  fi
}
sandbox_socket() { # $1 description, $2 socket name
  cat <<UNIT
[Unit]
Description=$1

[Socket]
ListenStream=/run/kevin-sandbox/$2.sock
DirectoryMode=0755
SocketUser=kevin
SocketGroup=kevin
SocketMode=0600
Accept=yes
MaxConnections=16

[Install]
WantedBy=sockets.target
UNIT
}
sandbox_socket "Kevin's sandbox: shell and file tools" shell > /etc/systemd/system/kevin-shell.socket
sandbox_service "Kevin's sandbox: one shell command or file operation" workspace > /etc/systemd/system/kevin-shell@.service
sandbox_socket "Kevin's sandbox: text extraction from uploads" extract > /etc/systemd/system/kevin-extract.socket
sandbox_service "Kevin's sandbox: text extraction from one upload" none > /etc/systemd/system/kevin-extract@.service

# The earlier way in (a sudo rule that let kevin run a launcher as kevin-sh) is gone.
rm -f /etc/sudoers.d/kevin-shell /usr/local/lib/benloe/kevin-shell

# Kept from before the units existed, as a second lock on the same door: any process of the
# kevin-sh uid that is somehow outside the units' network namespace still cannot send a packet,
# loopback included. It does not cover requests made through another service's unix socket;
# hiding /run in the units is what covers those.
cat > /etc/systemd/system/kevin-sh-firewall.service <<'UNIT'
[Unit]
Description=Reject all network traffic from the kevin-sh uid (Kevin's sandbox)
After=network-pre.target ufw.service
Before=pm2-root.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'for t in iptables ip6tables; do $t -C OUTPUT -m owner --uid-owner kevin-sh -j REJECT 2>/dev/null || $t -I OUTPUT 1 -m owner --uid-owner kevin-sh -j REJECT; done'
ExecStop=/bin/sh -c 'for t in iptables ip6tables; do $t -D OUTPUT -m owner --uid-owner kevin-sh -j REJECT 2>/dev/null || true; done'

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "$MOUNT_UNIT" >/dev/null 2>&1
# The image's root folder belongs to the sandbox uid (set when it was made; repeated in case it was changed by hand).
chown kevin-sh:kevin-sh "$WS"
chmod 0700 "$WS"
systemctl enable kevin-sh-firewall.service >/dev/null 2>&1
systemctl restart kevin-sh-firewall.service
systemctl enable kevin-shell.socket kevin-extract.socket >/dev/null 2>&1
# Restarted, not just started: a changed socket unit only takes effect that way. Commands
# already running keep running; they belong to their own service instances.
systemctl restart kevin-shell.socket kevin-extract.socket

# PM2's interpreter: drops to kevin and passes only the variables the server reads.
cat > /usr/local/lib/benloe/node-as-kevin <<'SHIM'
#!/bin/bash
# Installed by apps/kevin/setup.sh. Do not edit in place.
set -eu
keep=(PATH=/usr/bin:/bin HOME=/nonexistent)
for v in NODE_ENV PORT ANTHROPIC_API_KEY OPENAI_API_KEY AUTH_SERVICE_URL KEVIN_OWNER_EMAIL KEVIN_PUBLIC_URL KEVIN_TZ \
  KEVIN_VAPID_PUBLIC_KEY KEVIN_VAPID_PRIVATE_KEY KEVIN_DATA_DIR KEVIN_MODEL_MAIN KEVIN_MODEL_SMALL KEVIN_MODEL_DEEP; do
  if [[ -v $v ]]; then keep+=("$v=${!v}"); fi
done
exec /usr/bin/env -i "${keep[@]}" /usr/bin/setpriv --reuid=kevin --regid=kevin --init-groups /usr/local/bin/node "$@"
SHIM
chmod 755 /usr/local/lib/benloe/node-as-kevin

# ---- prove it, on this box, before saying it is done ---------------------------------------
# A few commands through the real socket, sent as the server would send them (from the kevin uid), checking
# the properties above from the inside. A failure here fails the setup.
check=$(setpriv --reuid=kevin --regid=kevin --init-groups /usr/bin/python3 -I /usr/local/lib/benloe/kevin-sandbox-selfcheck /run/kevin-sandbox/shell.sock) || {
  echo "sandbox self-check FAILED:" >&2
  echo "$check" >&2
  exit 1
}
echo "$check"
echo "kevin system setup done"
