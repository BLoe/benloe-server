# Task 1201: Category Analysis - Team Profile API

## Objective
Create backend endpoint for detailed team category profiles.

## Design Reference
See: `/ralph/designs/01-CATEGORY-ANALYSIS.md` - API section

## Context
- Enhances existing category analysis functionality
- Creates team "profile" based on category strengths
- Historical trend data for categories
- More sophisticated analysis than current basic view

## Acceptance Criteria
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/category/profile`
  - Returns team's category profile:
    - Z-scores for each category
    - League ranking per category
    - "Elite/Strong/Average/Weak" classification
  - Historical performance (week-by-week)
  - Category trends (improving/declining)
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/category/comparison`
  - Compare team to league average
  - Percentile rankings
- [ ] Cache analysis results

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for profile calculations
3. Tests pass: `npm test`
4. Manual test: Profile matches team performance

## Dependencies
- Existing category stats endpoint (enhance, don't replace)

## Notes
- Z-score = (team value - league mean) / standard deviation
- Keep historical data for trends (store last N weeks)
- Build on existing CategoryStatsTable data
