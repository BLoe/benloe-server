# Benloe Server

> Monorepo for all benloe.com applications and services

This monorepo contains all the applications, infrastructure configs, and shared utilities that power the benloe.com platform.

## Directory Structure

```
/srv/benloe/
├── apps/                    # Application code
│   ├── artanis/             # Authentication service (port 3002)
│   ├── benloe-secrets/      # Encrypted secret store (port 3011)
│   ├── dada-api/            # Dada image API (port 3004)
│   ├── fantasy-hawk/        # Fantasy sports analytics (port 3005)
│   ├── gamenight/           # Game night app (ports 3000, 3001)
│   └── weights-api/         # Weight tracking API (port 3003)
├── infra/                   # Infrastructure
│   ├── caddy/               # Caddyfile configs (symlinked to /etc/caddy/Caddyfile.d/)
│   └── scripts/             # Maintenance scripts
├── static/                  # Static sites served by Caddy
│   ├── benloe.com/
│   ├── dada.benloe.com/
│   └── weights.benloe.com/
├── data/                    # SQLite databases (gitignored)
├── logs/                    # Application logs (gitignored)
├── docs/                    # Documentation
├── shared/                  # Shared utilities and types
└── tests/                   # Playwright tests
```

## Applications

| App | Port | URL | Description |
|-----|------|-----|-------------|
| artanis-auth | 3002 | auth.benloe.com | Authentication service with magic link login |
| gamenight-frontend | 3000 | gamenight.benloe.com | Board game night scheduling (frontend) |
| gamenight-api | 3001 | gamenight.benloe.com/api | Board game night scheduling (API) |
| weights-api | 3003 | weights.benloe.com/api | Weight room tracking API |
| dada-api | 3004 | dada.benloe.com/api | Dada image generation API |
| fantasy-hawk-api | 3005 | fantasyhawk.benloe.com | Fantasy sports analytics |
| benloe-secrets | 3011 | secrets.benloe.com | Encrypted secret store (owner-only) |

## Quick Start

```bash
# Install all dependencies
npm install

# Build all apps
npm run build

# Run linting and formatting
npm run clean-code
```

## Deployment

Applications are deployed via PM2. Each app has its own `ecosystem.config.js`:

```bash
# Start individual app
cd /srv/benloe/apps/artanis && pm2 start ecosystem.config.js

# View all running services
pm2 list

# View logs
pm2 logs <app-name>
```

## Secrets Management

Secrets live in the `benloe-secrets` service as a single env document, AES-256-GCM encrypted at rest. Nothing here is stored in plaintext on disk and nothing is committed to git.

- Edit them at [secrets.benloe.com](https://secrets.benloe.com) — owner-only, with version history and restore.
- On save, and at boot before PM2 starts, the document renders to `/run/benloe-secrets/env` (tmpfs, mode 0400), plus a scoped file per consumer that needs isolation.
- Apps read that path with `dotenv`, directly or via `ecosystem.config.js`.
- A running process only picks up a change when it is restarted.

See `docs/SECRETS.md` for the design, the operational commands, and an honest account of what this does and does not protect against.

## Adding a New App

1. Create directory: `mkdir /srv/benloe/apps/my-new-app`
2. Add code and `ecosystem.config.js`
3. If it needs secrets, add them at [secrets.benloe.com](https://secrets.benloe.com) and read `/run/benloe-secrets/env`
4. Add workspaces entry to root `package.json` if using npm dependencies
5. Commit and push

## Infrastructure

- **Caddy**: Reverse proxy with automatic HTTPS. Configs in `infra/caddy/`
- **PM2**: Node.js process manager
- **SQLite**: Database storage in `data/` directory

---

**Platform**: Self-hosted on Ubuntu VPS
**Domain**: [benloe.com](https://benloe.com)
**Auth**: [auth.benloe.com](https://auth.benloe.com)
**Games**: [gamenight.benloe.com](https://gamenight.benloe.com)
**Weights**: [weights.benloe.com](https://weights.benloe.com)
**Fantasy**: [fantasyhawk.benloe.com](https://fantasyhawk.benloe.com)
