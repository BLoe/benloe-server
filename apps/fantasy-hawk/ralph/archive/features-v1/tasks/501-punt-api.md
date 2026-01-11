# Task 501: Punt Engine - Analysis API

## Objective
Create backend endpoints for punt strategy analysis.

## Design Reference
See: `/ralph/designs/06-PUNT-STRATEGY-ENGINE.md` - Analysis section

## Context
- "Punting" = intentionally ignoring certain categories to dominate others
- Common strategies: punt FT%, punt AST, punt TO, etc.
- Analyzes how well a team fits various punt strategies
- Helps users optimize their build direction

## Acceptance Criteria
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/punt/analysis`
  - Analyzes user's team against common punt strategies
  - Returns fit score for each strategy
  - Identifies which categories team naturally punts
  - Suggests optimal punt direction
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/punt/strategies`
  - Returns list of viable punt strategies for the league
  - Based on scoring categories (different leagues have different cats)
- [ ] Calculate category strength rankings for user's team
- [ ] Identify category weaknesses (punt candidates)

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for strategy fit calculations
3. Tests pass: `npm test`
4. Manual test: Verify analysis makes sense for a real roster

## Dependencies
- Existing roster and stats endpoints

## Notes
- Common punt strategies: FT%, FG%, TO, AST, BLK, 3PM
- Fit score based on how well roster players align
- Consider trade targets that would improve punt fit
- League categories determine which punts are viable
