import type Database from 'better-sqlite3';

/**
 * Turn-latency instrumentation (2026-08-01).
 *
 * The complaint this exists to answer: Cabinet feels slow next to a bare
 * Messages-API agent, and nothing in the system could say why. token_usage
 * records what a turn COST; nothing recorded where its wall clock went. This
 * records spans — named, timed, ordered intervals — for every phase of a turn
 * so the answer is a query rather than an argument.
 *
 * Design constraints:
 * - Never slow down or break the thing it measures. Spans buffer in memory and
 *   flush in ONE transaction at turn end; every DB touch is wrapped so an
 *   instrumentation failure degrades to "no metrics", never to a failed turn.
 * - performance.now(), not Date.now(): monotonic, unaffected by clock steps,
 *   and sub-millisecond. Wall-clock start time is stamped once per span from
 *   the real clock for the started_at column.
 * - Zero-cost when disabled (CABINET_PERF=off) — the recorder becomes a set of
 *   no-ops rather than a conditional at every call site.
 */

/**
 * Open vocabulary — new probes should just use a new string rather than
 * migrate an enum. Documented here so the Ops surface and any ad-hoc query
 * have one place to read the intended meaning.
 */
export type PerfPhase =
  /** POST /api/chat entry → response finished. The number Ben actually feels. */
  | 'request_total'
  /** Time the turn sat in TurnQueue behind another turn. */
  | 'queue_wait'
  /** Episodic lesson recall (embedding + vector search) before the turn. */
  | 'recall'
  /** profileGap()'s COUNT queries + memory file reads. */
  | 'profile_gap'
  /** assemblePrompt(): memory file reads + string assembly. */
  | 'prompt_assemble'
  /** query() called → first system/init message. This is the CLI subprocess
   *  spawn + MCP server handshake, and it is paid on EVERY turn because we
   *  open a fresh query() and resume by session id. */
  | 'sdk_spawn'
  /** init → first thinking delta. Model queue + prefill. */
  | 'ttf_thinking'
  /** init → first visible text delta. What "it's alive" looks like to Ben. */
  | 'ttf_text'
  /** init → first tool_use block. Pairs with ttf_text to show whether the
   *  model narrated before acting or dove straight into tools. */
  | 'ttf_tool'
  /** One assistant message (one API round trip within the agentic loop). */
  | 'step'
  /** tool_use emitted → matching tool_result observed. Labelled with the tool. */
  | 'tool'
  /** canUseTool gate: classification + audit insert (+ approval wait, if any). */
  | 'gate'
  /** PreToolUse hook body. */
  | 'hook_pre'
  /** PostToolUse hook body (includes truncation work). */
  | 'hook_post'
  /** Whole agent turn, spawn through result. */
  | 'turn_total';

export interface PerfSpanRow {
  turnId: string;
  chatId: string | null;
  sessionKind: string | null;
  model: string | null;
  phase: string;
  label: string | null;
  ms: number;
  seq: number;
  startedAt: string;
  meta: Record<string, unknown> | null;
}

export interface PerfRecorder {
  /** Record a completed interval directly (when you already have the ms). */
  mark(phase: PerfPhase | string, ms: number, opts?: { label?: string; meta?: Record<string, unknown> }): void;
  /** Start a span; the returned function ends it. Calling it twice is a no-op. */
  start(phase: PerfPhase | string, opts?: { label?: string }): (meta?: Record<string, unknown>) => void;
  /** Time a promise, recording the span whether it resolves or rejects. */
  time<T>(phase: PerfPhase | string, fn: () => Promise<T>, opts?: { label?: string }): Promise<T>;
  /** Fill in fields not known when the recorder was created (model, kind). */
  describe(fields: Partial<Pick<PerfSpanRow, 'chatId' | 'sessionKind' | 'model'>>): void;
  /** Write everything buffered. Safe to call more than once; drains the buffer. */
  flush(): void;
  /** Spans buffered but not yet flushed — for tests. */
  readonly pending: PerfSpanRow[];
}

const NOOP_STOP = () => {};

/** A recorder that measures nothing — used when instrumentation is disabled. */
export function nullPerf(): PerfRecorder {
  return {
    mark() {},
    start: () => NOOP_STOP,
    time: (_phase, fn) => fn(),
    describe() {},
    flush() {},
    pending: [],
  };
}

export function perfEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CABINET_PERF !== 'off';
}

