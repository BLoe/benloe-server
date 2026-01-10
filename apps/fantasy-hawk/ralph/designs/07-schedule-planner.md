# Schedule Planner - Design Specification

## Overview

Look ahead at the NBA schedule to plan roster moves, identify busy/light weeks, and prepare for playoffs.

**Primary Use Case**: "When are my players' bye weeks? Who has a good playoff schedule?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Schedule Planner                          [View: Season ▼]          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SEASON SCHEDULE HEATMAP                                            │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │       Wk15  Wk16  Wk17  Wk18  Wk19 │ Wk20  Wk21  Wk22        │ │
│  │                                    │    PLAYOFFS              │ │
│  │ LAL    4     3     4     3     4  │   4     4     3    ████  │ │
│  │ GSW    3     4     3     4     3  │   3     4     4    ████  │ │
│  │ BOS    4     4     3     4     4  │   4     3     4    █████ │ │
│  │ MIA    3     3     4     3     3  │   2     3     3    ███   │ │
│  │ ATL    4     3     4     4     4  │   4     4     4    █████ │ │
│  │ ...    ...                        │                          │ │
│  │                                    │                          │ │
│  │ Your roster teams highlighted ────────────────────────────   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├────────────────────────────────────┬────────────────────────────────┤
│  PLAYOFF SCHEDULE ANALYSIS         │  YOUR ROSTER STRENGTH          │
│  ┌──────────────────────────────┐  │  ┌────────────────────────────┐│
│  │ Best Playoff Schedules:      │  │  │ Playoff Games by Player    ││
│  │                              │  │  │                            ││
│  │ 1. ATL (12 games)   ⭐⭐⭐   │  │  │ LeBron (LAL)    11 games   ││
│  │ 2. CHI (12 games)   ⭐⭐⭐   │  │  │ Curry (GSW)     11 games   ││
│  │ 3. CLE (11 games)   ⭐⭐½   │  │  │ Tatum (BOS)     11 games   ││
│  │ 4. BOS (11 games)   ⭐⭐½   │  │  │ Bam (MIA)        8 games ⚠️││
│  │                              │  │  │ Garland (CLE)   10 games   ││
│  │ Worst:                       │  │  │ ...                        ││
│  │ 1. MIA (8 games)    ⭐       │  │  │                            ││
│  │ 2. PHX (9 games)    ⭐½     │  │  │ TOTAL: 89 games            ││
│  │                              │  │  │ Optimal: 96 games          ││
│  └──────────────────────────────┘  │  └────────────────────────────┘│
│                                    │                                │
├────────────────────────────────────┴────────────────────────────────┤
│                                                                     │
│  WEEKLY PLANNING VIEW (Next 4 Weeks)                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Week 15 (Current)      Week 16           Week 17    Week 18   │ │
│  │ ┌─────────────────┐   ┌───────────────┐ ┌─────────┐ ┌───────┐ │ │
│  │ │ Your Games: 28  │   │ Your Games: 31│ │ 26 ⚠️   │ │ 30    │ │ │
│  │ │ ▓▓▓▓▓▓▓▓░░      │   │ ▓▓▓▓▓▓▓▓▓░    │ │ ▓▓▓▓▓░  │ │ ▓▓▓▓▓ │ │ │
│  │ │                 │   │               │ │ LIGHT   │ │       │ │ │
│  │ │ Heavy days:     │   │ Heavy: Sat(6) │ │ Stream  │ │       │ │ │
│  │ │ Sat (5), Sun(4) │   │               │ │ week!   │ │       │ │ │
│  │ └─────────────────┘   └───────────────┘ └─────────┘ └───────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  BACK-TO-BACK TRACKER                                               │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ This Week's B2Bs:                                             │ │
│  │ • LeBron James (35 yrs) - Tue/Wed B2B  ⚠️ Rest risk: 30%     │ │
│  │ • Chris Paul (38 yrs) - Fri/Sat B2B    ⚠️ Rest risk: 45%     │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Season Schedule Heatmap

**Component**: `SeasonScheduleHeatmap`
**Test ID**: `data-testid="schedule-heatmap"`

Grid showing games per week for all teams. Your roster teams highlighted.

**Visual**: Cell intensity based on games (2=light, 4=dark)

### 2. Playoff Schedule Analysis

**Component**: `PlayoffScheduleAnalysis`
**Test ID**: `data-testid="schedule-playoff-analysis"`

Ranked list of teams by playoff games (weeks 20-22).

### 3. Roster Strength Panel

**Component**: `RosterScheduleStrength`
**Test ID**: `data-testid="schedule-roster-strength"`

List your players with their playoff game counts. Flag weak schedules.

### 4. Weekly Planning View

**Component**: `WeeklyPlanningView`
**Test ID**: `data-testid="schedule-weekly-view"`

4-week lookahead showing your projected games per week.

### 5. Back-to-Back Tracker

**Component**: `BackToBackTracker`
**Test ID**: `data-testid="schedule-b2b-tracker"`

Shows upcoming B2Bs with rest risk for veteran players.

---

## Data TestIDs Summary

- `schedule-heatmap`, `schedule-heatmap-cell-{team}-{week}`
- `schedule-playoff-analysis`, `schedule-playoff-team-{team}`
- `schedule-roster-strength`, `schedule-roster-player-{id}`
- `schedule-weekly-view`, `schedule-week-{number}`
- `schedule-b2b-tracker`, `schedule-b2b-player-{id}`
