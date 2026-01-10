# Streaming Optimizer - Design Specification

## Overview

The Streaming Optimizer helps users maximize games played by strategically adding/dropping players throughout the week. It's the core tactical tool for weekly management.

**Primary Use Case**: "I have 2 adds left this week. Who should I pick up to maximize my stats?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER                                                              │
├─────────────────────────────────────────────────────────────────────┤
│ Page Title: Streaming Optimizer              [Week Selector ▼]      │
├────────────────────────────────────────┬────────────────────────────┤
│                                        │                            │
│  WEEKLY SCHEDULE GRID                  │  STREAMING STATS           │
│  (Mon-Sun calendar view)               │  ┌────────────────────┐    │
│                                        │  │ Adds Remaining: 2  │    │
│  ┌─────┬───┬───┬───┬───┬───┬───┐     │  │ Games This Week: 28│    │
│  │     │Mon│Tue│Wed│Thu│Fri│Sat│Sun   │  │ Optimal: 32        │    │
│  ├─────┼───┼───┼───┼───┼───┼───┤     │  └────────────────────┘    │
│  │LeBrn│@BOS│ - │CHI│ - │@MIA│DEN│   │                            │
│  │Curry│LAL│ - │ - │@PHX│SAS│ - │    │  SLOT UTILIZATION          │
│  │...  │   │   │   │   │   │   │     │  [Progress bars by day]    │
│  └─────┴───┴───┴───┴───┴───┴───┘     │                            │
│                                        │                            │
│  🔴 = Off day  🟢 = Game  ⚠️ = Conflict │                            │
│                                        │                            │
├────────────────────────────────────────┴────────────────────────────┤
│                                                                     │
│  STREAMING CANDIDATES                                               │
│  [Position Filter ▼] [Category Filter ▼] [Sort: Games ▼]           │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Player        │ Team │ Pos │ Games │ Schedule    │ Key Stats  │ │
│  ├───────────────┼──────┼─────┼───────┼─────────────┼────────────┤ │
│  │ J. Poole      │ WAS  │ SG  │ 4     │ Tue,Thu,Sat,│ 3PM: 2.1   │ │
│  │ ⭐ Recommended │      │     │       │ Sun         │ PTS: 17.2  │ │
│  │───────────────┼──────┼─────┼───────┼─────────────┼────────────│ │
│  │ A. Sengun     │ HOU  │ C   │ 4     │ Mon,Wed,Fri,│ REB: 9.4   │ │
│  │               │      │     │       │ Sun         │ AST: 5.1   │ │
│  └───────────────┴──────┴─────┴───────┴─────────────┴────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ADD/DROP RECOMMENDATIONS                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  DROP: M. Conley (2 games, cold)                            │   │
│  │  ADD:  J. Poole (4 games, fills Tue/Thu gaps)               │   │
│  │  ────────────────────────────────────────────────────────── │   │
│  │  Impact: +2 games, +6 3PM, +12 PTS                          │   │
│  │                                              [Execute ▶]    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Weekly Schedule Grid

**Component**: `StreamingScheduleGrid`
**Test ID**: `data-testid="streaming-schedule-grid"`

```tsx
interface ScheduleGridProps {
  players: RosterPlayer[];
  weekSchedule: WeekSchedule;
  onPlayerClick?: (player: RosterPlayer) => void;
}

// Cell states
type CellState = 'game' | 'off' | 'conflict' | 'streaming-opportunity';
```

**Visual Design**:
- Fixed left column for player names (150px min)
- 7 day columns, equal width
- Cell height: 48px
- Game cells show opponent abbreviation (e.g., "@BOS", "CHI")
- Color coding:
  - Game: `bg-hawk-teal/20 text-hawk-teal`
  - Off: `bg-court-surface text-text-muted` (show "—")
  - Conflict: `bg-hawk-amber/20 border border-hawk-amber/50` (more players than slots)
  - Streaming opportunity: `bg-hawk-orange/10 border-dashed border-hawk-orange/30`

**Interactions**:
- Hover row: highlight entire row with `bg-white/5`
- Click player: open player detail flyout
- Hover cell: show tooltip with game details

**Data TestIDs**:
- `streaming-schedule-grid`
- `streaming-schedule-row-{playerId}`
- `streaming-schedule-cell-{playerId}-{day}`

---

### 2. Streaming Stats Panel

**Component**: `StreamingStatsPanel`
**Test ID**: `data-testid="streaming-stats-panel"`

```tsx
interface StreamingStats {
  addsRemaining: number;
  addsTotal: number;
  gamesThisWeek: number;
  optimalGames: number;
  slotUtilization: DayUtilization[];
}
```

