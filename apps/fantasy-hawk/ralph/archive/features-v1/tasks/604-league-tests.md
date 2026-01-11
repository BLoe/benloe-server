# Task 604: League Insights - E2E Tests

## Objective
Create E2E tests for the League Insights feature.

## Design Reference
See: `/ralph/designs/07-LEAGUE-INSIGHTS.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/league-insights.spec.ts`
- [ ] Test: League Insights tab appears in navigation
- [ ] Test: Settings page loads with league info
- [ ] Test: Category settings table displays
- [ ] Test: Non-standard settings are highlighted
- [ ] Test: Custom rankings load
- [ ] Test: Rankings table is sortable
- [ ] Test: Position filter works
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 601-603 (complete league insights feature)

## Notes
- Use `data-testid` attributes from previous tasks
- Test that data displays, not exact values
