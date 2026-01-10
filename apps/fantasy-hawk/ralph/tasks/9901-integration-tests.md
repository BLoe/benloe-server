# Task 9901: Full Integration Test Suite

## Objective
Create comprehensive integration tests covering all features working together.

## Design Reference
All feature designs in `/ralph/designs/`

## Context
- Individual feature tests verify each feature in isolation
- Integration tests verify features work together
- Tests complete user workflows across features
- Final validation before deployment

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/integration.spec.ts`
- [ ] Test complete user workflows:
  - New user: Sign in → Select league → View dashboard → Explore features
  - Streaming workflow: View schedule → Find candidates → Check recommendations
  - Matchup workflow: Check score → Analyze categories → Get projections
  - Trade workflow: Select partner → Build trade → Analyze impact
  - Waiver workflow: View recommendations → Compare players → Decision
- [ ] Test navigation flow between all tabs
- [ ] Test data consistency across features (same roster shown everywhere)
- [ ] Test error recovery (network failure, reload)
- [ ] All integration tests pass

## Verification
1. All tests pass: `npx playwright test --project=fantasy-hawk tests/fantasy-hawk/e2e/integration.spec.ts`
2. Tests complete in reasonable time (<2 minutes)
3. No flaky tests

## Dependencies
- All feature tasks (101-1204) complete

## Notes
- These tests run after all features are built
- Focus on user journeys, not edge cases
- May need authenticated test user
- Consider test data setup/teardown
