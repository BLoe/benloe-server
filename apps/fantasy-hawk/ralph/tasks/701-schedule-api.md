# Task 701: Schedule Planner - Season Schedule API

## Objective
Create backend endpoints for full-season NBA schedule data.

## Design Reference
See: `/ralph/designs/08-SCHEDULE-PLANNER.md` - API section

## Context
- Extends BDL client (from Task 101) for full season data
- Shows game distribution across fantasy weeks
- Identifies heavy/light weeks for planning
- Critical for playoff preparation

## Acceptance Criteria
- [ ] Create `GET /api/fantasy/schedule/season`
  - Returns full NBA season schedule
  - Grouped by fantasy week
  - Includes game counts per team per week
- [ ] Create `GET /api/fantasy/schedule/team/:teamAbbr`
  - Returns specific NBA team's schedule
  - Includes opponent, home/away, date
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/schedule/roster`
  - Returns schedule for user's rostered players
  - Aggregated games per week for the team
- [ ] Cache season schedule aggressively (rarely changes)
- [ ] Handle All-Star break and irregular weeks

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for schedule aggregation
3. Tests pass: `npm test`
4. Manual test: Verify schedule data for current week

## Dependencies
- Task 101 (BDL client base)

## Notes
- BDL has historical and future schedule data
- Fantasy weeks may not align with calendar weeks
- Consider storing/caching season schedule locally
- Handle edge cases: postponed games, All-Star break