/**
 * One recorder per turn. Not thread-safe and not meant to be shared across
 * concurrent turns — `seq` is a per-recorder counter, which is exactly the
 * per-turn ordering the table wants.
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
  let seq = 0;
  const buffer: PerfSpanRow[] = [];
  let chatId = opts.chatId ?? null;
  let sessionKind = opts.sessionKind ?? null;
  let model = opts.model ?? null;

  const push = (phase: string, ms: number, label: string | null, meta: Record<string, unknown> | null) => {
    buffer.push({
      turnId: opts.turnId,
      chatId,
      sessionKind,
      model,
      phase,
      label,
      // Guard against a negative/NaN clock reading poisoning aggregates.
      ms: Number.isFinite(ms) && ms >= 0 ? Math.round(ms * 1000) / 1000 : 0,
      seq: seq++,
      startedAt: new Date().toISOString(),
      meta,
    });
  };

  return {
    get pending() {
      return buffer;
    },
    describe(fields) {
      if (fields.chatId !== undefined) chatId = fields.chatId;
      if (fields.sessionKind !== undefined) sessionKind = fields.sessionKind;
      if (fields.model !== undefined) model = fields.model;
    },
    mark(phase, ms, o) {
      push(phase, ms, o?.label ?? null, o?.meta ?? null);
    },
    start(phase, o) {
      const t0 = now();
      let done = false;
      return (meta?: Record<string, unknown>) => {
        if (done) return;
        done = true;
        push(phase, now() - t0, o?.label ?? null, meta ?? null);
      };
    },
    async time(phase, fn, o) {
      const stop = this.start(phase, o);
      try {
        const out = await fn();
        stop();
        return out;
      } catch (err) {
        stop({ error: String((err as Error)?.message ?? err).slice(0, 200) });
        throw err;
      }
    },
    flush() {
      if (buffer.length === 0) return;
      const rows = buffer.splice(0, buffer.length);
      try {
        const insert = opts.db.prepare(
          `INSERT INTO perf_span (turn_id, chat_id, session_kind, model, phase, label, ms, seq, started_at, meta)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        );
        opts.db.transaction(() => {
          for (const r of rows) {
            insert.run(
              r.turnId,
              r.chatId,
              r.sessionKind,
              r.model,
              r.phase,
              r.label,
              r.ms,
              r.seq,
              r.startedAt,
              r.meta ? JSON.stringify(r.meta).slice(0, 2000) : null,
            );
          }
        })();
      } catch {
        // Metrics are never worth failing a turn over. Dropping the batch is
        // the correct degradation: the turn already succeeded.
      }
    },
  };
}

export interface PerfPhaseSummary {
  phase: string;
  label: string | null;
  n: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/**
 * Percentiles are computed in SQL-free JS on purpose: SQLite has no
 * percentile aggregate without an extension, and these row counts are small
 * (a few thousand spans over the window). Nearest-rank method.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

/**
 * Latency breakdown over a window, grouped by phase (and by label for the
 * per-tool 'tool' phase, which is the interesting one). Powers GET /api/perf
 * and the Ops surface.
 */
export function perfSummary(
  db: Database.Database,
  opts: { sinceHours?: number; sessionKind?: string | null; limitLabels?: number } = {},
): { window: string; byPhase: PerfPhaseSummary[]; byTool: PerfPhaseSummary[]; turns: number } {
  const sinceHours = opts.sinceHours ?? 24 * 7;
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const params: unknown[] = [since];
  let where = 'started_at >= ?';
  if (opts.sessionKind) {
    where += ' AND session_kind = ?';
    params.push(opts.sessionKind);
  }
  const rows = db
    .prepare(`SELECT phase, label, ms FROM perf_span WHERE ${where}`)
    .all(...params) as { phase: string; label: string | null; ms: number }[];
  const turns = (
    db.prepare(`SELECT COUNT(DISTINCT turn_id) AS n FROM perf_span WHERE ${where}`).get(...params) as { n: number }
  ).n;

  const group = (keyOf: (r: (typeof rows)[number]) => string | null, filter?: (r: (typeof rows)[number]) => boolean) => {
    const buckets = new Map<string, { phase: string; label: string | null; ms: number[] }>();
    for (const r of rows) {
      if (filter && !filter(r)) continue;
      const key = keyOf(r);
      if (key === null) continue;
      let b = buckets.get(key);
      if (!b) {
        b = { phase: r.phase, label: filter ? r.label : null, ms: [] };
        buckets.set(key, b);
      }
      b.ms.push(r.ms);
    }
    const out: PerfPhaseSummary[] = [];
    for (const b of buckets.values()) {
      const sorted = [...b.ms].sort((x, y) => x - y);
      const total = sorted.reduce((a, x) => a + x, 0);
      out.push({
        phase: b.phase,
        label: b.label,
        n: sorted.length,
        totalMs: Math.round(total),
        avgMs: Math.round(total / sorted.length),
        p50Ms: Math.round(percentile(sorted, 50)),
        p95Ms: Math.round(percentile(sorted, 95)),
        maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
      });
    }
    return out.sort((a, b) => b.totalMs - a.totalMs);
  };

  return {
    window: `${sinceHours}h`,
    turns,
    byPhase: group((r) => r.phase),
    byTool: group((r) => `${r.phase}:${r.label ?? ''}`, (r) => r.phase === 'tool').slice(0, opts.limitLabels ?? 25),
  };
}

/** Per-turn roll-up, newest first — "which turns were slow, and why". */
export function perfRecentTurns(db: Database.Database, limit = 25): {
  turnId: string;
  chatId: string | null;
  sessionKind: string | null;
  model: string | null;
  startedAt: string;
  totalMs: number;
  phases: Record<string, number>;
}[] {
  const turns = db
    .prepare(
      `SELECT turn_id, MIN(started_at) AS started_at
         FROM perf_span
        GROUP BY turn_id
        ORDER BY started_at DESC
        LIMIT ?`,
    )
    .all(limit) as { turn_id: string; started_at: string }[];
  return turns.map((t) => {
    const spans = db
      .prepare('SELECT chat_id, session_kind, model, phase, ms FROM perf_span WHERE turn_id = ?')
      .all(t.turn_id) as { chat_id: string | null; session_kind: string | null; model: string | null; phase: string; ms: number }[];
    const phases: Record<string, number> = {};
    for (const s of spans) phases[s.phase] = Math.round((phases[s.phase] ?? 0) + s.ms);
    const head = spans.find((s) => s.model) ?? spans[0];
    return {
      turnId: t.turn_id,
      chatId: head?.chat_id ?? null,
      sessionKind: head?.session_kind ?? null,
      model: head?.model ?? null,
      startedAt: t.started_at,
      totalMs: phases.request_total ?? phases.turn_total ?? 0,
      phases,
    };
  });
}
