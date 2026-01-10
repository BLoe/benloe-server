# Task 202: Matchup Center - Live Scoreboard UI

## Objective
Create the main matchup scoreboard showing head-to-head category comparison.

## Design Reference
See: `/ralph/designs/02-MATCHUP-CENTER.md` - Scoreboard layout section

## Context
- Primary view of the Matchup Center feature
- Shows your team vs opponent side-by-side
- Categories displayed with visual indicators of who's winning
- This is the "at a glance" view of your matchup

## Acceptance Criteria
- [ ] Add "Matchup" tab to main navigation
- [ ] Create `frontend/src/components/MatchupCenter.tsx` page component
- [ ] Create `frontend/src/components/matchup/Scoreboard.tsx`
- [ ] Display overall score (e.g., "5-3-1" categories)
- [ ] Show team names with logos/avatars if available
- [ ] Category-by-category breakdown:
  - Category name
  - Your value vs opponent value
  - Visual indicator (green/red/yellow for win/loss/tie)
  - Margin of difference
- [ ] Highlight categories you're winning vs losing
- [ ] Show "Last Updated" timestamp
- [ ] Auto-refresh option or manual refresh button
- [ ] Loading and error states
- [ ] Handle bye week gracefully

## Verification
1. Frontend builds without errors
2. Visual check: Scoreboard displays correctly
3. Colors match design system (hawk-teal for winning, hawk-red for losing)
4. Data updates when refresh is clicked

## Dependencies
- Task 201 (matchup API endpoints)

## Notes
- Follow pattern established by Streaming Optimizer navigation (Task 102)
- Category values should be formatted appropriately (percentages for FG%, FT%)
- Consider mobile layout - may need to stack instead of side-by-side
- Add `data-testid="matchup-scoreboard"` for testing
