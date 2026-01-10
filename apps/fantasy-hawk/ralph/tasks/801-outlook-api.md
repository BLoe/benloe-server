# Task 801: Season Outlook - Projection API

## Objective
Create backend endpoints for season standings projections.

## Design Reference
See: `/ralph/designs/10-SEASON-OUTLOOK.md` - API section

## Context
- Projects where teams will finish based on current pace
- Estimates playoff odds
- Helps users understand their position
- Motivates action if falling behind

## Acceptance Criteria
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/outlook/standings`
  - Returns current standings with projected final standings
  - Win pace extrapolation
  - Category win rates per team
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/outlook/playoffs`
  - Playoff odds for each team
  - Magic number calculations (wins needed to clinch)
  - Projected seeding
- [ ] Simple projection model (pace-based, not sophisticated)
- [ ] Handle early season (limited data) gracefully

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for projection math
3. Tests pass: `npm test`
4. Manual test: Projections seem reasonable

## Dependencies
- Existing standings endpoint

## Notes
- Projections are estimates - communicate uncertainty
- Pace = current rate extrapolated to full season
- Don't need Monte Carlo simulations - simple math is fine
- Early season projections will be volatile - that's ok
