# Task 301: AI Chat - Streaming API Endpoint

## Objective
Create backend endpoint for streaming AI chat responses using Claude.

## Design Reference
See: `/ralph/designs/12-AI-STRATEGY-CHAT.md` - API section

## Context
- User's Anthropic API key is stored via Artanis auth service
- Existing Claude integration in StrategyCorner.tsx - similar pattern
- Need streaming response for good UX
- Chat should have fantasy basketball context

## Acceptance Criteria
- [ ] Create `POST /api/fantasy/leagues/:leagueKey/chat` endpoint
- [ ] Accept message history and new user message
- [ ] Stream response using Server-Sent Events (SSE)
- [ ] Inject fantasy context into system prompt:
  - User's team roster
  - Current matchup status
  - League settings and categories
- [ ] Handle errors gracefully (no API key, rate limits)
- [ ] Rate limit to prevent abuse (e.g., 10 messages/minute)
- [ ] Return appropriate error if user has no API key configured

## Verification
1. Backend builds: `npm run build`
2. Write unit test for context injection logic
3. Tests pass: `npm test`
4. Manual test: curl with SSE to see streaming response

## Dependencies
- Artanis auth service (already exists)
- User must have Claude API key set up

## Notes
- Use claude-3-haiku for speed, claude-3-sonnet for quality (make configurable)
- Keep context injection concise - don't dump entire API responses
- System prompt should establish "fantasy basketball assistant" persona
- Consider conversation memory (store last N messages)
- Streaming is important - don't wait for full response
