import type Database from 'better-sqlite3';

/**
 * Turn-latency instrumentation.
 *
 * Written 2026-08-01 to answer "Cabinet feels slow and nothing can say why",
 * as a span recorder: one row per named interval, ~39 rows a turn. It answered
 * the question, the answer was acted on, and then it kept writing — 15,118
 * rows over ten days, the largest table in the database, read by nobody.
 *
 * Cut back 2026-08-11 to one row per turn. The per-phase breakdown is what you
 * want while investigating a specific slow turn; it is not worth keeping
 * permanently for every turn. What survives is the four numbers that answer
 * "was that turn slow, and roughly where did it go":
 *
 *   total_ms · ttf_text_ms · steps · tool_calls
 *
 * The recorder's API is unchanged on purpose — call sites still say
 * perf.start('step') and perf.time('recall', ...). Those calls now feed
 * counters instead of appending rows, so the instrumentation vocabulary stays
 * available for ad-hoc work without any of it reaching the database.
 *
 * Design constraints, unchanged:
 * - Never slow down or break the thing it measures. Nothing touches the DB
 *   until flush(), and flush() swallows its own errors.
 * - performance.now(), not Date.now(): monotonic, unaffected by clock steps.
 * - Zero-cost when disabled (CABINET_PERF=off) — the recorder becomes a set of
 *   no-ops rather than a conditional at every call site.
 */

/**
 * Open vocabulary. Only the four phases marked PERSISTED reach the database;
 * the rest are still timeable and still useful in an ad-hoc session, they just
 * do not accumulate rows forever.
 */
export type PerfPhase =
  /** POST /api/chat entry → response finished. */
  | 'request_total'
  /** Time the turn sat in TurnQueue behind another turn. */
  | 'queue_wait'
  /** Episodic lesson recall (embedding + vector search) before the turn. */
  | 'recall'
  /** profileGap()'s COUNT queries + memory file reads. */
  | 'profile_gap'
  /** assemblePrompt(): memory file reads + string assembly. */
  | 'prompt_assemble'
  /** query() called → first system/init message: CLI subprocess spawn + MCP
   *  handshake, paid on every turn. */
  | 'sdk_spawn'
  /** init → first thinking delta. */
  | 'ttf_thinking'
  /** PERSISTED. init → first visible text delta. What "it's alive" looks like. */
  | 'ttf_text'
  /** init → first tool_use block. */
  | 'ttf_tool'
  /** PERSISTED (counted). One assistant message = one API round trip. */
  | 'step'
  /** PERSISTED (counted). tool_use emitted → matching tool_result observed. */
  | 'tool'
  /** PreToolUse hook body. */
  | 'hook_pre'
  /** PostToolUse hook body (includes truncation work). */
  | 'hook_post'
  /** PERSISTED. Whole agent turn, spawn through result. */
  | 'turn_total';

/** One row of perf_turn. */
export interface PerfTurnRow {
  turnId: string;
  chatId: string | null;
  sessionKind: string | null;
  model: string | null;
  totalMs: number | null;
  ttfTextMs: number | null;
  steps: number;
  toolCalls: number;
  startedAt: string;
}

export interface PerfRecorder {
  /** Record a completed interval directly (when you already have the ms). */
  mark(phase: PerfPhase | string, ms: number, opts?: { label?: string; meta?: Record<string, unknown> }): void;
  /** Start a span; the returned function ends it. Calling it twice is a no-op. */
  start(phase: PerfPhase | string, opts?: { label?: string }): (meta?: Record<string, unknown>) => void;
  /** Time a promise, recording the span whether it resolves or rejects. */
  time<T>(phase: PerfPhase | string, fn: () => Promise<T>, opts?: { label?: string }): Promise<T>;
  /** Fill in fields not known when the recorder was created (model, kind). */
  describe(fields: Partial<Pick<PerfTurnRow, 'chatId' | 'sessionKind' | 'model'>>): void;
  /** Write the turn's row. Safe to call more than once; the second is a no-op. */
  flush(): void;
  /** The row as it currently stands — for tests. */
  readonly pending: PerfTurnRow;
}

export function nullPerf(): PerfRecorder {
  const empty: PerfTurnRow = {
    turnId: '',
    chatId: null,
    sessionKind: null,
    model: null,
    totalMs: null,
    ttfTextMs: null,
    steps: 0,
    toolCalls: 0,
    startedAt: '',
  };
  return {
    mark() {},
    start() {
      return () => {};
    },
    async time(_phase, fn) {
      return fn();
    },
    describe() {},
    flush() {},
    pending: empty,
  };
}

export function perfEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CABINET_PERF !== 'off';
}

/**
 * One recorder per turn. Not thread-safe and not meant to be shared across
 * concurrent turns.
 */
