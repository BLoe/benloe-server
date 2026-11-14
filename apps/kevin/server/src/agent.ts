// The agent loop: stream the model's reply, run the tools it calls (in
// parallel), feed the results back, repeat until the turn ends.
//
// Three rules shape this file, all from how the current models work:
//
//  1. Within a turn, the model's content is passed back exactly as it came,
//     thinking blocks included, and nothing earlier in the request changes.
//  2. When the turn is over, what is stored for future turns is text,
//     tool calls and tool results only. Thinking blocks are valid only against
//     the exact history that produced them, and Kevin's history does change
//     between turns (facts are saved, old turns are summarised), so they are
//     not carried across turns.
//  3. A message Ben sends mid-turn is delivered as his own words: a text block
//     in the user message that carries the tool results, after the last result.
import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bus, type UiItem } from './bus.js';
import { config } from './config.js';
import { nowIso } from './db.js';
import type { Kevin } from './kevin.js';
import { anthropic, record, spend } from './llm.js';
import { keywordSearch } from './memory.js';
import { contextBlock, factsBlock } from './prompt.js';
import type { ToolCtx } from './tools.js';

type Block = Anthropic.Beta.BetaContentBlockParam;
/** A conversation message. The API's own type also allows role 'system', which Kevin's history never holds. */
interface Msg {
  role: 'user' | 'assistant';
  content: Block[] | string;
}
type ToolItem = Extract<UiItem, { type: 'tool' }>;

export interface TurnInput {
  text: string;
  /** attachments.id values uploaded with this message */
  attachments?: number[];
  /** in-app path Ben is on, e.g. /pantry */
  page?: string | null;
  /** Ben asked for the deep model (the UI toggle, or "think hard" in the text). */
  deep?: boolean;
}

export interface TurnOpts {
  origin: 'chat' | 'job';
  jobKey?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** Stop the loop once this turn has cost this much (schedules). */
  spendCapUsd?: number;
}

/** Live state of a running turn; threads.ts owns one per thread. */
export interface TurnHandle {
  turnId: number;
  items: UiItem[];
  abort: AbortController;
  /** Messages Ben sent while this turn was running, not yet delivered. */
  pending: TurnInput[];
  confirms: Map<string, (approved: boolean) => void>;
  /** Prompt size of the last request, for the compaction decision. */
  lastPromptTokens: number;
}

export interface TurnResult {
  turnId: number;
  status: 'done' | 'error' | 'stopped' | 'refused' | 'blocked';
  text: string;
  costUsd: number;
  error?: string;
}

const MAX_ITERATIONS = 30;
const DEEP_RE = /\b(think (?:hard|harder|deeply|carefully)|ultrathink|use opus)\b/i;
const BETAS = ['thinking-display-updates-2026-08-18', 'server-side-fallback-2026-07-01'];

const WEB_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6, max_content_tokens: 25_000 },
] as unknown as Anthropic.Beta.BetaToolUnion[];

/** What is kept of a message once its turn is over (rule 2). */
export function stripForHistory(role: 'user' | 'assistant', content: Msg['content']): Block[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  const out: Block[] = [];
  for (const b of content as unknown as Record<string, unknown>[]) {
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ type: 'text', text: b.text });
    else if (role === 'assistant' && b.type === 'tool_use') out.push({ type: 'tool_use', id: b.id as string, name: b.name as string, input: b.input ?? {} });
    else if (role === 'user' && b.type === 'tool_result') {
      out.push({ type: 'tool_result', tool_use_id: b.tool_use_id as string, content: b.content as string, ...(b.is_error ? { is_error: true } : {}) });
    }
  }
  return out;
}

const TRIM_AFTER_TURNS = 6;
const TRIM_BATCH = 5;
const TRIM_TO_CHARS = 600;

/**
 * The thread's stored conversation, from after the compaction point.
 *
 * Tool results are most of what fills a thread, and an old one is rarely
 * needed in full. Results in turns more than TRIM_AFTER_TURNS back are cut to
 * their first TRIM_TO_CHARS characters. The boundary moves in steps of
 * TRIM_BATCH turns, because rewriting an old message invalidates the prompt
 * cache from that point: once every five turns, not once a turn.
 */
