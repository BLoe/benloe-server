# Task 1203: Category Analysis - Trend Charts

## Objective
Add historical trend visualization for category performance.

## Design Reference
See: `/ralph/designs/01-CATEGORY-ANALYSIS.md` - Trends section

## Context
- Shows how team performance has changed over time
- Identifies improving/declining categories
- Helps users see trajectory
- Useful for mid-season adjustments

## Acceptance Criteria
- [ ] Create `frontend/src/components/category/TrendCharts.tsx`
- [ ] Line chart showing each category over weeks
- [ ] Options:
  - View single category trend
  - View all categories (small multiples or overlay)
- [ ] Indicators for:
  - Trending up (improving)
  - Trending down (declining)
  - Stable
- [ ] Compare to league average trend line
- [ ] Select time range (last 4 weeks, season)
- [ ] Integrate into Category Stats section

## Verification
1. Frontend builds without errors
2. Visual check: Charts display correctly
3. Trends match actual data
4. Time range selector works

## Dependencies
- Task 1201 (trend data API)
- Task 1202 (page integration)

## Notes
- Use Recharts LineChart component
- Keep charts readable - too many lines = confusing
- Consider sparklines for compact view
- Add `data-testid="trend-charts"`