export function createPerfRecorder(opts: {
  db: Database.Database;
  turnId: string;
  chatId?: string | null;
  sessionKind?: string | null;
  model?: string | null;
  /** Injectable for tests; defaults to performance.now(). */
  now?: () => number;
}): PerfRecorder {
  const now = opts.now ?? (() => performance.now());
  let written = false;

  const row: PerfTurnRow = {
    turnId: opts.turnId,
    chatId: opts.chatId ?? null,
    sessionKind: opts.sessionKind ?? null,
    model: opts.model ?? null,
    totalMs: null,
    ttfTextMs: null,
    steps: 0,
    toolCalls: 0,
    startedAt: new Date().toISOString(),
  };

  // The whole of what persistence costs now: four assignments, no allocation.
  const record = (phase: string, ms: number) => {
    const clean = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0;
    if (phase === 'turn_total') row.totalMs = clean;
    else if (phase === 'ttf_text') row.ttfTextMs = clean;
    else if (phase === 'step') row.steps += 1;
    else if (phase === 'tool') row.toolCalls += 1;
    // Every other phase is timeable and deliberately not stored.
  };

  return {
    get pending() {
      return row;
    },
    describe(fields) {
      if (fields.chatId !== undefined) row.chatId = fields.chatId;
      if (fields.sessionKind !== undefined) row.sessionKind = fields.sessionKind;
      if (fields.model !== undefined) row.model = fields.model;
    },
    mark(phase, ms) {
      record(phase, ms);
    },
    start(phase) {
      const t0 = now();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        record(phase, now() - t0);
      };
    },
    async time(phase, fn) {
      const stop = this.start(phase);
      try {
        const out = await fn();
        stop();
        return out;
      } catch (err) {
        stop();
        throw err;
      }
    },
    flush() {
      if (written) return;
      written = true;
      try {
        opts.db
          .prepare(
            `INSERT INTO perf_turn (turn_id, chat_id, session_kind, model, total_ms, ttf_text_ms, steps, tool_calls, started_at)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT(turn_id) DO UPDATE SET
               chat_id=excluded.chat_id, session_kind=excluded.session_kind, model=excluded.model,
               total_ms=excluded.total_ms, ttf_text_ms=excluded.ttf_text_ms,
               steps=excluded.steps, tool_calls=excluded.tool_calls`,
          )
          .run(
            row.turnId,
            row.chatId,
            row.sessionKind,
            row.model,
            row.totalMs,
            row.ttfTextMs,
            row.steps,
            row.toolCalls,
            row.startedAt,
          );
      } catch {
        // Metrics are never worth failing a turn over. Dropping the row is the
        // correct degradation: the turn already succeeded.
      }
    },
  };
}

export interface PerfSummary {
  window: string;
  turns: number;
  /** Median and 95th percentile across the window, in ms. */
  totalMs: { p50: number; p95: number; max: number } | null;
  ttfTextMs: { p50: number; p95: number; max: number } | null;
  avgSteps: number;
  avgToolCalls: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

function spread(values: number[]): { p50: number; p95: number; max: number } | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    max: Math.round(sorted[sorted.length - 1]!),
  };
}

export function perfSummary(
  db: Database.Database,
  opts: { sinceHours?: number; sessionKind?: string | null } = {},
): PerfSummary {
  const sinceHours = opts.sinceHours ?? 24 * 7;
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const params: unknown[] = [since];
  let where = 'started_at >= ?';
  if (opts.sessionKind) {
    where += ' AND session_kind = ?';
    params.push(opts.sessionKind);
  }
  const rows = db
    .prepare(`SELECT total_ms, ttf_text_ms, steps, tool_calls FROM perf_turn WHERE ${where}`)
    .all(...params) as { total_ms: number | null; ttf_text_ms: number | null; steps: number; tool_calls: number }[];

  const n = rows.length || 1;
  return {
    window: `${sinceHours}h`,
    turns: rows.length,
    totalMs: spread(rows.map((r) => r.total_ms).filter((v): v is number => v != null)),
    ttfTextMs: spread(rows.map((r) => r.ttf_text_ms).filter((v): v is number => v != null)),
    avgSteps: Math.round((rows.reduce((a, r) => a + r.steps, 0) / n) * 10) / 10,
    avgToolCalls: Math.round((rows.reduce((a, r) => a + r.tool_calls, 0) / n) * 10) / 10,
  };
}

/** Recent turns, newest first — "which turns were slow". */
export function perfRecentTurns(db: Database.Database, limit = 25): PerfTurnRow[] {
  const rows = db
    .prepare(
      `SELECT turn_id, chat_id, session_kind, model, total_ms, ttf_text_ms, steps, tool_calls, started_at
       FROM perf_turn ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as {
    turn_id: string;
    chat_id: string | null;
    session_kind: string | null;
    model: string | null;
    total_ms: number | null;
    ttf_text_ms: number | null;
    steps: number;
    tool_calls: number;
    started_at: string;
  }[];
  return rows.map((r) => ({
    turnId: r.turn_id,
    chatId: r.chat_id,
    sessionKind: r.session_kind,
    model: r.model,
    totalMs: r.total_ms,
    ttfTextMs: r.ttf_text_ms,
    steps: r.steps,
    toolCalls: r.tool_calls,
    startedAt: r.started_at,
  }));
}
