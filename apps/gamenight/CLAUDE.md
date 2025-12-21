# Game Night Scheduler - Production Documentation

## Overview

The Game Night Scheduler is a web application that solves the commitment problem in board game scheduling. Instead of open invites that lead to wrong group sizes, it enables commitment-based scheduling where players commit to specific game/date combinations with enforced player limits.

**Live App**: https://gamenight.benloe.com  
**Status**: Production Ready ✅  
**Last Updated**: August 2025

## Core Problem & Solution

**Problem**: Board games require specific player counts (2-4, 3-6, etc.), but traditional "open invites" result in too many or too few players showing up.

**Solution**:

- Players commit to specific events with known games
- Events automatically close when max players reached
- Waitlist system handles overflow
- Clear visibility into who's actually coming

## Architecture Overview

### Technology Stack

**Frontend**:

- React 18 with TypeScript for type safety
- Tailwind CSS + Headless UI for modern, responsive design
- Zustand for lightweight state management
- Vite for fast builds and development

**Backend**:

- Node.js + Express with TypeScript
- Prisma ORM with SQLite database
- JWT authentication (integrated with Artanis auth service)
- Rate limiting and security middleware

**Infrastructure**:

- Deployed on VPS at `/var/apps/gamenight/`
- PM2 process management
- Caddy reverse proxy with automatic HTTPS
- SQLite for simple, reliable data storage

### Service Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │    │   Game Night     │    │  Artanis Auth   │
│  (React/Vite)   │────│   API Server     │────│   Service       │
│  Port 3000      │    │  (Express/Node)  │    │   Port 3002     │
└─────────────────┘    │   Port 3001      │    └─────────────────┘
                       └──────────────────┘
                                │
                       ┌──────────────────┐
                       │   SQLite DB      │
                       │  gamenight.db    │
                       └──────────────────┘
