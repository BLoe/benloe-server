import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from './agent.js';

/**
 * Persistent SDK sessions (2026-08-01).
 *
 * The problem, measured rather than assumed: Cabinet opened a fresh `query()`
 * for every turn and resumed by session id, which spawns a Claude CLI
 * subprocess each time. The `sdk_spawn` span put that at ~3.1s, consistently,
 * on every single turn. On a 78-second research turn that's noise; on "log
 * 278.4" it is essentially the entire wait.
 *
 * The SDK's own answer is the streaming-input form: pass an AsyncIterable as
 * `prompt` and keep it open, and the CLI stays alive across turns
 * (`Query.streamInput` is documented as "used internally for multi-turn
 * conversations"). One subprocess, many turns.
 *
 * What that costs us in exchange — and why this file is careful:
 *
 * 1. Everything in `options` is fixed at spawn. systemPrompt, model, effort,
 *    cwd. A turn whose spec differs from the live session's cannot reuse it,
 *    so the spec is hashed and a mismatch recycles the session. This is the
 *    reason register-based effort is deliberately STICKY per chat (see
 *    runtime/register.ts): an effort that flapped per-turn would respawn the
 *    subprocess every turn and also bust the prompt cache, losing on both
 *    counts at once.
 *
 * 2. canUseTool and the hooks are also fixed at spawn, but they need per-turn
 *    state (which chat, which gate context, which perf recorder). They
 *    therefore close over `session.active` — a mutable holder swapped at the
 *    start of each turn — instead of capturing a turn's values. Safe because
 *    TurnQueue guarantees exactly one turn is in flight process-wide; if that
 *    ever stops being true, this breaks and the assertion in `begin()` is
 *    what will catch it.
 *
 * 3. The output stream is now longer-lived than any one turn. A single reader
 *    loop owns it and dispatches messages to whichever turn is active,
 *    resolving that turn when its `result` message arrives.
 *
 * A session that dies for any reason (stream ends, error, subprocess exit) is
 * simply dropped, and the next turn spawns a new one — which is the old
 * behavior. This is a latency optimization; it is never allowed to become a
 * correctness dependency.
 */

/**
 * Everything that must match for a turn to reuse a live session. Compared as
 * a whole, not field by field: adding an option to buildOptions without
 * adding it here would silently let a turn run under stale settings.
 */
export interface SessionSpec {
  model: string;
  effort: string;
  systemPrompt: string;
  cwd: string;
  maxTurns: number;
}

export function specKey(s: SessionSpec): string {
  // systemPrompt runs to thousands of characters and is byte-stable by
  // design (§9.3), so length + a cheap rolling hash is enough to catch a
  // real edit without holding a second copy of it per session.
  let h = 0;
  for (let i = 0; i < s.systemPrompt.length; i++) h = (Math.imul(h, 31) + s.systemPrompt.charCodeAt(i)) | 0;
  return `${s.model}|${s.effort}|${s.cwd}|${s.maxTurns}|${s.systemPrompt.length}:${h}`;
}

/** The per-turn state that hooks and canUseTool read through. */
export interface ActiveTurn {
  chatId: string;
  onMessage(msg: Record<string, unknown>): void;
}

type SdkMessage = Record<string, unknown>;

interface Session {
  key: string;
  specKey: string;
  /** Pushes the next user message into the live input stream. */
  send(msg: SDKUserMessage): void;
  /** The live SDK Query handle (interrupt, getContextUsage, …). */
  query: {
    interrupt?(): Promise<unknown>;
    getContextUsage?(): Promise<Record<string, unknown>>;
    /**
     * Plan rate-limit + cost snapshot. The SDK's own name for this carries an
     * EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET suffix and it may be
     * renamed or removed in any release, which is exactly why it is optional
     * here and every caller feature-detects before invoking it.
     */
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?(): Promise<Record<string, unknown>>;
  };
  /** The slot hooks and canUseTool read through; swapped per turn. */
  active: ActiveTurn | null;
  /** Called when the stream ends or errors while a turn is still waiting. */
  onDeath: ((err?: unknown) => void) | null;
  /** Set when the reader loop ends — the session can no longer serve turns. */
  dead: boolean;
  /** Cumulative num_turns the CLI has reported, across every turn on this
   *  session. maxTurns is enforced by the CLI against the session, not the
   *  turn, so a long-lived session has to be recycled before it gets there. */
  turnsUsed: number;
  turnsServed: number;
  lastUsedAt: number;
  createdAt: number;
  close(): void;
}

/**
 * A session is recycled once its cumulative turn count comes within this many
 * steps of the ceiling, so a user turn never inherits a nearly-exhausted
 * budget and trips `error_max_turns` on its second tool call.
 */
const RECYCLE_HEADROOM = 24;

/** Idle sessions hold a subprocess; reap them rather than accumulate them. */
export const DEFAULT_IDLE_MS = 15 * 60_000;

