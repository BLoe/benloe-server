# AI Strategy Chat - Design Specification

## Overview

A conversational interface where users can ask any fantasy basketball question and get personalized AI-powered answers based on their team, league, and current situation.

**Primary Use Case**: "Should I trade Jokic for two mid-tier players?"

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER                                                              │
├─────────────────────────────────────────────────────────────────────┤
│ AI Strategy Chat                                      [Clear Chat]  │
├──────────────────────────────────────────┬──────────────────────────┤
│                                          │                          │
│  CHAT MESSAGES                           │  CONTEXT PANEL           │
│                                          │  ┌────────────────────┐  │
│  ┌────────────────────────────────────┐  │  │ 📊 What Claude      │  │
│  │ 🤖 AI                              │  │  │    Can See          │  │
│  │                                    │  │  │                    │  │
│  │ Welcome! I have access to your     │  │  │ ✓ Your Roster      │  │
│  │ Fantasy Hawk data. Ask me anything │  │  │ ✓ League Standings │  │
│  │ about your fantasy basketball      │  │  │ ✓ This Week Matchup│  │
│  │ strategy.                          │  │  │ ✓ Category Stats   │  │
│  │                                    │  │  │ ✓ Scoring Settings │  │
│  └────────────────────────────────────┘  │  │ ○ Trade History    │  │
│                                          │  │ ○ Player News      │  │
│  ┌────────────────────────────────────┐  │  └────────────────────┘  │
│  │ 👤 You                             │  │                          │
│  │                                    │  │  QUICK QUESTIONS         │
│  │ Should I trade LeBron for Trae     │  │  ┌────────────────────┐  │
│  │ Young and Bam Adebayo?             │  │  │ "Who should I      │  │
│  └────────────────────────────────────┘  │  │  stream tomorrow?"  │  │
│                                          │  │                      │  │
│  ┌────────────────────────────────────┐  │  │ "Am I making the   │  │
│  │ 🤖 AI                     typing...│  │  │  playoffs?"         │  │
│  │                                    │  │  │                      │  │
│  │ Let me analyze this trade for you. │  │  │ "What's wrong with │  │
│  │                                    │  │  │  my team?"          │  │
│  │ **Trade Analysis:**                │  │  │                      │  │
│  │                                    │  │  │ "Analyze this      │  │
│  │ You would give up:                 │  │  │  trade: [player]"   │  │
│  │ - LeBron James (LAL)               │  │  └────────────────────┘  │
│  │   25.1 PTS, 7.2 REB, 7.8 AST       │  │                          │
│  │                                    │  │  FOCUS CONTEXT           │
│  │ You would receive:                 │  │  ┌────────────────────┐  │
│  │ - Trae Young (ATL)                 │  │  │ [All Data    ▼]    │  │
│  │   26.8 PTS, 3.1 REB, 10.4 AST      │  │  │                    │  │
│  │ - Bam Adebayo (MIA)                │  │  │ Options:           │  │
│  │   19.2 PTS, 10.1 REB, 4.2 AST      │  │  │ • All Data         │  │
│  │                                    │  │  │ • My Matchup       │  │
│  │ **Impact on Your Build:**          │  │  │ • Trade Analysis   │  │
│  │ This trade would significantly...  │  │  │ • Streaming        │  │
│  │ █████████░░░░░░░░░░░ streaming     │  │  └────────────────────┘  │
│  └────────────────────────────────────┘  │                          │
│                                          │                          │
├──────────────────────────────────────────┴──────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Type your question...                               [Send ▶] │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Chat Container

**Component**: `AIStrategyChat`
**Test ID**: `data-testid="ai-chat"`

```tsx
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  contextFocus: ContextFocus;
}
```

**Layout**:
- Main chat area: 65% width
- Context panel: 35% width
- Input fixed at bottom
- Messages scroll within container

---

### 2. Message Bubbles

**Component**: `ChatMessage`
**Test ID**: `data-testid="chat-message-{id}"`

**User Message Style**:
```tsx
<div className="flex justify-end mb-4">
  <div className="max-w-[80%] bg-hawk-orange/20 border border-hawk-orange/30
                  rounded-2xl rounded-br-md px-4 py-3">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs text-text-muted">You</span>
    </div>
    <p className="text-text-primary">{content}</p>
  </div>
</div>
```

**AI Message Style**:
```tsx
<div className="flex justify-start mb-4">
  <div className="max-w-[80%] bg-court-elevated border border-white/10
                  rounded-2xl rounded-bl-md px-4 py-3">
    <div className="flex items-center gap-2 mb-1">
      <span className="w-6 h-6 rounded-full bg-hawk-indigo/30 flex items-center justify-center">
        🤖
      </span>
      <span className="text-xs text-text-muted">Claude</span>
    </div>
    <div className="prose prose-invert prose-sm">
      {/* Render markdown content */}
    </div>
  </div>
</div>
```