**Visual Design**:
- Card with 3 key stats at top
- Stats shown as big numbers with labels below
- Slot utilization as horizontal bar chart (7 bars for 7 days)
- Bar shows filled slots vs total slots

```
┌──────────────────────────────┐
│  ADDS         GAMES    GAP   │
│   2/5          28      -4    │
│  remaining    played  optimal│
│                              │
│  SLOT UTILIZATION            │
│  Mon ████████░░ 8/10         │
│  Tue ██████░░░░ 6/10         │
│  Wed ████████░░ 8/10         │
│  ...                         │
└──────────────────────────────┘
```

**Data TestIDs**:
- `streaming-stats-panel`
- `streaming-stat-adds`
- `streaming-stat-games`
- `streaming-slot-utilization`

---

### 3. Streaming Candidates Table

**Component**: `StreamingCandidatesTable`
**Test ID**: `data-testid="streaming-candidates-table"`

```tsx
interface StreamingCandidate {
  player: Player;
  team: string;
  positions: string[];
  gamesRemaining: number;
  gameSchedule: GameDay[];
  keyStats: StatValue[];
  recommendation?: 'strong' | 'moderate' | null;
}
```

**Columns**:
1. Player (with team logo small, recommendation badge)
2. Team
3. Position(s)
4. Games Remaining (big, prominent)
5. Schedule (visual dots for game days)
6. Key Stats (top 2-3 stats relevant to filters)
7. Actions (Add button)

**Visual Design**:
- Recommended players get subtle left border `border-l-4 border-l-hawk-orange`
- Schedule shown as 7 small circles (filled = game, empty = off)
- Stats shown in `font-mono` with trend indicator

**Filters**:
- Position dropdown (PG, SG, SF, PF, C, G, F, UTIL)
- Category dropdown (3PM, PTS, REB, AST, STL, BLK, etc.)
- Sort dropdown (Games, 3PM, PTS, etc.)

**Data TestIDs**:
- `streaming-candidates-table`
- `streaming-candidates-filter-position`
- `streaming-candidates-filter-category`
- `streaming-candidates-sort`
- `streaming-candidate-row-{playerId}`
- `streaming-candidate-add-{playerId}`

---

### 4. Add/Drop Recommendation Card

**Component**: `AddDropRecommendation`
**Test ID**: `data-testid="streaming-recommendation"`

```tsx
interface Recommendation {
  drop: Player | null;
  add: Player;
  gamesGained: number;
  categoryImpact: CategoryImpact[];
  reasoning: string;
}
```

**Visual Design**:
- Two-column layout: DROP (left, red tint) | ADD (right, green tint)
- Divider with arrow icon in center
- Impact stats below in grid
- Execute button prominent at bottom right

```
┌─────────────────────┬─────────────────────┐
│ DROP                │ ADD                 │
│ ┌─────────────────┐ │ ┌─────────────────┐ │
│ │ 🏀 M. Conley    │ │ │ 🏀 J. Poole     │ │
│ │ UTA • PG       │→│ │ WAS • SG        │ │
│ │ 2 games left   │ │ │ 4 games left    │ │
│ └─────────────────┘ │ └─────────────────┘ │
├─────────────────────┴─────────────────────┤
│ PROJECTED IMPACT                          │
│ Games: +2  │  3PM: +6  │  PTS: +12        │
│ AST: -3    │  STL: +2  │  TO: +1          │
├───────────────────────────────────────────┤
│ Gap fills: Tue, Thu (you have no games)   │
│                         [Execute Trade ▶] │
└───────────────────────────────────────────┘
```

**Data TestIDs**:
- `streaming-recommendation`
- `streaming-recommendation-drop`
- `streaming-recommendation-add`
- `streaming-recommendation-impact`
- `streaming-recommendation-execute`

---

## Responsive Behavior

**Desktop (≥1280px)**: Full layout as shown
**Tablet (768-1279px)**: Stats panel moves below grid, single column
**Mobile (<768px)**:
- Schedule grid scrolls horizontally
- Candidates table in card view (stacked, not columns)
- Recommendation card stacks vertically

---

## Loading States

1. **Initial load**: Skeleton loaders for grid and table
2. **Filter change**: Subtle opacity fade on table while loading
3. **Execute action**: Button shows spinner, then success checkmark

---

## Error States

- No roster data: "Connect your Yahoo account to see your roster"
- No streaming candidates: "No available players match your filters"
- API error: Standard error card with retry button

---

## Animations

1. **Grid cells**: Stagger fade-in on load (50ms delay per row)
2. **Recommendation**: Slide up when generated
3. **Execute success**: Card briefly pulses green, then fades out
4. **Stat changes**: Numbers animate when values change
