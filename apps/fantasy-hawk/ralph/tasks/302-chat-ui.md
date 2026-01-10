# Task 302: AI Chat - Chat UI Component

## Objective
Create the chat interface for AI strategy conversations.

## Design Reference
See: `/ralph/designs/12-AI-STRATEGY-CHAT.md` - Chat UI section
See: `/ralph/designs/00-DESIGN-SYSTEM.md` - Form elements and colors

## Context
- Chat interface should feel modern and responsive
- Streaming responses should appear word-by-word
- May be a slide-out panel or dedicated page
- This replaces/enhances the existing Strategy Corner

## Acceptance Criteria
- [ ] Create `frontend/src/components/chat/ChatPanel.tsx`
- [ ] Message list showing conversation history
- [ ] User messages styled differently from AI responses
- [ ] Input field with send button
- [ ] Support Enter to send, Shift+Enter for newline
- [ ] Streaming response display (words appear as they arrive)
- [ ] Loading indicator while AI is "thinking"
- [ ] Error state for failed messages
- [ ] "Clear conversation" button
- [ ] Scroll to bottom on new messages
- [ ] Integrate as new tab or enhance existing Strategy Corner
- [ ] Mobile-friendly layout

## Verification
1. Frontend builds without errors
2. Visual check: Chat interface matches design
3. Typing and sending works
4. Streaming display works smoothly
5. Error states display properly

## Dependencies
- Task 301 (streaming API)

## Notes
- Use SSE/EventSource for streaming from API
- Consider markdown rendering for AI responses
- Keep input enabled while AI responds (allow interruption?)
- Avatar or icon for AI vs user messages
- Add `data-testid="chat-panel"`, `data-testid="chat-input"`, `data-testid="chat-send"`
