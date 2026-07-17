import type {
  CabinetApi, TodayView, DomainId, DomainView, OpsFeed, OpsKind, MemoryView, RecallResponse, HealthInfo, ChatSummary, ChatMessage,
  UsageView, UsageRollingView,
} from './contracts.js';

/* The real client: fetches the gateway endpoints the contracts define. The
   server side lands in A5 (stubs) → A11 (real). Surfaces never see this
   directly — they depend on CabinetApi. */

class AuthRequiredError extends Error { constructor() { super('auth required'); } }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { Accept: 'application/json' } });
  if (r.status === 401) throw new AuthRequiredError();
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}
async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) throw new AuthRequiredError();
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const fetchApi: CabinetApi = {
  health: () => get<HealthInfo>('/api/healthz'),
  today: () => get<TodayView>('/api/today'),
  domain: (id: DomainId) => get<DomainView>(`/api/domains/${id}`),
  ops: (filter?: { kind?: OpsKind; domain?: string }) => get<OpsFeed>(`/api/ops${qs({ kind: filter?.kind, domain: filter?.domain })}`),
  revertOp: (id: string) => send<{ ok: boolean }>(`/api/ops/${id}/revert`, 'POST'),
  usage: () => get<UsageView>('/api/usage'),
  usageRolling: () => get<UsageRollingView>('/api/usage/rolling'),
  memory: () => get<MemoryView>('/api/memory'),
  saveMemoryFile: (name: string, content: string) => send<{ ok: boolean }>(`/api/memory/${encodeURIComponent(name)}`, 'PUT', { content }),
  recall: (query: string) => get<RecallResponse>(`/api/recall${qs({ q: query })}`),
  chats: () => get<{ chats: ChatSummary[] }>('/api/chats'),
  createChat: () => send<{ id: string }>('/api/chats', 'POST', {}),
  deleteChat: (chatId: string) => send<{ ok: boolean }>(`/api/chats/${chatId}`, 'DELETE'),
  messages: (chatId: string) => get<{ messages: ChatMessage[] }>(`/api/chats/${chatId}/messages`),
  command: (intent: string) => send<{ chatId: string }>('/api/command', 'POST', { intent }),
};

export { AuthRequiredError };
