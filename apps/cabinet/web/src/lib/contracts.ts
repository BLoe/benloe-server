/* ============================================================================
   CABINET v2 — API contracts. The FROZEN interface between the surfaces and
   the gateway. Movement 2 surfaces build against `CabinetApi` (mock now, real
   endpoints in A11); the shapes here do not change without a foundation bump.
   Self-contained on purpose so parallel agents need nothing else.
   ========================================================================== */

/* ---------- shared ---------- */
export type Severity = 'ok' | 'warn' | 'crit';
export type Tone = 'default' | 'ok' | 'warn' | 'crit';

/**
 * A data-driven instrument. Surfaces render these through one dispatcher so
 * every domain's vitals share the instrument family. Maps 1:1 onto A2's
 * components. `label` becomes the card cap; `tag` the corner tag.
 */
export type InstrumentSpec =
  | { kind: 'dial'; label: string; value: number; max: number; unit?: string; sub?: string; tag?: string; tagTone?: Severity }
  | { kind: 'rule'; label: string; readout: string; unit?: string; points?: number[]; markerPct?: number; tag?: string; tagTone?: Severity }
  | { kind: 'ring'; label: string; value: number; max: number; center?: string; sub?: string; tag?: string; tagTone?: Severity }
  | { kind: 'gauge'; label: string; value: number; max: number; threshold?: number; leftLabel?: string; rightLabel?: string; tag?: string; tagTone?: Severity }
  | { kind: 'stat'; label: string; big: string; unit?: string; sub?: string; tone?: Tone; points?: number[]; pointsColor?: string; tag?: string; tagTone?: Severity };

/* ---------- chats ---------- */
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-run'; toolId: string; name: string; input: unknown; output?: string; isError?: boolean; done: boolean; at?: string }
  | { type: 'notice'; level: 'info' | 'warn'; text: string }
  | { type: 'widget'; widgetType: string; data: unknown }
  | { type: 'approval'; packet: ApprovalPacket }
  /** A composer image attachment — `id` names the file behind GET /api/attachments/:id (never inlined here). Mirrors server/src/gateway/fold.ts's MessagePart 1:1 (hand-synced, see chat.ts). */
  | { type: 'image'; id: string; mediaType: string };

export interface ApprovalPacket {
  id: string; tier: number; action: string; payload: string; reasoning: string;
  confidence: number | null; reversibility: string | null; chatId: string | null; expiresAt: string;
}

export interface ChatSummary {
  id: string; title: string | null; model_override: string | null;
  archived: number; updated_at: string; messages: number;
  /** short preview / produced-artifact hint for the archive */
  preview?: string;
}
export interface ChatMessage { id: string; role: MessageRole; parts: MessagePart[]; created_at: string; author?: string | null; }

/* ---------- today ---------- */
export interface AttentionAction { label: string; intent: string; primary?: boolean; }
export interface AttentionItem {
  id: string; severity: Exclude<Severity, 'ok'>; badge?: string;
  title: string; meta?: string; detail: string; actions: AttentionAction[];
}
export interface OvernightNote { count: number; summary: string; }
/** The real morning-briefing narrative, durably read from sys-briefing — null when the job has never fired. */
export interface BriefingOutput { at: string; isCurrent: boolean; narrative: string; }
/** The real evening-checkin output, durably read from sys-checkin — null when the job has never fired. */
export interface CheckinOutput { at: string; isCurrent: boolean; vitals: InstrumentSpec[]; prompt: string; }
export interface TodayView {
  greeting: string;        // "Good morning, Ben." — the fallback/empty-state template, used only when briefing is null
  greetingAccent?: string; // italic brass clause, e.g. "A quiet day"
  read: string;            // the fallback template's supporting line
  attention: AttentionItem[];
  vitals: InstrumentSpec[];
  overnight: OvernightNote | null;
  sweptAt: string;         // ISO
  briefing: BriefingOutput | null;
  checkin: CheckinOutput | null;
}

/* ---------- domains ---------- */
export type DomainId = 'nutrition' | 'training' | 'health' | 'money' | 'admin' | 'people' | 'play';
export interface DomainMeta { id: DomainId; label: string; }
export const DOMAINS: DomainMeta[] = [
  { id: 'nutrition', label: 'Nutrition' },
  { id: 'training', label: 'Training' },
  { id: 'health', label: 'Health' },
  { id: 'money', label: 'Money' },
  { id: 'admin', label: 'Admin' },
  { id: 'people', label: 'People' },
  { id: 'play', label: 'Play' },
];
export interface LogEntry { id: string; at: string; text: string; meta?: string; }
export interface DomainView {
  id: DomainId; label: string;
  instruments: InstrumentSpec[];
  narrative: string;   // the agent's written read of this domain (Cabinet's voice)
  log: LogEntry[];
}

