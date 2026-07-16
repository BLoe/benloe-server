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
  tier: number; kind: OpsKind; result: string; chatId: string | null;
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
  memory(): Promise<MemoryView>;
  saveMemoryFile(name: string, content: string): Promise<{ ok: boolean }>;
  recall(query: string): Promise<RecallResponse>;
  chats(): Promise<{ chats: ChatSummary[] }>;
  createChat(): Promise<{ id: string }>;
  /** `live` — a turn is executing on this chat server-side right now
   *  (reattach-on-load; optional so the mock backend can ignore it). */
  messages(chatId: string): Promise<{ messages: ChatMessage[]; live?: boolean }>;
  command(intent: string): Promise<{ chatId: string }>;
}
