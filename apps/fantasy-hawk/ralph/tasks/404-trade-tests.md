# Task 404: Trade Analyzer - E2E Tests

## Objective
Create E2E tests for the Trade Analyzer feature.

## Design Reference
See: `/ralph/designs/04-TRADE-ANALYZER.md`

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/trade.spec.ts`
- [ ] Test: Trade tab appears in navigation
- [ ] Test: Trade builder page loads
- [ ] Test: Can select trade partner team
- [ ] Test: Rosters display for both teams
- [ ] Test: Can add player to trade
- [ ] Test: Can remove player from trade
- [ ] Test: Analyze button becomes active with valid trade
- [ ] Test: Analysis results display after clicking Analyze
- [ ] Test: Trade impact shows category changes
- [ ] Test: Clear trade resets the builder
- [ ] All tests pass

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 401-403 (complete trade feature)

## Notes
- Use `data-testid` attributes from previous tasks
- Test UI flow, not exact calculation results
