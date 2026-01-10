# Task 903: Learning Mode - E2E Tests

## Objective
Create E2E tests for Learning Mode features.

## Design Reference
See: `/ralph/designs/11-LEARNING-MODE.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/learning.spec.ts`
- [ ] Test: Tooltips appear on hover
- [ ] Test: Tooltip content displays
- [ ] Test: Learning mode toggle works
- [ ] Test: Tooltips hidden when mode disabled
- [ ] Test: Glossary is accessible
- [ ] Test: Glossary search filters terms
- [ ] Test: Glossary categories filter
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 901-902 (complete learning feature)

## Notes
- Test tooltip visibility carefully (hover state)
- Use `data-testid` attributes from previous tasks
