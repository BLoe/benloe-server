import type Database from 'better-sqlite3';
import type { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage, AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { MemoryStore } from '../memory/index.js';
import type { ImageMime } from '../gateway/attachments.js';
import type { ApprovalQueue, ApprovalPacket } from '../tiers/approvals.js';
import { buildGate, type GateContext } from '../tiers/gate.js';
import { assemblePrompt, type PromptInput } from './prompt.js';
import { refusalFallback, route } from './router.js';
import { TurnQueue, type TurnKind } from './queue.js';
import { generateTitle } from './titler.js';

/**
 * Per-kind agentic-turn budget. User turns can involve multi-file builds,
 * test runs, and deploys, so they get real headroom; heartbeat/cron turns
 * are scheduled and meant to be cheap, so they stay tight.
 */
const MAX_TURNS_BY_KIND: Record<TurnKind, number> = { user: 120, cron: 12, heartbeat: 6 };

/**
 * Continuation-on-limit (build 3). A turn cut off by the SDK's maxTurns
 * ceiling used to just end, stranding mid-work with no automatic recovery —
 * the failure mode that cost ~30min on 2026-07-14. Bounded to this many
 * chained auto-resumes per originating user turn; tracked via a depth
 * counter threaded through the recursive executeTurn call, NOT a class
 * field, so concurrent chats never share or leak continuation state.
 */
export const MAX_AUTO_CONTINUATIONS = 3;

/** Was this turn cut off by the maxTurns ceiling, or did it end some other way (success, or any other terminal error)? */
export type TurnOutcome = 'clean' | 'max_turns_cutoff';

export function classifyStop(subtype: string | null | undefined): TurnOutcome {
  return subtype === 'error_max_turns' ? 'max_turns_cutoff' : 'clean';
}

/** §12.2 event vocabulary — the gateway maps these 1:1 onto SSE. */
export type TurnEvent =
  | { type: 'turn-start'; messageId: string; chatId: string; model: string }
  | { type: 'text-delta'; delta: string }
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

export class AgentRuntime {
  readonly queue = new TurnQueue();
  readonly authMode: 'subscription' | 'api';
  private queryFn: QueryFn;
  private gate;
  /** Single-flight (guaranteed by the queue): the active turn's sinks. */
  private currentOnEvent: ((e: TurnEvent) => void) | null = null;
  private currentAbort: AbortController | null = null;
  private currentChatId: string | null = null;

  constructor(private opts: RuntimeOptions) {
    this.queryFn = opts.queryFn ?? sdkQuery;
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

  /** Chat id of the turn executing right now, else null — lets the
   *  gateway tell a (re)loading tab "this chat is live, follow along"
   *  (reattach-on-load, gateway/app.ts's /api/chats/:id/messages). */
  get currentChat(): string | null {
    return this.currentChatId;
  }

  /** Abort the in-flight turn (optionally only if it belongs to chatId). */
  interrupt(chatId?: string): boolean {
    if (!this.currentAbort) return false;
    if (chatId && this.currentChatId !== chatId) return false;
    this.currentAbort.abort();
    return true;
  }

  /** Serialized entry point: all turns pass through the queue. */
  run(req: TurnRequest): Promise<{ stopReason: string; sessionId: string | null }> {
    return this.queue.submit(req.kind, () => this.executeTurn(req));
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

  private chatRow(chatId: string): { sdk_session_id: string | null; model_override: string | null } {
    const row = this.opts.db
      .prepare('SELECT sdk_session_id, model_override FROM chat WHERE id = ?')
      .get(chatId) as { sdk_session_id: string | null; model_override: string | null } | undefined;
    if (!row) throw new Error(`unknown chat ${chatId}`);
    return row;
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
    const { model, effort } = modelOverride
      ? { model: modelOverride, effort: 'xhigh' as const }
      : route({ kind: req.kind, override: chat.model_override, deep: req.deep });

    const standingOrders = this.safeRead('STANDING_ORDERS.md');
    const ctx: GateContext = { chatId: req.chatId, sessionKind: req.kind, standingOrders };
    const messageId = randomUUID();
    const abort = req.abort ?? new AbortController();
    this.currentOnEvent = req.onEvent;
    this.currentAbort = abort;
    this.currentChatId = req.chatId;
    req.onEvent({ type: 'turn-start', messageId, chatId: req.chatId, model });

    // §9.3: systemPrompt must be byte-stable across turns for the SDK's
    // prompt cache to hit — everything per-turn (datetime, interlocutor,
    // lessons, snapshot, topic domain files) is wrapped into the message
    // instead, never glued into the system prompt.
    const { systemPrompt, turnContext } = assemblePrompt(this.opts.memory, { kind: req.kind, ...req.promptInput });
    const wrappedPrompt = `<turn-context>\n${turnContext}\n</turn-context>\n\n${req.prompt}`;

    // Vision (§ vision spike, 2026-07-11): query()'s `prompt` accepts a plain
    // string OR an AsyncIterable<SDKUserMessage> (sdk.d.ts) — the latter is
    // the only way to attach ImageBlockParam content. A turn with no images
    // keeps the plain string (byte-for-byte the same as before); a turn with
    // images becomes a one-shot generator yielding a single user message
    // whose content array is [text, ...images]. This is the initial-prompt
    // form, not Query.streamInput() — we open a fresh query() every turn and
    // resume via sdk_session_id, so there's no already-open Query to stream
    // into.
    const images = req.images ?? [];
    const promptPayload: string | AsyncIterable<SDKUserMessage> =
      images.length === 0
        ? wrappedPrompt
        : (async function* () {
            const message: SDKUserMessage = {
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
            yield message;
          })();

    let sessionId: string | null = chat.sdk_session_id;
    let stopReason = 'end_turn';
    let sawRefusal = false;
    let lastToolName: string | null = null;
    let numTurns: number | null = null;

    try {
      const q = this.queryFn({
        prompt: promptPayload,
        options: {
          model,
          effort,
          agents: AGENTS,
          cwd: this.opts.cwd ?? '/srv/benloe',
          additionalDirectories: [this.opts.dataDir ?? '/srv/benloe/data/cabinet'],
          systemPrompt,
          resume: req.kind === 'user' ? (chat.sdk_session_id ?? undefined) : undefined,
          maxTurns: MAX_TURNS_BY_KIND[req.kind],
          includePartialMessages: true,
          settingSources: [],
          // Appendix B: gated tools must NOT be listed here — bare entries
          // auto-approve before canUseTool. Only ungated cabinet tools appear.
          allowedTools: this.opts.allowedTools ?? [],
          disallowedTools: HARD_DENIES,
          mcpServers: this.opts.mcpServers as never,
          canUseTool: async (toolName: string, input: Record<string, unknown>) => {
            const r = await this.gate(toolName, input, ctx);
            return r.behavior === 'allow'
              ? { behavior: 'allow' as const, updatedInput: r.updatedInput }
              : { behavior: 'deny' as const, message: r.message };
          },
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (hookInput: { tool_name?: string; tool_input?: unknown }) => {
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
                        req.chatId,
                        req.kind,
                      );
                    return {};
                  },
                ],
              },
            ],
          },
          abortController: abort,
        },
      } as Parameters<QueryFn>[0]);

      for await (const msg of q as AsyncIterable<Record<string, any>>) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          sessionId = msg.session_id ?? sessionId;
          continue;
        }
        if (msg.type === 'stream_event') {
          const ev = msg.event;
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            req.onEvent({ type: 'text-delta', delta: ev.delta.text });
          }
          continue;
        }
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'tool_use') {
              req.onEvent({ type: 'tool-start', toolId: block.id, name: block.name, input: block.input });
              lastToolName = block.name;
            }
          }
          continue;
        }
        if (msg.type === 'user') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'tool_result') {
              const text =
                typeof block.content === 'string'
                  ? block.content
                  : (block.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
              req.onEvent({ type: 'tool-end', toolId: block.tool_use_id, output: text.slice(0, 4000), isError: !!block.is_error });
            }
          }
          continue;
        }
        if (msg.type === 'result') {
          stopReason = msg.subtype ?? 'end_turn';
          numTurns = typeof msg.num_turns === 'number' ? msg.num_turns : null;
          sawRefusal = /refusal/i.test(String(msg.result ?? '')) && msg.subtype !== 'success';
          this.recordUsage(model, req, msg);
          req.onEvent({
            type: 'turn-end',
            usage: (msg.usage as Record<string, unknown>) ?? null,
            sessionId,
            stopReason,
          });
        }
      }
    } catch (err) {
      req.onEvent({ type: 'error', message: String((err as Error).message ?? err).slice(0, 500), retryable: true });
      throw err;
    } finally {
      this.currentOnEvent = null;
      this.currentAbort = null;
      this.currentChatId = null;
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
