# Task 106: Streaming Optimizer - Integration & E2E Tests

## Objective
Create comprehensive E2E tests for the Streaming Optimizer feature.

## Design Reference
See: `/ralph/designs/03-STREAMING-OPTIMIZER.md` - for expected behaviors

## Context
- Tests should verify the complete user flow
- Previous tasks created unit tests for individual components
- E2E tests verify everything works together
- Tests run against the live site (https://fantasyhawk.benloe.com)

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/streaming.spec.ts`
- [ ] Test: Streaming tab appears in navigation when authenticated
- [ ] Test: Streaming page loads with all three panels
- [ ] Test: Schedule grid displays days of the week
- [ ] Test: Candidates table loads and displays players
- [ ] Test: Candidates table sorting works
- [ ] Test: Candidates table filtering by position works
- [ ] Test: Recommendations panel displays suggestions (or appropriate empty state)
- [ ] Test: Page handles loading states gracefully
- [ ] Test: Page handles error states (e.g., API failure)
- [ ] All tests pass: `npx playwright test --project=fantasy-hawk tests/fantasy-hawk/e2e/streaming.spec.ts`

## Verification
1. All E2E tests pass
2. Tests are not flaky (run 3x to verify)
3. Test coverage includes happy path and error cases
4. Tests complete in reasonable time (<30s total)

## Dependencies
- Tasks 101-105 (all streaming components must be built)

## Notes
- Use `data-testid` attributes added in previous tasks
- May need test fixtures for unauthenticated vs authenticated states
- Consider mocking external APIs for reliability
- Keep tests focused - each test should verify one thing
- Use existing `tests/fantasy-hawk/fixtures.ts` for shared setup
