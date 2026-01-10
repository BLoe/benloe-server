# Trade Analyzer - Design Specification

## Overview

Evaluate proposed trades by projecting category impact, considering team needs, and accounting for schedule/playoff implications.

**Primary Use Case**: "If I trade Player A for Players B+C, how does my team change?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Trade Analyzer                                        [Reset Trade] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TRADE BUILDER                                                      │
│  ┌─────────────────────────┐    ┌─────────────────────────┐        │
│  │ YOU GIVE                │    │ YOU RECEIVE             │        │
│  │ ┌─────────────────────┐ │    │ ┌─────────────────────┐ │        │
│  │ │ + Add Player        │ │ ⇄  │ │ + Add Player        │ │        │
│  │ └─────────────────────┘ │    │ └─────────────────────┘ │        │
│  │                         │    │                         │        │
│  │ 🏀 LeBron James        │    │ 🏀 Trae Young          │        │
│  │    LAL • SF/PF    [×]  │    │    ATL • PG       [×]  │        │
│  │                         │    │ 🏀 Bam Adebayo         │        │
│  │                         │    │    MIA • C/PF     [×]  │        │
│  └─────────────────────────┘    └─────────────────────────┘        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CATEGORY IMPACT                                                    │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Category │ Before │ After  │ Change │ Rank Before → After     │ │
│  │──────────┼────────┼────────┼────────┼─────────────────────────│ │
│  │ PTS      │ 1,892  │ 1,847  │  -45   │ 3rd  →  4th  ▼         │ │
│  │ REB      │   612  │   658  │  +46   │ 5th  →  3rd  ▲         │ │
│  │ AST      │   498  │   534  │  +36   │ 6th  →  4th  ▲         │ │
│  │ 3PM      │   112  │    98  │  -14   │ 4th  →  5th  ▼         │ │
│  │ FG%      │  47.2% │  48.1% │ +0.9%  │ 7th  →  5th  ▲         │ │
│  │ FT%      │  81.3% │  77.8% │ -3.5%  │ 2nd  →  6th  ▼▼        │ │
│  │ STL      │    67  │    64  │   -3   │ 4th  →  5th  ▼         │ │
│  │ BLK      │    48  │    56  │   +8   │ 6th  →  4th  ▲         │ │
│  │ TO       │    89  │    95  │   +6   │ 3rd  →  4th  ▼         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  NET SUMMARY: Gains REB, BLK, AST | Loses FT%, 3PM, PTS            │
│                                                                     │
├──────────────────────────────────┬──────────────────────────────────┤
│  TRADE FAIRNESS                  │  SCHEDULE CONSIDERATION          │
│  ┌────────────────────────────┐  │  ┌────────────────────────────┐  │
│  │                            │  │  │ Playoff Games (Wk 20-22)   │  │
│  │  BALANCED TRADE            │  │  │                            │  │
│  │  ████████████░░░░░░░░      │  │  │ Giving up:                 │  │
│  │       +0.3 in your favor   │  │  │ LeBron: 11 games           │  │
│  │                            │  │  │                            │  │
│  │  Standard Value: Fair      │  │  │ Receiving:                 │  │
│  │  Your Build Fit: Good ✓    │  │  │ Trae: 12 games             │  │
│  │                            │  │  │ Bam: 10 games              │  │
│  └────────────────────────────┘  │  │ Total: 22 games (+11)      │  │
│                                  │  └────────────────────────────┘  │
├──────────────────────────────────┴──────────────────────────────────┤
│  AI ANALYSIS                                                        │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ This trade sacrifices elite scoring and 3-point shooting to   │ │
│  │ gain rebounding and playmaking. Given your punt-3PM build,    │ │
│  │ this aligns well with your strategy. However, the FT% drop    │ │
│  │ from 2nd to 6th could hurt in close matchups.                 │ │
│  │                                                [Expand ▼]     │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Trade Builder

**Component**: `TradeBuilder`
**Test ID**: `data-testid="trade-builder"`

**Two Panels**:
- "You Give" (left) - players from your roster
- "You Receive" (right) - players from league (any team)

**Player Selection**:
- Click "Add Player" opens searchable dropdown
- Roster players filtered by what you have
- Receiving players from all league teams
- Search by name, team, position

**Data TestIDs**:
- `trade-builder`
- `trade-builder-give-panel`
- `trade-builder-receive-panel`
- `trade-builder-add-give`
- `trade-builder-add-receive`
- `trade-player-give-{playerId}`
- `trade-player-receive-{playerId}`
- `trade-player-remove-{playerId}`

### 2. Category Impact Table

**Component**: `CategoryImpactTable`
**Test ID**: `data-testid="trade-category-impact"`

**Columns**: Category, Before, After, Change, Rank Change

**Visual Indicators**:
- Positive change: green text, up arrow
- Negative change: red text, down arrow
- Rank improvements: green background
- Rank drops: red background
- Large changes (2+ ranks): double arrow

### 3. Trade Fairness Meter

**Component**: `TradeFairnessMeter`
**Test ID**: `data-testid="trade-fairness-meter"`

**Visual**: Horizontal slider/meter
- Center = perfectly fair
- Left = favors them
- Right = favors you
- Shows numerical value (e.g., +0.3)

**Additional Labels**:
- "Standard Value" assessment
- "Your Build Fit" assessment

### 4. Schedule Consideration

**Component**: `TradeSchedulePanel`
**Test ID**: `data-testid="trade-schedule"`

Shows playoff schedule comparison for players involved.

### 5. AI Analysis

**Component**: `TradeAIAnalysis`
**Test ID**: `data-testid="trade-ai-analysis"`

Narrative analysis of the trade. Expandable for full detail.

---

## Responsive Behavior

**Mobile**: Trade builder stacks vertically (Give above Receive)

---

## Data TestIDs Summary

- `trade-builder`, `trade-builder-give-panel`, `trade-builder-receive-panel`
- `trade-builder-add-give`, `trade-builder-add-receive`
- `trade-player-give-{playerId}`, `trade-player-receive-{playerId}`
- `trade-category-impact`, `trade-category-row-{category}`
- `trade-fairness-meter`
- `trade-schedule`
- `trade-ai-analysis`
- `trade-reset-button`
