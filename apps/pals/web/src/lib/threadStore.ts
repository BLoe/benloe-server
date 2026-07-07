import { foldEvent, type MessagePart, type SseEvent } from './protocol.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  streaming?: boolean;
  createdAt?: string;
}

export interface ThreadState {
  messages: ChatMessage[];
  status: 'idle' | 'streaming' | 'error';
  error?: string;
  model?: string;
}

export const emptyThread = (): ThreadState => ({ messages: [], status: 'idle' });

export function loadHistory(state: ThreadState, rows: { id: string; role: string; parts: MessagePart[]; created_at: string }[]): ThreadState {
  return {
    ...state,
    messages: rows.map((r) => ({ id: r.id, role: r.role as ChatMessage['role'], parts: r.parts, createdAt: r.created_at })),
  };
}

export function addUserMessage(state: ThreadState, text: string, optimisticId: string): ThreadState {
  return {
    ...state,
    status: 'streaming',
    error: undefined,
    messages: [...state.messages, { id: optimisticId, role: 'user', parts: [{ type: 'text', text }] }],
  };
}

/**
 * Apply one wire event to the thread. Pure — the React hook is a thin shell
 * around this, and the test suite drives it with recorded streams.
 */
export function applyEvent(state: ThreadState, e: SseEvent): ThreadState {
  const data = e.data as Record<string, unknown>;
  switch (e.event) {
    case 'turn-start': {
      const msg: ChatMessage = { id: String(data.messageId), role: 'assistant', parts: [], streaming: true };
      return { ...state, status: 'streaming', model: String(data.model), messages: [...state.messages, msg] };
    }
    case 'turn-end': {
      const messages = state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
      return { ...state, status: 'idle', messages };
    }
    case 'error': {
      const messages = state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
      return { ...state, status: 'error', error: String(data.message ?? 'stream error'), messages };
    }
    default: {
      // Part-bearing events fold into the streaming assistant message.
      const idx = state.messages.findLastIndex((m) => m.streaming);
      if (idx === -1) return state;
      const target = state.messages[idx]!;
      const parts = target.parts.map((p) => ({ ...p })); // fold mutates; copy first
      foldEvent(parts, data as never);
      const messages = [...state.messages];
      messages[idx] = { ...target, parts };
      return { ...state, messages };
    }
  }
}
