# Matchup Center - Design Specification

## Overview

The Matchup Center is the tactical headquarters for weekly head-to-head battles. Shows real-time category comparisons, games remaining, and strategic recommendations.

**Primary Use Case**: "Am I winning this week? What categories can I still flip?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER                                                              │
├─────────────────────────────────────────────────────────────────────┤
│ Matchup Center                    Week 14 ▼   [← Prev] [Next →]    │
├────────────────────────────────────┬────────────────────────────────┤
│                                    │                                │
│  MATCHUP SCOREBOARD               │   MATCHUP META                 │
│  ┌──────────────────────────────┐ │   ┌──────────────────────────┐ │
│  │     YOUR TEAM    vs   OPPONENT│ │   │ H2H Record: 2-1         │ │
│  │   "The Hawks"        "Ballers"│ │   │ Last Meeting: W 5-4     │ │
│  │                               │ │   │                          │ │
│  │        4 - 3 - 2              │ │   │ Their Style:             │ │
│  │       wins ties losses        │ │   │ "Punt FT% Build"         │ │
│  │                               │ │   │ Streams Often: Yes       │ │
│  │  PROJECTED: 5-4 (You Win)     │ │   └──────────────────────────┘ │
│  └──────────────────────────────┘ │                                │
│                                    │   SWING CATEGORIES            │
│  CATEGORY COMPARISON              │   ┌──────────────────────────┐ │
│  ┌──────────────────────────────┐ │   │ ⚠️ FG% - Down 0.8%       │ │
│  │ CAT    YOU    OPP    STATUS  │ │   │   Need: Bench low-eff    │ │
│  │ ─────────────────────────────│ │   │                          │ │
│  │ PTS   1,245  1,198   ✓ WIN   │ │   │ ⚠️ STL - Down 2          │ │
│  │ REB    412    398    ✓ WIN   │ │   │   Need: 1 more game      │ │
│  │ AST    298    312    ✗ LOSE  │ │   │                          │ │
│  │ 3PM    89     91     ≈ CLOSE │ │   │ 🎯 3PM - Tie             │ │
│  │ FG%   48.2   49.0    ✗ LOSE  │ │   │   Flip with: J. Poole    │ │
│  │ FT%   81.2   74.1    ✓ WIN   │ │   └──────────────────────────┘ │
│  │ STL    52     54     ≈ CLOSE │ │                                │
│  │ BLK    41     38     ✓ WIN   │ │                                │
│  │ TO     98     102    ✓ WIN   │ │                                │
│  └──────────────────────────────┘ │                                │
│                                    │                                │
├────────────────────────────────────┴────────────────────────────────┤
│                                                                     │
│  GAMES REMAINING COMPARISON                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │        │ Thu │ Fri │ Sat │ Sun │ TOTAL                        │ │
│  │ YOU    │  3  │  2  │  4  │  3  │  12   ████████████           │ │
│  │ OPP    │  2  │  4  │  2  │  1  │   9   █████████              │ │
│  │ EDGE   │ +1  │ -2  │ +2  │ +2  │  +3                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Matchup Scoreboard

**Component**: `MatchupScoreboard`
**Test ID**: `data-testid="matchup-scoreboard"`

```tsx
interface MatchupScore {
  yourTeam: { name: string; wins: number; ties: number; losses: number };
  opponent: { name: string; wins: number; ties: number; losses: number };
  projected: { winner: 'you' | 'opponent' | 'tie'; score: string };
  isLive: boolean;
}
```

**Visual Design**:
- Large centered display with team names on sides
- Score shown as massive numbers: "4 - 3 - 2"
- Color coding: wins=teal, ties=amber, losses=red
- "LIVE" badge with pulsing dot if games in progress
- Projection shown below in smaller text with confidence indicator

```
┌──────────────────────────────────────────────────┐
│            ● LIVE                                │
│                                                  │
│  The Hawks              vs              Ballers  │
│  (You)                                           │
│                                                  │
│           4    -    3    -    2                  │
│          WIN       TIE      LOSE                 │
│                                                  │
│        Projected: 5-4 (You Win) 📈               │
└──────────────────────────────────────────────────┘
```

**Data TestIDs**:
- `matchup-scoreboard`
- `matchup-scoreboard-your-team`
- `matchup-scoreboard-opponent`
- `matchup-scoreboard-score`
- `matchup-scoreboard-projection`
- `matchup-scoreboard-live-indicator`

---

