// Tools: one definition serves the agent (as an API tool), the UI (as
// POST /api/act/<name>) and jobs. Writes go through here so that validation,
// the audit log, the daily event log and live page refresh happen in one
// place, whoever made the change.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { type DB, nowIso } from './db.js';
import { bus } from './bus.js';
import { logEvent } from './memory.js';

export interface ToolCtx {
  db: DB;
  source: 'agent' | 'ui' | 'job';
  threadId?: string | null;
  turnId?: number | null;
  jobKey?: string | null;
  /**
   * Ask Ben to approve something destructive. In a chat turn this shows a
   * confirm button and waits; from the UI it is true (Ben clicked it himself);
   * in a job nobody is there, so it is false.
   */
  confirm(summary: string): Promise<boolean>;
  signal?: AbortSignal;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Written for the model: what it does and when to use it. */
  description: string;
  input: S;
  /** Domains whose pages should refresh after a successful call. Presence marks the tool as a write. */
  touches?: string[];
  /** Callable from the UI via /api/act. Default: true when `touches` is set. */
  ui?: boolean;
  /** Offered to the model. Default true; false for things only Ben may do (raising the spend cap). */
  agent?: boolean;
  run(input: z.infer<S>, ctx: ToolCtx): unknown | Promise<unknown>;
}

export function defineTool<S extends z.ZodType>(t: ToolDef<S>): ToolDef {
  return t as unknown as ToolDef;
}

/** An error whose message is meant for the caller (the model or the UI). */
export class ToolError extends Error {}

const MAX_RESULT_CHARS = 40_000;

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(t: ToolDef): void {
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(t.name)) throw new Error(`bad tool name: ${t.name}`);
    if (this.tools.has(t.name)) throw new Error(`duplicate tool: ${t.name}`);
    this.tools.set(t.name, t);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name) ?? this.tools.get(name.toLowerCase());
  }

  list(): ToolDef[] {
    // Sorted: the tool list is part of the cached prompt prefix and must be byte-stable.
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Definitions in the shape the Messages API wants. */
  apiTools(filter?: (t: ToolDef) => boolean): Anthropic.Tool[] {
    return this.list()
      .filter((t) => t.agent !== false && (!filter || filter(t)))
      .map((t) => {
        const schema = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
        delete schema.$schema;
        return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema, eager_input_streaming: true };
      });
  }

  /** Runs a tool. Never throws: failures come back as { ok: false, text }. */
  async call(name: string, rawInput: unknown, ctx: ToolCtx): Promise<{ ok: boolean; text: string; value?: unknown }> {
    const started = Date.now();
    const tool = this.get(name);
    let ok = false;
    let text: string;
    let value: unknown;
    if (!tool) {
      text = `No tool named "${name}". Available: ${this.list().map((t) => t.name).join(', ')}`;
    } else if (ctx.source === 'ui' && !(tool.ui ?? !!tool.touches)) {
      text = `"${name}" is not callable from the UI.`;
    } else if (ctx.source !== 'ui' && tool.agent === false) {
      text = `"${name}" is something only Ben can do, from the app.`;
    } else {
      const parsed = tool.input.safeParse(rawInput ?? {});
      if (!parsed.success) {
        text = `Invalid input for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`;
      } else {
        try {
          value = await tool.run(parsed.data, ctx);
          ok = true;
          text = typeof value === 'string' ? value : JSON.stringify(value ?? { ok: true });
          if (text.length > MAX_RESULT_CHARS) {
            text = `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: result was ${text.length} characters. Narrow the request.]`;
          }
        } catch (e) {
          text = e instanceof ToolError ? e.message : `${tool.name} failed: ${e instanceof Error ? e.message : String(e)}`;
          if (!(e instanceof ToolError)) console.error(`tool ${tool.name} threw`, e);
        }
      }
    }
    const input = safeJson(rawInput);
    try {
      ctx.db
        .prepare('INSERT INTO tool_audit (at, source, thread_id, turn_id, tool, input, ok, result, ms) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(nowIso(), ctx.source, ctx.threadId ?? null, ctx.turnId ?? null, name, input.slice(0, 20_000), ok ? 1 : 0, text.slice(0, 2000), Date.now() - started);
    } catch (e) {
      console.error('audit write failed', e);
    }
    if (ok && tool?.touches?.length) {
      logEvent(ctx.db, `${tool.name} ${input.slice(0, 400)}`, ctx.threadId ?? null);
      bus.publish({ type: 'data_changed', domains: tool.touches });
    }
    return { ok, text, value };
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return '{}';
  }
}
