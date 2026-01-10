# Task 1002: Player Comparison - Comparison UI

## Objective
Create the player comparison interface.

## Design Reference
See: `/ralph/designs/09-PLAYER-COMPARISON.md` - UI section

## Context
- Users select players to compare
- Side-by-side stat display
- Visual indicators for category leaders
- Quick tool for decision making

## Acceptance Criteria
- [ ] Add "Compare" tab to main navigation
- [ ] Create `frontend/src/components/PlayerComparison.tsx` page
- [ ] Create `frontend/src/components/comparison/PlayerSelector.tsx`
  - Search autocomplete to find players
  - Show 2-4 player slots
  - Clear/replace players
- [ ] Create `frontend/src/components/comparison/ComparisonTable.tsx`
  - Category rows with player columns
  - Highlight leader in each category (green)
  - Show category value + rank indicator
- [ ] Show player photos if available
- [ ] Display player metadata (team, position, injury status)
- [ ] "Compare" button triggers comparison
- [ ] Shareable link to specific comparison

## Verification
1. Frontend builds without errors
2. Visual check: Can search and select players
3. Comparison table shows clearly
4. Leader highlighting works

## Dependencies
- Task 1001 (comparison API)

## Notes
- Autocomplete should be fast and responsive
- Handle case where player not found
- Consider mobile layout (may need to stack)
- Add `data-testid="player-selector"`, `data-testid="comparison-table"`
