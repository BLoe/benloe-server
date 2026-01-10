# Category Analysis (Enhancements) - Design Specification

## Overview

Enhanced category analysis with team profile visualization, identity detection, and trend tracking over time.

**Note**: Builds on existing CategoryStatsTable component. These are additions.

**Primary Use Case**: "How has my team's category profile changed over the season?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Category Analysis                    [Timespan: This Week ▼]        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────┐  ┌──────────────────────────────┐  │
│  │  YOUR TEAM PROFILE         │  │  TEAM IDENTITY               │  │
│  │                            │  │                              │  │
│  │       PTS                  │  │  ┌────────────────────────┐  │  │
│  │        ▲                   │  │  │  "Big Man Build"       │  │  │
│  │   3PM / \ REB              │  │  │   Punt: AST, FT%       │  │  │
│  │      /   \                 │  │  │                        │  │  │
│  │ AST •─────• FG%            │  │  │  Strengths:            │  │  │
│  │      \   /                 │  │  │  REB (2nd), BLK (3rd)  │  │  │
│  │   FT% \ / BLK              │  │  │  FG% (4th)             │  │  │
│  │        ▼                   │  │  │                        │  │  │
│  │       STL                  │  │  │  Weaknesses:           │  │  │
│  │                            │  │  │  AST (10th), FT% (11th)│  │  │
│  │  [Radar Chart]             │  │  └────────────────────────┘  │  │
│  │                            │  │                              │  │
│  │  ● You  ○ League Avg       │  │  AI Analysis: "Your team    │  │
│  │                            │  │  excels in paint categories │  │
│  └────────────────────────────┘  │  but struggles with guard   │  │
│                                  │  stats. Consider trading..."│  │
│                                  └──────────────────────────────┘  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CATEGORY TRENDS (Last 8 Weeks)                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                                                               │ │
│  │    ▲ Rank                                                     │ │
│  │  1 │     ╭──────╮                                             │ │
│  │    │    ╱        ╲                    REB (improving)         │ │
│  │  3 │───╱──────────╲───────────────                            │ │
│  │    │                ╲       ╭────    BLK (stable)             │ │
│  │  6 │─────────────────╲────╯─────                              │ │
│  │    │                   ╲                                       │ │
│  │  9 │────────────────────╲────────    FT% (declining) ⚠️       │ │
│  │    │                      ╲___                                 │ │
│  │ 12 │───────────────────────────────                           │ │
│  │    └────────────────────────────────▶ Week                    │ │
│  │      W7   W8   W9   W10  W11  W12  W13  W14                   │ │
│  │                                                               │ │
│  │  Select categories: [REB ✓] [BLK ✓] [FT% ✓] [PTS] [AST] ...  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  EXISTING: CATEGORY STATS TABLE (enhanced)                          │
│  [Current CategoryStatsTable with additional columns]               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Cat │ Value │ Rank │ vs Avg │ Trend │ Correlation            │ │
│  │─────┼───────┼──────┼────────┼───────┼────────────────────────│ │
│  │ PTS │ 1,892 │ 4th  │ +8.2%  │  ▲+1  │ Pairs with: 3PM, FG%  │ │
│  │ REB │   612 │ 2nd  │ +15.1% │  ▲+2  │ Pairs with: BLK, FG%  │ │
│  │ AST │   498 │ 10th │ -12.4% │  ▼-1  │ Pairs with: STL, 3PM  │ │
│  │ ... │       │      │        │       │                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Team Profile Radar Chart

**Component**: `TeamProfileRadar`
**Test ID**: `data-testid="category-radar-chart"`

9-point radar chart showing your team's shape vs league average.

**Libraries**: Recharts RadarChart

**Visual**:
- Your team: solid orange line with fill
- League average: dashed gray line
- Hover shows exact values

### 2. Team Identity Card

**Component**: `TeamIdentityCard`
**Test ID**: `data-testid="category-identity"`

Auto-detected build archetype with strengths/weaknesses summary.

```tsx
interface TeamIdentity {
  archetype: string; // "Big Man Build", "Guard Heavy", "Balanced", etc.
  puntCategories: string[];
  strengths: CategoryRank[];
  weaknesses: CategoryRank[];
  aiSummary: string;
}
```

### 3. Category Trends Chart

**Component**: `CategoryTrendsChart`
**Test ID**: `data-testid="category-trends"`

Multi-line chart showing rank history over last 8 weeks.

**Interactions**:
- Toggle categories on/off
- Hover shows week-by-week values
- Declining categories flagged with warning

**Data TestIDs**:
- `category-trends`
- `category-trends-line-{category}`
- `category-trends-toggle-{category}`

### 4. Enhanced Category Table

**Component**: `EnhancedCategoryTable`
**Test ID**: `data-testid="category-table-enhanced"`

Adds columns to existing table:
- Trend (arrow showing rank change vs last week)
- Correlation (which categories pair well)

---

## Responsive Behavior

**Mobile**:
- Radar chart scales down but maintains proportions
- Trends chart scrolls horizontally
- Identity card stacks below radar

---

## Data TestIDs Summary

- `category-radar-chart`
- `category-identity`, `category-identity-archetype`, `category-identity-strengths`
- `category-trends`, `category-trends-line-{cat}`, `category-trends-toggle-{cat}`
- `category-table-enhanced`, `category-table-row-{cat}`
- `category-ai-narrative`
