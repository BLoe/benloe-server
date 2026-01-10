# Player Comparison Tool - Design Specification

## Overview

Compare two or more players head-to-head across all relevant metrics to inform roster and trade decisions.

**Primary Use Case**: "Is Player A or Player B better for my team?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Player Comparison                              [Add Player +]       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┬──────────────────┬──────────────────┐        │
│  │   LeBron James   │   Kevin Durant   │   Jayson Tatum   │        │
│  │   LAL • SF/PF    │   PHX • SF/PF    │   BOS • SF/PF    │        │
│  │   [× Remove]     │   [× Remove]     │   [× Remove]     │        │
│  ├──────────────────┼──────────────────┼──────────────────┤        │
│  │                  │                  │                  │        │
│  │  SEASON AVERAGES │                  │                  │        │
│  │                  │                  │                  │        │
│  │  PTS   25.1  ✓   │  PTS   27.8  ✓✓  │  PTS   26.9  ✓   │        │
│  │  ████████░░░░    │  ██████████░░    │  █████████░░░    │        │
│  │                  │                  │                  │        │
│  │  REB    7.2      │  REB    6.8      │  REB    8.1  ✓   │        │
│  │  ██████░░░░░░    │  █████░░░░░░░    │  ███████░░░░░    │        │
│  │                  │                  │                  │        │
│  │  AST    7.8  ✓   │  AST    5.2      │  AST    4.8      │        │
│  │  ███████░░░░░    │  ████░░░░░░░░    │  ███░░░░░░░░░    │        │
│  │                  │                  │                  │        │
│  │  3PM    1.8      │  3PM    2.4  ✓   │  3PM    3.1  ✓✓  │        │
│  │  ███░░░░░░░░░    │  ████░░░░░░░░    │  █████░░░░░░░    │        │
│  │                  │                  │                  │        │
│  │  FG%  51.2%  ✓   │  FG%  52.8%  ✓✓  │  FG%  47.1%      │        │
│  │                  │                  │                  │        │
│  │  ...             │  ...             │  ...             │        │
│  │                  │                  │                  │        │
│  ├──────────────────┼──────────────────┼──────────────────┤        │
│  │  SCHEDULE        │                  │                  │        │
│  │  This Week: 3    │  This Week: 4 ✓  │  This Week: 3    │        │
│  │  Playoffs: 11    │  Playoffs: 9     │  Playoffs: 11 ✓  │        │
│  ├──────────────────┼──────────────────┼──────────────────┤        │
│  │  RECENT TREND    │                  │                  │        │
│  │  Last 7: ▲ Hot   │  Last 7: — Avg   │  Last 7: ▼ Cold  │        │
│  │  [Sparkline]     │  [Sparkline]     │  [Sparkline]     │        │
│  ├──────────────────┼──────────────────┼──────────────────┤        │
│  │  YOUR TEAM FIT   │                  │                  │        │
│  │  Score: 78/100   │  Score: 82/100 ✓ │  Score: 71/100   │        │
│  │  "Helps AST"     │  "Helps FG%"     │  "Helps 3PM"     │        │
│  └──────────────────┴──────────────────┴──────────────────┘        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  TIMESPAN: [Season ▼] [Last 30 Days] [Last 14 Days] [Last 7 Days]  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Player Selector

**Component**: `PlayerComparisonSelector`
**Test ID**: `data-testid="comparison-player-selector"`

Search/dropdown to add players. Max 4 players.

### 2. Comparison Columns

**Component**: `PlayerComparisonColumn`
**Test ID**: `data-testid="comparison-column-{playerId}"`

Each player gets a column showing:
- Header (name, team, positions)
- Stats with bars
- Schedule info
- Trend sparkline
- Team fit score

### 3. Stat Bars

**Component**: `StatComparisonBar`
**Test ID**: `data-testid="comparison-stat-{category}-{playerId}"`

Horizontal bar scaled relative to compared players. Winner gets checkmark.

### 4. Trend Sparklines

**Component**: `PlayerTrendSparkline`
**Test ID**: `data-testid="comparison-trend-{playerId}"`

Mini line chart showing last 14 days of performance.

### 5. Team Fit Score

**Component**: `TeamFitScore`
**Test ID**: `data-testid="comparison-fit-{playerId}"`

Calculated score (0-100) based on how player helps your team's weak categories.

### 6. Timespan Toggle

**Component**: `TimespanToggle`
**Test ID**: `data-testid="comparison-timespan"`

Toggle between Season, Last 30, Last 14, Last 7 days.

---

## Data TestIDs Summary

- `comparison-add-player`
- `comparison-column-{playerId}`
- `comparison-remove-{playerId}`
- `comparison-stat-{category}-{playerId}`
- `comparison-trend-{playerId}`
- `comparison-fit-{playerId}`
- `comparison-timespan`
- `comparison-timespan-{period}`
