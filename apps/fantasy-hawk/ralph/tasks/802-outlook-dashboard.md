# Task 802: Season Outlook - Dashboard UI

## Objective
Create the main season outlook dashboard view.

## Design Reference
See: `/ralph/designs/10-SEASON-OUTLOOK.md` - Dashboard section

## Context
- "Big picture" view of the season
- Shows where user stands in the league
- Highlights trajectory and trends
- Motivational/informational purpose

## Acceptance Criteria
- [ ] Add "Season Outlook" tab to main navigation
- [ ] Create `frontend/src/components/SeasonOutlook.tsx` page
- [ ] Create `frontend/src/components/outlook/Dashboard.tsx`
- [ ] Display current standing prominently:
  - Current rank, record
  - Trend indicator (rising/falling/stable)
- [ ] Projected final standing:
  - Expected finish rank
  - Win projection
- [ ] Season progress indicator:
  - Weeks completed / total weeks
  - Visual progress bar
- [ ] Quick stats summary:
  - Win rate this season
  - Best/worst categories
- [ ] Loading and error states

## Verification
1. Frontend builds without errors
2. Visual check: Dashboard displays user's outlook
3. Numbers match current standings
4. Trend indicators work

## Dependencies
- Task 801 (outlook API)

## Notes
- Keep it motivational, not discouraging
- "On pace for..." framing is helpful
- Consider adding week-over-week change
- Add `data-testid="outlook-dashboard"`
