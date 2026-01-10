# Season Outlook & Playoffs - Design Specification

## Overview

Track your playoff odds, clinching scenarios, and optimal strategies based on standings position.

**Primary Use Case**: "Am I making the playoffs? What do I need to clinch?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Season Outlook                      [Strategy: Competing ▼]         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  YOUR PLAYOFF STATUS                                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                                                               │ │
│  │           PLAYOFF ODDS                                        │ │
│  │                                                               │ │
│  │              ████████████████████████████████░░░░░░           │ │
│  │                           87%                                 │ │
│  │                                                               │ │
│  │   Current: 5th place  •  Record: 8-5  •  2 GB from 1st       │ │
│  │                                                               │ │
│  │   ✓ Win next 2 → 95% odds                                     │ │
│  │   ⚠️ Lose next 2 → 68% odds                                   │ │
│  │                                                               │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├────────────────────────────────────┬────────────────────────────────┤
│  STANDINGS                         │  PLAYOFF BRACKET PREVIEW       │
│  ┌──────────────────────────────┐  │  ┌────────────────────────────┐│
│  │ Rk │ Team          │ Record  │  │  │                            ││
│  │────┼───────────────┼─────────│  │  │  ROUND 1      FINALS       ││
│  │ 1  │ Dynasty       │ 10-3    │  │  │  ┌─────────┐               ││
│  │ 2  │ The Hawks     │ 9-4     │  │  │  │ 1.Dynasty│              ││
│  │ 3  │ Ballers       │ 9-4     │  │  │  └────┬────┘               ││
│  │ 4  │ Splash Bros   │ 8-5     │  │  │       │      ┌─────┐       ││
│  │───────── PLAYOFF LINE ────────│  │  │  ┌────┴────┐ │     │       ││
│  │ 5★│ Your Team     │ 8-5     │  │  │  │ 8.Picks  │ │     │       ││
│  │ 6  │ Deep Roster   │ 7-6     │  │  │  └─────────┘ │     │       ││
│  │ 7  │ Streamers     │ 6-7     │  │  │              │ TBD │       ││
│  │ ...│               │         │  │  │  ┌─────────┐ │     │       ││
│  │                              │  │  │  │ 4.Splash│ │     │       ││
│  │ ★ = Your Team                │  │  │  └────┬────┘ │     │       ││
│  └──────────────────────────────┘  │  │       │      └─────┘       ││
│                                    │  │  ┌────┴────┐               ││
│  REMAINING SCHEDULE                │  │  │ 5.You ★ │               ││
│  ┌──────────────────────────────┐  │  │  └─────────┘               ││
│  │ Week 15: vs Ballers (9-4)    │  │  │                            ││
│  │ Week 16: vs Dynasty (10-3)   │  │  │  Your R1 opponent:         ││
│  │ Week 17: vs Streamers (6-7)  │  │  │  4. Splash Bros            ││
│  │ Week 18: vs Deep Roster (7-6)│  │  │  H2H: 1-1 this season      ││
│  │                              │  │  │  You typically win: 5-4    ││
│  └──────────────────────────────┘  │  └────────────────────────────┘│
│                                    │                                │
├────────────────────────────────────┴────────────────────────────────┤
│                                                                     │
│  CLINCHING SCENARIOS                                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Magic Number: 3 (wins needed to clinch playoff spot)          │ │
│  │                                                               │ │
│  │ • Win Week 15 + Week 16 = CLINCHED                            │ │
│  │ • Win Week 15 + Streamers lose = CLINCHED                     │ │
│  │ • Win any 3 of remaining 4 = CLINCHED                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Playoff Odds Display

**Component**: `PlayoffOddsCard`
**Test ID**: `data-testid="outlook-playoff-odds"`

Big percentage with progress bar. Scenario impacts below.

### 2. Standings Table

**Component**: `StandingsTable`
**Test ID**: `data-testid="outlook-standings"`

Shows all teams with playoff line highlighted. Your team starred.

### 3. Playoff Bracket Preview

**Component**: `PlayoffBracketPreview`
**Test ID**: `data-testid="outlook-bracket"`

Visual bracket showing projected seeding and matchups.

### 4. Remaining Schedule

**Component**: `RemainingSchedule`
**Test ID**: `data-testid="outlook-remaining-schedule"`

List of upcoming matchups with opponent records.

### 5. Clinching Scenarios

**Component**: `ClinchingScenarios`
**Test ID**: `data-testid="outlook-clinching"`

Magic number and specific paths to clinch.

### 6. Strategy Mode Toggle

**Component**: `StrategyModeToggle`
**Test ID**: `data-testid="outlook-strategy-mode"`

Options: Competing, Rebuilding, Locked In

Each mode adjusts recommendations throughout the app.

---

## Data TestIDs Summary

- `outlook-playoff-odds`
- `outlook-standings`, `outlook-standings-row-{teamId}`
- `outlook-bracket`, `outlook-bracket-matchup-{round}-{seed}`
- `outlook-remaining-schedule`, `outlook-schedule-week-{num}`
- `outlook-clinching`
- `outlook-strategy-mode`, `outlook-strategy-{mode}`
