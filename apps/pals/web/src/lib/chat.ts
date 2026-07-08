/* Live conversation client: POST /api/chat and stream Cabinet's turn back as
   Server-Sent Events, folding the events into renderable message parts. Reuses
   the gateway's own SSE parser (both ends of the wire agree by construction). */
import { createSseParser } from '../../../server/src/gateway/sse.js';
import { AuthRequiredError } from './client.js';
import { usingMock } from './cabinet.js';
import type { MessagePart, ApprovalPacket } from './contracts.js';

/** The turn events the gateway emits (mirrors the server's TurnEvent). */
export type TurnEvent =
  | { type: 'turn-start'; messageId: string; threadId: string; model: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; toolId: string; name: string; input: unknown }
  | { type: 'tool-end'; toolId: string; output: string; isError: boolean }
  | { type: 'widget'; widgetType: string; data: unknown }
  | { type: 'notice'; level: 'info' | 'warn'; text: string }
  | { type: 'approval'; packet: ApprovalPacket }
  | { type: 'turn-end'; usage: unknown; sessionId: string | null; stopReason: string }
  | { type: 'error'; message: string; retryable?: boolean };

/** POST a message and pump the streamed turn into `onEvent`. */
export async function streamChat(
  threadId: string,
  text: string,
  onEvent: (e: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (usingMock) return mockStream(text, onEvent);
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, text }),
    signal,
  });
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
  const parse = createSseParser((e) => onEvent(e.data as TurnEvent));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parse(dec.decode(value, { stream: true }));
  }
}

/** Dev-only: a simulated streamed reply so the UI works without a backend. */
async function mockStream(text: string, onEvent: (e: TurnEvent) => void): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  onEvent({ type: 'turn-start', messageId: 'mock', threadId: 'mock', model: 'claude-sonnet-5' });
  const reply = `Noted — "${text.slice(0, 80)}". This is a simulated reply; the real Cabinet answers live when the app is deployed against the gateway.`;
  for (const chunk of reply.match(/.{1,6}/g) ?? []) {
    await sleep(24);
    onEvent({ type: 'text-delta', delta: chunk });
  }
  onEvent({ type: 'turn-end', usage: null, sessionId: 'mock', stopReason: 'success' });
}

/** Fold a turn event into the growing assistant message (mutates `parts`). */
export function foldTurn(parts: MessagePart[], e: TurnEvent): void {
  switch (e.type) {
    case 'text-delta': {
      const last = parts[parts.length - 1];
      if (last?.type === 'text') last.text += e.delta;
      else parts.push({ type: 'text', text: e.delta });
      break;
    }
    case 'tool-start':
      parts.push({ type: 'tool-run', toolId: e.toolId, name: e.name, input: e.input, done: false });
      break;
    case 'tool-end': {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        if (p.type === 'tool-run' && p.toolId === e.toolId) {
          p.output = e.output;
          p.isError = e.isError;
          p.done = true;
          break;
        }
      }
      break;
    }
    case 'notice':
      parts.push({ type: 'notice', level: e.level, text: e.text });
      break;
    case 'widget':
      parts.push({ type: 'widget', widgetType: e.widgetType, data: e.data });
      break;
    case 'approval':
      parts.push({ type: 'approval', packet: e.packet });
      break;
    default:
      break;
  }
}
