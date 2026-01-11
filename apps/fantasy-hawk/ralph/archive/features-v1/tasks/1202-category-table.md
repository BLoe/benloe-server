# Task 1202: Category Analysis - Enhanced Table UI

## Objective
Enhance the existing category stats table with profile view.

## Design Reference
See: `/ralph/designs/01-CATEGORY-ANALYSIS.md` - Table section

## Context
- Builds on existing CategoryStatsTable component
- Adds profile visualization
- More intuitive display of strengths/weaknesses
- Maintains existing functionality

## Acceptance Criteria
- [ ] Create `frontend/src/components/category/TeamProfile.tsx`
  - Visual profile card for user's team
  - Radar chart or bar chart of category strengths
  - "Your Identity" summary (e.g., "Rebounding + Blocks Build")
- [ ] Enhance existing table with:
  - Z-score column option
  - Percentile column option
  - Strength classification badges
- [ ] Add toggle between views:
  - Existing raw numbers view
  - New profile/analytical view
- [ ] Highlight user's team row distinctly
- [ ] Integrate into existing Category Stats tab

## Verification
1. Frontend builds without errors
2. Visual check: Profile displays correctly
3. Chart visualizes strengths clearly
4. Toggle between views works

## Dependencies
- Task 1201 (profile API)
- Existing CategoryStatsTable

## Notes
- Don't break existing functionality
- Consider Recharts for radar/bar chart (already in project)
- Profile view should be the "aha moment" for users
- Add `data-testid="team-profile"`, `data-testid="view-toggle"`
