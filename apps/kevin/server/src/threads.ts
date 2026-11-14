// Threads: one turn at a time per thread, threads independent of each other.
// A message sent while a turn is running is folded into that turn.
import { randomUUID } from 'node:crypto';
import { bus } from './bus.js';
import { nowIso } from './db.js';
import type { Kevin } from './kevin.js';
import { small } from './llm.js';
import { indexItem } from './memory.js';
import { runTurn, type TurnHandle, type TurnInput, type TurnOpts, type TurnResult } from './agent.js';

interface ThreadState {
  /** Tail of this thread's queue. */
  chain: Promise<unknown>;
  handle: TurnHandle | null;
}
const states = new Map<string, ThreadState>();
const stateOf = (id: string): ThreadState => {
  let s = states.get(id);
  if (!s) states.set(id, (s = { chain: Promise.resolve(), handle: null }));
  return s;
};

export interface ThreadRow {
  id: string; title: string; origin: string; created_at: string; updated_at: string; archived: number;
}

export function createThread(kevin: Kevin, origin: 'chat' | 'job' = 'chat', title = 'New chat'): ThreadRow {
  const id = randomUUID();
  const now = nowIso();
  kevin.db.prepare('INSERT INTO threads (id, title, origin, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, title, origin, now, now);
  return kevin.db.prepare('SELECT id, title, origin, created_at, updated_at, archived FROM threads WHERE id = ?').get(id) as ThreadRow;
}

export function listThreads(kevin: Kevin, includeArchived = false): (ThreadRow & { running: boolean })[] {
  const rows = kevin.db
    .prepare(`SELECT id, title, origin, created_at, updated_at, archived FROM threads ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY updated_at DESC LIMIT 200`)
    .all() as ThreadRow[];
  return rows.map((r) => ({ ...r, running: !!states.get(r.id)?.handle }));
}

export function getThread(kevin: Kevin, id: string) {
  const thread = kevin.db.prepare('SELECT id, title, origin, created_at, updated_at, archived FROM threads WHERE id = ?').get(id) as ThreadRow | undefined;
  if (!thread) return null;
  const handle = states.get(id)?.handle ?? null;
  const turns = (kevin.db.prepare('SELECT id, started_at, ended_at, status, model, user_ui, assistant_ui, error, cost_usd FROM turns WHERE thread_id = ? ORDER BY id').all(id) as Record<string, unknown>[]).map((t) => ({
    id: t.id as number, started_at: t.started_at, ended_at: t.ended_at, status: t.status, model: t.model, error: t.error, cost_usd: t.cost_usd,
    user: JSON.parse(t.user_ui as string) as unknown,
    // A running turn's items live in memory until it ends.
    items: handle && handle.turnId === t.id ? handle.items : (JSON.parse(t.assistant_ui as string) as unknown),
  }));
  // Confirms waiting on Ben, so a page loaded mid-turn can still show the buttons.
  const confirms = handle ? [...handle.confirmSummaries].map(([confirmId, summary]) => ({ confirmId, summary, turnId: handle.turnId })) : [];
  return { ...thread, running: !!handle, turns, confirms };
}

/**
 * Sends a message into a thread. If a turn is running there, the message is
 * folded into it and this resolves with null; otherwise it resolves with the
 * new turn's result when that turn ends.
 */
export function send(kevin: Kevin, threadId: string, input: TurnInput, opts: TurnOpts = { origin: 'chat' }): Promise<TurnResult | null> {
  const s = stateOf(threadId);
  if (s.handle && opts.origin === 'chat') {
    s.handle.pending.push(input);
    return Promise.resolve(null);
  }
  const run = s.chain.then(async () => {
    const handle: TurnHandle = { turnId: 0, items: [], abort: new AbortController(), pending: [], confirms: new Map(), confirmSummaries: new Map(), lastPromptTokens: 0 };
    s.handle = handle;
    try {
      const result = await runTurn(kevin, threadId, input, opts, handle);
      // Titles and compaction are model calls: only after a turn that really ran.
      if (result.status === 'done' || result.status === 'stopped') void afterTurn(kevin, threadId, handle).catch((e) => console.error('afterTurn failed', e));
      // Anything that arrived too late to fold becomes the next turn.
      for (const late of handle.pending.splice(0)) queueMicrotask(() => void send(kevin, threadId, late, opts));
      return result;
    } finally {
      s.handle = null;
    }
  });
  s.chain = run.catch(() => undefined);
  return run;
}

export function stop(threadId: string): boolean {
  const h = states.get(threadId)?.handle;
  if (!h) return false;
  for (const done of h.confirms.values()) done(false);
  h.abort.abort();
  return true;
}

export function resolveConfirm(threadId: string, confirmId: string, approved: boolean): boolean {
  const done = states.get(threadId)?.handle?.confirms.get(confirmId);
  if (!done) return false;
  done(approved);
  return true;
}

export const isRunning = (threadId: string): boolean => !!states.get(threadId)?.handle;

// ---- after a turn: title, compaction ---------------------------------------

const COMPACT_ABOVE_TOKENS = 60_000;
const KEEP_TURNS = 4;

async function afterTurn(kevin: Kevin, threadId: string, handle: TurnHandle): Promise<void> {
  const { db } = kevin;
  const t = db.prepare('SELECT title, origin FROM threads WHERE id = ?').get(threadId) as { title: string; origin: string };
  const turnCount = (db.prepare('SELECT COUNT(*) AS n FROM turns WHERE thread_id = ?').get(threadId) as { n: number }).n;
  if (t.title === 'New chat' && turnCount >= 1) {
    const first = db.prepare('SELECT user_ui, assistant_ui FROM turns WHERE thread_id = ? ORDER BY id LIMIT 1').get(threadId) as { user_ui: string; assistant_ui: string };
    const user = (JSON.parse(first.user_ui) as { text: string }).text.slice(0, 600);
    const reply = (JSON.parse(first.assistant_ui) as { type: string; text?: string }[]).filter((i) => i.type === 'text').map((i) => i.text).join(' ').slice(0, 600);
    try {
      const title = (await small(db, { purpose: 'title', threadId }, 'Write a title of at most five words for this conversation. Reply with the title only, no quotes.', `Ben: ${user}\n\nKevin: ${reply}`, 400))
        .replace(/^["'\s]+|["'\s.]+$/g, '').slice(0, 80);
      if (title) {
        db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(title, threadId);
        bus.publish({ type: 'thread_updated', threadId, title });
      }
    } catch (e) {
      console.error('title failed', e);
    }
  }
  if (handle.lastPromptTokens > COMPACT_ABOVE_TOKENS) await compact(kevin, threadId);
}

const KEEP_TAIL_CHARS = 60_000;

/**
 * Summarises the older part of a thread; history is then sent from after
 * that point. The cut is always at a turn boundary, so no tool result is
 * separated from its call. `keepTurns` is a maximum: when the recent turns are
 * large, fewer are kept verbatim, but always at least one.
 */
export async function compact(kevin: Kevin, threadId: string, keepTurns = KEEP_TURNS): Promise<boolean> {
  const { db } = kevin;
  const t = db.prepare('SELECT title, summary, summary_upto FROM threads WHERE id = ?').get(threadId) as { title: string; summary: string | null; summary_upto: number };
  const sizes = db.prepare('SELECT turn_id, SUM(LENGTH(content)) AS chars FROM messages WHERE thread_id = ? AND id > ? GROUP BY turn_id ORDER BY turn_id').all(threadId, t.summary_upto) as { turn_id: number; chars: number }[];
  let keep = 0;
  let tail = 0;
  for (let i = sizes.length - 1; i >= 0 && keep < keepTurns; i--) {
    tail += sizes[i]!.chars;
    if (keep >= 1 && tail > KEEP_TAIL_CHARS) break;
    keep++;
  }
  if (sizes.length <= keep) return false;
  const cutTurn = sizes[sizes.length - keep - 1]!.turn_id;
  const rows = db.prepare('SELECT id, role, content FROM messages WHERE thread_id = ? AND id > ? AND turn_id <= ? ORDER BY id').all(threadId, t.summary_upto, cutTurn) as { id: number; role: string; content: string }[];
  if (!rows.length) return false;
  const text = rows
    .map((r) => {
      const blocks = JSON.parse(r.content) as Record<string, unknown>[];
      return blocks
        .map((b) => {
          if (b.type === 'text') return `${r.role === 'user' ? 'Ben' : 'Kevin'}: ${b.text as string}`;
          if (b.type === 'tool_use') return `Kevin called ${b.name as string}(${JSON.stringify(b.input).slice(0, 400)})`;
          if (b.type === 'tool_result') return `result: ${String(b.content).slice(0, 600)}`;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    })
    .join('\n')
    .slice(-200_000);
  const summary = await small(
    db,
    { purpose: 'compaction', threadId },
    'You are compressing the earlier part of a conversation between Ben and his assistant Kevin so the conversation can continue without it. Use these headings: Context, Decisions, Work completed, Open threads. Under Decisions, keep Ben\'s decisions, corrections and stated preferences word for word, in quotation marks. Paraphrase the rest: what he asked for, the facts and numbers that came up, what was changed in his data, what is still unresolved. At most 600 words.',
    `${t.summary ? `Summary of what came before this section:\n${t.summary}\n\n` : ''}The section to compress:\n${text}`,
    4000,
  );
  if (!summary.trim()) return false;
  db.prepare('UPDATE threads SET summary = ?, summary_upto = ? WHERE id = ?').run(summary, rows.at(-1)!.id, threadId);
  // Recallable later, once the detail is gone from the live conversation.
  indexItem(db, 'log-summary', `compaction-${threadId}`, `${t.title} (earlier part)`, summary);
  return true;
}
