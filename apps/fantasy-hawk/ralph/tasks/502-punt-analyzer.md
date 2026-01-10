# Task 502: Punt Engine - Strategy Analyzer UI

## Objective
Create the main punt strategy analysis interface.

## Design Reference
See: `/ralph/designs/06-PUNT-STRATEGY-ENGINE.md` - UI section

## Context
- Shows how well user's team fits various punt strategies
- Visual comparison of different build directions
- Helps users understand their team identity

## Acceptance Criteria
- [ ] Add "Punt Strategy" tab to main navigation
- [ ] Create `frontend/src/components/PuntEngine.tsx` page
- [ ] Create `frontend/src/components/punt/StrategyAnalyzer.tsx`
- [ ] Display punt strategy cards:
  - Strategy name (e.g., "Punt FT%")
  - Fit score (visual meter or percentage)
  - Categories gained vs categories punted
  - Key players that fit the strategy
- [ ] Highlight best-fit strategy
- [ ] Show current category strengths radar chart or bar chart
- [ ] "Your Natural Punts" section showing weak categories
- [ ] Loading and empty states

## Verification
1. Frontend builds without errors
2. Visual check: Strategy analyzer displays
3. Fit scores update based on roster
4. Best-fit strategy is highlighted

## Dependencies
- Task 501 (punt analysis API)

## Notes
- Make punt strategies understandable to newcomers
- Include brief explanation of what punting means
- Visual meters/gauges work well for fit scores
- Add `data-testid="punt-analyzer"`
