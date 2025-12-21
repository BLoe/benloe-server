# Defense Against the Dart Arts (DADA) - Project Scope

## Project Overview

**Defense Against the Dart Arts** is a darts training and practice application inspired by Harry Potter's Defense Against the Dark Arts class. The app provides a trainer-guided experience (Professor Moody/Snape personality) that uses spaced repetition principles to help users improve their dart skills through structured drills and long-term progress tracking.

**Core Philosophy:**
- **Trainer-Guided:** Professor Moody provides instruction, commentary, and drill recommendations
- **Quick Sessions:** Designed for 2-5 minute practice sessions throughout the day, not structured around days/weeks
- **Motor Skill Learning:** Uses spaced repetition adapted for motor skills (not traditional flashcard-style)
- **Performance-Based:** Algorithm tracks results automatically - no manual difficulty ratings
- **Simple Input:** Button-based throw entry - fast and mobile-friendly

## Target User

Experienced developer (Ben) learning darts through deliberate practice. Wants:
- Structured training without overthinking
- Quick feedback on performance
- Long-term progress visibility
- Mobile-friendly for practicing at dartboard

## Core Features

### 1. Drill System

**Drill Types:**
- **Treble 20 Focus** - Hit Treble 20 repeatedly (10 throws)
- **Bullseye Practice** - Hit the double bull (10 throws)
- **High Score Hunt** - Score as high as possible in 9 darts
- **Around the Clock** - Hit 1-20 in sequence (single, double, or treble variants)
- **Cricket Practice** - Hit 15, 16, 17, 18, 19, 20, Bull (3 hits each)
- **Doubles Practice** - Hit each double around the board
- **Specific Target Drills** - Any number/ring combination for focused practice

**Drill Properties:**
- `id` - Unique identifier
- `name` - Display name
- `description` - Instructions for user
- `target` - What to aim for (number + ring type, or null for open scoring)
- `throwCount` - How many darts in the drill
- `category` - accuracy, scoring, endurance, game-specific

### 2. Spaced Repetition Algorithm

**Not traditional Anki/SM-2** - Adapted for motor skills:

**Input Factors:**
- Performance (50% weight) - Recent accuracy/success rate
- Recency (30% weight) - Time since last practiced
- Variety (20% weight) - Ensure different drill types get rotation

**Performance Calculation:**
- Last 3 sessions average accuracy
- Drills with <50% accuracy get higher priority
- Drills with >80% accuracy get lower priority (mastered)

**Recency Calculation:**
- Sessions since last practice (not time-based)
- Drills not practiced in 5+ sessions get boosted priority

**Variety Calculation:**
- Ensure different categories rotate
- Don't repeat same drill type back-to-back

**Drill Selection Logic:**
```
for each drill:
  performanceScore = (1 - recentAccuracy) * 0.5
  recencyScore = min(sessionsSinceLastPractice / 5, 1.0) * 0.3
  varietyScore = categoryRotationBonus * 0.2

  totalScore = performanceScore + recencyScore + varietyScore

return drill with highest totalScore
```

### 3. Dart Input System

**Two-Stage Input:**
1. Select number (1-20, Bull, Miss)
2. Select ring type (Single, Double, Treble) - if applicable

**Special Cases:**
- Bull = auto Double Bull (50 points)
- Miss = 0 points, no ring selection
- Numbers require ring selection

**Confirmation:**
- Shows selected throw and calculated score
- "Record Throw" button enabled only when complete

### 4. Professor Moody Commentary

**Personality:** Gruff, demanding, rarely satisfied (like Snape)

**Commentary Types:**
- **Drill Start:** Sets expectations, instruction
- **Hit Target:** Grudging approval, warnings against overconfidence
- **Miss Target:** Criticism, reminders to focus
- **Drill Complete:** Summary with measured tone

**Example Comments:**
- Hit: "Acceptable. Do not let success inflate your ego."
- Miss: "Disappointing. Focus on fundamentals."
- Start: "Your drill today: Treble 20. Show me you can hit it with consistency."
- Complete: "Session complete. Your performance was... sufficient."

### 5. Statistics Tracking

**Session-Level Stats:**
- Total throws in session
- Current drill accuracy (hits vs. attempts)
- 3-Dart Average (3DA) - standard darts metric

**Drill-Level Stats (Persistent):**
- Accuracy percentage per drill
- Best accuracy achieved
- Total sessions completed
- Last practiced (session count, not date)
- Trend (improving, stable, declining)

