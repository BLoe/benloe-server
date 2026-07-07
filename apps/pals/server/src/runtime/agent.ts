import type Database from 'better-sqlite3';
import type { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { MemoryStore } from '../memory/index.js';
import type { ApprovalQueue, ApprovalPacket } from '../tiers/approvals.js';
import { buildGate, type GateContext } from '../tiers/gate.js';
import { assemblePrompt, type PromptInput } from './prompt.js';
import { refusalFallback, route } from './router.js';
import { TurnQueue, type TurnKind } from './queue.js';
import { generateTitle } from './titler.js';

/** §12.2 event vocabulary — the gateway maps these 1:1 onto SSE. */
export type TurnEvent =
  | { type: 'turn-start'; messageId: string; threadId: string; model: string }
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
  /** Extra allowedTools entries — ONLY ungated mcp__pals__* names (Appendix B). */
  allowedTools?: string[];
  /** render_widget emissions forward into the active turn's event stream. */
  widgetBus?: EventEmitter;
  queryFn?: QueryFn; // injectable for tests
  cwd?: string;
  dataDir?: string;
}

export interface TurnRequest {
  threadId: string;
  prompt: string;
  kind: TurnKind;
  deep?: boolean;
  abort?: AbortController;
  promptInput?: Partial<PromptInput>;
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
 * Configure Claude auth for the SDK subprocess (§9.1, validated Appendix B).
 * Exactly one credential is left in the environment; CLAUDE_CONFIG_DIR is
 * always isolated so ambient settings cannot shadow the gate.
 */
export function configureAuth(env: Record<string, string | undefined>): 'subscription' | 'api' {
  const mode = env.PALS_CLAUDE_AUTH === 'api' ? 'api' : 'subscription';
  if (mode === 'subscription') delete env.ANTHROPIC_API_KEY;
  else delete env.CLAUDE_CODE_OAUTH_TOKEN;
  env.CLAUDE_CONFIG_DIR ??= '/home/claude-worker/.pals-claude';
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
  private currentThreadId: string | null = null;

  constructor(private opts: RuntimeOptions) {
    this.queryFn = opts.queryFn ?? sdkQuery;
    this.authMode = configureAuth(process.env);
    this.gate = buildGate({
      db: opts.db,
      approvals: opts.approvals,
      // Autonomous by default (Ben's directive): execute + audit, no approval
      // friction. Set PALS_AUTONOMY=tiered to restore the 5-tier gate.
      autonomy: process.env.PALS_AUTONOMY === 'tiered' ? 'tiered' : 'full',
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

  /** Abort the in-flight turn (optionally only if it belongs to threadId). */
  interrupt(threadId?: string): boolean {
    if (!this.currentAbort) return false;
    if (threadId && this.currentThreadId !== threadId) return false;
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

  private threadRow(threadId: string): { sdk_session_id: string | null; model_override: string | null } {
    const row = this.opts.db
      .prepare('SELECT sdk_session_id, model_override FROM thread WHERE id = ?')
      .get(threadId) as { sdk_session_id: string | null; model_override: string | null } | undefined;
    if (!row) throw new Error(`unknown thread ${threadId}`);
    return row;
  }

  private async executeTurn(
    req: TurnRequest,
    modelOverride?: string,
  ): Promise<{ stopReason: string; sessionId: string | null }> {
    const thread = this.threadRow(req.threadId);
    const { model, effort } = modelOverride
      ? { model: modelOverride, effort: 'xhigh' as const }
      : route({ kind: req.kind, override: thread.model_override, deep: req.deep });

    const standingOrders = this.safeRead('STANDING_ORDERS.md');
    const ctx: GateContext = { threadId: req.threadId, sessionKind: req.kind, standingOrders };
    const messageId = randomUUID();
    const abort = req.abort ?? new AbortController();
    this.currentOnEvent = req.onEvent;
    this.currentAbort = abort;
    this.currentThreadId = req.threadId;
    req.onEvent({ type: 'turn-start', messageId, threadId: req.threadId, model });

    const systemPrompt = assemblePrompt(this.opts.memory, { kind: req.kind, ...req.promptInput });

    let sessionId: string | null = thread.sdk_session_id;
    let stopReason = 'end_turn';
    let sawRefusal = false;

    try {
      const q = this.queryFn({
        prompt: req.prompt,
        options: {
          model,
          effort,
          cwd: this.opts.cwd ?? '/srv/benloe',
          additionalDirectories: [this.opts.dataDir ?? '/srv/benloe/data/pals'],
          systemPrompt,
          resume: req.kind === 'user' ? (thread.sdk_session_id ?? undefined) : undefined,
          maxTurns: req.kind === 'heartbeat' ? 6 : 40,
          includePartialMessages: true,
          settingSources: [],
          // Appendix B: gated tools must NOT be listed here — bare entries
          // auto-approve before canUseTool. Only ungated pals tools appear.
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
                        'INSERT INTO action_audit (tool, args, decision, thread_id, session_kind) VALUES (?,?,?,?,?)',
                      )
                      .run(
                        `pre:${hookInput.tool_name ?? 'unknown'}`,
                        JSON.stringify(hookInput.tool_input ?? {}).slice(0, 2000),
                        'observed',
                        req.threadId,
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
      this.currentThreadId = null;
    }

    if (sessionId && sessionId !== thread.sdk_session_id) {
      this.opts.db
        .prepare("UPDATE thread SET sdk_session_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(sessionId, req.threadId);
    }

    // Fable 5 refusal → one retry on Opus 4.8 (§14).
    const fallback = refusalFallback(model);
    if (sawRefusal && fallback && !modelOverride) {
      req.onEvent({ type: 'notice', level: 'warn', text: `Fable 5 declined; retrying on ${fallback}.` });
      return this.executeTurn(req, fallback);
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
        `INSERT INTO token_usage (model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, session_kind, thread_id)
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
        req.threadId,
      );
  }
}
