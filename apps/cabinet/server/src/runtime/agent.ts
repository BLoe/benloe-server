import type Database from 'better-sqlite3';
import type { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage, AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { MemoryStore } from '../memory/index.js';
import type { ImageMime } from '../gateway/attachments.js';
import type { ApprovalQueue, ApprovalPacket } from '../tiers/approvals.js';
import { buildGate, type GateContext } from '../tiers/gate.js';
import { assemblePrompt, type PromptInput } from './prompt.js';
import { capacityLine, recordRateLimitEvent, recordUsageSnapshot } from './rateLimits.js';
import { refusalFallback, route } from './router.js';
import { TurnQueue, type TurnKind } from './queue.js';
import { generateTitle } from './titler.js';
import { truncateForModel } from './toolTruncate.js';
import { createPerfRecorder, nullPerf, perfEnabled, type PerfRecorder } from './perf.js';
import { SessionPool, type ActiveTurn, type SessionSpec } from './session.js';
import { describeTransition, readMcpStatus, type McpStatus } from './mcpHealth.js';
import { effortForRegister, nextRegister, type Register } from './register.js';

/**
 * Per-kind agentic-turn budget. User turns can involve multi-file builds,
 * test runs, and deploys, so they get real headroom; heartbeat/cron turns
 * are scheduled and meant to be cheap, so they stay tight.
 */
const MAX_TURNS_BY_KIND: Record<TurnKind, number> = { user: 120, cron: 12, heartbeat: 6 };

/**
 * Step 1 (2026-07-16, joint design w/ benji): native auto-compact threshold
 * override. Step 0's diagnostic harness showed the CLI's default
 * autoCompactThreshold sits at ~96.6% of the context window (934K of 967K
 * measured on Sonnet 5) — high enough that it structurally cannot fire
 * within even a 120-step turn, which is why cache_read compounds
 * quadratically (integral of a linearly-growing context) instead of being
 * periodically flattened. Valid range per the SDK's settings schema is
 * [100_000, 1_000_000] tokens (verified against the runtime bundle, not
 * just the .d.ts). 200K first: conservative-first, ratchet down toward
 * 150K only once we've confirmed no fidelity loss on a real build turn.
 * Env-overridable so tuning doesn't require a full redeploy — just
 * `cabinet-privops pm2-start ecosystem.config.js` + `pm2-save`.
 */
const AUTO_COMPACT_WINDOW = Number(process.env.CABINET_AUTO_COMPACT_WINDOW) || 200_000;

/**
 * Continuation-on-limit (build 3). A turn cut off by the SDK's maxTurns
 * ceiling used to just end, stranding mid-work with no automatic recovery —
 * the failure mode that cost ~30min on 2026-07-14. Bounded to this many
 * chained auto-resumes per originating user turn; tracked via a depth
 * counter threaded through the recursive executeTurn call, NOT a class
 * field, so concurrent chats never share or leak continuation state.
 */
export const MAX_AUTO_CONTINUATIONS = 3;

/**
 * Advisory per-turn token budget for the whole agentic loop (§task budgets).
 * Returns null for models that don't support the feature — the API rejects
 * `output_config.task_budget` on Sonnet 5 and Haiku 4.5 — and for turn kinds
 * whose maxTurns ceiling is already tight enough to be the real limit.
 *
 * Sizes come from observed production spend (token_usage, 2026-07): the
 * heaviest real user turns ran ~85k output tokens plus tool results, so 400k
 * leaves generous headroom while still landing well inside a turn that would
 * otherwise grind through all 120 steps. The documented floor is 20k, and an
 * undersized budget causes refusal-like behavior, so err high.
 */
export function taskBudgetFor(model: string, kind: TurnKind): number | null {
  const supported = /opus-5|opus-4-8|opus-4-7|fable-5|mythos-5/.test(model);
  if (!supported) return null;
  if (kind !== 'user') return null;
  return Number(process.env.CABINET_TASK_BUDGET) || 400_000;
}

/** Was this turn cut off by the maxTurns ceiling, or did it end some other way (success, or any other terminal error)? */
export type TurnOutcome = 'clean' | 'max_turns_cutoff';

export function classifyStop(subtype: string | null | undefined): TurnOutcome {
  return subtype === 'error_max_turns' ? 'max_turns_cutoff' : 'clean';
}

/** §12.2 event vocabulary — the gateway maps these 1:1 onto SSE. */
export type TurnEvent =
  | { type: 'turn-start'; messageId: string; chatId: string; model: string }
  | { type: 'text-delta'; delta: string }
  /**
   * Live reasoning (2026-08-01). Previously the only thing the stream carried
   * between "turn-start" and the first tool result was nothing at all: the
   * model's thinking was dropped on the floor, so a turn that spent 40s
   * reasoning before its first tool call was indistinguishable from a hung
   * process. Rendered as ephemeral, de-emphasized text in the chat surface and
   * deliberately NOT persisted to the transcript — thinking is a liveness
   * signal, not a record.
   */
  | { type: 'thinking-delta'; delta: string }
  /**
   * Redacted-thinking progress. On the subscription path Opus 5 streams
   * `thinking_delta` frames that carry only a token estimate — the reasoning
   * text itself is not exposed (verified live 2026-08-01: ttf_thinking fired
   * at 2.1s while zero characters arrived). The CLI digests those frames into
   * a system/thinking_tokens message, which is the only honest liveness
   * signal available during a long think. Drives the "thinking · ~1.2k" pill.
   */
  | { type: 'thinking-tokens'; estimated: number }
  /**
   * Agentic-loop progress (2026-08-01). One per assistant message, so the UI
   * can show "step 7 · 3 tools · 18s" instead of a silent spinner during a
   * long multi-tool turn.
   */
  | { type: 'step'; step: number; tools: number; elapsedMs: number }
  | { type: 'tool-start'; toolId: string; name: string; input: unknown }
  | { type: 'tool-end'; toolId: string; output: string; isError: boolean }
  | { type: 'widget'; widgetType: string; data: unknown }
  | { type: 'notice'; level: 'info' | 'warn'; text: string }
  | { type: 'approval'; packet: ApprovalPacket }
  | { type: 'turn-end'; usage: Record<string, unknown> | null; sessionId: string | null; stopReason: string }
  | { type: 'error'; message: string; retryable: boolean };

export type QueryFn = typeof sdkQuery;

export interface RuntimeOptions {
  db: Database.Database;
  memory: MemoryStore;
  approvals: ApprovalQueue;
  /** In-process + external MCP server configs, injected by the composition root. */
  mcpServers?: Record<string, unknown>;
  /** Extra allowedTools entries — ONLY ungated mcp__cabinet__* names (Appendix B). */
  allowedTools?: string[];
  /** render_widget emissions forward into the active turn's event stream. */
  widgetBus?: EventEmitter;
  queryFn?: QueryFn; // injectable for tests
  cwd?: string;
  dataDir?: string;
  /** Keep a chat's CLI subprocess alive between turns (default: on). */
  persistSessions?: boolean;
}

export interface TurnRequest {
  chatId: string;
  prompt: string;
  kind: TurnKind;
  deep?: boolean;
  abort?: AbortController;
  promptInput?: Partial<PromptInput>;
  /** Composer image attachments (§ vision spike, 2026-07-11) — decoded bytes
   *  already read off disk by /api/chat, base64-ready for the turn. */
  images?: { mediaType: ImageMime; base64: string }[];
  /**
   * Latency recorder for this turn. The gateway creates it so its own
   * pre-turn work (lesson recall, profileGap, queue wait) shares one turn_id
   * with everything the runtime records; when absent — cron, heartbeat, tests
   * — the runtime makes its own.
   */
  perf?: PerfRecorder;
  onEvent(e: TurnEvent): void;
}

/** Hard floor under the tier engine — these never run regardless of gate bugs. */
export const HARD_DENIES = [
  'Bash(sudo su*)',
  'Bash(rm -rf /*)',
  'Bash(chmod -R 777*)',
  'Bash(curl * | *sh*)',
  'Bash(wget * | *sh*)',
  'KillShell',
];

/**
 * Subagents (track 3.1). Options.agents was never set before this, so the
 * Agent tool had nothing to invoke even though the gate already passes it
 * under autonomy:'full'. `design-reviewer` is the first: a read-only critic
 * for a UI surface's component + CSS source (a screenshot comes later — the
 * Agent tool prompt is text-only, so image review needs its own path).
 *
 * model: 'sonnet' — vision-capable, fast, and the right cost/taste balance
 * for a per-surface review loop. Escalate to 'opus' for deeper aesthetic
 * reasoning if sonnet's critiques prove too shallow in practice.
 */
const DESIGN_REVIEWER_AGENT: AgentDefinition = {
  description:
    'Reviews a UI surface (its component + CSS source, and later a screenshot) for layout, spacing, visual hierarchy, contrast/legibility, and usability. Returns a prioritized, specific critique. Does not modify code.',
  model: 'sonnet',
  effort: 'high',
  // Read-only by design — a reviewer must never edit/write/run. No
  // Edit/Write/Bash/Agent, so it cannot touch code or spawn further work.
  tools: ['Read', 'Grep', 'Glob'],
  prompt: `You are a sharp, senior product designer reviewing a UI surface in Cabinet, Ben's personal operator console — a warm, dark "campaign desk": inlaid-wood browns, a single brass accent, a book serif for voice and mono for data, restraint over decoration.

Judge every surface against Cabinet's actual design tokens (apps/cabinet/web/src/styles/tokens.css), not generic taste:
- Ground/panel/inset browns (--ground, --panel, --panel-2, --inset) layer depth; --rule/--rule-soft are the only hairlines.
- --brass and its variants are the ONE accent — Cabinet's own voice and live activity. Flag any competing accent color, gratuitous color, or brass used where it isn't meaningful (voice/liveness), not just decoration.
- --patina (settled/positive), --vermilion (the one alert) are semantic, not decorative — flag misuse.
- Type scale is deliberate and dense (--fs-cap through --fs-h1); flag ad-hoc font sizes or weights that don't map to the scale, and flag hierarchy that doesn't read at a glance.
- Spacing is a strict 4px scale (--sp-1..--sp-9); flag cramped or inconsistent spacing, and flag padding/margins that don't look drawn from the scale.
- Text sits on a dark ground: --linen/--linen-dim/--linen-faint. Flag any contrast that would be hard to read against --ground/--panel, or any pure-white/off-token color.

You will be given a path (or paths) to a component's source and its CSS. Read them with your Read/Grep/Glob tools — do not guess at markup you haven't read.

Always return your findings as a PRIORITIZED list, most jarring problem first. For each finding give:
1. The specific file and selector/element it's in.
2. What's wrong (spacing/density, alignment, visual hierarchy, contrast/legibility, wasted or cramped space — call these out explicitly by category).
3. A concrete fix — a specific token, value, or rule change, not vague praise or "consider improving X."

Be concrete and opinionated. Do not pad with praise. If a surface is genuinely fine, say so briefly and stop — do not invent findings to fill a list. You are read-only: you never edit, write, or run anything, only report.`,
};

export const AGENTS: Record<string, AgentDefinition> = {
  'design-reviewer': DESIGN_REVIEWER_AGENT,
};

/**
 * Configure Claude auth for the SDK subprocess (§9.1, validated Appendix B).
 * Exactly one credential is left in the environment; CLAUDE_CONFIG_DIR is
 * always isolated so ambient settings cannot shadow the gate.
 */
export function configureAuth(env: Record<string, string | undefined>): 'subscription' | 'api' {
  const mode = env.CABINET_CLAUDE_AUTH === 'api' ? 'api' : 'subscription';
  if (mode === 'subscription') delete env.ANTHROPIC_API_KEY;
  else delete env.CLAUDE_CODE_OAUTH_TOKEN;
  env.CLAUDE_CONFIG_DIR ??= '/home/claude-worker/.cabinet-claude';
  return mode;
}

/**
 * Last observed MCP status, process-wide. Module scope on purpose: the
 * transition is what matters, and TurnQueue guarantees one in-flight turn per
 * process, so there is no interleaving to protect against.
 */
let lastMcpStatus: McpStatus | null = null;

export class AgentRuntime {
  readonly queue = new TurnQueue();
  readonly authMode: 'subscription' | 'api';
  private queryFn: QueryFn;
  private gate;
  readonly sessions: SessionPool;
  /**
   * Whether a chat's CLI subprocess is kept alive between turns. On by
   * default; CABINET_SESSION_POOL=off falls back to spawning per turn, which
   * is the pre-2026-08-01 behavior and the escape hatch if a pooled session
   * ever misbehaves in a way a restart doesn't fix.
   */
  private readonly poolEnabled: boolean;
  /** Single-flight (guaranteed by the queue): the active turn's sinks. */
  private currentOnEvent: ((e: TurnEvent) => void) | null = null;
  private currentAbort: AbortController | null = null;
  private currentChatId: string | null = null;
  /** Per-turn state the pooled session's hooks and gate read through. */
  private turnCtx: { ctx: GateContext; perf: PerfRecorder; chatId: string; kind: TurnKind } | null = null;
  /** In-flight diagnostic appends, awaited by close(). */
  private pendingWrites = new Set<Promise<unknown>>();

  constructor(private opts: RuntimeOptions) {
    this.queryFn = opts.queryFn ?? sdkQuery;
    this.poolEnabled = opts.persistSessions ?? process.env.CABINET_SESSION_POOL !== 'off';
    this.sessions = new SessionPool({
      queryFn: this.queryFn,
      maxSessions: Number(process.env.CABINET_MAX_SESSIONS) || 3,
      onSpawn: (key, reason) =>
        this.diagLog({ kind: 'session-spawn', chatId: key, reason, live: this.sessions.size }),
    });
    this.authMode = configureAuth(process.env);
    this.gate = buildGate({
      db: opts.db,
      approvals: opts.approvals,
      // Autonomous by default (Ben's directive): execute + audit, no approval
      // friction. Set CABINET_AUTONOMY=tiered to restore the 5-tier gate.
      autonomy: process.env.CABINET_AUTONOMY === 'tiered' ? 'tiered' : 'full',
      events: {
        onNotify: (toolName, c) =>
          this.currentOnEvent?.({ type: 'notice', level: 'info', text: `Tier 3 — ${toolName}: ${c.reason}` }),
        onApprovalRequested: (packet) => this.currentOnEvent?.({ type: 'approval', packet }),
      },
    });
    opts.widgetBus?.on('widget', (w: { widgetType: string; data: unknown }) =>
      this.currentOnEvent?.({ type: 'widget', widgetType: w.widgetType, data: w.data }),
    );
  }

  /**
   * The turn currently in flight, as seen by a pooled session's hooks and
   * gate. Non-null for the whole duration of a turn (TurnQueue guarantees
   * one at a time). A hook firing with no active turn would mean a
   * subprocess acted outside any turn at all — audit it under a sentinel
   * rather than crash the hook and let the tool call proceed unrecorded.
   */
  private get turn(): { ctx: GateContext; perf: PerfRecorder; chatId: string; kind: TurnKind } {
    return (
      this.turnCtx ?? {
        ctx: { chatId: null, sessionKind: 'cron', standingOrders: '' },
        perf: nullPerf(),
        chatId: 'orphan',
        kind: 'cron',
      }
    );
  }

  /**
   * Pool key. Per chat, so two conversations never share a subprocess and
   * therefore never share the CLI's own conversation state. Scheduled kinds
   * are keyed separately from user chats even when they reuse a chat row, so
   * a cron turn can't evict the chat Ben is mid-conversation in.
   */
  private sessionKey(req: TurnRequest): string {
    return req.kind === 'user' ? `user:${req.chatId}` : `${req.kind}:${req.chatId}`;
  }

  /** Chat id of the turn executing right now, else null — lets the
   *  gateway tell a (re)loading tab "this chat is live, follow along"
   *  (reattach-on-load, gateway/app.ts's /api/chats/:id/messages). */
  get currentChat(): string | null {
    return this.currentChatId;
  }

  /**
   * Abort the in-flight turn (optionally only if it belongs to chatId).
   *
   * Prefers the SDK's own interrupt over an AbortController: aborting tears
   * the subprocess down, which on a pooled session throws away a warm CLI
   * that the next turn would otherwise reuse. The SDK interrupt stops the
   * turn and leaves the session standing. The abort path remains as the
   * fallback for one-shot (scheduled) turns and for a session that has
   * already gone away.
   */
  interrupt(chatId?: string): boolean {
    if (!this.currentChatId) return false;
    if (chatId && this.currentChatId !== chatId) return false;
    const key = `user:${this.currentChatId}`;
    void this.sessions.interrupt(key).then((ok) => {
      if (!ok) this.currentAbort?.abort();
    });
    return true;
  }

  /**
   * Refresh plan rate-limit state from the SDK's usage snapshot, if a live
   * session can answer. Returns true when something was actually recorded.
   *
   * Deliberately best-effort: the primary ingest is the push path in
   * handleMessage. This is the supplement that runs on the heartbeat, and a
   * false return means "no fresh reading available", never "utilization is
   * zero". Callers must treat those as different.
   */
  async refreshRateLimits(): Promise<boolean> {
    const usage = await this.sessions.pollUsage();
    if (!usage) return false;
    return recordUsageSnapshot(this.opts.db, usage);
  }

  /** Serialized entry point: all turns pass through the queue. */
  run(req: TurnRequest): Promise<{ stopReason: string; sessionId: string | null }> {
    // Time spent waiting behind another turn is latency Ben feels but that no
    // model-side metric would ever explain, so it gets its own span.
    const stopWait = req.perf?.start('queue_wait', { label: req.kind });
    return this.queue.submit(req.kind, () => {
      stopWait?.({ depth: this.queue.depth });
      return this.executeTurn(req);
    });
  }

  /**
   * Name a conversation from its opening exchange (§9.2 nano route). Runs OFF
   * the turn queue: it is a stateless, tool-less read that shares no state with
   * the active turn, so it must not wait behind — or block — the next user turn.
   * Never throws; returns null when a title can't be produced.
   */
  titleFor(userText: string, assistantText: string): Promise<string | null> {
    return generateTitle(this.queryFn, { userText, assistantText });
  }

  private chatRow(chatId: string): {
    sdk_session_id: string | null;
    model_override: string | null;
    register: Register | null;
    desk_streak: number;
  } {
    const row = this.opts.db
      .prepare('SELECT sdk_session_id, model_override, register, desk_streak FROM chat WHERE id = ?')
      .get(chatId) as
      | { sdk_session_id: string | null; model_override: string | null; register: Register | null; desk_streak: number }
      | undefined;
    if (!row) throw new Error(`unknown chat ${chatId}`);
    return row;
  }

  /**
   * Settle this chat's register (§runtime/register.ts) and persist it when it
   * moves. Only user turns have a register: scheduled turns have no message
   * from Ben to read, and their effort is already fixed by their route.
   */
  private settleRegister(req: TurnRequest, chat: { register: Register | null; desk_streak: number }): Register | null {
    if (req.kind !== 'user') return null;
    const next = nextRegister({ register: chat.register, deskStreak: chat.desk_streak }, req.prompt);
    if (next.register !== chat.register || next.deskStreak !== chat.desk_streak) {
      this.opts.db
        .prepare('UPDATE chat SET register = ?, desk_streak = ? WHERE id = ?')
        .run(next.register, next.deskStreak, req.chatId);
    }
    return next.register;
  }

  private async executeTurn(
    req: TurnRequest,
    execOpts: {
      /** Retry a refusal on a fallback model (§14) — unrelated to continuation. */
      modelOverride?: string;
      /** How many auto-continuations already ran for this originating user turn. */
      continuationDepth?: number;
      /** num_turns reported by the previous round, to detect a stuck loop. */
      lastNumTurns?: number;
      /** Consecutive prior continuations that reported no new num_turns. */
      noProgressStreak?: number;
    } = {},
  ): Promise<{ stopReason: string; sessionId: string | null }> {
    const { modelOverride, continuationDepth = 0, lastNumTurns, noProgressStreak = 0 } = execOpts;
    const chat = this.chatRow(req.chatId);
    const routed = modelOverride
      ? { model: modelOverride, effort: 'xhigh' as string }
      : route({ kind: req.kind, override: chat.model_override, deep: req.deep });
    const model = routed.model;
    // Register decides effort, not model: a desk turn is still Opus 5, just
    // told to spend less. Dropping to a smaller model for logging would save
    // more, but it would also mean Ben's quick asides get answered by an
    // entity that hasn't read his charter the same way — the register split
    // is about depth, not about who's talking.
    const register = this.settleRegister(req, chat);
    const effort = modelOverride ? routed.effort : effortForRegister(register ?? 'counsel', routed.effort);

    const messageId = randomUUID();
    const perf =
      req.perf ??
      (perfEnabled()
        ? createPerfRecorder({ db: this.opts.db, turnId: messageId, chatId: req.chatId, sessionKind: req.kind })
        : nullPerf());
    perf.describe({ model });
    const turnClock = perf.start('turn_total');

    const stopRead = perf.start('prompt_assemble', { label: 'STANDING_ORDERS.md' });
    const standingOrders = this.safeRead('STANDING_ORDERS.md');
    stopRead();
    const ctx: GateContext = { chatId: req.chatId, sessionKind: req.kind, standingOrders };
    const abort = req.abort ?? new AbortController();
    this.currentOnEvent = req.onEvent;
    this.currentAbort = abort;
    this.currentChatId = req.chatId;
    req.onEvent({ type: 'turn-start', messageId, chatId: req.chatId, model });

    // §9.3: systemPrompt must be byte-stable across turns for the SDK's
    // prompt cache to hit — everything per-turn (datetime, interlocutor,
    // lessons, snapshot, topic domain files) is wrapped into the message
    // instead, never glued into the system prompt.
    const stopAssemble = perf.start('prompt_assemble', { label: 'promptCore' });
    // capacity is resolved HERE rather than by each caller: every turn in the
    // system funnels through run(), so this is the one place that cannot be
    // forgotten by a future call site.
    const { systemPrompt, turnContext } = assemblePrompt(this.opts.memory, {
      kind: req.kind,
      ...req.promptInput,
      capacity: capacityLine(this.opts.db) ?? undefined,
    });
    const wrappedPrompt = `<turn-context>\n${turnContext}\n</turn-context>\n\n${req.prompt}`;
    stopAssemble({ systemPromptChars: systemPrompt.length, turnContextChars: turnContext.length });

    // Every turn is now an SDKUserMessage, images or not. Before the session
    // pool, a text-only turn passed a plain string as `prompt` and only a
    // vision turn built a message object; with a long-lived input stream
    // there is exactly one shape, and images are just extra content blocks
    // (§ vision spike, 2026-07-11).
    const images = req.images ?? [];
    const userMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: wrappedPrompt },
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
          })),
        ],
      },
      parent_tool_use_id: null,
    };

    let sessionId: string | null = chat.sdk_session_id;
    let stopReason = 'end_turn';
    let sawRefusal = false;
    let lastToolName: string | null = null;
    let numTurns: number | null = null;
    // Step 0 diagnostic harness — see diagLog() above.
    let stepCount = 0;
    const cumUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

    // Latency probes. `initAt` anchors the time-to-first-* measurements to the
    // moment the CLI subprocess was actually ready, so subprocess spawn cost
    // (sdk_spawn) and model cost (ttf_*) stay separable — the whole point of
    // the exercise, since one is ours to fix and the other isn't.
    let initAt = 0;
    let stepAt = 0;
    let sawThinking = false;
    let sawText = false;
    let sawTool = false;
    let toolCount = 0;
    /** tool_use id → the open 'tool' span, closed by its matching tool_result. */
    const openTools = new Map<string, { name: string; stop: (meta?: Record<string, unknown>) => void }>();
    const stopSpawn = perf.start('sdk_spawn');
    let spawnRecorded = false;

    // The options object is built ONCE per CLI subprocess, not once per turn:
    // a pooled session reuses the object it was spawned with. So nothing in
    // here may close over this turn's mutable state — hooks and the gate read
    // `this.turn`, the holder the pool swaps at the start of every turn.
    // Capturing `perf`/`ctx` here instead would silently attribute turn 7's
    // audit rows and spans to turn 1. (`model`, `effort`, `systemPrompt` and
    // `kind` ARE captured, deliberately: they're in the SessionSpec, so a turn
    // that changes any of them gets a fresh subprocess rather than this one.)
    const buildQueryOptions = (): Record<string, unknown> => ({
          model,
          effort,
          agents: AGENTS,
          cwd: this.opts.cwd ?? '/srv/benloe',
          additionalDirectories: [this.opts.dataDir ?? '/srv/benloe/data/cabinet'],
          systemPrompt,
          resume: req.kind === 'user' ? (chat.sdk_session_id ?? undefined) : undefined,
          maxTurns: MAX_TURNS_BY_KIND[req.kind],
          includePartialMessages: true,
          // Opus 5 migration (2026-08-01). maxTurns is a cliff: the turn runs
          // full speed into the wall and gets cut off mid-action, which is
          // what the continuation machinery below exists to paper over. A task
          // budget is the graceful version — the model sees a server-side
          // countdown across the whole agentic loop and paces itself, wrapping
          // up with a real answer instead of being guillotined. Advisory, not
          // enforced; maxTurns stays as the hard ceiling.
          //
          // Only sent for models that support it (Opus/Fable — NOT Sonnet 5 or
          // Haiku, where the API rejects it), and sized well above observed
          // per-turn spend: an undersized budget makes the model decline or
          // scope down the work, which is a far worse failure than a long turn.
          ...(taskBudgetFor(model, req.kind) ? { taskBudget: { total: taskBudgetFor(model, req.kind)! } } : {}),
          // Pin the permission mode explicitly. The SDK 0.3.202 -> 0.3.210
          // upgrade (2026-07-16) changed the headless default away from
          // 'default': non-pre-approved built-in tools (Bash/Read/Grep/Glob/
          // Edit/Write) started getting mode-auto-denied BEFORE canUseTool or
          // the PreToolUse hook were ever consulted (no action_audit rows for
          // them; tool_result was the CLI's canned "The user doesn't want to
          // take this action right now" deny). We rely on canUseTool as the
          // headless permission handler, so we must state 'default' — the only
          // mode that routes an un-pre-approved tool through canUseTool instead
          // of a classifier/auto-deny. Everything is still allowed there
          // (gate returns allow under autonomy:'full'); HARD_DENIES stays the
          // floor via disallowedTools.
          permissionMode: 'default',
          settingSources: [],
          // Step 1: tighten native auto-compact so it can actually fire
          // mid-turn instead of sitting at ~96.6% of the window (see
          // AUTO_COMPACT_WINDOW above). Shallow-merges into the flag
          // settings layer — does not touch permissions or anything else.
          settings: { autoCompactWindow: AUTO_COMPACT_WINDOW },
          // Appendix B: gated tools must NOT be listed here — bare entries
          // auto-approve before canUseTool. Only ungated cabinet tools appear.
          allowedTools: this.opts.allowedTools ?? [],
          disallowedTools: HARD_DENIES,
          mcpServers: this.opts.mcpServers as never,
          canUseTool: async (toolName: string, input: Record<string, unknown>) => {
            // The gate sits in the critical path of EVERY non-pre-approved
            // tool call; if classification or the audit insert ever gets
            // expensive, this is where it shows up.
            const stop = this.turn.perf.start('gate', { label: toolName });
            const r = await this.gate(toolName, input, this.turn.ctx);
            stop({ behavior: r.behavior });
            return r.behavior === 'allow'
              ? { behavior: 'allow' as const, updatedInput: r.updatedInput }
              : { behavior: 'deny' as const, message: r.message };
          },
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (hookInput: { tool_name?: string; tool_input?: unknown }) => {
                    const stop = this.turn.perf.start('hook_pre', { label: hookInput.tool_name ?? 'unknown' });
                    // Audit-only hook: covers the narrow auto-approved class
                    // that never reaches canUseTool (Appendix B).
                    this.opts.db
                      .prepare(
                        'INSERT INTO action_audit (tool, args, decision, chat_id, session_kind) VALUES (?,?,?,?,?)',
                      )
                      .run(
                        `pre:${hookInput.tool_name ?? 'unknown'}`,
                        JSON.stringify(hookInput.tool_input ?? {}).slice(0, 2000),
                        'observed',
                        this.turn.chatId,
                        this.turn.kind,
                      );
                    stop();
                    return {};
                  },
                ],
              },
            ],
            // Step 3 (2026-07-16, token-cost work w/ benji): deterministic
            // HEAD+TAIL truncation of large built-in tool results. This
            // handles the WITHIN-a-turn gap Step 1's compaction can't — a
            // big Bash/Read output at step 10 of a long turn otherwise gets
            // re-sent verbatim on every subsequent step until the turn grows
            // enough to trip the compact threshold. Deliberately synchronous
            // and non-LLM (see toolTruncate.ts doc comment). Defensive
            // try/catch: a hook throwing must never break the tool call
            // itself, so on any unexpected shape we just pass the original
            // response through untouched and log why.
            PostToolUse: [
              {
                hooks: [
                  async (hookInput: { tool_name?: string; tool_response?: unknown }) => {
                    const stopHook = this.turn.perf.start('hook_post', { label: hookInput.tool_name ?? 'unknown' });
                    try {
                      const name = hookInput.tool_name;
                      const resp = hookInput.tool_response as Record<string, unknown> | undefined;
                      if (!resp) return {};
                      if (name === 'Bash') {
                        if (resp.isImage || typeof resp.stdout !== 'string') return {};
                        const { text, wasTruncated, originalChars } = truncateForModel(resp.stdout, 'Bash output');
                        if (!wasTruncated) return {};
                        this.diagLog({ kind: 'tool-truncate', chatId: this.turn.chatId, tool: name, originalChars });
                        return {
                          hookSpecificOutput: {
                            hookEventName: 'PostToolUse' as const,
                            updatedToolOutput: { ...resp, stdout: text },
                          },
                        };
                      }
                      if (name === 'Read') {
                        if (resp.type !== 'text') return {};
                        const file = resp.file as Record<string, unknown> | undefined;
                        if (!file || typeof file.content !== 'string') return {};
                        const { text, wasTruncated, originalChars } = truncateForModel(file.content, 'file read');
                        if (!wasTruncated) return {};
                        this.diagLog({ kind: 'tool-truncate', chatId: this.turn.chatId, tool: name, originalChars });
                        return {
                          hookSpecificOutput: {
                            hookEventName: 'PostToolUse' as const,
                            updatedToolOutput: { ...resp, file: { ...file, content: text } },
                          },
                        };
                      }
                      return {};
                    } catch (err) {
                      this.diagLog({ kind: 'tool-truncate-error', chatId: this.turn.chatId, error: String(err) });
                      return {};
                    } finally {
                      stopHook();
                    }
                  },
                ],
              },
            ],
            // Step 1 fidelity check (2026-07-16): PreCompact/PostCompact are
            // observe-only in this SDK version — there is no
            // PreCompactHookSpecificOutput, so this cannot bias what the
            // native summarizer keeps (confirmed by grepping the runtime
            // bundle, not just the .d.ts). This just logs so we can eyeball
            // whether AUTO_COMPACT_WINDOW is firing and whether the summary
            // preserves current-task state well enough to trust.
            PreCompact: [
              {
                hooks: [
                  async (hookInput: { trigger?: string; custom_instructions?: string | null }) => {
                    this.diagLog({
                      kind: 'precompact',
                      chatId: this.turn.chatId,
                      trigger: hookInput.trigger,
                      hasCustomInstructions: !!hookInput.custom_instructions,
                    });
                    return {};
                  },
                ],
              },
            ],
            PostCompact: [
              {
                hooks: [
                  async (hookInput: { trigger?: string; compact_summary?: string }) => {
                    const summary = hookInput.compact_summary ?? '';
                    this.diagLog({
                      kind: 'postcompact',
                      chatId: this.turn.chatId,
                      trigger: hookInput.trigger,
                      summaryLength: summary.length,
                      summaryPreview: summary.slice(0, 2000),
                    });
                    return {};
                  },
                ],
              },
            ],
          },
    });

    const spec: SessionSpec = {
      model,
      effort,
      systemPrompt,
      cwd: this.opts.cwd ?? '/srv/benloe',
      maxTurns: MAX_TURNS_BY_KIND[req.kind],
    };
    this.turnCtx = { ctx, perf, chatId: req.chatId, kind: req.kind };

    const handleMessage = (msg: Record<string, any>): void => {
      // Plan rate-limit telemetry rides in on turns Cabinet is already
      // running — no extra request, and no dependency on the experimental
      // usage control method. recordRateLimitEvent swallows its own errors:
      // capacity accounting must never be able to kill a turn.
      if (msg.type === 'rate_limit_event') {
        recordRateLimitEvent(this.opts.db, msg.rate_limit_info);
        return;
      }
      if (msg.type === 'system' && msg.subtype === 'thinking_tokens') {
        if (!sawThinking && initAt) {
          sawThinking = true;
          perf.mark('ttf_thinking', performance.now() - initAt, { meta: { step: stepCount, redacted: true } });
        }
        req.onEvent({ type: 'thinking-tokens', estimated: Number(msg.estimated_tokens) || 0 });
        return;
      }
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id ?? sessionId;
        // Record whether the cabinet MCP toolset actually came up for this
        // query. Nothing else does, and on 2026-08-08 a one-turn drop left no
        // server-side trace at all (task 58).
        //
        // The counts ride on the spawn span's meta rather than perf.describe():
        // describe() sets the three row-level columns (chatId, sessionKind,
        // model) and silently drops anything else, so it could not carry these
        // even if it took them. The spawn span is where they belong anyway —
        // "what did this query launch with" is a property of the launch.
        const mcp = readMcpStatus(msg as never);
        const line = describeTransition(lastMcpStatus, mcp);
        if (line) console.warn(`[mcp-health] chat=${req.chatId} ${line}`);
        lastMcpStatus = mcp;
        stopSpawn({ resumed: !!chat.sdk_session_id, mcpTools: mcp.toolCount, mcpHealthy: mcp.healthy });
        initAt = performance.now();
        stepAt = initAt;
        return;
      }
      if (msg.type === 'stream_event') {
        const ev = msg.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          if (!sawText && initAt) {
            sawText = true;
            perf.mark('ttf_text', performance.now() - initAt, { meta: { step: stepCount } });
          }
          req.onEvent({ type: 'text-delta', delta: ev.delta.text });
        } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
          // Summarized-thinking path: real reasoning text. On the
          // subscription/redacted path these frames carry no `thinking`
          // string at all (only a token estimate, handled above as
          // thinking-tokens), so an empty delta is normal — drop it rather
          // than emitting an event that renders as nothing.
          const text = typeof ev.delta.thinking === 'string' ? ev.delta.thinking : '';
          if (!text) return;
          if (!sawThinking && initAt) {
            sawThinking = true;
            perf.mark('ttf_thinking', performance.now() - initAt, { meta: { step: stepCount } });
          }
          req.onEvent({ type: 'thinking-delta', delta: text });
        }
        return;
      }
      if (msg.type === 'assistant') {
        stepCount++;
        if (stepAt) {
          perf.mark('step', performance.now() - stepAt, { meta: { step: stepCount } });
          stepAt = performance.now();
        }
        req.onEvent({
          type: 'step',
          step: stepCount,
          tools: toolCount,
          elapsedMs: initAt ? Math.round(performance.now() - initAt) : 0,
        });
        const stepUsage = msg.message?.usage as Record<string, number> | undefined;
        if (stepUsage) {
          cumUsage.input_tokens += stepUsage.input_tokens ?? 0;
          cumUsage.output_tokens += stepUsage.output_tokens ?? 0;
          cumUsage.cache_creation_input_tokens += stepUsage.cache_creation_input_tokens ?? 0;
          cumUsage.cache_read_input_tokens += stepUsage.cache_read_input_tokens ?? 0;
        }
        // Step 0 diagnostic harness: every 20 internal steps of a user
        // turn, snapshot the running usage sum plus a full context-usage
        // breakdown (which tool is actually eating the window, and
        // whether native auto-compact is even enabled/firing today).
        if (req.kind === 'user' && stepCount % 20 === 0) {
          // Snapshot stepCount now — by the time getContextUsage()'s
          // promise resolves, later assistant messages may have already
          // ticked it forward (caught 2026-07-16: an earlier version read
          // the closure-captured live value inside .then(), mislabeling
          // the reading by however many steps elapsed before it resolved).
          const stepAtCall = stepCount;
          this.diagLog({ kind: 'usage-diag', chatId: req.chatId, step: stepAtCall, cumUsage: { ...cumUsage } });
          this.sessions
            .contextUsage(req.chatId)
            ?.then((ctx: Record<string, any>) =>
              this.diagLog({
                kind: 'ctx-diag',
                chatId: req.chatId,
                step: stepAtCall,
                totalTokens: ctx.totalTokens,
                maxTokens: ctx.maxTokens,
                percentage: ctx.percentage,
                isAutoCompactEnabled: ctx.isAutoCompactEnabled,
                autoCompactThreshold: ctx.autoCompactThreshold,
                messageBreakdown: ctx.messageBreakdown,
              }),
            )
            .catch((err) => this.diagLog({ kind: 'ctx-diag-error', chatId: req.chatId, step: stepAtCall, error: String(err) }));
        }
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_use') {
            if (!sawTool && initAt) {
              sawTool = true;
              perf.mark('ttf_tool', performance.now() - initAt, {
                label: block.name,
                // The narration check, as data: did any visible text reach
                // Ben before the first tool call, or did the turn dive
                // straight in? Queryable regression test for the voice rule.
                meta: { step: stepCount, narratedFirst: sawText },
              });
            }
            toolCount++;
            openTools.set(block.id, {
              name: block.name,
              stop: perf.start('tool', { label: block.name }),
            });
            req.onEvent({ type: 'tool-start', toolId: block.id, name: block.name, input: block.input });
            lastToolName = block.name;
          }
        }
        return;
      }
      if (msg.type === 'user') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_result') {
            const text =
              typeof block.content === 'string'
                ? block.content
                : (block.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
            const open = openTools.get(block.tool_use_id);
            if (open) {
              open.stop({ isError: !!block.is_error, outputChars: text.length });
              openTools.delete(block.tool_use_id);
            }
            req.onEvent({ type: 'tool-end', toolId: block.tool_use_id, output: text.slice(0, 4000), isError: !!block.is_error });
          }
        }
        return;
      }
      if (msg.type === 'result') {
        stopReason = msg.subtype ?? 'end_turn';
        numTurns = typeof msg.num_turns === 'number' ? msg.num_turns : null;
        sawRefusal = /refusal/i.test(String(msg.result ?? '')) && msg.subtype !== 'success';
        if (req.kind === 'user') {
          // Reconciliation: does our per-step sum match the CLI's own
          // final aggregate? A mismatch means the instrumentation's
          // assumption (each assistant message's usage is that one API
          // call's own usage, summable across the turn) is wrong.
          this.diagLog({ kind: 'usage-diag-final', chatId: req.chatId, steps: stepCount, cumUsage, resultUsage: msg.usage ?? null });
        }
        this.recordUsage(model, req, msg);
        req.onEvent({
          type: 'turn-end',
          usage: (msg.usage as Record<string, unknown>) ?? null,
          sessionId,
          stopReason,
        });
      }
    };

    try {
      const { spawned } = await this.sessions.runTurn({
        key: this.sessionKey(req),
        spec,
        buildOptions: buildQueryOptions,
        message: userMessage,
        onMessage: handleMessage,
        // Scheduled turns fire minutes or hours apart. Holding a subprocess
        // open between a 10:30am briefing and a 3:30pm ping buys nothing and
        // costs memory, so they stay one-shot — the pre-pool behavior.
        ephemeral: !this.poolEnabled || req.kind !== 'user',
      });
      // Reused sessions genuinely cost ~0 here; recording the span either way
      // (rather than skipping it) is what makes "did pooling actually work"
      // answerable from perf_span instead of from vibes.
      stopSpawn({ spawned, reused: !spawned });
      spawnRecorded = true;
    } catch (err) {
      req.onEvent({ type: 'error', message: String((err as Error).message ?? err).slice(0, 500), retryable: true });
      throw err;
    } finally {
      this.currentOnEvent = null;
      this.currentAbort = null;
      this.currentChatId = null;
      this.turnCtx = null;
      // A tool still open here never got its result — an abort, an error, or
      // a turn that ended mid-flight. Close the span rather than dropping it,
      // so "aborted during a 90s Bash" is visible in the data.
      if (!spawnRecorded) stopSpawn({ failed: true });
      for (const [, open] of openTools) open.stop({ orphaned: true });
      openTools.clear();
      turnClock({ steps: stepCount, tools: toolCount, stopReason });
      // A continuation re-enters executeTurn with a fresh recorder; flushing
      // here means each round's spans land under its own turn_id instead of
      // being lost if a later round throws.
      if (!req.perf) perf.flush();
    }

    if (sessionId && sessionId !== chat.sdk_session_id) {
      this.opts.db
        .prepare("UPDATE chat SET sdk_session_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(sessionId, req.chatId);
    }

    // Continuation-on-limit (build 3): see MAX_AUTO_CONTINUATIONS above for
    // the rationale. Only kind=='user' turns auto-continue — scheduled kinds
    // (heartbeat/cron) have much lower ceilings already and re-fire on their
    // own schedule, so they just get the notice and stop. A stuck loop (two
    // consecutive continuations reporting the same num_turns as the round
    // before them — i.e. no new session activity) pauses for a human even
    // under the depth cap.
    if (classifyStop(stopReason) === 'max_turns_cutoff') {
      const maxTurns = MAX_TURNS_BY_KIND[req.kind];
      const lastActionNote = lastToolName ? ` (last action: ${lastToolName})` : '';
      if (req.kind !== 'user' || modelOverride) {
        req.onEvent({
          type: 'notice',
          level: 'warn',
          text: `Hit the ${maxTurns}-step limit for this ${req.kind} turn${lastActionNote} — not auto-continuing.`,
        });
      } else {
        const madeProgress = lastNumTurns === undefined || numTurns === null || numTurns !== lastNumTurns;
        const streak = madeProgress ? 0 : noProgressStreak + 1;
        if (streak >= 2) {
          req.onEvent({
            type: 'notice',
            level: 'warn',
            text: `Hit the ${maxTurns}-step limit again with no progress since the last continuation${lastActionNote} — pausing after ${streak} continuations with no progress; reply "continue" to resume.`,
          });
        } else if (continuationDepth >= MAX_AUTO_CONTINUATIONS) {
          req.onEvent({
            type: 'notice',
            level: 'warn',
            text: `Hit the ${maxTurns}-step limit and the auto-continue cap (${MAX_AUTO_CONTINUATIONS}/${MAX_AUTO_CONTINUATIONS})${lastActionNote} — reply "continue" to resume.`,
          });
        } else {
          req.onEvent({
            type: 'notice',
            level: 'info',
            text: `Hit the ${maxTurns}-step limit${lastActionNote} — auto-continuing (${continuationDepth + 1}/${MAX_AUTO_CONTINUATIONS})…`,
          });
          return this.executeTurn(
            { ...req, prompt: 'Continue the previous task from where you left off.' },
            {
              continuationDepth: continuationDepth + 1,
              lastNumTurns: numTurns ?? undefined,
              noProgressStreak: streak,
            },
          );
        }
      }
    }

    // Fable 5 refusal → one retry on Opus 4.8 (§14).
    const fallback = refusalFallback(model);
    if (sawRefusal && fallback && !modelOverride) {
      req.onEvent({ type: 'notice', level: 'warn', text: `Fable 5 declined; retrying on ${fallback}.` });
      return this.executeTurn(req, { modelOverride: fallback });
    }

    return { stopReason, sessionId };
  }

  private safeRead(file: string): string {
    try {
      return this.opts.memory.read(file);
    } catch {
      return '';
    }
  }

  /**
   * Step 0 diagnostic harness (2026-07-16, joint design w/ benji): mid-turn
   * visibility into where a long user turn's cache_read actually goes,
   * before we tune options.settings.autoCompactWindow (Step 1) or add a
   * PostToolUse truncation hook (Step 2). Best-effort JSONL append under
   * CABINET_DATA_DIR — deliberately NOT console.log, since pm2 currently
   * writes to its own default (root-owned, unreadable) log dir rather than
   * the error_file/out_file paths in ecosystem.config.js. Strip this method
   * and its call sites once Steps 1-2 land and we no longer need to watch
   * this live.
   */
  private diagLog(record: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
    const path = join(this.opts.dataDir ?? '/srv/benloe/data/cabinet', 'usage-diag.jsonl');
    const p = appendFile(path, line).catch(() => {
      // best-effort only — never let diagnostic logging break a real turn
    });
    // Tracked so close() can wait for it. Untracked fire-and-forget writes
    // were the source of an intermittent ENOTEMPTY in the test suite: the
    // append landed after the temp dir had been removed.
    this.pendingWrites.add(p);
    void p.finally(() => this.pendingWrites.delete(p));
  }

  /**
   * Release everything this runtime holds: live CLI subprocesses and any
   * in-flight diagnostic writes. Called on shutdown, and by tests between
   * cases. Idempotent.
   */
  async close(): Promise<void> {
    this.sessions.closeAll();
    await Promise.allSettled([...this.pendingWrites]);
  }

  private recordUsage(model: string, req: TurnRequest, result: Record<string, any>): void {
    const u = result.usage ?? {};
    this.opts.db
      .prepare(
        `INSERT INTO token_usage (model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, session_kind, chat_id)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        model,
        u.input_tokens ?? 0,
        u.output_tokens ?? 0,
        u.cache_read_input_tokens ?? 0,
        u.cache_creation_input_tokens ?? 0,
        result.total_cost_usd ?? null,
        req.kind,
        req.chatId,
      );
  }
}
