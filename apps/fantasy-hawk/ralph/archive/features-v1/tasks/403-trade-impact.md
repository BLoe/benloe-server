# Task 403: Trade Analyzer - Impact Visualization

## Objective
Create visualization showing trade impact on team categories.

## Design Reference
See: `/ralph/designs/04-TRADE-ANALYZER.md` - Impact Visualization section

## Context
- Shows results of trade analysis
- Before/after comparison for each category
- Visual indicators of improvement vs decline
- Helps users quickly understand trade value

## Acceptance Criteria
- [ ] Create `frontend/src/components/trade/TradeImpact.tsx`
- [ ] Display after trade analysis completes
- [ ] Category-by-category breakdown:
  - Current value
  - Projected value after trade
  - Delta (change amount)
  - Visual indicator (green up, red down)
- [ ] Overall trade grade/summary
- [ ] Show player stat changes in detail
- [ ] "Net impact" summary (e.g., "+2 categories, -1 category")
- [ ] Consider showing impact on league standings/rankings
- [ ] Animate appearance for polish

## Verification
1. Frontend builds without errors
2. Visual check: Impact display after analysis
3. Numbers make sense (giving away scorer reduces points)
4. Colors indicate direction correctly

## Dependencies
- Task 401 (analysis API response)
- Task 402 (trade builder integration)

## Notes
- Use design system stat colors (excellent/good/average/poor)
- Keep visualization simple and scannable
- Consider bar chart or meter visualization
- Add `data-testid="trade-impact"`
