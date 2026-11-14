#!/bin/bash
# One-time (idempotent) system setup for Kevin. Run as root; safe to re-run.
#
#   kevin      runs the server. Owns /var/lib/kevin (0700): database, documents, uploads.
#   kevin-sh   runs the agent's shell tool. Owns only /var/lib/kevin-sh/workspace
#              and has no network: an iptables owner rule rejects everything it sends.
#
# The split matters because the shell executes commands a model wrote, and the
# model reads web pages. A command running as `kevin` could read the API key
# from the server's environment and the tax documents from its data folder.
set -euo pipefail

id kevin >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin kevin
id kevin-sh >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin kevin-sh
# kevin joins kevin-sh's group so the file tools can exchange files with the shell.
usermod -a -G kevin-sh kevin

install -d -o kevin -g kevin -m 0700 /var/lib/kevin
install -d -o root -g root -m 0755 /var/lib/kevin-sh
install -d -o kevin-sh -g kevin-sh -m 2770 /var/lib/kevin-sh/workspace
install -d -o root -g root -m 0755 /opt/kevin /opt/kevin/releases /usr/local/lib/benloe

# The shell launcher: what `sudo -u kevin-sh` is allowed to run.
cat > /usr/local/lib/benloe/kevin-shell <<'SH'
#!/bin/sh
# Installed by apps/kevin/setup.sh. Runs one command as kevin-sh, in its
# workspace, with an empty environment and resource limits.
set -eu
cd /var/lib/kevin-sh/workspace
umask 007
# 4 GB of address space, 1 GB files, 256 processes, 256 open files, 115 seconds.
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/var/lib/kevin-sh/workspace LANG=C.UTF-8 \
  /usr/bin/prlimit --as=4294967296 --fsize=1073741824 --nproc=256 --nofile=256 \
  /usr/bin/timeout -k 5 115 /bin/bash -c "$1"
SH
chmod 755 /usr/local/lib/benloe/kevin-shell

# Validated before it is installed: a bad file in sudoers.d breaks sudo for everyone.
tmp=$(mktemp)
cat > "$tmp" <<'SUDO'
# Kevin's server may run the sandboxed shell launcher as kevin-sh, nothing else.
kevin ALL=(kevin-sh) NOPASSWD: /usr/local/lib/benloe/kevin-shell
SUDO
visudo -cf "$tmp" >/dev/null
install -o root -g root -m 0440 "$tmp" /etc/sudoers.d/kevin-shell

# No network for kevin-sh, loopback included (so no reaching local services).
cat > /etc/systemd/system/kevin-sh-firewall.service <<'UNIT'
[Unit]
Description=Reject all network traffic from the kevin-sh uid (Kevin's shell sandbox)
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
systemctl enable kevin-sh-firewall.service >/dev/null 2>&1
systemctl restart kevin-sh-firewall.service

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

echo "kevin system setup done"
