#!/bin/bash
#
# Bootstrap script for benloe.com VPS
#
# This script sets up a fresh Ubuntu VPS with all required packages,
# configs, and services to run the benloe.com infrastructure.
#
# Usage:
#   1. Provision a fresh Ubuntu 22.04+ VPS
#   2. SSH in as root
#   3. Clone the repo: git clone git@github.com:BLoe/benloe-server.git /srv/benloe
#   4. Run: /srv/benloe/infra/scripts/bootstrap.sh
#
# IMPORTANT: This script assumes it's running as root on a fresh VPS.
# Review each section before running on an existing server.

set -euo pipefail

REPO_DIR="/srv/benloe"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  benloe.com VPS Bootstrap Script"
echo "========================================"
echo ""

# Sanity checks
if [[ $EUID -ne 0 ]]; then
   echo "Error: This script must be run as root"
   exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
    echo "Error: Repository not found at $REPO_DIR"
    echo "Clone it first: git clone git@github.com:BLoe/benloe-server.git $REPO_DIR"
    exit 1
fi

# =============================================================================
# 1. System Packages
# =============================================================================
echo "[1/7] Installing system packages..."

apt-get update
apt-get install -y \
    curl \
    git \
    ufw \
    fail2ban \
    mosh \
    sqlite3 \
    debian-keyring \
    debian-archive-keyring \
    apt-transport-https

# =============================================================================
# 2. Install Caddy
# =============================================================================
echo "[2/7] Installing Caddy..."

if ! command -v caddy &> /dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
else
    echo "  Caddy already installed: $(caddy version | head -1)"
fi

# =============================================================================
# 3. Install Node.js via NVM
# =============================================================================
echo "[3/7] Installing Node.js..."

export NVM_DIR="/root/.nvm"
if [[ ! -d "$NVM_DIR" ]]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    source "$NVM_DIR/nvm.sh"
    nvm install 24
    nvm use 24
    nvm alias default 24
else
    source "$NVM_DIR/nvm.sh"
    echo "  Node.js already installed: $(node --version)"
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
else
    echo "  PM2 already installed: $(pm2 --version)"
fi

# =============================================================================
# 4. Configure Firewall (UFW)
# =============================================================================
echo "[4/7] Configuring firewall..."

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow 22/tcp comment 'SSH access'
ufw allow 80/tcp comment 'HTTP web traffic'
ufw allow 443/tcp comment 'HTTPS web traffic'
ufw allow 60000:61000/udp comment 'Mosh UDP ports'

ufw --force enable
echo "  Firewall configured and enabled"

# =============================================================================
# 5. Configure SSH Hardening
# =============================================================================
echo "[5/7] Configuring SSH..."

cp "$INFRA_DIR/system/sshd/99-hardening.conf" /etc/ssh/sshd_config.d/
systemctl reload ssh
echo "  SSH hardening applied"

# =============================================================================
# 6. Configure Caddy
# =============================================================================
echo "[6/7] Configuring Caddy..."

cp "$INFRA_DIR/system/Caddyfile" /etc/caddy/Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
echo "  Caddy configured"

# =============================================================================
# 7. Build and Start Applications
# =============================================================================
echo "[7/7] Building and starting applications..."

cd "$REPO_DIR"

# Create data and logs directories
mkdir -p data logs

# Check for .env file
if [[ ! -f ".env" ]]; then
    echo ""
    echo "  WARNING: .env file not found!"
    echo "  Copy .env.example to .env and fill in your secrets before starting apps."
    echo "  Then run: pm2 start ecosystem.config.js"
    echo ""
else
    # Install dependencies and build each app
    for app_dir in apps/*/; do
        if [[ -f "${app_dir}package.json" ]]; then
            echo "  Building ${app_dir}..."
            cd "$REPO_DIR/${app_dir}"
            npm install
            npm run build 2>/dev/null || true
        fi
    done

    cd "$REPO_DIR"

    # Start all apps with PM2
    # Note: Each app has its own ecosystem.config.js
    for app_dir in apps/*/; do
        if [[ -f "${app_dir}ecosystem.config.js" ]]; then
            echo "  Starting ${app_dir}..."
            pm2 start "${app_dir}ecosystem.config.js"
        fi
    done

    pm2 save
fi

# =============================================================================
# Done!
# =============================================================================
echo ""
echo "========================================"
echo "  Bootstrap Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Verify services: pm2 list"
echo "  2. Check Caddy: systemctl status caddy"
echo "  3. Test sites: curl https://benloe.com"
echo ""
echo "If you need to restore databases, copy your backups to:"
echo "  $REPO_DIR/data/"
echo ""