/* ---------- ops (the trust surface) ---------- */
export type OpsKind = 'user' | 'heartbeat' | 'cron';
export interface OpsEntry {
  id: string; at: string; tool: string; action: string; reason: string;
  kind: OpsKind; chatId: string | null;
  reversible: boolean; diff?: string;
  reverted?: boolean;
}
export interface OpsFeed { entries: OpsEntry[]; }

/* ---------- brain: memory + recall ---------- */
export interface MemoryFile { name: string; content: string; updatedAt: string | null; editable: boolean; }
export interface MemoryLesson { id: number; text: string; domain: string | null; confidence: number; }
export interface MemoryView { files: MemoryFile[]; lessons: MemoryLesson[]; }

export type RecallSource = 'fact' | 'episodic' | 'chat' | 'lesson' | 'document';
export interface RecallResult {
  source: RecallSource; title: string; snippet: string;
  provenance: string; score: number; ref: string;
}
export interface RecallResponse { query: string; results: RecallResult[]; }

/* ---------- credentials (the encrypted store every integration reads from) ----------
   Mirrors server/src/gateway/credentialRoutes.ts + domains/credentialCatalog.ts.

   The asymmetry below is the whole design, and it is deliberate: there is no
   field anywhere in these shapes that carries a secret VALUE, because the
   server has no route that can return one. A secret travels in exactly one
   direction — IN, through saveCredential's body — and everything that comes
   back is metadata. If a "value" or "reveal" field ever appears here, it is a
   bug in the server, not a feature to render. */

/** What the store will admit about a stored credential: that it exists, and when it was touched. */
export interface CredentialMeta {
  id: number;
  name: string;
  provider: string | null;
  description: string | null;
  /** All four are SQLite `datetime('now')` — naive UTC, no zone marker. Parse deliberately. */
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  rotated_at: string | null;
}

/**
 * A catalog entry joined to storage: a credential Cabinet knows how to use,
 * whether or not it has one yet. The page renders slots rather than a bare
 * key/value editor so Ben pastes into a named, described box instead of
 * having to guess that the slug must be exactly `plaid-client-id`.
 */
export interface CredentialSlot {
  name: string;
  /** Group heading — one integration's slots stay together. */
  group: string;
  label: string;
  description: string;
  /** Where the value comes from, verbatim: "Plaid Dashboard → Developers → Keys". */
  where: string;
  required: boolean;
  stored: boolean;
  meta: CredentialMeta | null;
}

/**
 * A process environment variable worth surfacing. Read-only by nature: these
 * are set outside the app and only a restart changes them.
 */
export interface EnvVarReport {
  name: string;
  label: string;
  description: string;
  /** Why it can't be edited here. Always present — "you can't" without "because" reads as a missing feature. */
  reason: string;
  set: boolean;
  /**
   * True when absence is a real problem. False means a working default applies, or the var belongs to an
   * optional integration Ben may never turn on — so an unset one is quiet, not a warning. A page that cries
   * wolf about a feature nobody uses teaches you to skip the one section that matters.
   */
  required: boolean;
  /** True when the var is deleted from process.env at boot and `set` came from the artifact it produced. */
  scrubbed: boolean;
  /** Non-null ONLY for vars the server marks as configuration rather than secret (e.g. PLAID_ENV). */
  value: string | null;
  /**
   * The `app_setting` key that now owns this value, or null. Non-null means the
   * variable is a LEGACY FALLBACK: a stored setting outranks it, so the line
   * still sitting in .env may not be the value actually in force. The row stays
   * listed precisely so that fact is discoverable from the .env side too — it
   * just must not be rendered as if it were authoritative.
   */
  supersededBy: string | null;
}

