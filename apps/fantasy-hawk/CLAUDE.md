# Fantasy Hawk - Yahoo Fantasy Basketball Analytics

A full-stack web application that integrates with Yahoo Fantasy Sports API to provide advanced analytics and visualizations for fantasy basketball leagues.

## Project Overview

Fantasy Hawk allows users to:
- Connect their Yahoo Fantasy Basketball account via OAuth
- View league standings with interactive charts
- Analyze team and player statistics
- Track performance across the season

## Technology Stack

### Backend (`/backend`)
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Authentication**:
  - Artanis (benloe.com auth system)
  - Yahoo OAuth 2.0 for Fantasy API access
- **Database**: SQLite (stores OAuth tokens)
- **Key Libraries**:
  - `oauth-1.0a` - OAuth 1.0a signing
  - `better-sqlite3` - Fast SQLite driver
  - `helmet` - Security middleware
  - `cors` - Cross-origin resource sharing

### Frontend (`/frontend`)
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Routing**: React Router DOM
- **State Management**: React hooks (useState, useEffect)

## Architecture

```
User Browser
    ↓
Caddy (fantasyhawk.benloe.com)
    ↓
    ├─→ Static Frontend (/var/apps/fantasy-hawk/frontend/dist)
    └─→ Backend API (localhost:3005)
         ├─→ Artanis Auth (localhost:3002)
         └─→ Yahoo Fantasy API (OAuth authenticated)
```

## Key Features

### OAuth Flow
1. User logs in via Artanis (existing benloe.com auth)
2. User clicks "Connect Yahoo Account"
3. Backend initiates OAuth 1.0a flow with Yahoo
4. User authorizes on Yahoo's site
5. Yahoo redirects back with OAuth token
6. Backend exchanges for access token and stores in SQLite
7. Frontend can now make authenticated Fantasy API requests

### API Endpoints

**OAuth Management**
- `GET /api/oauth/connect` - Initiate Yahoo OAuth flow
- `GET /api/oauth/callback` - OAuth callback handler
- `GET /api/oauth/status` - Check connection status
- `POST /api/oauth/disconnect` - Remove Yahoo connection

**Fantasy Data**
- `GET /api/fantasy/games` - User's fantasy games
- `GET /api/fantasy/leagues` - User's leagues
- `GET /api/fantasy/leagues/:league_key` - League details
- `GET /api/fantasy/leagues/:league_key/settings` - League settings (stat categories)
- `GET /api/fantasy/leagues/:league_key/standings` - League standings
- `GET /api/fantasy/teams` - User's teams
- `GET /api/fantasy/teams/:team_key/roster` - Team roster
- `GET /api/fantasy/teams/:team_key/stats` - Team stats
- `GET /api/fantasy/players/:player_key/stats` - Player stats
- `GET /api/fantasy/leagues/:league_key/scoreboard` - Current matchups

**Debug Endpoints**
- `GET /api/fantasy/debug/dump-settings/:league_key` - Dump settings to server file
- `GET /api/fantasy/debug/standings/:league_key` - Raw standings response
- `GET /api/fantasy/debug/teams` - Raw teams response
- `GET /api/fantasy/proxy?endpoint=...` - Generic Yahoo API proxy

## Database Schema

### yahoo_tokens
Stores Yahoo OAuth access tokens per user:
- `user_id` (PRIMARY KEY) - Artanis user ID
- `access_token` - Yahoo OAuth access token
- `access_token_secret` - OAuth token secret
- `session_handle` - For token renewal
- `token_expires` - Token expiration timestamp
- `created_at` - When token was created
- `updated_at` - Last token update

### oauth_request_tokens
Temporary storage during OAuth flow:
- `token` (PRIMARY KEY) - Request token
- `token_secret` - Request token secret
- `user_id` - Associated user ID
- `created_at` - Creation timestamp
- `expires_at` - Expiration timestamp (10 minutes)

## Deployment