export function loadHistory(kevin: Kevin, threadId: string): { messages: Msg[]; summary: string | null } {
  const t = kevin.db.prepare('SELECT summary, summary_upto FROM threads WHERE id = ?').get(threadId) as { summary: string | null; summary_upto: number };
  const rows = kevin.db.prepare('SELECT turn_id, role, content FROM messages WHERE thread_id = ? AND id > ? ORDER BY id').all(threadId, t.summary_upto) as { turn_id: number; role: 'user' | 'assistant'; content: string }[];
  const turnIds = [...new Set(rows.map((r) => r.turn_id))];
  const trimCount = Math.max(0, Math.floor((turnIds.length - TRIM_AFTER_TURNS) / TRIM_BATCH) * TRIM_BATCH);
  const trimmed = new Set(turnIds.slice(0, trimCount));
  const messages = rows.map((r) => {
    const content = JSON.parse(r.content) as Block[];
    if (trimmed.has(r.turn_id)) {
      for (const b of content) {
        if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > TRIM_TO_CHARS) {
          b.content = `${b.content.slice(0, TRIM_TO_CHARS)}\n[older result trimmed from ${b.content.length} characters; run the tool again if the rest is needed]`;
        }
      }
    }
    return { role: r.role, content };
  });
  return { messages, summary: t.summary };
}

/** Marks the end of the conversation as a cache breakpoint, on a copy. */
function withBreakpoint(messages: Msg[]): Msg[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const blocks: Block[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...(last.content as Block[])];
  const tail = blocks.at(-1);
  if (tail && tail.type !== 'thinking' && tail.type !== 'redacted_thinking') {
    blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } } as Block;
  }
  return [...messages.slice(0, -1), { role: last.role, content: blocks }];
}

function attachmentBlocks(kevin: Kevin, ids: number[]): { note: string; images: Block[]; ui: { id: number; filename: string; mime: string }[] } {
  const images: Block[] = [];
  const notes: string[] = [];
  const ui: { id: number; filename: string; mime: string }[] = [];
  for (const id of ids) {
    const a = kevin.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
      | { id: number; filename: string; mime: string; path: string; kind: string; extracted_text: string | null; size: number }
      | undefined;
    if (!a) continue;
    ui.push({ id: a.id, filename: a.filename, mime: a.mime });
    notes.push(`[attachment #${a.id}: ${a.filename} (${a.mime})]\n${a.extracted_text?.trim() || '(no text was extracted)'}`);
    // The picture itself rides along for this turn only; history keeps the text.
    if (a.kind === 'image' && a.size <= 4_500_000 && /^image\/(png|jpeg|gif|webp)$/.test(a.mime)) {
      try {
        images.push({ type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: readFileSync(join(config.dataDir, a.path)).toString('base64') } });
      } catch (e) {
        console.error('attachment unreadable', a.id, e);
      }
    }
  }
  return { note: notes.join('\n\n'), images, ui };
}

