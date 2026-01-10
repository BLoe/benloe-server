# Task 1101: Waiver Advisor - Recommendations API

## Objective
Create backend endpoints for waiver wire recommendations.

## Design Reference
See: `/ralph/designs/05-WAIVER-ADVISOR.md` - API section

## Context
- Analyzes free agent pool
- Identifies players to target
- Considers team needs based on categories
- Suggests FAAB bids if applicable

## Acceptance Criteria
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/waiver/recommendations`
  - Returns top waiver targets ranked by value
  - Considers user's team category needs
  - Filters by position if specified
  - Includes ownership trend (rising/falling)
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/waiver/drops`
  - Suggests players to drop from user's roster
  - Based on performance and outlook
- [ ] Include player news/recent performance in response
- [ ] Handle waiver vs free agent distinction

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for ranking logic
3. Tests pass: `npm test`
4. Manual test: Recommendations seem reasonable

## Dependencies
- Existing Yahoo free agents endpoint

## Notes
- "Hot" players = recent performance above average
- Consider schedule (from BDL) for added value
- Ownership trend from Yahoo percent owned changes
- Don't need perfect recommendations - directional is fine
