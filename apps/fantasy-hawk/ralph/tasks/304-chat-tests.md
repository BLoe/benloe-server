# Task 304: AI Chat - E2E Tests

## Objective
Create E2E tests for the AI Strategy Chat feature.

## Design Reference
See: `/ralph/designs/12-AI-STRATEGY-CHAT.md`

## Context
- Chat requires API key to function
- Tests should verify UI behavior, not AI response quality
- Streaming responses need special test handling

## Acceptance Criteria
- [ ] Create `tests/fantasy-hawk/e2e/chat.spec.ts`
- [ ] Test: Chat interface appears (tab or panel)
- [ ] Test: Message input field works
- [ ] Test: Send button triggers message send
- [ ] Test: User message appears in chat history
- [ ] Test: Loading indicator shows while waiting
- [ ] Test: Response appears (mocked if needed for reliability)
- [ ] Test: Clear conversation works
- [ ] Test: Error state when API key missing
- [ ] Test: Mobile layout works
- [ ] All tests pass: `npx playwright test --project=fantasy-hawk tests/fantasy-hawk/e2e/chat.spec.ts`

## Verification
1. All E2E tests pass
2. Tests are not flaky
3. Tests complete in reasonable time

## Dependencies
- Tasks 301-303 (chat feature complete)

## Notes
- May need to mock AI responses for reliable testing
- Test the UI, not the AI - response content will vary
- Consider timeout handling for slow responses
- Use `data-testid` attributes from Task 302