export interface SessionPoolOptions {
  queryFn: QueryFn;
  /** Max live sessions. Each one is a subprocess, so this is a memory bound. */
  maxSessions?: number;
  idleMs?: number;
  now?: () => number;
  /** Told when a session is created or recycled, for the perf trail. */
  onSpawn?(key: string, reason: 'new' | 'spec-changed' | 'exhausted' | 'dead'): void;
}

export interface RunTurnArgs {
  /** Pool key — the chat id. Turns for different chats get different sessions. */
  key: string;
  spec: SessionSpec;
  /** Only called when a subprocess actually has to be spawned. */
  buildOptions(): Record<string, unknown>;
  /** The user message for this turn. */
  message: SDKUserMessage;
  /** Every SDK message for this turn, in order. */
  onMessage(msg: SdkMessage): void;
  /**
   * Scheduled turns (cron/heartbeat) run rarely and would just hold a
   * subprocess hostage between firings, so they close their session
   * immediately — one-shot, exactly the old behavior.
   */
  ephemeral?: boolean;
}

export class SessionPool {
  private sessions = new Map<string, Session>();
  private opts: Required<Omit<SessionPoolOptions, 'onSpawn'>> & Pick<SessionPoolOptions, 'onSpawn'>;

  constructor(opts: SessionPoolOptions) {
    this.opts = {
      maxSessions: opts.maxSessions ?? 3,
      idleMs: opts.idleMs ?? DEFAULT_IDLE_MS,
      now: opts.now ?? (() => Date.now()),
      queryFn: opts.queryFn,
      onSpawn: opts.onSpawn,
    };
  }

  get size(): number {
    return this.sessions.size;
  }

  stats(): { key: string; ageMs: number; idleMs: number; turnsUsed: number; turnsServed: number }[] {
    const now = this.opts.now();
    return [...this.sessions.values()].map((s) => ({
      key: s.key,
      ageMs: now - s.createdAt,
      idleMs: now - s.lastUsedAt,
      turnsUsed: s.turnsUsed,
      turnsServed: s.turnsServed,
    }));
  }

  /**
   * Run one turn, reusing a live session when the spec matches. Resolves when
   * the SDK emits this turn's `result` message (or the session dies first).
   * Returns whether a subprocess had to be spawned, so the caller can record
   * the `sdk_spawn` span honestly — a reused session's spawn cost is zero and
   * should be reported as such, not omitted.
   */
  async runTurn(args: RunTurnArgs): Promise<{ spawned: boolean }> {
    this.reapIdle();
    const wanted = specKey(args.spec);
    let session = this.sessions.get(args.key);
    let spawned = false;

    if (session) {
      const reason =
        session.dead ? 'dead'
        : session.specKey !== wanted ? 'spec-changed'
        : session.turnsUsed >= args.spec.maxTurns - RECYCLE_HEADROOM ? 'exhausted'
        : null;
      if (reason) {
        this.drop(args.key, session);
        this.opts.onSpawn?.(args.key, reason);
        session = undefined;
      }
    }

    if (!session) {
      if (!this.sessions.has(args.key)) this.evictToFit();
      session = this.spawn(args, wanted);
      spawned = true;
      this.opts.onSpawn?.(args.key, 'new');
    }

    return this.begin(session, args).then(() => ({ spawned }));
  }

