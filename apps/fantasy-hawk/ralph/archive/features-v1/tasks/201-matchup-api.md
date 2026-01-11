# Task 201: Matchup Center - API Endpoints

## Objective
Create backend endpoints for real-time matchup data and projections.

## Design Reference
See: `/ralph/designs/02-MATCHUP-CENTER.md` - Data requirements section

## Context
- Yahoo provides live scoreboard data via existing API
- Need to structure it for the matchup center views
- Combine with schedule data to project remaining games
- This powers the live matchup tracking feature

## Acceptance Criteria
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/matchup/current`
  - Returns current week's matchup for the user's team
  - Includes both teams' category totals
  - Includes category-by-category win/loss/tie status
  - Includes games played and games remaining per team
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/matchup/projections`
  - Projects final category outcomes based on pace
  - Identifies "swing" categories (close enough to flip)
  - Returns confidence levels for each projection
- [ ] Add response types to shared types file
- [ ] Handle edge cases: bye weeks, no active matchup
- [ ] Cache appropriately (scoreboard data changes frequently during games)

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for projection logic
3. Tests pass: `npm test`
4. Manual test: curl endpoints during an active week

## Dependencies
- None (uses existing Yahoo client)

## Notes
- Yahoo scoreboard endpoint already exists - may just need restructuring
- Projections are estimates - don't overcomplicate the math
- Games remaining requires BDL schedule data (from Task 101)
- Consider WebSocket for real-time updates in future (not this task)
