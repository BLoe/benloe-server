# Infrastructure

This directory contains everything needed to rebuild the benloe.com VPS from scratch.

## Directory Structure

```
infra/
├── caddy/                    # Caddy configs for each subdomain
│   ├── auth.caddyfile
│   ├── dada.benloe.com
│   ├── fitness.benloe.com
│   ├── gamenight.benloe.com
│   ├── weights.benloe.com
│   └── ...
├── system/                   # System-level configs (copied to /etc/)
│   ├── Caddyfile            # Main Caddyfile → /etc/caddy/Caddyfile
│   └── sshd/
│       └── 99-hardening.conf # SSH hardening → /etc/ssh/sshd_config.d/
├── scripts/
│   ├── bootstrap.sh         # Full server setup from scratch
│   ├── backup-databases.sh  # SQLite database backup (runs as an installed copy)
│   ├── backup-databases.test.sh # Its tests (root, through benloe-promote)
│   ├── install-db-backup.sh # Installs it and its three systemd units; run through benloe-promote
│   ├── benloe-promote.sh    # Runs an install script from a root-owned checkout of a commit on GitHub
│   ├── benloe-promote.test.sh # Its tests (any user; root only through benloe-promote)
│   ├── install-promote.sh   # Installs benloe-promote; run through benloe-promote
│   ├── installers.test.sh   # Tests the installers (root, through benloe-promote)
│   └── test-guard.sh        # What makes those tests refuse to run as root from a tree another uid can write
└── README.md                # This file
```

## Rebuilding the Server

If you need to set up a new VPS from scratch:

```bash
# 1. Provision Ubuntu 22.04+ VPS (DigitalOcean, etc.)

# 2. SSH in as root and clone the repo
git clone git@github.com:BLoe/benloe-server.git /srv/benloe

# 3. Run bootstrap script
/srv/benloe/infra/scripts/bootstrap.sh

# 4. Set up secrets
cp /srv/benloe/.env.example /srv/benloe/.env
nano /srv/benloe/.env  # Fill in your secrets

# 5. Start applications
cd /srv/benloe && pm2 start apps/*/ecosystem.config.js

# 6. Restore database backups (if you have them)
cp /path/to/backups/*.db /srv/benloe/data/
```

## Database Backups

The irreplaceable data is in SQLite databases: those in `/srv/benloe/data/`, and those
services keep under `/var/lib/`. The nightly backup takes every file named `*.db`,
`*.sqlite` or `*.sqlite3` in `/srv/benloe/data` or one folder down, except under
`/srv/benloe/data/backups/`, and three fixed files under `/var/lib`;
`infra/scripts/backup-databases.sh` lists them at its top.

### Manual Backup
```bash
systemctl start benloe-db-backup.service   # runs the installed copy; log in /var/log/benloe-db-backup.log
```

### Automatic Backup
`benloe-db-backup.timer` runs nightly (~09:15 UTC). It executes an installed,
root-owned copy of the script, `/usr/local/sbin/benloe-db-backup.sh`, never the
copy in this repository: `/srv/benloe` is owned by `claude-worker`, and root
must not run or install anything out of it. After editing
`infra/scripts/backup-databases.sh` or any of the three `benloe-db-backup` units in
`infra/systemd/`, and on a new box: commit, push, merge to main, then
```bash
benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/install-db-backup.sh
```
`benloe-promote` runs that installer from a root-owned checkout of the commit,
fetched from GitHub; the installer copies the script and the three units, reloads
systemd and enables the timer. See "Promoting code that root runs" in
`docs/CLAUDE.md`.

Snapshots land in `/var/backups/benloe/<timestamp>/` (root-only; 14 days kept, and
the newest three complete runs for as long as they are the newest three).
Nobody is alerted when a run fails; it leaves an error line in the journal
(`journalctl -t benloe-db-backup -p err`) and, if `/var/backups` is writable,
`/var/backups/benloe/LAST-RUN-FAILED`.

This README used to tell you to add `backup-databases.sh` to root's crontab,
run from `/srv/benloe`. Nothing removes that line: check `crontab -l` as root
and delete any line naming `backup-databases.sh`.

The script's tests need root, and root does not run anything out of this
repository's working tree, tests included. They are run from a promoted
checkout, against throwaway databases:
```bash
benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" infra/scripts/backup-databases.test.sh
```
The same goes for `benloe-promote.test.sh` and `installers.test.sh`; see
"Promoting code that root runs" in `docs/CLAUDE.md`.

### Offsite Backup
For true disaster recovery, sync backups offsite:
```bash
# Example: rsync to another server
rsync -avz /var/backups/benloe/ user@backup-server:/backups/benloe/

# Example: upload to S3
aws s3 sync /var/backups/benloe/ s3://your-bucket/benloe-backups/
```

## Firewall Rules

The bootstrap script configures UFW with:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (Caddy) |
| 443 | TCP | HTTPS (Caddy) |
| 60000-61000 | UDP | Mosh |

## What's NOT in Git

These must be recreated manually or restored from backups:

- `/srv/benloe/.env` - Secrets (use `.env.example` as template)
- `/srv/benloe/data/*.db` - SQLite databases
- SSL certificates - Auto-regenerated by Caddy
- SSH keys - Must be added to new server
