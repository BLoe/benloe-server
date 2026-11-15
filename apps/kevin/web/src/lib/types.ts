// Shapes the server sends. Source of truth: server/src/bus.ts, threads.ts
// (getThread) and core/index.ts (the system views).

export type UiItem =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown; state: 'running' | 'ok' | 'error' | 'denied'; preview?: string; ms?: number };
export type ToolItem = Extract<UiItem, { type: 'tool' }>;

export interface UserUi {
  text: string;
  attachments?: { id: number; filename: string; mime: string }[];
  page?: string | null;
}

export type BusEvent =
  | { type: 'turn_start'; threadId: string; turnId: number; user: UserUi }
  | { type: 'text_delta'; threadId: string; turnId: number; text: string }
  | { type: 'status_delta'; threadId: string; turnId: number; text: string }
  | { type: 'block_stop'; threadId: string; turnId: number }
  | { type: 'tool'; threadId: string; turnId: number; item: ToolItem }
  | { type: 'confirm_request'; threadId: string; turnId: number; confirmId: string; tool: string; summary: string }
  | { type: 'confirm_resolved'; threadId: string; confirmId: string; approved: boolean }
  | { type: 'user_folded'; threadId: string; turnId: number; text: string }
  | { type: 'turn_end'; threadId: string; turnId: number; status: string; costUsd: number; error?: string }
  | { type: 'thread_updated'; threadId: string; title?: string }
  | { type: 'data_changed'; domains: string[] }
  | { type: 'notification'; id: number; title: string; body: string; at: string; link: string | null; source: string | null };

/** What the app's listeners receive: the server's events plus one of its own. */
export type AppEvent = BusEvent | { type: 'reconnected' };

export interface ThreadSummary {
  id: string;
  title: string;
  origin: string;
  created_at: string;
  updated_at: string;
  archived: number;
  running: boolean;
}

export interface TurnPayload {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: string;
  model: string | null;
  error: string | null;
  cost_usd: number;
  user: UserUi;
  items: UiItem[];
}

export interface ThreadPayload extends ThreadSummary {
  turns: TurnPayload[];
  /** Confirm requests still waiting on Ben. */
  confirms?: { confirmId: string; summary: string; turnId: number }[];
}

export interface Me {
  email: string;
  timezone: string;
  vapidPublicKey: string;
  models: Record<string, string>;
}

export interface Upload {
  id: number;
  filename: string;
  mime: string;
  kind: 'image' | 'pdf' | 'text' | 'other';
  size: number;
  extract_status: string;
  extracted_preview: string | null;
}

export interface DomainInfo {
  name: string;
  views: string[];
  tools: string[];
}

export interface HomeCard {
  title: string;
  lines: string[];
  link?: string;
}

export type TriggerType = 'once' | 'cron' | 'interval';
export type ScheduleAction = 'notify' | 'check' | 'agent_turn';

export interface Schedule {
  id: number;
  name: string;
  trigger_type: TriggerType;
  trigger_value: string;
  action: ScheduleAction;
  payload: { title?: string; body?: string; link?: string; sql?: string; prompt?: string; deep?: boolean; thread_id?: string };
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  created_by: string;
  spend_cap_usd?: number;
  spent_this_month_usd?: number;
}

export type Outcome = 'did-work' | 'nothing-to-do' | 'errored';

export interface RunSummary {
  started_at: string;
  outcome: Outcome | null;
  detail: string | null;
}

export interface SystemJob {
  job_key: string;
  name: string;
  description: string;
  cadence: string;
  paused: boolean;
  last_run: RunSummary | null;
  last_work: RunSummary | null;
}

export interface JobRun {
  id: number;
  job_key: string;
  started_at: string;
  ended_at: string | null;
  outcome: Outcome | null;
  detail: string | null;
  cost_usd: number | null;
  schedule_name: string | null;
}

export interface NotificationRow {
  id: number;
  at: string;
  title: string;
  body: string;
  link: string | null;
  source: string | null;
  read_at: string | null;
}

export interface NotificationsView {
  unread: number;
  items: NotificationRow[];
}

export interface Agenda {
  today: string;
  upcoming: Schedule[];
}

export interface Fact {
  id: number;
  text: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface SpendView {
  monthUsd: number;
  capUsd: number;
  remainingUsd: number;
  blocked: boolean;
  month_start: string;
  by_purpose: { purpose: string; requests: number; cost_usd: number }[];
  by_model: { model: string; requests: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number }[];
  by_day: { day: string; cost_usd: number }[];
  recent_turns: { id: number; thread_id: string; title: string; started_at: string; model: string; status: string; cost_usd: number }[];
}

export interface MemoryHit {
  kind: string;
  ref: string;
  title: string;
  snippet: string;
  at: string | null;
}

export interface MemoryLogRow {
  id: number;
  at: string;
  day: string;
  kind: string;
  thread_id: string | null;
  text: string;
}

export interface AuditRow {
  id: number;
  at: string;
  source: string;
  thread_id: string | null;
  tool: string;
  input: string;
  ok: number;
  result: string;
  ms: number;
}

export interface Health {
  runner_last_tick: string | null;
  last_backup: RunSummary | null;
  offsite_backup: boolean;
  embeddings: boolean;
  push_devices: number;
  models: Record<string, string>;
}
