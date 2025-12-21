# 🏗️ Benloe Platform

> Monorepo for all benloe.com applications and services

This monorepo contains all the applications and shared utilities that power the benloe.com platform.

## 📦 Workspaces

- **`artanis/`** - Authentication service with magic link login
- **`homepage/`** - Main benloe.com homepage with project showcase
- **`gamenight/`** - Board game night scheduling application
- **`shared/`** - Shared utilities, types, and components

## 🚀 Quick Start

```bash
# Install all dependencies
npm install

# Run all services in development
npm run dev

# Build all projects
npm run build

# Run tests across all workspaces
npm run test
```

## 🔧 Development

Each workspace is a separate application with its own:

- Dependencies and package.json
- Build configuration
- Deployment setup
- Git history (preserved via git subtree)

### Adding New Workspaces

1. Create new directory in `/var/apps/`
2. Add to `workspaces` array in root `package.json`
3. Follow existing patterns for TypeScript and tooling

## 🌐 Deployment

Applications are deployed independently via PM2:

- **artanis**: `pm2 start artanis/ecosystem.config.js`
- **gamenight**: `pm2 start gamenight/ecosystem.config.js`

Static files served via Caddy with reverse proxy configuration.

## 🤝 Shared Dependencies

Cross-workspace dependencies are managed via workspace references:

```json
{
  "dependencies": {
    "@benloe/shared": "workspace:*",
    "@benloe/artanis-types": "workspace:*"
  }
}
```

---

**Platform**: Self-hosted on Ubuntu server  
**Domain**: [benloe.com](https://benloe.com)  
**Auth**: [auth.benloe.com](https://auth.benloe.com)  
**Games**: [gamenight.benloe.com](https://gamenight.benloe.com)
