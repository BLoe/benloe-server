# Task 1001: Player Comparison - Comparison API

## Objective
Create backend endpoint for side-by-side player comparison.

## Design Reference
See: `/ralph/designs/09-PLAYER-COMPARISON.md` - API section

## Context
- Compare 2-4 players head-to-head
- Shows all stat categories
- Highlights advantages/disadvantages
- Useful for trade and waiver decisions

## Acceptance Criteria
- [ ] Create `POST /api/fantasy/leagues/:leagueKey/players/compare`
  - Accepts array of player IDs (2-4 players)
  - Returns all players' stats side-by-side
  - Includes season averages, recent performance
  - Highlights which player leads each category
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/players/search`
  - Search players by name
  - Returns basic info for selection UI
- [ ] Format stats consistently for comparison
- [ ] Handle players with limited data (rookies, injured)

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for comparison logic
3. Tests pass: `npm test`
4. Manual test: Compare known players

## Dependencies
- Existing Yahoo player data endpoints

## Notes
- Use per-game averages for fair comparison
- Consider game counts (players with fewer games may skew)
- Include ownership percentage for context
- Handle IL/out players appropriately