export async function runTurn(kevin: Kevin, threadId: string, input: TurnInput, opts: TurnOpts, handle: TurnHandle): Promise<TurnResult> {
  const { db } = kevin;
  const deep = !!input.deep || DEEP_RE.test(input.text);
  const model = opts.model ?? (deep ? config.models.deep : config.models.main);
  const effort = opts.effort ?? (deep ? 'high' : 'low');
  const att = attachmentBlocks(kevin, input.attachments ?? []);
  const userUi = { text: input.text, attachments: att.ui, page: input.page ?? null };

  const turnId = Number(
    db.prepare('INSERT INTO turns (thread_id, started_at, origin, model, effort, user_ui) VALUES (?,?,?,?,?,?)').run(threadId, nowIso(), opts.origin, model, effort, JSON.stringify(userUi)).lastInsertRowid,
  );
  handle.turnId = turnId;
  handle.items = [];
  bus.publish({ type: 'turn_start', threadId, turnId, user: userUi });
  const pub = {
    text: (text: string) => bus.publish({ type: 'text_delta', threadId, turnId, text }),
    status: (text: string) => bus.publish({ type: 'status_delta', threadId, turnId, text }),
    tool: (item: ToolItem) => bus.publish({ type: 'tool', threadId, turnId, item }),
  };

  const finish = (status: TurnResult['status'], error?: string): TurnResult => {
    const items = handle.items.filter((i) => i.type !== 'text' && i.type !== 'status' ? true : i.text.trim().length > 0);
    for (const i of items) if (i.type === 'tool' && i.state === 'running') i.state = 'error';
    db.prepare('UPDATE turns SET ended_at = ?, status = ?, assistant_ui = ?, error = ? WHERE id = ?').run(nowIso(), status, JSON.stringify(items), error ?? null, turnId);
    db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(nowIso(), threadId);
    const costUsd = (db.prepare('SELECT cost_usd FROM turns WHERE id = ?').get(turnId) as { cost_usd: number }).cost_usd;
    bus.publish({ type: 'turn_end', threadId, turnId, status, costUsd, ...(error ? { error } : {}) });
    const text = items.filter((i): i is Extract<UiItem, { type: 'text' }> => i.type === 'text').map((i) => i.text).join('\n\n');
    return { turnId, status, text, costUsd, ...(error ? { error } : {}) };
  };

  const s = spend(db);
  if (s.blocked) {
    const msg = `This month's spend cap is reached ($${s.monthUsd.toFixed(2)} of $${s.capUsd.toFixed(2)}). Raise it in Settings to continue.`;
    handle.items.push({ type: 'text', text: msg });
    return finish('blocked', msg);
  }

  // ---- the request, fixed for the whole turn (rule 1) ----
  const { messages: history, summary } = loadHistory(kevin, threadId);
  const hits = opts.origin === 'chat' ? keywordSearch(db, input.text, 5, ['log-summary', 'log-note', 'document', 'recipe', 'space-record']) : [];
  const ctxText = contextBlock({ page: input.page, hits, origin: opts.origin });
  const userText = [input.text, att.note].filter(Boolean).join('\n\n');
  // A compaction summary rides in front of the first message after the cut
  // (request only; the stored rows are untouched).
  if (summary && history.length) {
    const first = history[0]!;
    history[0] = { role: first.role, content: [{ type: 'text', text: `<earlier_in_this_conversation>\n${summary}\n</earlier_in_this_conversation>` }, ...(first.content as Block[])] };
  }
  const storedUser: Block[] = [{ type: 'text', text: ctxText }, { type: 'text', text: userText || '(no text)' }];
  const turnMessages: Msg[] = [{ role: 'user', content: [...att.images, ...storedUser] }];

  const facts = factsBlock(db);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: kevin.stableSystem, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ...(facts ? [{ type: 'text' as const, text: facts }] : []),
  ];
  const tools = [...(kevin.tools.apiTools((t) => opts.origin === 'chat' || t.name !== 'shell') as unknown as Anthropic.Beta.BetaToolUnion[]), ...WEB_TOOLS];

  const persist = (endNote?: string) => {
    const msgs = [...turnMessages];
    // The first message is stored without this turn's image bytes.
    msgs[0] = { role: 'user', content: storedUser };
    if (endNote && msgs.at(-1)?.role === 'user') msgs.push({ role: 'assistant', content: [{ type: 'text', text: endNote }] });
    const ins = db.prepare('INSERT INTO messages (thread_id, turn_id, role, content) VALUES (?,?,?,?)');
    db.transaction(() => {
      for (const m of msgs) {
        const content = stripForHistory(m.role, m.content);
        if (content.length) ins.run(threadId, turnId, m.role, JSON.stringify(content));
      }
    })();
  };

  const ctx: ToolCtx = {
    db, source: opts.origin === 'job' ? 'job' : 'agent', threadId, turnId, jobKey: opts.jobKey ?? null, signal: handle.abort.signal,
    confirm: (summaryText) => {
      if (opts.origin === 'job') return Promise.resolve(false);
      const confirmId = randomUUID();
      return new Promise<boolean>((resolve) => {
        const done = (approved: boolean) => {
          clearTimeout(timer);
          handle.confirms.delete(confirmId);
          bus.publish({ type: 'confirm_resolved', threadId, confirmId, approved });
          resolve(approved);
        };
        const timer = setTimeout(() => done(false), 5 * 60_000);
        handle.confirms.set(confirmId, done);
        bus.publish({ type: 'confirm_request', threadId, turnId, confirmId, tool: 'confirm', summary: summaryText });
      });
    },
  };

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const stream = anthropic().beta.messages.stream(
        {
          model, max_tokens: 32_000, system, tools,
          messages: withBreakpoint([...history, ...turnMessages]),
          output_config: { effort },
          thinking: { type: 'adaptive', display: 'updates' },
          betas: BETAS,
          fallbacks: 'default',
        } as unknown as Anthropic.Beta.MessageCreateParamsStreaming,
        { signal: handle.abort.signal },
      );

      // Stream order is display order. index -> the UI item for that block.
      const byIndex = new Map<number, UiItem>();
      stream.on('streamEvent', (e) => {
        if (e.type === 'content_block_start') {
          const b = e.content_block as { type: string; id?: string; name?: string };
          let item: UiItem | null = null;
          const prev = handle.items.at(-1);
          if (b.type === 'text' && prev?.type === 'text') {
            // A cited answer arrives as several adjacent text blocks; it is one piece of prose.
            byIndex.set(e.index, prev);
            return;
          }
          if (b.type === 'text') item = { type: 'text', text: '' };
          else if (b.type === 'thinking') item = { type: 'status', text: '' };
          else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
            item = { type: 'tool', id: b.id!, name: b.name!, input: {}, state: 'running' };
            pub.tool(item);
          }
          if (item) {
            byIndex.set(e.index, item);
            handle.items.push(item);
          }
        } else if (e.type === 'content_block_delta') {
          const item = byIndex.get(e.index);
          const d = e.delta as { type: string; text?: string; thinking?: string };
          if (item?.type === 'text' && d.type === 'text_delta' && d.text) {
            item.text += d.text;
            pub.text(d.text);
          } else if (item?.type === 'status' && d.type === 'thinking_delta' && d.thinking) {
            item.text += d.thinking;
            pub.status(d.thinking);
          }
        } else if (e.type === 'content_block_stop') {
          bus.publish({ type: 'block_stop', threadId, turnId });
        }
      });

      const msg = await stream.finalMessage();
      handle.lastPromptTokens = (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
      record(db, { purpose: 'turn', threadId, turnId, jobKey: opts.jobKey }, msg.model || model, msg.usage);

      // Fill in what the stream did not carry: tool inputs, and how server tools ended.
      const blocks = msg.content as unknown as Record<string, unknown>[];
      const toolItems = new Map<string, ToolItem>(handle.items.filter((i): i is ToolItem => i.type === 'tool').map((i) => [i.id, i]));
      for (const b of blocks) {
        if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          const item = toolItems.get(b.id as string);
          if (item) item.input = b.input ?? {};
        } else if (typeof b.type === 'string' && b.type.endsWith('_tool_result') && typeof b.tool_use_id === 'string') {
          const item = toolItems.get(b.tool_use_id);
          if (item && item.state === 'running') {
            const failed = !Array.isArray(b.content) && (b.content as { type?: string } | null)?.type?.endsWith('error');
            item.state = failed ? 'error' : 'ok';
            pub.tool(item);
          }
        }
      }

      if (msg.stop_reason === 'refusal') {
        handle.items.push({ type: 'text', text: 'I can’t help with that request.' });
        persist('(Kevin declined this request.)');
        return finish('refused');
      }
      turnMessages.push({ role: 'assistant', content: msg.content as unknown as Block[] });
      if (msg.stop_reason === 'pause_turn') continue; // a long server-tool call; send it back to continue

      const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (!calls.length) {
        // Ben wrote while the last reply was streaming: answer that too.
        if (handle.pending.length && msg.stop_reason === 'end_turn') {
          turnMessages.push({ role: 'user', content: drainPending(handle, threadId, turnId) });
          continue;
        }
        if (msg.stop_reason === 'max_tokens') handle.items.push({ type: 'status', text: 'That reply hit the length limit and was cut off.' });
        persist();
        return finish('done');
      }

      const results: Block[] = await Promise.all(
        calls.map(async (call): Promise<Block> => {
          const item = toolItems.get(call.id) ?? { type: 'tool' as const, id: call.id, name: call.name, input: call.input, state: 'running' as const };
          pub.tool(item);
          const started = Date.now();
          // A call cut off by the length limit can carry a partial input that still parses.
          const r = msg.stop_reason === 'max_tokens'
            ? { ok: false, text: 'This call was cut off before its input was complete. Send it again, with smaller content if it was large.' }
            : await kevin.tools.call(call.name, call.input, ctx);
          item.state = r.ok ? 'ok' : r.text.startsWith('Ben declined') ? 'denied' : 'error';
          item.preview = r.text.slice(0, 600);
          item.ms = Date.now() - started;
          pub.tool(item);
          return { type: 'tool_result', tool_use_id: call.id, content: r.text, ...(r.ok ? {} : { is_error: true }) };
        }),
      );
      if (handle.abort.signal.aborted) throw new DOMException('stopped', 'AbortError');
      // Rule 3: Ben's mid-turn words go after the last tool result, as his.
      turnMessages.push({ role: 'user', content: [...results, ...(handle.pending.length ? drainPending(handle, threadId, turnId) : [])] });

      if (opts.spendCapUsd != null) {
        const cost = (db.prepare('SELECT cost_usd FROM turns WHERE id = ?').get(turnId) as { cost_usd: number }).cost_usd;
        if (cost >= opts.spendCapUsd) {
          persist(`(Stopped: this run reached its spend cap of $${opts.spendCapUsd.toFixed(2)}.)`);
          return finish('error', `spend cap of $${opts.spendCapUsd.toFixed(2)} reached`);
        }
      }
      if (spend(db).blocked) {
        handle.items.push({ type: 'text', text: 'Stopping here: this month’s spend cap is reached. Raise it in Settings to continue.' });
        persist('(Stopped: the monthly spend cap was reached.)');
        return finish('blocked', 'monthly spend cap reached');
      }
    }
    handle.items.push({ type: 'text', text: `I stopped after ${MAX_ITERATIONS} steps without finishing. Tell me to continue and I’ll pick it up.` });
    persist(`(Stopped after ${MAX_ITERATIONS} steps.)`);
    return finish('error', 'step limit reached');
  } catch (e) {
    const aborted = handle.abort.signal.aborted;
    const message = aborted ? 'stopped' : e instanceof Error ? e.message : String(e);
    if (!aborted) {
      console.error(`turn ${turnId} failed`, e);
      handle.items.push({ type: 'text', text: `Something went wrong on my side: ${message}` });
    }
    // Keep only complete exchanges: drop an assistant message whose tool calls never got results.
    const last = turnMessages.at(-1);
    if (last?.role === 'assistant' && Array.isArray(last.content) && (last.content as Block[]).some((b) => b.type === 'tool_use')) turnMessages.pop();
    try {
      persist(aborted ? '(Ben stopped this turn.)' : `(This turn failed: ${message})`);
    } catch (pe) {
      console.error('could not persist failed turn', pe);
    }
    return finish(aborted ? 'stopped' : 'error', aborted ? undefined : message);
  }
}

function drainPending(handle: TurnHandle, threadId: string, turnId: number): Block[] {
  const out: Block[] = [];
  for (const p of handle.pending.splice(0)) {
    bus.publish({ type: 'user_folded', threadId, turnId, text: p.text });
    handle.items.push({ type: 'status', text: `Ben: ${p.text}` });
    out.push({ type: 'text', text: p.text });
  }
  return out;
}