export interface CredentialsView {
  /** False when the server booted without CABINET_CRED_KEY: names still list, but nothing can be encrypted or read. */
  configured: boolean;
  /** Every stored credential, metadata only. `slots` is what the page renders; this is the raw list. */
  credentials: CredentialMeta[];
  slots: CredentialSlot[];
  /** Machine-managed (plaid-item-*) — listed, never editable by hand. */
  managed: CredentialMeta[];
  /** Stored but claimed by no slot. Visible rather than silently hidden. */
  unrecognised: CredentialMeta[];
  env: EnvVarReport[];
}

/** `created` distinguishes a first store from a rotation, so the UI can say which happened truthfully. */
export interface CredentialSaveResult { ok: boolean; created: boolean; credential: CredentialMeta }

/* ---------- settings (the editable, NON-secret half of the same page) ----------
   Mirrors server/src/domains/settings.ts + gateway/settingsRoutes.ts.

   The exact inverse of the credential shapes above: every field here is a
   plaintext value that is safe to print, echo and screenshot. That is the
   membership rule for the table, not an accident of the current contents — if a
   value ever needs hiding it is a credential, not a setting.

   Resolution order is DB row → environment variable → built-in default, and
   `source` reports which of the three won. Rendering that is the whole job: a
   settings page whose edit silently loses to an invisible env var is the worst
   bug this surface can have. */
export type SettingType = 'enum' | 'origin' | 'text';
export type SettingSource = 'db' | 'env' | 'default';

export interface SettingView {
  key: string;
  /** Group heading — shares the integration's name with the credential slots above it. */
  group: string;
  label: string;
  /** What it does, in outcome terms. Rendered under the control. */
  description: string;
  type: SettingType;
  /** Allowed values, for `enum` only. */
  options?: string[];
  /** Used when neither a stored row nor the environment supplies a value. */
  default: string;
  /** The legacy environment variable this setting outranks, when there is one. */
  envVar?: string;
  /** True when the process reads this once at boot, so a save isn't live yet. */
  restartRequired?: boolean;
  /** The value actually in force. */
  value: string;
  source: SettingSource;
  /** SQLite `datetime('now')` — naive UTC. Non-null only when `source` is 'db'. */
  updated_at: string | null;
  /** The environment's value, when the variable is set — whether or not it won. */
  env_value: string | null;
}

/* ---------- money (Plaid + the ledger it fills) ----------
   Mirrors server/src/domains/money.ts and server/src/gateway/plaidRoutes.ts.
   Two sign conventions travel with this data and both are load-bearing:
     · a transaction `amount` is POSITIVE when money LEFT the account;
     · `credit` and `loans` in NetWorth are POSITIVE meaning "owed", and
       net_worth is already cash + investments − credit − loans.
   Anything rendering these inverts them at its peril. */
export type PlaidEnvironment = 'sandbox' | 'production';
export type PlaidItemStatus = 'active' | 'login_required' | 'error' | 'revoked';

/** One linked institution. The unit that breaks, gets repaired, and gets unlinked. */
export interface PlaidItemSummary {
  id: number;
  institution: string | null;
  status: PlaidItemStatus;
  error_code: string | null;
  /** SQLite `datetime('now')` — naive UTC, no zone marker. Parse deliberately. */
  last_synced_at: string | null;
  consent_expiration_time: string | null;
}

export interface FinancialAccount {
  id: number;
  account_id: string;
  institution_name: string | null;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  limit_amount: number | null;
  balance_as_of: string | null;
  item_status: PlaidItemStatus;
  /** 0/1 — hidden accounts stay linked but drop out of every rollup. */
  hidden: number;
}

/**
 * `accounts_counted` vs `accounts_total` is not decoration: an account with no
 * current balance (a broken item, a fresh link mid-backfill) silently drops
 * out of the sum, and the result looks exactly like a real drop in net worth.
 * Every renderer of `net_worth` renders the ratio and `stalest_balance_at`
 * with it.
 */
export interface NetWorth {
  cash: number;
  /** Positive = owed. */
  credit: number;
  investments: number;
  /** Positive = owed. */
  loans: number;
  net_worth: number;
  accounts_counted: number;
  accounts_total: number;
  stalest_balance_at: string | null;
}

/**
 * Why Plaid isn't working, when it isn't. `configured: false` has two causes
 * with two completely different fixes — Ben hasn't pasted the keys, or the
 * secrets service is down — and collapsing them into one boolean is what would
 * make the setup panel tell him to re-paste credentials during an outage that
 * had nothing to do with them.
 *
 *   'ready'        — credentials are in the vault; calls will go through
 *   'unconfigured' — secrets service healthy, no keys stored yet (Ben's move)
 *   'unreachable'  — socket gone or unreadable; an ops fault, not a setup step
 *   'unknown'      — never successfully polled (cold start, clears in seconds)
 */