**Long-Term Stats:**
- Overall 3DA trend over time
- Accuracy by drill type
- Most/least practiced drills
- Progress charts showing improvement
- Session history with drill results

### 6. Trainer Mode (Homepage)

**Primary View:**
- "Your Next Drill" - Recommended by algorithm
- Brief explanation why (e.g., "You haven't practiced this in 8 sessions")
- Alternative drills available
- Start drill button

**Secondary Options:**
- Free Practice - Choose your own drill
- View Progress - Charts and stats
- Drill History - Past sessions

## Technical Architecture

### Frontend (Current)

**Single-Page Application:**
- Static HTML + Vanilla JS
- Tailwind CSS for styling
- Artanis authentication integration
- Hosted at: `https://dada.benloe.com`

**Data Storage (Current):**
- Client-side only (session data in memory)
- No persistence between page reloads

### Backend (Planned)

**API Endpoints Needed:**
```
POST   /api/drills/:drillId/sessions        # Start new drill session
POST   /api/drills/:drillId/sessions/:id/throws  # Record throw
PATCH  /api/drills/:drillId/sessions/:id    # Complete session
GET    /api/drills/recommended              # Get next recommended drill
GET    /api/stats/overall                   # Get overall stats
GET    /api/stats/drills/:drillId           # Get drill-specific stats
GET    /api/sessions                        # Get session history
GET    /api/sessions/:id                    # Get session details
```

**Technology:**
- Node.js + Express (consistent with other apps)
- SQLite database (`/var/apps/data/dada.db`)
- Port: TBD (check available with `pm2 list`)
- PM2 ecosystem config

### Database Schema

**users table:**
- Already exists in Artanis system
- Reference by user_id

**drills table:**
```sql
CREATE TABLE drills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  target_number TEXT,  -- '20', 'bull', null
  target_ring TEXT,    -- 'single', 'double', 'treble', null
  throw_count INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**sessions table:**
```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  drill_id TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  throw_count INTEGER DEFAULT 0,
  hits INTEGER DEFAULT 0,
  accuracy REAL,
  total_score INTEGER DEFAULT 0,
  three_dart_avg REAL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (drill_id) REFERENCES drills(id)
);
```

**throws table:**
```sql
CREATE TABLE throws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  number TEXT NOT NULL,  -- '1'-'20', 'bull', '0' for miss
  ring_type TEXT,        -- 'single', 'double', 'treble', null
  score INTEGER NOT NULL,
  thrown_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

**drill_stats table (computed/cached):**
```sql
CREATE TABLE drill_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  drill_id TEXT NOT NULL,
  total_sessions INTEGER DEFAULT 0,
  total_throws INTEGER DEFAULT 0,
  total_hits INTEGER DEFAULT 0,
  avg_accuracy REAL,
  best_accuracy REAL,
  last_session_id INTEGER,
  sessions_since_practiced INTEGER DEFAULT 0,
  trend TEXT,  -- 'improving', 'stable', 'declining'
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (drill_id) REFERENCES drills(id),
  UNIQUE(user_id, drill_id)
);
```

## Current Implementation Status

### ✅ Completed

- [x] Authentication with Artanis
- [x] Simple button-based dart input
- [x] Drill system (3 drills defined)
- [x] Professor Moody commentary system
- [x] Session stats tracking (throws, accuracy, 3DA)
- [x] Progress bar for drill completion
- [x] Recent throws display
- [x] Mobile-friendly UI

### 🚧 In Progress

- [ ] Additional drill types
- [ ] Backend API development

### 📋 Planned

**Backend & Data Persistence:**
- [ ] Express API setup
- [ ] SQLite database setup
- [ ] User session management
- [ ] Throw recording endpoint
- [ ] Stats calculation service

**Spaced Repetition:**
- [ ] Drill recommendation algorithm
- [ ] Performance tracking across sessions
- [ ] Recency tracking
- [ ] Variety rotation logic

**Trainer Mode:**
- [ ] Homepage with recommended drill
- [ ] Explanation of why drill was chosen
- [ ] Alternative drill suggestions
- [ ] Free practice mode

**Statistics & Progress:**
- [ ] Overall stats dashboard
- [ ] Per-drill performance charts
- [ ] Session history view
- [ ] Progress trends over time
- [ ] 3DA chart over sessions

**Additional Drills:**
- [ ] Around the Clock (single, double, treble variants)
- [ ] Cricket practice
- [ ] Shanghai (specific number, all three rings)
- [ ] Doubles around the board
- [ ] Trebles around the board
- [ ] Custom target creation

