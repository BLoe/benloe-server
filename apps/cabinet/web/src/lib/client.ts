import type {
  CabinetApi, TodayView, DomainId, DomainView, OpsFeed, OpsKind, MemoryView, RecallResponse, HealthInfo, ChatSummary, ChatMessage,
  UsageView, UsageRollingView, PerfView,
  PlaidStatus, LinkTokenResponse, ExchangeResponse, SyncResponse, MoneySummary, MoneyTransaction, MoneyTrend, CategorySpend, Holding,
  CredentialsView, CredentialSaveResult,
} from './contracts.js';

/* The real client: fetches the gateway endpoints the contracts define. The
   server side lands in A5 (stubs) → A11 (real). Surfaces never see this
   directly — they depend on CabinetApi. */

class AuthRequiredError extends Error { constructor() { super('auth required'); } }

/**
 * A non-2xx response, carrying the parts of the body a surface can actually
 * act on. Plaid's failures are the reason this exists: a 503 means "no keys
 * stored yet" (a setup state, not a fault) and a 502 with `needs_relink`
 * means "this bank wants Ben to log in again" — both are things the Money
 * surface renders differently, and neither survives being flattened into a
 * message string. `message` still reads sensibly for every older caller that
 * only ever looks at `e.message`.
 */
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly needsRelink = false,
    readonly configured: boolean | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fail(r: Response): Promise<never> {
  const text = await r.text();
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    /* not JSON — fall through to the raw text below */
  }
  const message = typeof body?.error === 'string' && body.error ? body.error : `${r.status} ${text}`;
  throw new ApiError(
    r.status,
    message,
    typeof body?.error_code === 'string' ? body.error_code : null,
    body?.needs_relink === true,
    typeof body?.configured === 'boolean' ? body.configured : null,
  );
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { Accept: 'application/json' } });
  if (r.status === 401) throw new AuthRequiredError();
  if (!r.ok) await fail(r);
  return r.json() as Promise<T>;
}
async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) throw new AuthRequiredError();
  if (!r.ok) await fail(r);
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
  perf: (hours?: number) => get<PerfView>(`/api/perf${qs({ hours: hours ? String(hours) : undefined })}`),
  memory: () => get<MemoryView>('/api/memory'),
  saveMemoryFile: (name: string, content: string) => send<{ ok: boolean }>(`/api/memory/${encodeURIComponent(name)}`, 'PUT', { content }),
  recall: (query: string) => get<RecallResponse>(`/api/recall${qs({ q: query })}`),
  chats: () => get<{ chats: ChatSummary[] }>('/api/chats'),
  createChat: () => send<{ id: string }>('/api/chats', 'POST', {}),
  deleteChat: (chatId: string) => send<{ ok: boolean }>(`/api/chats/${chatId}`, 'DELETE'),
  messages: (chatId: string) => get<{ messages: ChatMessage[] }>(`/api/chats/${chatId}/messages`),
  command: (intent: string) => send<{ chatId: string }>('/api/command', 'POST', { intent }),

  // The POST body is the only place a plaintext secret exists on the wire, and
  // it is never echoed: the response is metadata, and a non-2xx becomes an
  // ApiError built from the server's `error` field alone. Nothing here logs.
  credentials: () => get<CredentialsView>('/api/credentials'),
  saveCredential: (input) => send<CredentialSaveResult>('/api/credentials', 'POST', input),
  deleteCredential: (name) => send<{ ok: boolean; deleted: string }>(`/api/credentials/${encodeURIComponent(name)}`, 'DELETE'),

  plaidStatus: () => get<PlaidStatus>('/api/plaid/status'),
  // The server reads item_id off the body and ignores anything non-positive,
  // so an omitted item_id is exactly "open Link in create mode".
  plaidLinkToken: (itemId?: number) =>
    send<LinkTokenResponse>('/api/plaid/link-token', 'POST', itemId ? { item_id: itemId } : {}),
  plaidExchange: (publicToken: string) =>
    send<ExchangeResponse>('/api/plaid/exchange', 'POST', { public_token: publicToken }),
  plaidSync: (itemId?: number) => send<SyncResponse>('/api/plaid/sync', 'POST', itemId ? { item_id: itemId } : {}),
  plaidUnlinkItem: (itemId: number) => send<{ ok: boolean; deleted: number }>(`/api/plaid/items/${itemId}`, 'DELETE'),
  plaidSetAccountHidden: (accountId: number, hidden: boolean) =>
    send<{ ok: boolean; id: number; hidden: boolean }>(`/api/plaid/accounts/${accountId}`, 'PATCH', { hidden }),

  moneySummary: (days?: number) => get<MoneySummary>(`/api/money/summary${qs({ days: days ? String(days) : undefined })}`),
  moneyTransactions: (opts?: { days?: number; limit?: number }) =>
    get<{ transactions: MoneyTransaction[] }>(
      `/api/money/transactions${qs({ days: opts?.days ? String(opts.days) : undefined, limit: opts?.limit ? String(opts.limit) : undefined })}`,
    ),
  moneyTrend: (days?: number) => get<MoneyTrend>(`/api/money/trend${qs({ days: days ? String(days) : undefined })}`),
  moneyCategories: (days?: number) =>
    get<{ categories: CategorySpend[] }>(`/api/money/categories${qs({ days: days ? String(days) : undefined })}`),
  moneyHoldings: () => get<{ holdings: Holding[] }>('/api/money/holdings'),
};

export { ApiError, AuthRequiredError };