export type PlaidBrokerState = 'ready' | 'unconfigured' | 'unreachable' | 'unknown';

export interface PlaidStatus {
  /** False when Plaid cannot be called at all — a normal state, not an error. */
  configured: boolean;
  /** What the UI branches on. `configured` is `state === 'ready'`. */
  state: PlaidBrokerState;
  /** Populated for 'unreachable'. Names a system, never a secret. */
  detail: string | null;
  environment: PlaidEnvironment;
  /** Must be allow-listed in the Plaid dashboard for OAuth banks to come back. */
  redirect_uri: string;
  webhook_url: string;
  items: PlaidItemSummary[];
  accounts: FinancialAccount[];
  net_worth: NetWorth;
}

export interface LinkTokenResponse { link_token: string; environment: PlaidEnvironment; }
export interface ExchangeResponse {
  ok: boolean;
  item: { id: number; institution: string | null; status: PlaidItemStatus };
  syncing: boolean;
}

export interface SyncCounts { added: number; modified: number; removed: number; skipped: number; }
export interface SyncReport {
  item_id: number; institution: string | null; ok: boolean;
  accounts: number; transactions: SyncCounts; holdings: number;
  status?: string; error?: string;
}
/** `net_worth` only comes back from a sync-everything run (syncAll), not a single item. */
export interface SyncResponse { reports: SyncReport[]; net_worth?: NetWorth; }

export interface MoneyTransaction {
  transaction_id: string;
  /** YYYY-MM-DD, local to the account. */
  date: string;
  /** Positive = spent, negative = received. */
  amount: number;
  merchant: string | null;
  category_primary: string | null;
  category_detailed: string | null;
  account: string | null;
  mask: string | null;
  /** 0/1 — provisional; the amount and merchant can both still change. */
  pending: number;
}

/** `spent` is POSITIVE dollars out; the sign flip happens once, server-side. */
export interface CategorySpend { category: string; detailed_top: string | null; spent: number; txns: number; }

export interface Holding {
  ticker: string | null; security: string | null; type: string | null;
  quantity: number | null; price: number | null; value: number | null;
  cost_basis: number | null; account: string | null; institution: string | null;
}

export interface NetWorthSnapshot {
  local_day: string;
  cash: number; credit: number; investments: number; loans: number; net_worth: number;
  accounts_counted: number; accounts_total: number;
}
export interface SpendDay { local_day: string; spent: number; txns: number; }
export interface MoneyTrend { net_worth: NetWorthSnapshot[]; spend_by_day: SpendDay[]; }

export interface MoneySummary {
  linked_institutions: number;
  /** Items that are anything other than `active` — first-class, not a footnote. */
  needs_attention: { institution: string | null; status: PlaidItemStatus; error: string | null }[];
  last_synced_at: string | null;
  net_worth: NetWorth;
  window_days: number;
  total_spent: number;
  by_category: CategorySpend[];
  accounts: FinancialAccount[];
}

/* ---------- health / presence ---------- */
export type PresenceState = 'idle' | 'working' | 'thinking' | 'offline';
export interface HealthInfo { ok: boolean; authMode: string; presence: PresenceState; presenceMeta: string; }

/* ---------- usage (Ops surface: "why did we spike" / "are we near a wall") ---------- */
export interface UsageDay {
  day: string; model: string;
  input: number; output: number; cache_read: number; cache_write: number;
  cost_usd: number; turns: number;
}
export interface UsageView { authMode: string; byDay: UsageDay[]; }

export type UsageWindowId = '5h' | '24h' | '7d';
export interface UsageWindow {
  window: UsageWindowId;
  input: number; output: number; cache_read: number; cache_write: number;
  cost_usd: number; turns: number;
  /** cache_read / cache_write, rounded to 2dp. null when there's been no write to divide by yet. */
  cacheReadWriteRatio: number | null;
}
export interface UsageRollingView { authMode: string; windows: UsageWindow[]; }

/* ---------- latency (Ops surface: "was that turn slow") ----------
   Mirrors runtime/perf.ts, which was cut back on 2026-08-11 from a per-phase
   span table (~39 rows a turn, 15k rows in ten days, read by nobody) to one
   row per turn. The per-phase breakdown was the right tool for the
   investigation that prompted it and the wrong thing to keep forever; what
   survives is the four numbers that say whether a turn was slow and roughly
   where it went. All times are milliseconds. */
