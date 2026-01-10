# Task 601: League Insights - Analysis API

## Objective
Create backend endpoints for league-specific insights and analysis.

## Design Reference
See: `/ralph/designs/07-LEAGUE-INSIGHTS.md` - API section

## Context
- Analyzes league settings to understand scoring nuances
- Identifies undervalued/overvalued categories
- Generates custom player rankings for specific league
- Helps users understand their league's uniqueness

## Acceptance Criteria
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/insights/settings`
  - Returns parsed league settings summary
  - Identifies non-standard settings
  - Highlights unusual category weights
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/insights/analysis`
  - Category importance rankings
  - Players over/under valued in this league
  - Positional scarcity analysis
- [ ] Cache analysis results (settings don't change mid-season)

## Verification
1. Backend builds: `npm run build`
2. Write unit tests for settings parsing
3. Tests pass: `npm test`
4. Manual test: Verify analysis for real league

## Dependencies
- Existing league settings endpoint from Yahoo

## Notes
- Different leagues have different categories and weights
- Some leagues use different stat sets entirely
- Compare to "standard" settings to highlight differences
- Cache aggressively - settings rarely change
