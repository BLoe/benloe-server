# Task 203: Matchup Center - Category Breakdown

## Objective
Create detailed category breakdown view with per-player contributions.

## Design Reference
See: `/ralph/designs/02-MATCHUP-CENTER.md` - Category Detail section

## Context
- Drill-down from the scoreboard into individual categories
- Shows which players are contributing to each category
- Helps identify where to focus roster decisions
- Expandable detail view within the matchup page

## Acceptance Criteria
- [ ] Create `frontend/src/components/matchup/CategoryBreakdown.tsx`
- [ ] Clicking a category in scoreboard expands to show breakdown
- [ ] Show player-by-player contribution to that category:
  - Player name
  - Their value for this category this week
  - Games played / games remaining
- [ ] Show team total and opponent total prominently
- [ ] Sort players by contribution (highest first)
- [ ] Highlight top contributors
- [ ] Show opponent's top contributors (if data available)
- [ ] Collapse/expand animation
- [ ] Integrate into MatchupCenter page below scoreboard

## Verification
1. Frontend builds without errors
2. Visual check: Clicking category expands breakdown
3. Player contributions sum to team total
4. Collapse/expand works smoothly

## Dependencies
- Task 201 (API must include per-player data)
- Task 202 (scoreboard to integrate with)

## Notes
- May need additional API field for per-player category breakdown
- Not all data may be available from Yahoo - do what's possible
- Keep it simple - this is supplementary detail, not the main view
- Add `data-testid="category-breakdown"` for testing