  /** Drive one turn on an established session. */
  private begin(session: Session, args: RunTurnArgs): Promise<void> {
    if (session.active) {
      // TurnQueue makes this unreachable; if it ever fires, the mutable
      // per-turn holder that hooks read through is being shared between two
      // turns and every audit row is suspect. Fail loudly.
      return Promise.reject(new Error(`session ${session.key} already has a turn in flight`));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        session.active = null;
        session.onDeath = null;
        session.lastUsedAt = this.opts.now();
        session.turnsServed += 1;
        if (args.ephemeral || session.dead) this.drop(session.key, session);
        if (err) reject(err);
        else resolve();
      };

      session.active = {
        chatId: args.key,
        onMessage: (msg) => {
          try {
            args.onMessage(msg);
          } catch (err) {
            finish(err);
            return;
          }
          if (msg.type === 'result') {
            const n = (msg as { num_turns?: unknown }).num_turns;
            if (typeof n === 'number') session.turnsUsed = n;
            finish();
          }
        },
      };
      // Set by the reader loop when the stream ends mid-turn: the subprocess
      // went away without producing a result, so this turn gets nothing.
      session.onDeath = (err) => finish(err ?? new Error('agent session ended before the turn finished'));

      try {
        session.send(args.message);
      } catch (err) {
        finish(err);
      }
    });
  }

  private spawn(args: RunTurnArgs, wanted: string): Session {
    // The input side: an async generator that stays open, handing the CLI
    // each user message as it arrives. Returning from this generator is what
    // tells the CLI the conversation is over, so it only returns on close().
    const inbox: SDKUserMessage[] = [];
    let wake: (() => void) | null = null;
    let closed = false;

    async function* input(): AsyncGenerator<SDKUserMessage> {
      for (;;) {
        while (inbox.length > 0) yield inbox.shift() as SDKUserMessage;
        if (closed) return;
        await new Promise<void>((r) => {
          wake = r;
        });
      }
    }

    // ONE mutable slot, shared by the hooks (which read it lazily, per tool
    // call) and the pool (which writes it at turn start). Passing it to
    // buildOptions before the session object exists is why it's a separate
    // box rather than a field: the options closure needs a stable reference.
    const holder: { current: ActiveTurn | null } = { current: null };
    const q = this.opts.queryFn({
      prompt: input(),
      options: args.buildOptions(),
    } as Parameters<QueryFn>[0]);

    const session: Session = {
      key: args.key,
      specKey: wanted,
      query: q as Session['query'],
      get active() {
        return holder.current;
      },
      set active(v: ActiveTurn | null) {
        holder.current = v;
      },
      onDeath: null,
      dead: false,
      turnsUsed: 0,
      turnsServed: 0,
      createdAt: this.opts.now(),
      lastUsedAt: this.opts.now(),
      send: (msg) => {
        if (closed || session.dead) throw new Error('agent session is closed');
        inbox.push(msg);
        wake?.();
        wake = null;
      },
      close: () => {
        closed = true;
        wake?.();
        wake = null;
      },
    };

    // The reader loop: one iteration of the query for the session's whole
    // life, dispatching to whichever turn is active.
    void (async () => {
      try {
        for await (const msg of q as AsyncIterable<SdkMessage>) {
          session.active?.onMessage(msg);
        }
        session.dead = true;
        session.onDeath?.();
      } catch (err) {
        session.dead = true;
        session.onDeath?.(err);
      } finally {
        session.dead = true;
        if (this.sessions.get(args.key) === session) this.sessions.delete(args.key);
      }
    })();

    this.sessions.set(args.key, session);
    return session;
  }

  /**
   * Best-effort plan-usage snapshot from any live session.
   *
   * Supplements the push path (`rate_limit_event` on the turn stream), which
   * is primary. This exists to cover the gap the push path structurally
   * cannot: windows the provider has not mentioned recently, and the state of
   * things before the first turn of a quiet day.
   *
   * Returns null — never a fabricated zero — when there is no live session,
   * when the SDK build does not expose the method, or when the call throws.
   * "Unknown" is a legitimate and useful answer here; an invented number is
   * not. Costs no model tokens: it is a control-plane call on a subprocess
   * that is already running.
   */
  async pollUsage(): Promise<Record<string, unknown> | null> {
    for (const s of this.sessions.values()) {
      if (s.dead) continue;
      const fn = s.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof fn !== 'function') continue;
      try {
        const usage = await fn.call(s.query);
        if (usage) return usage;
      } catch {
        // An experimental API that moved is expected, not exceptional. Try the
        // next session; if none answer, the caller degrades to "unknown".
      }
    }
    return null;
  }

  /** Abort the in-flight turn on a session (does not close the session). */
  async interrupt(key: string): Promise<boolean> {
    const s = this.sessions.get(key);
    if (!s || !s.active || s.dead) return false;
    try {
      await s.query.interrupt?.();
      return true;
    } catch {
      // An interrupt that can't be delivered means the subprocess is already
      // gone; drop the session so the next turn gets a clean one.
      this.drop(key, s);
      return false;
    }
  }

  contextUsage(key: string): Promise<Record<string, unknown>> | null {
    const s = this.sessions.get(key);
    if (!s || s.dead || !s.query.getContextUsage) return null;
    return s.query.getContextUsage();
  }

  private drop(key: string, session: Session): void {
    session.dead = true;
    try {
      session.close();
    } catch {
      /* closing a dead session is not an error worth surfacing */
    }
    if (this.sessions.get(key) === session) this.sessions.delete(key);
  }

  private reapIdle(): void {
    const now = this.opts.now();
    for (const [key, s] of [...this.sessions]) {
      if (!s.active && now - s.lastUsedAt > this.opts.idleMs) this.drop(key, s);
    }
  }

  /** Make room for one more, evicting the least recently used idle session. */
  private evictToFit(): void {
    while (this.sessions.size >= this.opts.maxSessions) {
      let oldest: [string, Session] | null = null;
      for (const entry of this.sessions) {
        if (entry[1].active) continue;
        if (!oldest || entry[1].lastUsedAt < oldest[1].lastUsedAt) oldest = entry;
      }
      if (!oldest) return; // everything is busy — let it exceed rather than kill a live turn
      this.drop(oldest[0], oldest[1]);
    }
  }

  closeAll(): void {
    for (const [key, s] of [...this.sessions]) this.drop(key, s);
  }
}