```

### Request Flow

1. **Client** → Caddy (HTTPS termination)
2. **Caddy** → Routes `/api/*` to Game Night API (3001)
3. **Caddy** → Routes `/*` to React app (3000)
4. **API** → Validates JWT with Artanis service
5. **API** → Queries SQLite database
6. **API** → Returns JSON response

## Database Schema

The application uses a SQLite database with the following core entities:

### Games

- Board game catalog with BGG (BoardGameGeek) integration
- Stores player count requirements, complexity, duration
- Rich metadata including images and descriptions

### Events

- Scheduled game sessions with date/time/location
- Linked to specific games with player count enforcement
- Support for recurring events and series
- Status tracking (OPEN/FULL/CANCELLED/COMPLETED)

### Commitments

- Player commitments to specific events
- Support for committed/waitlisted/declined statuses
- Automatic event closure when max players reached

### Additional Features

- Calendar subscriptions (iCal feeds)
- Event reminders and notifications
- Recurring event patterns

## Key Features

### 🎯 **Commitment-Based Scheduling**

- Players commit to events, not just "maybe" responses
- Events automatically close when full
- Waitlist system for popular events
- Clear participant visibility

### 🎲 **BoardGameGeek Integration**

- Search and import games from BGG database
- Accurate player counts and game metadata
- Rich game information including complexity ratings

### 📅 **Calendar Export**

- iCal feed generation for personal calendars
- Subscription-based updates
- Integration with Google Calendar, Apple Calendar, etc.

### 🔄 **Recurring Events**

- Weekly, bi-weekly, monthly patterns
- Automatic event creation
- Series management for ongoing game groups

### 📱 **Mobile-First Design**

- Responsive design for all screen sizes
- Touch-optimized interactions
- Progressive Web App capabilities

## Security & Production Features

### 🔒 **Security**

- JWT-based authentication via Artanis service
- Rate limiting (100 requests per 15 minutes)
- Security headers (CSP, XSS protection, etc.)
- CORS configured for benloe.com domains
- HTTPS enforced with automatic certificates

### 📊 **Monitoring & Reliability**

- PM2 process management with automatic restarts
- Health check endpoints (`/api/health`)
- Structured logging and error tracking
- Database backups via git repository

### ⚡ **Performance**

- Optimized Vite builds with tree shaking
- Efficient SQLite queries with proper indexing
- CDN-ready static assets
- Client-side caching with Zustand

## Development & Testing

### Code Quality

- Full TypeScript coverage
- ESLint + Prettier for consistent formatting
- Automated builds with type checking
- Production-ready error handling

### Testing Suite (Playwright)

- API health and functionality tests
- UI interaction and navigation tests
- Responsive design verification
- Authentication flow testing

### Development Workflow

```bash
# Frontend development
npm run dev          # Start development server
npm run build        # Production build
npm run test         # Run Playwright tests

# Backend development
cd api
npm run dev          # Start API with hot reload
npm run build        # Compile TypeScript
npm run db:migrate   # Update database schema
```

## Deployment

### File Structure

```
/var/apps/gamenight/
├── api/                    # Backend Express server
│   ├── src/               # TypeScript source
│   ├── dist/              # Compiled JavaScript
│   ├── prisma/            # Database schema & migrations
│   └── package.json
├── src/                   # Frontend React app
├── dist/                  # Built frontend assets
├── tests/                 # Playwright test suite
├── playwright.config.ts   # Test configuration
└── package.json          # Root package.json
```

### Environment Configuration

**API** (`.env`):

```env
NODE_ENV=production
PORT=3001
JWT_SECRET=<shared-with-artanis>
AUTH_SERVICE_URL=http://localhost:3002
DATABASE_URL=file:./prisma/gamenight.db
```

**Frontend** (`.env`):

```env
VITE_API_URL=/api
VITE_AUTH_URL=https://auth.benloe.com
```

### Process Management

- **gamenight-api**: Express server (PM2 managed)
- **gamenight-frontend**: Static file server (PM2 managed)
- Automatic restart on crashes
- Log rotation and monitoring

### Caddy Configuration

```caddyfile
gamenight.benloe.com {
    # API routes
    reverse_proxy /api/* localhost:3001

    # Frontend static files
    reverse_proxy * localhost:3000

    # Security headers
    header /* {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

## API Endpoints

### Core Endpoints

- `GET /api/health` - Service health check
- `GET /api/games` - List games with filtering
- `POST /api/games/search` - Search BoardGameGeek
- `GET /api/events` - List upcoming events
- `POST /api/events` - Create new event
- `POST /api/events/:id/join` - Join event
- `DELETE /api/events/:id/leave` - Leave event

### Authentication

- All write operations require JWT token
- Tokens validated against Artanis auth service
- User context passed via `creatorId` and `userId` fields

### Rate Limiting

- 100 requests per 15-minute window per IP
- Headers included: `RateLimit-Limit`, `RateLimit-Remaining`
- 429 status code when exceeded

## Future Enhancements

### Planned Features

- Push notifications for event reminders
- Game recommendation engine
- Advanced filtering and search
- Social features (friend groups, invites)
- Integration with game collection APIs

### Technical Improvements

- Redis caching for frequently accessed data
- WebSocket connections for real-time updates
- Database migration to PostgreSQL for scaling
- CDN integration for static assets

## Maintenance

### Regular Tasks

- Monitor PM2 process status: `pm2 status`
- Check application logs: `pm2 logs gamenight-api`
- Verify SSL certificate renewal (automatic via Caddy)
- Review rate limiting and security logs

### Backup Strategy

- Database: Included in git repository
- Configuration: Stored in `/var/apps/gamenight/`
- Code: Backed up to GitHub repository
- Server snapshots: Manual DigitalOcean snapshots

### Troubleshooting

- **App not loading**: Check PM2 processes, Caddy config
- **API errors**: Review logs in `/var/apps/gamenight/api/logs/`
- **Database issues**: Verify SQLite file permissions and disk space
- **Auth problems**: Confirm Artanis service connectivity

---

**Built for the board game community to solve the eternal "how many people are actually coming?" problem. Now you can plan game nights with confidence! 🎲**
