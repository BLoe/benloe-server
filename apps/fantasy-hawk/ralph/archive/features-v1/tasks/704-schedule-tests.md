# Task 704: Schedule Planner - E2E Tests

## Objective
Create E2E tests for the Schedule Planner feature.

## Design Reference
See: `/ralph/designs/08-SCHEDULE-PLANNER.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/schedule.spec.ts`
- [ ] Test: Schedule tab appears in navigation
- [ ] Test: Calendar view loads
- [ ] Test: Months are navigable
- [ ] Test: Week click shows detail
- [ ] Test: Toggle between league/roster view works
- [ ] Test: Playoff analysis section displays
- [ ] Test: Team rankings show
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 701-703 (complete schedule feature)

## Notes
- Use `data-testid` attributes from previous tasks
- Test navigation and display, not exact dates
