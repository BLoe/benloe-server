# Task 804: Season Outlook - E2E Tests

## Objective
Create E2E tests for the Season Outlook feature.

## Design Reference
See: `/ralph/designs/10-SEASON-OUTLOOK.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/outlook.spec.ts`
- [ ] Test: Season Outlook tab appears in navigation
- [ ] Test: Dashboard loads with standings
- [ ] Test: Current rank displays
- [ ] Test: Projected standings show
- [ ] Test: Playoff odds section displays
- [ ] Test: Magic number shows if applicable
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 801-803 (complete outlook feature)

## Notes
- Use `data-testid` attributes from previous tasks
- Test display presence, not exact projections