**Streaming State**:
- Show typing indicator: three pulsing dots
- Text appears character by character (or word by word)
- Cursor blink at end of streaming text

**Data TestIDs**:
- `chat-message-{id}`
- `chat-message-content-{id}`
- `chat-typing-indicator`

---

### 3. Chat Input

**Component**: `ChatInput`
**Test ID**: `data-testid="chat-input"`

```tsx
<div className="border-t border-white/10 p-4 bg-court-base">
  <div className="flex gap-3">
    <input
      data-testid="chat-input-field"
      type="text"
      placeholder="Ask about your fantasy team..."
      className="flex-1 bg-court-surface border border-white/10 rounded-xl
                 px-4 py-3 text-text-primary placeholder:text-text-muted
                 focus:border-hawk-orange/50 focus:ring-1 focus:ring-hawk-orange/20"
    />
    <button
      data-testid="chat-send-button"
      className="bg-hawk-orange text-white px-6 py-3 rounded-xl font-medium
                 hover:bg-hawk-orange/90 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Send
    </button>
  </div>
</div>
```

**Behavior**:
- Enter key sends message
- Button disabled while streaming
- Shift+Enter for newline
- Auto-resize textarea for long messages (optional)

**Data TestIDs**:
- `chat-input`
- `chat-input-field`
- `chat-send-button`

---

### 4. Context Panel

**Component**: `ChatContextPanel`
**Test ID**: `data-testid="chat-context-panel"`

**Sections**:

1. **What Claude Can See** - Checklist of available data
2. **Quick Questions** - Clickable suggested prompts
3. **Focus Context** - Dropdown to narrow AI context

```tsx
interface ContextItem {
  label: string;
  available: boolean;
  description?: string;
}

const contextItems: ContextItem[] = [
  { label: 'Your Roster', available: true },
  { label: 'League Standings', available: true },
  { label: 'This Week Matchup', available: true },
  { label: 'Category Stats', available: true },
  { label: 'Scoring Settings', available: true },
  { label: 'Trade History', available: false },
  { label: 'Player News', available: false },
];
```

**Visual Design**:
- Available items: teal checkmark
- Unavailable items: grayed out circle
- Quick questions as clickable pills/cards
- Focus dropdown as styled select

**Data TestIDs**:
- `chat-context-panel`
- `chat-context-item-{label}`
- `chat-quick-question-{index}`
- `chat-focus-selector`

---

### 5. Quick Questions

**Component**: `QuickQuestions`
**Test ID**: `data-testid="chat-quick-questions"`

```tsx
const quickQuestions = [
  "Who should I stream tomorrow?",
  "Am I making the playoffs?",
  "What's wrong with my team?",
  "Should I punt any categories?",
  "Who should I target in trades?",
  "How do I beat my opponent this week?",
];
```

**Visual Design**:
- Cards with subtle hover effect
- Clicking fills the input and sends
- Icon before each question

**Data TestIDs**:
- `chat-quick-questions`
- `chat-quick-question-{index}`

---

## AI Response Formatting

The AI should format responses with markdown:

```markdown
**Trade Analysis:**

You would give up:
- LeBron James (LAL)
  25.1 PTS, 7.2 REB, 7.8 AST

You would receive:
- Trae Young (ATL)
  26.8 PTS, 3.1 REB, 10.4 AST

**Category Impact:**
| Category | Before | After | Change |
|----------|--------|-------|--------|
| PTS | 3rd | 2nd | +1 |
| AST | 6th | 3rd | +3 |
```

**Render with**:
- Code blocks with syntax highlighting
- Tables as styled HTML tables
- Bold/italic text
- Lists with proper spacing
- Links to other app features (e.g., "View in Trade Analyzer")

---

## Streaming Implementation

**Backend**: Server-Sent Events (SSE) or WebSocket

```tsx
// Frontend hook
function useStreamingChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = async (content: string) => {
    // Add user message
    // Start SSE connection
    // Update assistant message as chunks arrive
    // Handle completion
  };

  return { messages, isStreaming, sendMessage };
}
```

**API Endpoint**: `POST /api/chat/stream`
- Request: `{ message: string, context: ContextFocus, history: ChatMessage[] }`
- Response: SSE stream of text chunks

---

## Error Handling

- **API Error**: Show error message in chat bubble with retry button
- **Rate Limited**: "Please wait a moment before sending another message"
- **Context Too Large**: Automatically summarize or truncate history
- **Offline**: "You're offline. Please check your connection."

---

## Responsive Behavior

**Desktop**: Side-by-side layout
**Tablet**: Context panel collapses to icon button that opens drawer
**Mobile**:
- Full-width chat
- Context panel as bottom sheet (swipe up)
- Quick questions as horizontal scroll above input

---

## Animations

1. **Message appear**: Slide up + fade in
2. **Typing indicator**: Three dots with staggered pulse
3. **Streaming text**: Fade in word by word
4. **Quick question click**: Brief scale down feedback
5. **Send button**: Pulse on send, checkmark on success
