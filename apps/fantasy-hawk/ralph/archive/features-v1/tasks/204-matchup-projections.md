# Task 204: Matchup Center - Games Remaining & Projections

## Objective
Add games remaining tracking and category outcome projections.

## Design Reference
See: `/ralph/designs/02-MATCHUP-CENTER.md` - Projections section

## Context
- Shows how many games each team has left this week
- Projects likely final outcomes for each category
- Identifies "swing" categories that could flip
- Helps users decide where to focus

## Acceptance Criteria
- [ ] Create `frontend/src/components/matchup/ProjectionsPanel.tsx`
- [ ] Display games remaining for your team vs opponent
- [ ] Show player-by-player games remaining breakdown
- [ ] For each category, show:
  - Current status (winning/losing/tied)
  - Projected final status
  - Confidence level (high/medium/low)
  - "Swing" indicator if category could flip
- [ ] Highlight swing categories prominently
- [ ] Show projected final score
- [ ] Add "Key Insight" summary (e.g., "Focus on AST - you can win it with 2 more games")
- [ ] Integrate into MatchupCenter page

## Verification
1. Frontend builds without errors
2. Games remaining counts are accurate
3. Projections update when data refreshes
4. Swing categories are highlighted appropriately

## Dependencies
- Task 201 (projections API)
- Task 202 (page integration)
- Task 101 (BDL schedule data for games remaining)

## Notes
- Projections are estimates - communicate uncertainty to users
- "Swing" threshold: categories within ~10% of flipping
- Games remaining requires matching roster players to BDL team schedule
- Add `data-testid="projections-panel"` for testing