### Backend
- **Location**: `/var/apps/fantasy-hawk/backend`
- **Port**: 3005
- **Process Manager**: PM2 (`fantasy-hawk-api`)
- **Logs**: `/var/apps/logs/fantasy-hawk-api-*.log`
- **Database**: `/var/apps/data/fantasy-hawk.db`

### Frontend
- **Location**: `/var/apps/fantasy-hawk/frontend/dist`
- **Served by**: Caddy (static files)
- **Domain**: `https://fantasyhawk.benloe.com`

### PM2 Configuration
```javascript
{
  name: 'fantasy-hawk-api',
  script: 'backend/dist/server.js',
  env: {
    NODE_ENV: 'production',
    PORT: 3005,
    YAHOO_CLIENT_ID: '<from Yahoo Developer>',
    YAHOO_CLIENT_SECRET: '<from Yahoo Developer>',
    YAHOO_CALLBACK_URL: 'https://fantasyhawk.benloe.com/api/oauth/callback',
    AUTH_SERVICE_URL: 'http://localhost:3002',
    DATABASE_PATH: '/var/apps/data/fantasy-hawk.db',
    FRONTEND_URL: 'https://fantasyhawk.benloe.com'
  }
}
```

### Caddy Configuration
```
fantasyhawk.benloe.com {
    handle /api/* {
        reverse_proxy localhost:3005
    }
    handle {
        root * /var/apps/fantasy-hawk/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

## Development

### Backend Development
```bash
cd /var/apps/fantasy-hawk/backend
npm run dev       # Run in development mode
npm run build     # Build TypeScript
npm start         # Run production build
```

### Frontend Development
```bash
cd /var/apps/fantasy-hawk/frontend
npm run dev       # Start Vite dev server (port 5173)
npm run build     # Build for production
npm run preview   # Preview production build
```

### Deployment Commands
```bash
# Backend
cd /var/apps/fantasy-hawk/backend
npm run build
pm2 restart fantasy-hawk-api

# Frontend
cd /var/apps/fantasy-hawk/frontend
npm run build
# No restart needed - Caddy serves static files
```

## Yahoo API Documentation

See `docs/YAHOO_API_STRUCTURE.md` for detailed documentation on:
- Yahoo Fantasy API response structures
- How to parse complex nested JSON responses
- Common stat IDs for NBA
- Debug endpoints for exploring API responses

## Yahoo Developer Setup

1. Create app at https://developer.yahoo.com/apps/create/
2. Set **Client Type**: Confidential Client
3. Set **Homepage URL**: `https://fantasyhawk.benloe.com`
4. Set **Redirect URI**: `https://fantasyhawk.benloe.com/api/oauth/callback`
5. Enable **Fantasy Sports** API with Read access
6. Copy **Client ID** and **Client Secret** to backend `.env`

## Security Considerations

- OAuth tokens stored encrypted in SQLite
- CORS restricted to benloe.com domain
- Helmet.js security headers
- All traffic over HTTPS via Caddy
- Artanis authentication required before Yahoo OAuth

## Future Enhancements

- Player comparison tools
- Historical performance tracking
- Trade analyzer
- Waiver wire recommendations
- Weekly matchup predictions
- Custom scoring projections
- League activity feed
- Mobile responsive improvements

## Troubleshooting

### Backend won't start
- Check PM2 logs: `pm2 logs fantasy-hawk-api`
- Verify database path exists: `/var/apps/data/`
- Check port 3005 isn't in use: `ss -tlnp | grep 3005`

### OAuth fails
- Verify Yahoo app credentials in `.env`
- Check callback URL matches Yahoo Developer settings
- Ensure frontend URL is correct in environment

### Data not loading
- Check if user is logged in via Artanis
- Verify Yahoo account is connected: `/api/oauth/status`
- Check browser console for API errors
- Verify token hasn't expired in database

## Project Created
December 21, 2025 by Claude Code

## Repository
Git repository initialized at `/var/apps/fantasy-hawk/.git`
