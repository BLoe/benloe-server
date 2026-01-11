# Task 1204: Category Analysis - E2E Tests

## Objective
Create E2E tests for enhanced Category Analysis features.

## Design Reference
See: `/ralph/designs/01-CATEGORY-ANALYSIS.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/category-enhanced.spec.ts`
- [ ] Test: Team profile displays
- [ ] Test: Profile chart renders
- [ ] Test: View toggle works
- [ ] Test: Z-score/percentile columns show in analytical view
- [ ] Test: Trend charts display
- [ ] Test: Time range selector works
- [ ] Test: Trend direction indicators show
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 1201-1203 (complete category enhancements)

## Notes
- Test the enhanced views, not the existing basic functionality
- Use `data-testid` attributes from previous tasks
