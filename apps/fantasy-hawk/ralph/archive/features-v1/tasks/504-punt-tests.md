# Task 504: Punt Engine - E2E Tests

## Objective
Create E2E tests for the Punt Strategy Engine.

## Design Reference
See: `/ralph/designs/06-PUNT-STRATEGY-ENGINE.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/punt.spec.ts`
- [ ] Test: Punt Strategy tab appears in navigation
- [ ] Test: Strategy analyzer page loads
- [ ] Test: Strategy cards display with fit scores
- [ ] Test: Category strengths visualization displays
- [ ] Test: Archetypes section shows
- [ ] Test: Click archetype shows detail
- [ ] Test: User's players mapped to archetypes
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 501-503 (complete punt feature)

## Notes
- Use `data-testid` attributes from previous tasks
- Test UI flow and display, not calculation accuracy
