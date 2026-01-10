# Task 1102: Waiver Advisor - Dashboard UI

## Objective
Create the waiver wire advisor dashboard.

## Design Reference
See: `/ralph/designs/05-WAIVER-ADVISOR.md` - Dashboard section

## Context
- Central hub for waiver decisions
- Shows recommendations and trends
- Helps users find pickups and drops
- Time-sensitive (waivers have deadlines)

## Acceptance Criteria
- [ ] Add "Waivers" tab to main navigation
- [ ] Create `frontend/src/components/WaiverAdvisor.tsx` page
- [ ] Create `frontend/src/components/waiver/RecommendationsPanel.tsx`
  - Top 10 pickup recommendations
  - Player card with key info
  - "Why" summary for each recommendation
  - Filter by position
- [ ] Create `frontend/src/components/waiver/DropsPanel.tsx`
  - Suggested drops from user's roster
  - Reasoning for each drop
- [ ] Show waiver deadline countdown if active
- [ ] Loading and empty states
- [ ] Quick link to Yahoo waiver page

## Verification
1. Frontend builds without errors
2. Visual check: Dashboard displays recommendations
3. Position filter works
4. Drops panel shows roster analysis

## Dependencies
- Task 1101 (waiver API)

## Notes
- Make recommendations actionable
- Include "ownership rising" indicators
- Keep it scannable - users may check frequently
- Add `data-testid="waiver-dashboard"`, `data-testid="recommendations-panel"`
