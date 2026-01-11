# Task 803: Season Outlook - Playoff Scenarios

## Objective
Create playoff odds and scenario visualization.

## Design Reference
See: `/ralph/designs/10-SEASON-OUTLOOK.md` - Playoffs section

## Context
- Shows likelihood of making playoffs
- Identifies "magic number" to clinch
- Shows bubble teams and competition
- Helps users understand stakes

## Acceptance Criteria
- [ ] Create `frontend/src/components/outlook/PlayoffOdds.tsx`
- [ ] Display playoff bracket preview:
  - Current projected seeding
  - Teams in vs out
  - Bubble teams highlighted
- [ ] Playoff odds visualization:
  - Percentage chance of making playoffs
  - Visual meter or gauge
- [ ] Magic number section:
  - Wins needed to clinch
  - Teams you're competing with
- [ ] What-if scenarios:
  - "If you win this week..." projections
- [ ] Integrate into Season Outlook page

## Verification
1. Frontend builds without errors
2. Visual check: Playoff odds display
3. Magic number calculation makes sense
4. Bracket preview shows teams

## Dependencies
- Task 801 (playoff odds API)
- Task 802 (page integration)

## Notes
- Playoff format varies by league (top 4, top 6, etc.)
- Handle "clinched" and "eliminated" states
- Make it engaging, not just numbers
- Add `data-testid="playoff-odds"`
