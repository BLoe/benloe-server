# Task 1104: Waiver Advisor - E2E Tests

## Objective
Create E2E tests for Waiver Advisor feature.

## Design Reference
See: `/ralph/designs/05-WAIVER-ADVISOR.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/waiver.spec.ts`
- [ ] Test: Waivers tab appears in navigation
- [ ] Test: Dashboard loads recommendations
- [ ] Test: Player cards display info
- [ ] Test: Position filter works
- [ ] Test: Drops panel shows suggestions
- [ ] Test: FAAB section shows for FAAB leagues (or is hidden)
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 1101-1103 (complete waiver feature)

## Notes
- Test display presence, not specific player recommendations
- Use `data-testid` attributes from previous tasks
