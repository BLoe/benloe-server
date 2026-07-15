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

/** POST a message (with optional composer image attachments) and pump the streamed turn into `onEvent`. */
export async function streamChat(
  threadId: string,
  message: { text: string; attachments?: { id: string }[] },
  onEvent: (e: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (usingMock) return mockStream(message.text, onEvent, message.attachments?.length ?? 0);
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, text: message.text, attachments: message.attachments }),
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

/**
 * Stop the in-flight turn for a thread — a real cancel, not just dropping
 * this tab's connection: it POSTs /api/interrupt, which aborts the SDK
 * query server-side (AgentRuntime.interrupt), so the agent loop actually
 * stops running rather than continuing unseen after the tab disconnects.
 * Whatever already streamed stays (live-persist already saved it). No-op in
 * mock mode — there's no server-side turn to abort.
 */
export async function interruptChat(threadId: string): Promise<boolean> {
  if (usingMock) return true;
  const res = await fetch('/api/interrupt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId }),
  });
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok) return false;
  const body = (await res.json().catch(() => ({}))) as { interrupted?: boolean };
  return body.interrupted ?? false;
}

/**
 * Upload one composer image (paste/drop/attach) before referencing its id in
 * streamChat — mirrors gateway/attachments.ts's server-side save. Mock mode
 * has no backend to hit, so it hands back a synthetic id; the mock chat
 * stream doesn't attempt to render it (dev-only rough edge, not a shipped path).
 */
export async function uploadAttachment(file: File): Promise<{ id: string; mediaType: string }> {
  const dataBase64 = await fileToBase64(file);
  if (usingMock) return { id: `mock-${dataBase64.length}-${file.name}`, mediaType: file.type };
  const res = await fetch('/api/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType: file.type, dataBase64 }),
  });
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `attachment upload failed: ${res.status}`);
  }
  return res.json();
}

/** data: URL → bare base64 payload (strips the `data:<mime>;base64,` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Dev-only: a simulated streamed reply so the UI works without a backend. */
async function mockStream(text: string, onEvent: (e: TurnEvent) => void, attachmentCount = 0): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  onEvent({ type: 'turn-start', messageId: 'mock', threadId: 'mock', model: 'claude-sonnet-5' });
  const imageNote = attachmentCount > 0 ? ` (with ${attachmentCount} image${attachmentCount === 1 ? '' : 's'} attached)` : '';
  const reply = `Noted — "${text.slice(0, 80)}"${imageNote}. This is a simulated reply; the real Cabinet answers live when the app is deployed against the gateway.`;
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
