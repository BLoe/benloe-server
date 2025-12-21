# Benloe Server

> Monorepo for all benloe.com applications and services

This monorepo contains all the applications, infrastructure configs, and shared utilities that power the benloe.com platform.

## Directory Structure

```
/srv/benloe/
├── apps/                    # Application code
│   ├── artanis/             # Authentication service (port 3002)
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
├── homepage/                # Main benloe.com homepage
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

All secrets are stored in `/srv/benloe/.env` (never committed to git).

Apps load secrets via ecosystem.config.js which parses the .env file. See `.env.example` for required variables.

## Adding a New App

1. Create directory: `mkdir /srv/benloe/apps/my-new-app`
2. Add code and `ecosystem.config.js`
3. If needs secrets, add to `/srv/benloe/.env` and `.env.example`
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
