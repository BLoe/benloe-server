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

/* ---------- threads ---------- */
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-run'; toolId: string; name: string; input: unknown; output?: string; isError?: boolean; done: boolean }
  | { type: 'notice'; level: 'info' | 'warn'; text: string }
  | { type: 'widget'; widgetType: string; data: unknown }
  | { type: 'approval'; packet: ApprovalPacket };

export interface ApprovalPacket {
  id: string; tier: number; action: string; payload: string; reasoning: string;
  confidence: number | null; reversibility: string | null; threadId: string | null; expiresAt: string;
}

export interface ThreadSummary {
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
export interface TodayView {
  greeting: string;        // "Good morning, Ben."
  greetingAccent?: string; // italic brass clause, e.g. "A quiet day"
  read: string;            // the voice — the agent's read of the day
  attention: AttentionItem[];
  vitals: InstrumentSpec[];
  overnight: OvernightNote | null;
  sweptAt: string;         // ISO
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
  tier: number; kind: OpsKind; result: string; threadId: string | null;
  reversible: boolean; diff?: string;
  reverted?: boolean;
}
export interface OpsFeed { entries: OpsEntry[]; }

/* ---------- brain: memory + recall ---------- */
export interface MemoryFile { name: string; content: string; updatedAt: string | null; editable: boolean; }
export interface MemoryLesson { id: number; text: string; domain: string | null; confidence: number; }
export interface MemoryView { files: MemoryFile[]; lessons: MemoryLesson[]; }

export type RecallSource = 'fact' | 'episodic' | 'thread' | 'lesson' | 'document';
export interface RecallResult {
  source: RecallSource; title: string; snippet: string;
  provenance: string; score: number; ref: string;
}
export interface RecallResponse { query: string; results: RecallResult[]; }

/* ---------- health / presence ---------- */
export type PresenceState = 'idle' | 'working' | 'thinking' | 'offline';
export interface HealthInfo { ok: boolean; authMode: string; presence: PresenceState; presenceMeta: string; }

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
  memory(): Promise<MemoryView>;
  saveMemoryFile(name: string, content: string): Promise<{ ok: boolean }>;
  recall(query: string): Promise<RecallResponse>;
  threads(): Promise<{ threads: ThreadSummary[] }>;
  createThread(): Promise<{ id: string }>;
  messages(threadId: string): Promise<{ messages: ChatMessage[] }>;
  command(intent: string): Promise<{ threadId: string }>;
}
