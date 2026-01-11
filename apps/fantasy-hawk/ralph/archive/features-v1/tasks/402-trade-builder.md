# Task 402: Trade Analyzer - Trade Builder UI

## Objective
Create the trade construction interface for selecting players to trade.

## Design Reference
See: `/ralph/designs/04-TRADE-ANALYZER.md` - Trade Builder section

## Context
- Users select players from their team and opponent's team
- Two-column interface: Your Players / Their Players
- Selected players move to a "trade block" area
- Triggers analysis when trade is built

## Acceptance Criteria
- [ ] Add "Trade" tab to main navigation
- [ ] Create `frontend/src/components/TradeAnalyzer.tsx` page
- [ ] Create `frontend/src/components/trade/TradeBuilder.tsx`
- [ ] Team selector dropdown to choose trade partner
- [ ] Display your roster with player cards
- [ ] Display selected team's roster
- [ ] Click to add/remove players from trade
- [ ] Visual "trade block" showing proposed trade
- [ ] "Analyze Trade" button when trade is valid (at least 1 each side)
- [ ] Loading state while fetching rosters
- [ ] Clear trade button

## Verification
1. Frontend builds without errors
2. Visual check: Trade builder interface works
3. Can select players from both sides
4. Analyze button triggers API call

## Dependencies
- Task 401 (trade API)

## Notes
- Player cards should show key info: name, position, team, key stats
- Consider roster position eligibility
- Don't need to validate trade legality - just build it
- Add `data-testid="trade-builder"`, `data-testid="analyze-trade-btn"`
