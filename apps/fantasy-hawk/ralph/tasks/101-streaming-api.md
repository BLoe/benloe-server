# Task 101: Streaming Optimizer - BDL Client & Schedule API

## Objective
Create the Ball Don't Lie API client and backend endpoints that provide NBA schedule data for streaming analysis.

## Design Reference
See: `/ralph/designs/03-STREAMING-OPTIMIZER.md` - Schedule Grid and data requirements sections

## Context
- This is the first feature task - it establishes the BDL client that other features will reuse
- Ball Don't Lie API: `https://api.balldontlie.io/v1/` - free tier, no auth needed
- Key endpoints: `/games` (schedule), `/teams` (team info)
- Existing Yahoo API patterns in `backend/src/services/yahoo.ts`
- Existing route patterns in `backend/src/routes/fantasy.ts`

## Acceptance Criteria
- [ ] Create `backend/src/services/balldontlie.ts` with typed API client
- [ ] Implement `getGames(startDate, endDate)` - fetch NBA games in date range
- [ ] Implement `getTeams()` - fetch all NBA teams with IDs and abbreviations
- [ ] Create NBA team abbreviation → BDL team ID mapping
- [ ] Add response caching (schedule data rarely changes mid-day)
- [ ] Create `GET /api/fantasy/leagues/:leagueKey/streaming/schedule` endpoint
  - Returns games for current fantasy week
  - Groups by day with team game counts
- [ ] Handle errors gracefully with typed error responses

## Verification
1. Backend builds: `cd /srv/benloe/apps/fantasy-hawk/backend && npm run build`
2. Create unit test `src/services/balldontlie.test.ts`:
   - Test date formatting
   - Test response parsing with mocked data
   - Test caching behavior
3. Run tests: `npm test`
4. Manual test: Hit the endpoint with curl and verify response structure

## Dependencies
None - this is the first task

## Notes
- Free tier rate limit: 30 requests/minute - cache aggressively
- Fantasy week dates come from Yahoo API (already available via existing endpoints)
- Consider timezone handling - NBA games are in ET, fantasy weeks may span timezones
- Export the BDL client from a services index for easy reuse
