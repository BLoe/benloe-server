# Task 603: League Insights - Custom Rankings

## Objective
Generate custom player rankings tailored to league settings.

## Design Reference
See: `/ralph/designs/07-LEAGUE-INSIGHTS.md` - Rankings section

## Context
- Standard rankings don't account for league-specific settings
- Custom rankings value players based on actual scoring categories
- Helps identify undervalued players in user's specific league

## Acceptance Criteria
- [ ] Create backend endpoint `GET /api/fantasy/leagues/:leagueKey/insights/rankings`
  - Returns player rankings weighted by league categories
  - Top 100 players based on league-specific value
  - Comparison to standard rankings (over/under valued)
- [ ] Create `frontend/src/components/league/CustomRankings.tsx`
- [ ] Display rankings table:
  - League rank
  - Player name, team, position
  - Standard rank (for comparison)
  - Rank difference (arrows up/down)
- [ ] Filter by position
- [ ] Highlight significantly over/under valued players
- [ ] Integrate into League Insights page

## Verification
1. Backend endpoint returns rankings
2. Frontend displays rankings table
3. Filtering works
4. Over/under valued players highlighted

## Dependencies
- Task 601 (league analysis API)
- Task 602 (page integration)

## Notes
- Rankings based on category z-scores weighted by league categories
- Don't need to be perfectly accurate - directional is fine
- Cache rankings (compute intensive)
- Add `data-testid="custom-rankings"`
