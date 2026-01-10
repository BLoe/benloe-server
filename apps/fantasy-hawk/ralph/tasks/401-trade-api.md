# Task 401: Trade Analyzer - Analysis API

## Objective
Create backend endpoints for trade analysis and impact projections.

## Design Reference
See: `/ralph/designs/04-TRADE-ANALYZER.md` - API section

## Context
- Analyzes potential trades between teams
- Projects category impact of player swaps
- Needs access to player stats and team rosters
- Helps users evaluate if trades are beneficial

## Acceptance Criteria
- [ ] Create `POST /api/fantasy/leagues/:leagueKey/trade/analyze`
  - Accepts: players to give, players to receive, other team key
  - Returns category-by-category impact projection
  - Shows before/after comparison for each category
  - Includes "trade grade" or recommendation
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/teams/:teamKey/roster`
  - Returns other team's roster (for trade partner selection)
- [ ] Calculate stat projections based on season averages
- [ ] Account for games remaining in season
- [ ] Handle multi-player trades

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for trade impact calculations
3. Tests pass: `npm test`
4. Manual test: Analyze a mock trade

## Dependencies
- Existing Yahoo roster endpoints

## Notes
- Projection math doesn't need to be sophisticated
- Consider using per-game averages × expected games remaining
- Trade "grade" can be simple (you gain X cats, lose Y)
- Don't need to enforce trade validity (Yahoo handles that)