### 2. Category Comparison Table

**Component**: `CategoryComparisonTable`
**Test ID**: `data-testid="matchup-category-table"`

```tsx
interface CategoryComparison {
  category: string;
  categoryAbbr: string;
  yourValue: number;
  opponentValue: number;
  status: 'win' | 'lose' | 'close' | 'tie';
  margin: number;
  marginPercent: number;
  isPercentage: boolean; // for FG%, FT%
}
```

**Visual Design**:
- Three columns: Category, Your Value (left-aligned), Their Value (right-aligned)
- Status indicator between values
- Row coloring based on status:
  - Win: subtle green left border
  - Lose: subtle red left border
  - Close (within 5%): amber background tint
  - Tie: neutral

**Status Icons**:
- Win: ✓ in teal circle
- Lose: ✗ in red circle
- Close: ≈ in amber circle
- Tie: = in neutral

**Interactions**:
- Hover row: expand to show more details (your rank, their rank, league avg)
- Click row: scroll to relevant streaming candidates

**Data TestIDs**:
- `matchup-category-table`
- `matchup-category-row-{category}`
- `matchup-category-status-{category}`
- `matchup-category-your-value-{category}`
- `matchup-category-opp-value-{category}`

---

### 3. Swing Categories Panel

**Component**: `SwingCategoriesPanel`
**Test ID**: `data-testid="matchup-swing-categories"`

```tsx
interface SwingCategory {
  category: string;
  currentStatus: 'losing' | 'tied';
  margin: number;
  flipPotential: 'high' | 'medium' | 'low';
  suggestion: string;
  suggestedPlayer?: Player;
}
```

**Visual Design**:
- Card format for each swing category
- Icon based on flip potential:
  - High: 🎯 (target, achievable)
  - Medium: ⚠️ (warning, needs effort)
  - Low: ⚡ (lightning, long shot)
- Suggestion text with actionable player name as link

**Data TestIDs**:
- `matchup-swing-categories`
- `matchup-swing-category-{category}`
- `matchup-swing-suggestion-{category}`

---

### 4. Games Remaining Comparison

**Component**: `GamesRemainingChart`
**Test ID**: `data-testid="matchup-games-remaining"`

```tsx
interface GamesRemaining {
  day: string;
  yourGames: number;
  opponentGames: number;
  edge: number; // positive = your advantage
}
```

**Visual Design**:
- Horizontal bar chart, grouped by day
- Your games in orange, opponent in gray
- Edge row shows +/- with color (green positive, red negative)
- Total column on right with aggregate

**Interactions**:
- Hover day: show which players are playing for each team
- Click day: filter streaming candidates to that day

**Data TestIDs**:
- `matchup-games-remaining`
- `matchup-games-day-{day}`
- `matchup-games-total`

---

### 5. Matchup Meta Panel

**Component**: `MatchupMetaPanel`
**Test ID**: `data-testid="matchup-meta"`

**Content**:
- H2H Record (your wins-losses against this opponent)
- Last Meeting result
- Opponent's detected build style (e.g., "Punt FT% Build")
- Streaming activity indicator

**Visual Design**:
- Compact info card
- Build style shown as pill/badge
- Activity indicator: "Active Streamer" or "Passive Manager"

**Data TestIDs**:
- `matchup-meta`
- `matchup-meta-record`
- `matchup-meta-build-style`
- `matchup-meta-activity`

---

## Week Navigation

**Component**: `WeekSelector`

- Dropdown for week selection
- Previous/Next arrows
- Current week highlighted
- Past weeks show final results
- Future weeks show "Upcoming"

**Data TestIDs**:
- `matchup-week-selector`
- `matchup-week-prev`
- `matchup-week-next`

---

## Responsive Behavior

**Desktop**: Side-by-side layout as shown
**Tablet**: Stack scoreboard above comparison table, meta panel moves to bottom
**Mobile**:
- Scoreboard simplified (just score, no team names spelled out)
- Category table scrolls horizontally
- Games remaining becomes vertical list

---

## Real-Time Updates

If games are in progress:
1. "LIVE" badge pulses
2. Category values update every 60 seconds
3. Status changes trigger subtle animation
4. Score changes have number flip animation

---

## Empty/Loading States

- **Loading**: Skeleton for scoreboard and table
- **No matchup this week**: "No matchup scheduled for Week X"
- **Bye week**: "Your team has a bye this week"
- **Season not started**: "Season starts in X days"
