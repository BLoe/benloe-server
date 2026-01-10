# Task 1003: Player Comparison - E2E Tests

## Objective
Create E2E tests for Player Comparison feature.

## Design Reference
See: `/ralph/designs/09-PLAYER-COMPARISON.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/comparison.spec.ts`
- [ ] Test: Compare tab appears in navigation
- [ ] Test: Player selector shows search input
- [ ] Test: Search returns player results
- [ ] Test: Can add player to comparison
- [ ] Test: Can add multiple players
- [ ] Test: Comparison table displays
- [ ] Test: Category leaders are highlighted
- [ ] Test: Can remove/replace players
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 1001-1002 (complete comparison feature)

## Notes
- May need to mock search results for reliability
- Use `data-testid` attributes from previous tasks
