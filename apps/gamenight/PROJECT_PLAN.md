# 🎲 Game Night Scheduler - Complete Implementation Plan

## 🎯 Project Vision

A delightful board game scheduling app that solves the commitment problem through structured event creation with enforced player limits. Built with AI-assisted development for rapid iteration and type-safe architecture.

## 🔐 Unified Authentication System

### Decision: Build Unified Auth for benloe.com

**Benefits with AI code generation:**

- Single user database across all benloe.com subprojects
- JWT tokens with subdomain cookie sharing
- Consistent user experience
- ~200 lines of boilerplate that AI generates perfectly

### Architecture

```
auth.benloe.com (Express service)
├── /api/auth/magic-link    # Send magic link email
├── /api/auth/verify        # Verify token & issue JWT
├── /api/auth/refresh       # Refresh JWT token
└── /api/users/profile      # Shared profile management

gamenight.benloe.com
└── Validates JWT from auth.benloe.com cookie
```

### Implementation

- Magic link authentication (no passwords)
- 30-day persistent sessions
- Cross-subdomain cookie sharing
- Rate limiting (10 requests/minute per IP)

## 📊 Complete Database Schema

### Core Models

```prisma
// Shared User model (auth.benloe.com)
model User {
  id          String   @id @default(cuid())
  email       String   @unique
  name        String?
  avatar      String?
  timezone    String   @default("UTC")
  createdAt   DateTime @default(now())
  lastLoginAt DateTime?

  // Game Night specific relations
  createdEvents Event[] @relation("EventCreator")
  commitments   Commitment[]
  reminders     EventReminder[]
  calendarSubs  CalendarSubscription[]
}

// Game library with BGG integration
model Game {
  id          String  @id @default(cuid())
  name        String
  minPlayers  Int
  maxPlayers  Int
  duration    Int?    // minutes
  complexity  Float?  // 1-5 BGG weight
  bggId       Int?    @unique
  imageUrl    String?
  description String?
  bestWith    String? // "3-4" players recommended

  events Event[]

  @@index([name])
}

// Events (one-time and recurring)
model Event {
  id          String      @id @default(cuid())
  title       String?
  dateTime    DateTime
  location    String?
  description String?
  status      EventStatus @default(OPEN)
  createdAt   DateTime    @default(now())
  commitmentDeadline DateTime?

  game        Game   @relation(fields: [gameId], references: [id])
  gameId      String
  creator     User   @relation("EventCreator", fields: [creatorId], references: [id])
  creatorId   String

  // Recurring events
  recurringPattern   RecurringPattern?
  parentEvent        Event? @relation("RecurringSeries", fields: [parentEventId], references: [id])
  parentEventId      String?
  childEvents        Event[] @relation("RecurringSeries")

  commitments Commitment[]
  reminders   EventReminder[]

  @@index([dateTime])
  @@index([status])
}

// Recurring event patterns
model RecurringPattern {
  id        String           @id @default(cuid())
  frequency RecurrenceType   // WEEKLY, BIWEEKLY, MONTHLY
  interval  Int             @default(1)
  endDate   DateTime?

  event     Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  eventId   String @unique
}

// User commitments to events
model Commitment {
  id       String           @id @default(cuid())
  status   CommitmentStatus @default(COMMITTED)
  joinedAt DateTime         @default(now())
  notes    String?

  event   Event  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  eventId String
  user    User   @relation(fields: [userId], references: [id])
  userId  String

  @@unique([eventId, userId])
}

// Email reminder scheduling
model EventReminder {
  id         String   @id @default(cuid())
  eventId    String
  userId     String
  reminderAt DateTime
  sent       Boolean  @default(false)
  type       ReminderType @default(BEFORE_EVENT)

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id])

  @@unique([eventId, userId, type])
}

// Calendar subscription management
model CalendarSubscription {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique @default(cuid())
  createdAt DateTime @default(now())
  active    Boolean  @default(true)

  user User @relation(fields: [userId], references: [id])
}

enum EventStatus {
  OPEN
  FULL
  CANCELLED
  COMPLETED
}

enum CommitmentStatus {
  COMMITTED
  WAITLISTED
  DECLINED
}

enum RecurrenceType {
  WEEKLY
  BIWEEKLY
  MONTHLY
}

enum ReminderType {
  BEFORE_EVENT    // 24h before
  WEEKLY_DIGEST   // Sunday evening
  COMMITMENT_DEADLINE // 2h before deadline
}
```

