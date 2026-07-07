import { createSseParser, type SseEvent } from './protocol.js';

export interface ThreadSummary {
  id: string;
  title: string | null;
  model_override: string | null;
  archived: number;
  updated_at: string;
  messages: number;
}

const json = async <T>(r: Response): Promise<T> => {
  if (r.status === 401) throw new AuthRequiredError();
  if (r.status === 403) throw new Error('This account is not authorized for PALS.');
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
};

export class AuthRequiredError extends Error {
  constructor() {
    super('auth required');
  }
}

export const api = {
  threads: () => fetch('/api/threads').then((r) => json<{ threads: ThreadSummary[] }>(r)),
  createThread: (title?: string) =>
    fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }).then(
      (r) => json<{ id: string }>(r),
    ),
  patchThread: (id: string, patch: Record<string, unknown>) =>
    fetch(`/api/threads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(json),
  messages: (id: string) => fetch(`/api/threads/${id}/messages`).then((r) => json<{ messages: never[] }>(r)),
  approvals: () => fetch('/api/approvals').then((r) => json<{ approvals: ApprovalPacket[] }>(r)),
  decide: (id: string, approved: boolean, message?: string) =>
    fetch(`/api/approvals/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, message }),
    }).then(json),
  interrupt: (threadId: string) =>
    fetch('/api/interrupt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId }) }).then(json),
  usage: () => fetch('/api/usage').then((r) => json<{ authMode: string; byDay: UsageRow[] }>(r)),
  health: () => fetch('/api/healthz').then((r) => json<HealthInfo>(r)),
};

export interface ApprovalPacket {
  id: string;
  tier: number;
  action: string;
  payload: string;
  reasoning: string;
  confidence: number | null;
  reversibility: string | null;
  threadId: string | null;
  expiresAt: string;
}

export interface UsageRow {
  day: string;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cost_usd: number;
  turns: number;
}

export interface HealthInfo {
  ok: boolean;
  db: boolean;
  authMode: string;
  embedder: boolean | null;
  queueDepth: number;
  pendingApprovals: number;
}

/** POST /api/chat and pump the SSE turn stream into onEvent. */
export async function streamChat(
  threadId: string,
  text: string,
  onEvent: (e: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, text }),
    signal,
  });
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
  const parse = createSseParser(onEvent);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parse(dec.decode(value, { stream: true }));
  }
}

/**
 * Long-lived /api/events subscription with Last-Event-ID reconnection.
 * Hand-rolled on fetch (EventSource can't send our auth cookie options or
 * custom reconnect policy the way we want on iOS standalone PWAs).
 */
export function subscribeEvents(onEvent: (e: SseEvent) => void): () => void {
  let lastId: string | undefined;
  let stopped = false;
  let ac = new AbortController();

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        const res = await fetch('/api/events', {
          headers: lastId ? { 'Last-Event-ID': lastId } : {},
          signal: ac.signal,
        });
        if (res.status === 401) throw new AuthRequiredError();
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const parse = createSseParser((e) => {
          if (e.id) lastId = e.id;
          onEvent(e);
        });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parse(dec.decode(value, { stream: true }));
        }
      } catch (err) {
        if (stopped || err instanceof AuthRequiredError) return;
      }
      await new Promise((r) => setTimeout(r, 3000)); // reconnect backoff
    }
  };
  void connect();

  return () => {
    stopped = true;
    ac.abort();
  };
}

/** artanis login redirect helper: send them to auth with a return url. */
export function redirectToLogin(): void {
  window.location.href = `https://auth.benloe.com/?redirect=${encodeURIComponent(window.location.href)}`;
}
