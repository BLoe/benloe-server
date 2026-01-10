# Task 1103: Waiver Advisor - FAAB Suggestions

## Objective
Add FAAB bid suggestions for leagues using FAAB system.

## Design Reference
See: `/ralph/designs/05-WAIVER-ADVISOR.md` - FAAB section

## Context
- FAAB = Free Agent Acquisition Budget
- Leagues may use FAAB instead of waiver priority
- Need to suggest how much to bid
- Based on player value and remaining budget

## Acceptance Criteria
- [ ] Create backend endpoint `GET /api/fantasy/leagues/:leagueKey/waiver/faab`
  - Returns FAAB suggestions for top targets
  - Considers remaining budget
  - Accounts for time of season (bid more aggressively late)
  - Returns percentage of budget to bid
- [ ] Create `frontend/src/components/waiver/FaabSuggestions.tsx`
  - Display suggested bid amounts
  - Show remaining budget context
  - "What others might bid" estimate
- [ ] Only show for FAAB leagues (detect from settings)
- [ ] Integrate into Waiver Advisor page
- [ ] Handle $0 FAAB players (true free agents)

## Verification
1. Backend returns FAAB suggestions
2. Frontend displays bid amounts
3. Only appears for FAAB leagues
4. Suggestions seem reasonable

## Dependencies
- Task 1101 (recommendations API)
- Task 1102 (dashboard integration)

## Notes
- FAAB strategy varies by time of season
- Consider league competitiveness (more bids = higher suggestions)
- Include "rostered before claimed" possibility
- Add `data-testid="faab-suggestions"`