## 🏗️ Implementation Phases (Dependency Order)

### Phase 1: Authentication Foundation

**Goal:** Unified auth system across benloe.com

1. **Auth Service Setup**
   - Express server for auth.benloe.com
   - Prisma schema for User model
   - JWT token generation/validation
   - Cross-subdomain cookie configuration

2. **Magic Link Flow**
   - Email sending with SendGrid/Resend
   - Token generation with expiration
   - Verification endpoint
   - Session management

3. **Gamenight Integration**
   - JWT validation middleware
   - User context extraction
   - Protected route setup

### Phase 2: Core Data Layer

**Goal:** Complete database foundation

1. **Database Setup**
   - Full Prisma schema implementation
   - Migrations and relationships
   - Type generation
   - Seed data for development

2. **Basic API Routes**
   - User CRUD operations
   - Game CRUD operations
   - Event CRUD operations
   - Commitment management

### Phase 3: Game Library System

**Goal:** BoardGameGeek integration

1. **BGG API Client**
   - XML API wrapper
   - Game search functionality
   - Data parsing and normalization
   - Image URL extraction

2. **Game Import Flow**
   - Search interface
   - Preview before import
   - One-click import
   - Manual game addition
   - Game data enrichment

### Phase 4: Event Management

**Goal:** Core scheduling functionality

1. **Event Creation**
   - Multi-step wizard
   - Game selection
   - Date/time picker
   - Recurrence pattern setup
   - Player limit configuration

2. **Commitment System**
   - Join/leave actions
   - Waitlist management
   - Conflict detection
   - Status updates

### Phase 5: Recurring Events

**Goal:** Pattern-based scheduling

1. **Pattern Creation**
   - Weekly/bi-weekly/monthly options
   - End date configuration
   - Instance generation logic

2. **Series Management**
   - Edit single vs all instances
   - Cancellation handling
   - Commitment propagation

### Phase 6: Calendar Integration

**Goal:** External calendar sync

1. **ICS Generation**
   - Personal calendar feeds
   - Public event calendar
   - Timezone handling
   - Event updates

2. **Subscription Management**
   - Unique feed URLs
   - Token-based access
   - Calendar client compatibility

### Phase 7: Email System

**Goal:** Notification and reminders

1. **Email Templates**
   - Event reminders (24h before)
   - Commitment confirmations
   - Event updates
   - Weekly digest

2. **Scheduling System**
   - Reminder queue management
   - User preferences
   - Delivery tracking

### Phase 8: Frontend Foundation

**Goal:** React application setup

1. **Project Setup**
   - Vite + React + TypeScript
   - Tailwind CSS + HeadlessUI
   - API client with type safety
   - Error boundaries

2. **Component Library**
   - Shared UI components
   - Form components
   - Loading/error states
   - Layout components

### Phase 9: Core Pages

**Goal:** Complete user interface

1. **Home/Event Feed**
   - Event card layout
   - Filtering and search
   - Quick join actions
   - Commitment status display

2. **Event Creation Wizard**
   - Step-by-step flow
   - Game selection
   - Recurrence setup
   - Validation and error handling

3. **Event Details Page**
   - Complete event information
   - Player list and status
   - Join/leave actions
   - Host management tools

4. **Game Library**
   - Grid/list views
   - Search and filtering
   - BGG import interface
   - Game detail pages

5. **User Dashboard**
   - Upcoming commitments
   - Hosted events
   - Calendar subscription
   - Settings and preferences

### Phase 10: Polish & Deployment

**Goal:** Production-ready application