**Quality of Life:**
- [ ] Keyboard shortcuts for number entry
- [ ] Undo last throw
- [ ] Edit throw if misrecorded
- [ ] Session notes/comments
- [ ] Export stats to CSV

## UI/UX Flow

### Landing Page (Trainer Mode)
```
+----------------------------------+
|  Professor Moody                 |
|  "Your next drill: Treble 20     |
|   Focus. You haven't practiced   |
|   this in 6 sessions."           |
+----------------------------------+
|                                  |
|  [Start Drill]                   |
|  [Choose Different Drill]        |
|  [View Progress]                 |
+----------------------------------+
```

### Drill Active Page (Current)
```
+----------------------------------+
|  Professor Moody                 |
|  "Commentary here..."            |
+----------------------------------+
|  Drill: Treble 20 Focus          |
|  Progress: [=======>   ] 7/10    |
+----------------------------------+
|  Enter Your Throw:               |
|  [Number Grid]                   |
|  [Ring Type Buttons]             |
|  Selected: Treble 20 (60 pts)    |
|  [Record Throw]                  |
+----------------------------------+
|  Stats: 7 throws | 42% | 45.2    |
+----------------------------------+
|  Recent Throws:                  |
|  Treble 20 - 60 ✓                |
|  Single 5 - 5                    |
|  ...                             |
+----------------------------------+
```

### Stats Dashboard (Planned)
```
+----------------------------------+
|  Overall Progress                |
|  3DA: 45.2 (↑ 3.1 from last)     |
|  Sessions: 24                    |
|  [3DA Chart Over Time]           |
+----------------------------------+
|  Drill Performance               |
|  Treble 20: 42% | Last: 6 ago    |
|  Bullseye: 28% | Last: 3 ago     |
|  [More drills...]                |
+----------------------------------+
```

## Success Metrics

**User Engagement:**
- Sessions per week
- Average session length
- Drill completion rate

**Skill Improvement:**
- 3DA trend upward over time
- Accuracy improvement per drill
- Consistency (variance in performance)

**Algorithm Effectiveness:**
- Are recommended drills actually helpful?
- Do users follow recommendations?
- Balanced drill variety

## Future Enhancements (Beyond MVP)

**Advanced Features:**
- Game modes (301, 501, Cricket matches)
- Multiplayer practice sessions
- Video analysis integration
- Dart trajectory prediction
- Heat maps of board accuracy

**Social Features:**
- Share sessions with friends
- Leaderboards (optional)
- Coach/student relationships

**Hardware Integration:**
- Smart dartboard integration (if available)
- Automated throw detection
- Bluetooth connectivity

**AI Enhancements:**
- Computer vision for throw validation
- Form analysis from video
- Personalized training plans
- Adaptive difficulty

## Dependencies

**Frontend:**
- Tailwind CSS 3.4.1 (CDN, pinned)

**Backend (Planned):**
- Node.js (via nvm)
- Express.js
- SQLite3
- PM2 for process management

**Infrastructure:**
- Artanis for authentication
- Caddy for reverse proxy
- PM2 for app management

## Deployment Plan

1. **Phase 1 (Current):** Static frontend with session-only data
2. **Phase 2:** Add backend API, basic persistence
3. **Phase 3:** Implement spaced repetition algorithm
4. **Phase 4:** Build stats dashboard
5. **Phase 5:** Add more drill types
6. **Phase 6:** Polish and refinements

## Notes & Decisions

**Why Session-Based (Not Time-Based)?**
- Users may practice multiple times per day
- Focus on consistency of practice, not calendar days
- Easier to track "sessions since last practiced"

**Why Simplified Input?**
- Original graphical dartboard was too complex for quick entry
- Button-based is faster and more reliable
- Mobile-friendly (large tap targets)

**Why No Manual Difficulty Ratings?**
- Users poor at self-assessment
- Performance data is objective
- Reduces cognitive load

**Why Professor Moody/Snape?**
- Harry Potter theme matches "Defense Against the Dart Arts" name
- Demanding trainer personality keeps expectations realistic
- More engaging than generic encouragement

**Why 3-Dart Average?**
- Standard metric in darts community
- Easy to understand and compare
- Directly relates to game scores (501, etc.)

---

*Last Updated: 2025-11-04*
*Status: Phase 1 Complete, Phase 2 Planning*
