# Task 602: League Insights - Settings Breakdown UI

## Objective
Create UI showing league settings analysis and comparisons.

## Design Reference
See: `/ralph/designs/07-LEAGUE-INSIGHTS.md` - Settings UI section

## Context
- Shows users how their league differs from standard
- Helps understand category importance
- Educational for users new to their league

## Acceptance Criteria
- [ ] Add "League Insights" tab to main navigation
- [ ] Create `frontend/src/components/LeagueInsights.tsx` page
- [ ] Create `frontend/src/components/league/SettingsBreakdown.tsx`
- [ ] Display league basic info:
  - League name, number of teams
  - Scoring type (H2H categories, roto, points)
  - Number of roster spots, positions
- [ ] Category settings table:
  - Category name
  - How it's scored
  - "Standard?" indicator
- [ ] Highlight non-standard categories prominently
- [ ] Explain implications of unusual settings

## Verification
1. Frontend builds without errors
2. Visual check: Settings page displays league info
3. Non-standard items are highlighted
4. Information matches Yahoo

## Dependencies
- Task 601 (league API)

## Notes
- Keep explanations simple for newcomers
- Consider tooltip explanations for category types
- Show what "standard" means as reference
- Add `data-testid="league-settings"`
