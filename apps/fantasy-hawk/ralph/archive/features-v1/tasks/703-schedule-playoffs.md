# Task 703: Schedule Planner - Playoff Week Analysis

## Objective
Create detailed analysis of fantasy playoff weeks.

## Design Reference
See: `/ralph/designs/08-SCHEDULE-PLANNER.md` - Playoffs section

## Context
- Fantasy playoffs are crucial - roster construction matters
- Some NBA teams have better schedules during fantasy playoffs
- Helps users plan ahead for championship push
- Identifies schedule-based advantages

## Acceptance Criteria
- [ ] Create backend endpoint `GET /api/fantasy/leagues/:leagueKey/schedule/playoffs`
  - Returns game counts for each NBA team during playoff weeks
  - Identifies best/worst schedule teams
  - Analyzes user's roster playoff schedule strength
- [ ] Create `frontend/src/components/schedule/PlayoffAnalysis.tsx`
- [ ] Display playoff weeks overview:
  - Dates of each playoff round
  - Total games available
- [ ] Team schedule rankings for playoffs:
  - NBA teams sorted by playoff week games
  - Highlight teams on user's roster
- [ ] Roster strength indicator:
  - How does your team's schedule compare?
  - Players to target with good playoff schedules
- [ ] Integrate into Schedule Planner page

## Verification
1. Backend endpoint returns playoff analysis
2. Frontend displays playoff weeks
3. Team rankings are sorted correctly
4. User's roster schedule is highlighted

## Dependencies
- Task 701 (schedule API)
- Task 702 (page integration)

## Notes
- Playoff weeks vary by league settings
- Yahoo provides playoff week configuration in settings
- Consider championship week specifically
- Add `data-testid="playoff-analysis"`