export interface PerfSpread { p50: number; p95: number; max: number; }
export interface PerfTurnSummary {
  turnId: string;
  chatId: string | null;
  sessionKind: string | null;
  model: string | null;
  startedAt: string;
  totalMs: number | null;
  ttfTextMs: number | null;
  steps: number;
  toolCalls: number;
}
export interface PerfView {
  enabled: boolean;
  window: string;
  turns: number;
  totalMs: PerfSpread | null;
  ttfTextMs: PerfSpread | null;
  avgSteps: number;
  avgToolCalls: number;
  recent: PerfTurnSummary[];
}

/* ============================================================================
   The single interface both the mock and the real (fetch) client implement.
   Surfaces depend ONLY on this.
   ========================================================================== */
export interface CabinetApi {
  health(): Promise<HealthInfo>;
  today(): Promise<TodayView>;
  domain(id: DomainId): Promise<DomainView>;
  ops(filter?: { kind?: OpsKind; domain?: string }): Promise<OpsFeed>;
  revertOp(id: string): Promise<{ ok: boolean }>;
  usage(): Promise<UsageView>;
  usageRolling(): Promise<UsageRollingView>;
  perf(hours?: number): Promise<PerfView>;
  memory(): Promise<MemoryView>;
  saveMemoryFile(name: string, content: string): Promise<{ ok: boolean }>;
  recall(query: string): Promise<RecallResponse>;
  chats(): Promise<{ chats: ChatSummary[] }>;
  createChat(): Promise<{ id: string }>;
  deleteChat(chatId: string): Promise<{ ok: boolean }>;
  /** `live` — a turn is executing on this chat server-side right now
   *  (reattach-on-load; optional so the mock backend can ignore it). */
  messages(chatId: string): Promise<{ messages: ChatMessage[]; live?: boolean }>;
  command(intent: string): Promise<{ chatId: string }>;

  /* ---- credentials: metadata out, secrets only ever in ---- */
  credentials(): Promise<CredentialsView>;
  /** The one call that carries a plaintext secret. Nothing it returns contains one. */
  saveCredential(input: { name: string; secret: string; provider?: string | null; description?: string | null }): Promise<CredentialSaveResult>;
  /** Works even with no encryption key loaded — dropping ciphertext you can't read is still a complete delete. */
  deleteCredential(name: string): Promise<{ ok: boolean; deleted: string }>;

  /* ---- settings: plaintext both ways, and echoed back normalised ---- */
  settings(): Promise<{ settings: SettingView[] }>;
  /** Returns the RESOLVED view, not the submitted string — the server normalises. Render what comes back. */
  saveSetting(key: string, value: string): Promise<{ setting: SettingView }>;
  /**
   * Stop overriding: drops the stored row so the value falls back to the
   * environment variable or the built-in default. Deliberately not the same
   * operation as saving the old value back, which would leave a row that keeps
   * outranking a future .env change forever.
   */
  revertSetting(key: string): Promise<{ setting: SettingView }>;

  /* ---- money: the Plaid connection itself ---- */
  plaidStatus(): Promise<PlaidStatus>;
  /** With `itemId`, Link opens in UPDATE mode to repair that connection instead of adding a second one. */
  plaidLinkToken(itemId?: number): Promise<LinkTokenResponse>;
  plaidExchange(publicToken: string): Promise<ExchangeResponse>;
  /** With `itemId`, one institution; otherwise all of them. */
  plaidSync(itemId?: number): Promise<SyncResponse>;
  plaidUnlinkItem(itemId: number): Promise<{ ok: boolean; deleted: number }>;
  plaidSetAccountHidden(accountId: number, hidden: boolean): Promise<{ ok: boolean; id: number; hidden: boolean }>;

  /* ---- money: the ledger Plaid fills ---- */
  moneySummary(days?: number): Promise<MoneySummary>;
  moneyTransactions(opts?: { days?: number; limit?: number }): Promise<{ transactions: MoneyTransaction[] }>;
  moneyTrend(days?: number): Promise<MoneyTrend>;
  moneyCategories(days?: number): Promise<{ categories: CategorySpend[] }>;
  moneyHoldings(): Promise<{ holdings: Holding[] }>;
}
