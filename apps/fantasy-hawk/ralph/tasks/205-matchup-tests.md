# Task 205: Matchup Center - E2E Tests

## Objective
Create comprehensive E2E tests for the Matchup Center feature.

## Design Reference
See: `/ralph/designs/02-MATCHUP-CENTER.md` - for expected behaviors

## Context
- Tests verify the complete matchup tracking flow
- Must handle authenticated state (matchup requires login)
- Tests run against live site

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/matchup.spec.ts`
- [ ] Test: Matchup tab appears in navigation
- [ ] Test: Matchup page loads scoreboard
- [ ] Test: Category scores display correctly
- [ ] Test: Win/loss/tie indicators show proper colors
- [ ] Test: Category breakdown expands on click
- [ ] Test: Projections panel displays
- [ ] Test: Games remaining shows for both teams
- [ ] Test: Refresh updates data
- [ ] Test: Handles bye week appropriately
- [ ] All tests pass: `npx playwright test --project=fantasy-hawk tests/fantasy-hawk/e2e/matchup.spec.ts`

## Verification
1. All E2E tests pass
2. Tests are not flaky (run 3x to verify)
3. Tests complete in reasonable time

## Dependencies
- Tasks 201-204 (all matchup components)

## Notes
- Testing live matchup requires active fantasy week
- May need fixtures for different scenarios (winning, losing, bye)
- Focus on UI behavior, not exact data values
- Use `data-testid` attributes from previous tasks
