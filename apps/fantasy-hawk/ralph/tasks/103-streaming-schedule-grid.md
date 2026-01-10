# Task 103: Streaming Optimizer - Schedule Grid Component

## Objective
Build the weekly schedule grid showing which NBA teams play on which days.

## Design Reference
See: `/ralph/designs/03-STREAMING-OPTIMIZER.md` - Schedule Grid section with layout specs

## Context
- Replaces placeholder from Task 102
- Shows 7-day grid (Mon-Sun of fantasy week)
- Each cell shows teams playing that day
- Highlights days with many games (good streaming days)
- Uses data from the schedule API (Task 101)

## Acceptance Criteria
- [ ] Create `frontend/src/components/streaming/ScheduleGrid.tsx`
- [ ] Display 7-column grid for days of the week
- [ ] Show date headers (Mon 1/15, Tue 1/16, etc.)
- [ ] List team abbreviations playing each day
- [ ] Color-code days by game count:
  - Light games (0-4): subtle background
  - Medium (5-8): normal
  - Heavy (9+): highlighted as good streaming days
- [ ] Show total games count per day
- [ ] Clicking a team filters the candidates table (emit event/callback)
- [ ] Loading skeleton while data fetches
- [ ] Handle empty state (no games data)
- [ ] Integrate into StreamingOptimizer page (replace placeholder)

## Verification
1. Frontend builds without errors
2. Visual check: Grid displays with mock or real data
3. Days are correctly labeled
4. Game counts appear accurate
5. Color coding works based on game density

## Dependencies
- Task 101 (schedule API)
- Task 102 (page shell to integrate into)

## Notes
- Team abbreviations should be consistent (e.g., "LAL" not "Los Angeles Lakers")
- Consider timezone - display in user's local time or ET
- Grid should be horizontally scrollable on mobile if needed
- Add `data-testid="schedule-grid"` for testing
