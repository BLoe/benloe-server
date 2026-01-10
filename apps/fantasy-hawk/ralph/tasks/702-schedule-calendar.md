# Task 702: Schedule Planner - Calendar View UI

## Objective
Create visual calendar showing NBA game distribution.

## Design Reference
See: `/ralph/designs/08-SCHEDULE-PLANNER.md` - Calendar section

## Context
- Shows full season at a glance
- Highlights heavy/light game weeks
- Helps plan roster moves in advance
- Critical for playoff week preparation

## Acceptance Criteria
- [ ] Add "Schedule" tab to main navigation
- [ ] Create `frontend/src/components/SchedulePlanner.tsx` page
- [ ] Create `frontend/src/components/schedule/CalendarView.tsx`
- [ ] Display monthly calendar view
- [ ] Show game counts per day/week with color coding:
  - Light weeks: fewer games, cooler color
  - Heavy weeks: more games, warmer color
- [ ] Highlight current week
- [ ] Click week to see detailed breakdown
- [ ] Toggle between: league-wide view vs my roster view
- [ ] Identify All-Star break, playoff weeks
- [ ] Navigation: previous/next month

## Verification
1. Frontend builds without errors
2. Visual check: Calendar displays correctly
3. Game counts are accurate
4. Week detail view works

## Dependencies
- Task 701 (schedule API)

## Notes
- Calendar should be responsive
- Use consistent color scale for game density
- Consider mini-heatmap style visualization
- Add `data-testid="schedule-calendar"`
