# Task 303: AI Chat - Context Injection System

## Objective
Build the system that provides relevant fantasy context to the AI.

## Design Reference
See: `/ralph/designs/12-AI-STRATEGY-CHAT.md` - Context section

## Context
- AI needs current fantasy data to give useful advice
- Context should be dynamic based on conversation topic
- Too much context = slow and expensive, too little = unhelpful
- Smart context selection improves response quality

## Acceptance Criteria
- [ ] Create `backend/src/services/chatContext.ts`
- [ ] Build context based on user's league:
  - Team roster with key stats
  - Current matchup summary
  - League scoring categories
  - Recent transactions (last 7 days)
- [ ] Implement topic detection to include relevant context:
  - "streaming" → include FA list and schedule
  - "trade" → include other teams' rosters
  - "matchup" → include detailed matchup data
  - default → basic roster and matchup
- [ ] Keep context under token limit (summarize if needed)
- [ ] Cache context data to avoid repeated API calls
- [ ] Update chat API to use context service

## Verification
1. Backend builds without errors
2. Write unit tests for context building
3. Tests pass
4. Manual test: Ask different types of questions, verify context relevance

## Dependencies
- Task 301 (chat API to integrate with)

## Notes
- Context doesn't need to be perfect - AI can ask follow-up questions
- Start simple, can add more sophisticated topic detection later
- Consider token counting to stay within limits
- System prompt + context should be ~2000 tokens max
