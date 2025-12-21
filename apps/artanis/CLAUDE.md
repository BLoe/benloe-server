# Artanis Authentication System

## Philosophy & Architecture

Artanis is a unified authentication service for the benloe.com ecosystem, built on the principle of **secure, passwordless authentication** with **magic links**. The system prioritizes security through simplicity, avoiding complex password management while maintaining enterprise-grade security standards.

## Core Principles

### Security First

- **Zero passwords**: Magic link authentication eliminates password-related vulnerabilities
- **HTTP-only cookies**: JWTs stored in secure, HTTP-only cookies prevent XSS attacks
- **Token lifecycle management**: Proper session invalidation and cleanup
- **Rate limiting**: Built-in protection against brute force attacks
- **CORS enforcement**: Strict origin checking for cross-domain requests

### Developer Experience

- **Type safety**: Full TypeScript implementation with strict type checking
- **Code quality**: ESLint + Prettier with security plugins for consistent, secure code
- **Database schema**: Prisma ORM with clear relational models
- **Error handling**: Comprehensive error boundaries with appropriate HTTP status codes

### Production Ready

- **Process management**: PM2 configuration for zero-downtime deployments
- **Environment isolation**: Proper separation of development and production configurations
- **Logging**: Structured logging with file rotation
- **Monitoring**: Built-in health checks and error tracking

## System Architecture

### Authentication Flow

1. **Magic Link Request**: User submits email address
2. **Token Generation**: Cryptographically secure token with expiration
3. **Email Delivery**: Mailgun API sends styled email with verification link
4. **Token Verification**: User clicks link, token is validated and consumed
5. **Session Creation**: JWT issued and stored in HTTP-only cookie
6. **Cross-Domain Auth**: Cookie domain configured for \*.benloe.com ecosystem

### Data Models

- **User**: Core user profile with timezone and metadata
- **Session**: Active login sessions with expiration and tracking
- **MagicLinkToken**: Single-use tokens with expiration for email verification

### Security Layers

- **Content Security Policy**: Helmet.js with strict CSP headers
- **Rate Limiting**: IP-based request throttling on authentication endpoints
- **JWT Validation**: Stateless token verification with proper error handling
- **Cookie Security**: Production-grade cookie settings (secure, httpOnly, sameSite)

## Technology Stack

### Core Framework

- **Express.js**: Robust HTTP server with middleware ecosystem
- **TypeScript**: Type safety and enhanced developer experience
- **Prisma**: Type-safe database access and migrations
- **SQLite**: Lightweight, serverless database for auth data

### Authentication & Security

- **JWT**: Stateless authentication tokens
- **Mailgun**: Reliable email delivery service
- **Helmet**: Security headers and CSP configuration
- **Zod**: Runtime type validation for API inputs

### Development Tools

- **ESLint**: Code linting with security and import plugins
- **Prettier**: Consistent code formatting
- **tsx**: TypeScript execution for development
- **Tailwind CSS**: Utility-first styling for UI components

### Production Environment

- **PM2**: Process management and monitoring
- **Caddy**: Reverse proxy and SSL termination (separate service)
- **Linux**: Production deployment on VPS infrastructure

## Project Structure

### Source Code Organization

```
src/
├── middleware/     # Authentication and request processing
├── routes/         # API endpoints and handlers
├── services/       # Business logic and external integrations
└── types/          # TypeScript type definitions
```

### Configuration Files

- `prisma/schema.prisma`: Database schema and relationships
- `ecosystem.config.js`: PM2 process configuration
- `tailwind.config.js`: Styling build configuration
- `.env`: Environment variables (not committed)

### Frontend Views

- `views/login.ejs`: Magic link request interface
- `views/verify.ejs`: Token verification page
- `views/dashboard.ejs`: Protected user interface

## Integration Guidelines

### Adding New Services

1. **Authentication Middleware**: Use `authenticate` middleware for protected routes
2. **CORS Configuration**: Add new domains to allowed origins
3. **Error Handling**: Implement consistent error responses
4. **Type Safety**: Extend user types in `src/types/` for additional fields

### Environment Configuration

- **Development**: Local database, relaxed security settings, detailed logging
- **Production**: Remote database, strict security headers, error log aggregation

### Database Management

- **Migrations**: Use Prisma migrate for schema changes
- **Seeding**: User creation handled through magic link flow
- **Cleanup**: Automated token cleanup prevents database bloat

## Operational Considerations

### Deployment

- Build process generates production assets (CSS, TypeScript compilation)
- PM2 handles process restart and monitoring
- Environment variables managed through `.env` files
- Database migrations run separately from application deployment

### Monitoring

- Application logs written to `logs/` directory
- PM2 provides process health monitoring
- Error tracking through console.error with structured logging
- Magic link success/failure rates tracked in application logs

### Maintenance

- Token cleanup runs automatically during verification process
- Session management handles expired tokens gracefully
- Email delivery failures logged for troubleshooting
- Database size monitoring for long-term scaling

## Development Commands

### Core Operations

- `npm run dev`: Start development server with file watching
- `npm run build`: Build production assets and TypeScript
- `npm run start`: Run production server
- `npm run clean-code`: Auto-fix linting and format code

### Database Operations

- `npm run db:migrate`: Apply schema changes
- `npm run db:generate`: Regenerate Prisma client
- `npm run db:studio`: Open database GUI

### Quality Assurance

- `npm run type-check`: TypeScript compilation check
- `npm run lint`: Code quality analysis
- `npm run check-all`: Full quality assurance suite

## Future Considerations

### Scalability

- JWT stateless design enables horizontal scaling
- Session cleanup can be moved to background jobs
- Email queue system for high-volume magic link delivery
- Database migration to PostgreSQL for larger datasets

### Feature Expansion

- Multi-factor authentication support
- OAuth integration with third-party providers
- User profile management and preferences
- Admin dashboard for user management

### Security Enhancements

- Audit logging for authentication events
- Suspicious activity detection
- Geographic access controls
- Advanced rate limiting with user behavior analysis
