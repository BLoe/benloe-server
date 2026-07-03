# System Context for benloe.com VPS

## Environment Overview

You are operating on Ben's experimental VPS that hosts multiple web projects under benloe.com. This server is designed for rapid prototyping, learning, and experimentation with various technologies.

**IMPORTANT: You are running as ROOT user on this system. Do NOT use 'sudo' in commands - you have full administrative access.**

**Your Role:**
- Build and deploy experimental web applications
- Manage multiple subdomains with different technology stacks
- Optimize for fast iteration and learning
- Leverage your training data by using well-documented technologies

## System Architecture

The server uses Caddy as the main reverse proxy, routing traffic to:
- Static files served from `/srv/benloe/static/[subdomain]/`
- Node.js applications in `/srv/benloe/apps/[app-name]/` on various ports (managed by PM2)
- Docker containers when needed
- Any other runtimes as experiments require

**Current Architecture (Monorepo):**
All applications are managed in a single monorepo at `/srv/benloe/` connected to GitHub.

## Directory Structure

```
/srv/benloe/                      # Monorepo root (benloe-server on GitHub)
├── .env                          # All secrets (NEVER committed)
├── .env.example                  # Template showing required vars
├── apps/                         # Application code
│   ├── artanis/                  # Auth service (port 3002)
│   ├── weights-api/              # Weight tracking API (port 3003)
│   ├── dada-api/                 # Dada image API (port 3004)
│   ├── fantasy-hawk/             # Fantasy sports (port 3005)
│   └── gamenight/                # Game night (ports 3000, 3001)
├── infra/                        # Infrastructure
│   ├── caddy/                    # Caddyfile configs (symlinked to /etc/caddy/Caddyfile.d/)
│   └── scripts/                  # Maintenance scripts
├── static/                       # Static sites served by Caddy
│   ├── benloe.com/
│   ├── dada.benloe.com/
│   └── weights.benloe.com/
├── data/                         # SQLite databases (gitignored)
├── logs/                         # Application logs (gitignored)
├── docs/                         # Documentation
│   └── CLAUDE.md                 # This file
├── shared/                       # Shared utilities and types
└── tests/                        # Playwright tests

/etc/caddy/Caddyfile.d/          # Symlink → /srv/benloe/infra/caddy/
/root/CLAUDE.md                   # Symlink → /srv/benloe/docs/CLAUDE.md
```

## Secrets Management

**All secrets are stored in `/srv/benloe/.env`** (never committed to git).

Apps load secrets via:
```javascript
require('dotenv').config({ path: '/srv/benloe/.env' });
// Then reference: process.env.JWT_SECRET, etc.
```

Current secrets:
- `JWT_SECRET` - Shared across artanis, gamenight, fantasy-hawk, weights-api
- `MAILGUN_API_KEY` - Used by artanis for email
- `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` - Used by fantasy-hawk

## Git Monorepo

**Repository:** `github.com/BLoe/benloe-server`

### Adding a New App

1. Create directory: `mkdir /srv/benloe/apps/my-new-app`
2. Add code and `ecosystem.config.js`
3. If needs secrets, add to `/srv/benloe/.env` and `.env.example`
4. Commit: `cd /srv/benloe && git add apps/my-new-app && git commit`
5. Push: `git push origin main`

### What's NOT Committed

- `.env` (secrets)
- `data/` (databases)
- `logs/` (application logs)
- `node_modules/` and `dist/` (build artifacts)

## Current Active Services

| Service | Port | Location | Description |
|---------|------|----------|-------------|
| artanis-auth | 3002 | apps/artanis | Authentication service |
| weights-api | 3003 | apps/weights-api | Weight tracking API |
| dada-api | 3004 | apps/dada-api | Dada image API |
| fantasy-hawk-api | 3005 | apps/fantasy-hawk | Fantasy sports analytics |
| gamenight-frontend | 3000 | apps/gamenight | Game night frontend |
| gamenight-api | 3001 | apps/gamenight | Game night API |

Check services: `pm2 list`

## Deployment Workflow

1. Make changes in `/srv/benloe/`
2. Build if needed: `npm run build` in app directory
3. Restart service: `pm2 restart <service-name>`
4. Commit and push: `git add . && git commit && git push`

## OS Updates (7-Day Delay Rule)

Ubuntu packages are updated automatically, but **only versions published at
least 7 days ago** are installed (supply-chain caution over patch speed —
this includes security updates, deliberately).

- Script: `infra/scripts/apt-delayed-upgrade.sh` — checks each pending .deb's
  `Last-Modified` date in the archive pool and pins away anything younger
  than 7 days, then runs a normal `dist-upgrade`. Covers the Ubuntu, Caddy,
  and Chrome repos uniformly.
- Schedule: `apt-delayed-upgrade.timer`, daily ~06:30 UTC. Units live in
  `infra/systemd/` (source of truth) and are **copied** to
  `/etc/systemd/system/` — after editing, re-copy and `systemctl daemon-reload`.
- Logs: `/srv/benloe/logs/apt-delayed-upgrade.log`
- unattended-upgrades' install step is disabled (`APT::Periodic::Unattended-Upgrade "0"`
  in `/etc/apt/apt.conf.d/20auto-upgrades`) so nothing bypasses the rule.
  Don't re-enable it or run `apt-get upgrade` manually for routine updates.
- Kernel updates set the reboot-required flag; reboots are manual (Ben's call).
  PM2 and Caddy are boot-enabled, so a plain `systemctl reboot` is safe.

## Technology Preferences

**Choose technologies with strong representation in training data:**
- React with Vite for frontends
- Node.js with Express for APIs
- SQLite for simple projects
- Tailwind CSS for styling
- Standard patterns over creative solutions

## Key Principles

1. **Working code over perfect code**
2. **Single files are valid solutions**
3. **Boring technology with good documentation**
4. **Secrets NEVER in git** - always use .env
5. **Experiments can fail and be abandoned**
6. **Learning and fun are primary goals**

## Owner Context

Ben is an experienced developer (15+ years) exploring personal projects. He values:
- Fast iteration and experimentation
- Learning by building
- "Building in public" (code is public, secrets are not)
- LLM-assisted development