1. **Mobile Optimization**
   - Responsive design
   - Touch interactions
   - Performance optimization

2. **Error Handling**
   - Toast notifications
   - Form validation with Zod
   - Graceful degradation

3. **Security & Performance**
   - CSP headers
   - Rate limiting
   - Caching strategies
   - SEO optimization

4. **Deployment**
   - PM2 configuration
   - Caddy reverse proxy
   - SSL certificates
   - Environment management

## 🎯 Complete Feature Set

### Event Management

- Create one-time and recurring events
- Enforced player limits with waitlist
- Location and rich description support
- Commitment deadlines
- Conflict detection for users
- Host controls (edit, cancel, manage)

### Game Integration

- BoardGameGeek search and import
- Game complexity indicators
- "Best with X players" recommendations
- Play time and player count info
- Custom game support
- Game artwork display

### Calendar & Reminders

- Personal .ics calendar feeds
- Individual event exports
- Email reminders (24h before events)
- Weekly digest emails
- Google Calendar integration
- Timezone support

### User Experience

- Unified benloe.com authentication
- Magic link login (no passwords)
- Display name and avatar
- Reliability scoring (subtle)
- Commitment history tracking
- Personalized dashboard

### Social Features

- Shareable event links
- Commitment visibility
- Waitlist with auto-promotion
- Event comments
- Host feedback system

## 🔧 Technical Architecture

### Frontend Stack

```typescript
React + TypeScript + Vite
Tailwind CSS + HeadlessUI
Zustand (state management)
React Hook Form + Zod (forms)
date-fns (date handling)
```

### Backend Stack

```typescript
Node.js + Express + TypeScript
Prisma ORM + SQLite/PostgreSQL
JWT authentication
SendGrid/Resend (email)
node-cron (scheduling)
```

### Shared Services

```typescript
// Service architecture
AuthService; // JWT validation, magic links
EventService; // CRUD, recurrence, validation
GameService; // BGG import, search
EmailService; // Templates, scheduling
CalendarService; // ICS generation
NotificationService; // Reminders, digests
```

### Component Architecture

```typescript
// Shared UI components
<EventCard />           // Event display with actions
<GameSelector />        // BGG search and selection
<DateTimePicker />      // Date/time with recurrence
<CommitmentButton />    // Join/leave with status
<UserAvatar />          // User display with reliability
<RecurrenceSelector />  // Weekly/bi-weekly/monthly
<CalendarExport />      // ICS download/subscription
```

## 🚀 Deployment Architecture

```
benloe.com
├── auth.benloe.com
│   ├── Express auth service (port 3002)
│   └── User database
├── gamenight.benloe.com
│   ├── /api/* → Express API (port 3001)
│   ├── /* → React SPA (port 3000)
│   └── Game/Event database
└── Shared session cookies
```

### Caddy Configuration

```caddy
auth.benloe.com {
  reverse_proxy localhost:3002
}

gamenight.benloe.com {
  reverse_proxy /api/* localhost:3001
  reverse_proxy /* localhost:3000
}
```

## 📈 Development Strategy for AI Tools

### Prompt Engineering Patterns

1. **"Generate Prisma schema for [feature] with [constraints]"**
2. **"Create TypeScript service with error handling for [operation]"**
3. **"Build React component with Tailwind styles for [UI element]"**
4. **"Add Zod validation schema for [data structure]"**
5. **"Implement API endpoint with [authentication/authorization]"**

### Type-First Development

- Generate TypeScript interfaces from Prisma schema
- Create API contracts before implementation
- Use strict TypeScript configuration
- Let type errors guide AI code completion

### Component-Driven Development

- Build isolated components with clear props
- Compose components into pages
- Consistent design system with Tailwind
- Reusable business logic hooks

### Testing Strategy

- Type safety as primary testing layer
- Integration tests for API endpoints
- Component testing for complex interactions
- Manual testing for user flows

---

**Status:** Ready to begin Phase 1 implementation
**Next Steps:** Set up auth service and unified authentication system
