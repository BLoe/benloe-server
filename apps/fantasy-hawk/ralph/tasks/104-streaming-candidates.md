# Task 104: Streaming Optimizer - Candidates Table

## Objective
Build the streaming candidates table showing available free agents with their game schedules.

## Design Reference
See: `/ralph/designs/03-STREAMING-OPTIMIZER.md` - Candidates Table section

## Context
- Shows free agents who could be streamed this week
- Combines Yahoo FA data with BDL schedule data
- Key insight: players with more games = more potential stats
- Needs API endpoint to fetch candidates with schedule overlay

## Acceptance Criteria
- [ ] Create backend endpoint `GET /api/fantasy/leagues/:leagueKey/streaming/candidates`
  - Fetches free agents from Yahoo
  - Enriches with games remaining this week from BDL
  - Returns sorted by games remaining (desc)
- [ ] Create `frontend/src/components/streaming/CandidatesTable.tsx`
- [ ] Display columns: Player Name, Team, Position, Games This Week, Key Stats
- [ ] Show game days as dots/icons (e.g., ●○●○●○○ for Mon/Wed/Fri)
- [ ] Sortable by any column
- [ ] Filter by position (PG, SG, SF, PF, C, G, F, UTIL)
- [ ] Filter by team (when user clicks schedule grid)
- [ ] Highlight players with 4+ games this week
- [ ] Pagination or virtual scroll for large lists (25+ players)
- [ ] Loading and empty states
- [ ] Integrate into StreamingOptimizer page (replace placeholder)

## Verification
1. Backend builds and endpoint returns data
2. Write unit test for candidates endpoint
3. Frontend builds without errors
4. Table displays with sortable columns
5. Filters work correctly
6. Schedule dots match actual game days

## Dependencies
- Task 101 (BDL client and schedule data)
- Task 102 (page shell)
- Task 103 (optional - for team filter integration)

## Notes
- Yahoo FA endpoint: already exists in codebase, may need minor additions
- Limit initial fetch to top 50 FAs by percent owned to keep response fast
- Position eligibility comes from Yahoo - players can have multiple positions
- Add `data-testid="candidates-table"` for testing
