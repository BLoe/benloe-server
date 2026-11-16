// The transcript state machine: turns the server's thread payload and its
// stream of events into what the chat renders. Pure, so it is tested without
// a browser (transcript.test.ts).
//
// The stream carries no block indexes or sequence numbers, so order is the
// contract: deltas append to the block that is open, `block_stop` closes it,
// and a tool event is an upsert by tool id.
import type { BusEvent, ThreadPayload, ToolItem, TurnPayload, UiItem, UserUi } from './types';

export interface Turn {
  id: number;
  status: string;
  user: UserUi;
  items: UiItem[];
  costUsd: number;
  error: string | null;
  startedAt: string | null;
  model: string | null;
  /** The last item is a text or status block still receiving deltas. */
  open: boolean;
}

export interface Confirm {
  confirmId: string;
  turnId: number;
  summary: string;
}

/** A message Ben sent that the server has not yet shown as a turn or folded into one. */
export interface PendingMessage {
  text: string;
  attachments: { id: number; filename: string; mime: string }[];
}

export interface ThreadState {
  id: string;
  title: string;
  running: boolean;
  turns: Turn[];
  confirms: Confirm[];
  pending: PendingMessage[];
}

export type ThreadEvent = Extract<BusEvent, { threadId: string }>;

/** How the server stores a folded mid-turn message: a status item with this prefix (agent.ts drainPending). */
export const FOLDED_PREFIX = 'Ben: ';

export const emptyThread = (id: string, title = 'New chat'): ThreadState => ({ id, title, running: false, turns: [], confirms: [], pending: [] });

function turnFromPayload(t: TurnPayload): Turn {
  return {
    id: t.id,
    status: t.status,
    user: t.user ?? { text: '' },
    items: Array.isArray(t.items) ? t.items : [],
    costUsd: t.cost_usd ?? 0,
    error: t.error ?? null,
    startedAt: t.started_at ?? null,
    model: t.model ?? null,
    open: false,
  };
}

export function fromPayload(p: ThreadPayload): ThreadState {
  const confirms = (p.confirms ?? []).map((c) => ({ confirmId: c.confirmId, turnId: c.turnId, summary: c.summary }));
  return { id: p.id, title: p.title, running: p.running, turns: p.turns.map(turnFromPayload), confirms, pending: [] };
}

/** How much of a turn has been seen: used to tell which copy of a running turn is further along. */
export function progress(turn: Turn): number {
  let n = 0;
  for (const i of turn.items) n += 1 + (i.type === 'tool' ? (i.state === 'running' ? 0 : 1) : i.text.length);
  return n;
}

/**
 * Applies a fresh payload from GET /api/threads/:id over what is on screen.
 * The server's copy wins, with one exception: a turn still running may be
 * further along locally (events kept arriving while the request was in
 * flight), and then the local copy of that turn is kept. The refetch at
 * `turn_end` settles any difference. Confirm cards come from both sides.
 */
export function mergeSnapshot(local: ThreadState | null, payload: ThreadPayload): ThreadState {
  const next = fromPayload(payload);
  if (!local || local.id !== payload.id) return next;
  const mine = new Map(local.turns.map((t) => [t.id, t]));
  next.turns = next.turns.map((t) => {
    const l = mine.get(t.id);
    if (!l || t.status !== 'running') return t;
    if (l.status !== 'running') return { ...t, items: l.items, status: l.status, costUsd: l.costUsd, error: l.error, open: false };
    return progress(l) > progress(t) ? { ...t, items: l.items, open: l.open } : t;
  });
  // A turn that began after the server took its snapshot.
  const lastId = next.turns.at(-1)?.id ?? 0;
  for (const l of local.turns) if (l.id > lastId) next.turns.push(l);
  next.running = next.turns.some((t) => t.status === 'running');
  // The server's waiting confirms, plus any that arrived by event after its snapshot. One Ben already
  // answered while the stream was down may linger; answering it again is harmless and removes it.
  const waiting = [...next.confirms, ...local.confirms.filter((c) => !next.confirms.some((n) => n.confirmId === c.confirmId))];
  next.confirms = next.running ? waiting.filter((c) => next.turns.some((t) => t.id === c.turnId && t.status === 'running')) : [];
  next.pending = local.pending.filter((p) => !isShown(next, p));
  return next;
}

const same = (a: string, b: string) => a.trim() === b.trim();

function isShown(thread: ThreadState, p: PendingMessage): boolean {
  const last = thread.turns.at(-1);
  if (!last) return false;
  return same(last.user.text, p.text) || last.items.some((i) => i.type === 'status' && same(i.text, FOLDED_PREFIX + p.text));
}

function dropPending(pending: PendingMessage[], text: string): PendingMessage[] {
  const at = pending.findIndex((p) => same(p.text, text));
  return at < 0 ? pending : [...pending.slice(0, at), ...pending.slice(at + 1)];
}

function updateTurn(state: ThreadState, turnId: number, fn: (t: Turn) => Turn): ThreadState {
  const at = state.turns.findIndex((t) => t.id === turnId);
  // An event for a turn we never saw start: a refetch will bring it.
  if (at < 0) return state;
  const turns = state.turns.slice();
  turns[at] = fn(turns[at]!);
  return { ...state, turns };
}

function appendDelta(turn: Turn, kind: 'text' | 'status', text: string): Turn {
  const last = turn.items.at(-1);
  if (turn.open && last && last.type === kind) {
    return { ...turn, items: [...turn.items.slice(0, -1), { type: kind, text: last.text + text }] };
  }
  return { ...turn, items: [...turn.items, { type: kind, text }], open: true };
}

function upsertTool(turn: Turn, item: ToolItem): Turn {
  const at = turn.items.findIndex((i) => i.type === 'tool' && i.id === item.id);
  if (at < 0) return { ...turn, items: [...turn.items, { ...item }], open: false };
  const items = turn.items.slice();
  items[at] = { ...item };
  return { ...turn, items };
}

export function applyEvent(state: ThreadState, e: ThreadEvent): ThreadState {
  if (e.threadId !== state.id) return state;
  switch (e.type) {
    case 'turn_start': {
      const pending = dropPending(state.pending, e.user?.text ?? '');
      if (state.turns.some((t) => t.id === e.turnId)) return { ...state, pending, running: true };
      const turn: Turn = { id: e.turnId, status: 'running', user: e.user ?? { text: '' }, items: [], costUsd: 0, error: null, startedAt: new Date().toISOString(), model: null, open: false };
      return { ...state, running: true, pending, turns: [...state.turns, turn] };
    }
    case 'text_delta':
      return updateTurn(state, e.turnId, (t) => appendDelta(t, 'text', e.text));
    case 'status_delta':
      return updateTurn(state, e.turnId, (t) => appendDelta(t, 'status', e.text));
    case 'block_stop':
      return updateTurn(state, e.turnId, (t) => (t.open ? { ...t, open: false } : t));
    case 'tool':
      return updateTurn(state, e.turnId, (t) => upsertTool(t, e.item));
    case 'user_folded': {
      const next = updateTurn(state, e.turnId, (t) => {
        const text = FOLDED_PREFIX + e.text;
        // After a reconnect the snapshot may already hold it.
        const last = t.items.at(-1);
        if (last?.type === 'status' && last.text === text) return t;
        return { ...t, items: [...t.items, { type: 'status', text }], open: false };
      });
      return { ...next, pending: dropPending(next.pending, e.text) };
    }
    case 'confirm_request':
      if (state.confirms.some((c) => c.confirmId === e.confirmId)) return state;
      return { ...state, confirms: [...state.confirms, { confirmId: e.confirmId, turnId: e.turnId, summary: e.summary }] };
    case 'confirm_resolved':
      return { ...state, confirms: state.confirms.filter((c) => c.confirmId !== e.confirmId) };
    case 'turn_end': {
      const next = updateTurn(state, e.turnId, (t) => ({
        ...t,
        status: e.status,
        costUsd: e.costUsd,
        error: e.error ?? null,
        open: false,
        // What the server does when it stores the turn (agent.ts finish()).
        items: t.items
          .filter((i) => i.type === 'tool' || i.text.trim().length > 0)
          .map((i) => (i.type === 'tool' && i.state === 'running' ? { ...i, state: 'error' as const } : i)),
      }));
      return { ...next, running: next.turns.some((t) => t.status === 'running'), confirms: next.confirms.filter((c) => c.turnId !== e.turnId) };
    }
    case 'thread_updated':
      return e.title ? { ...state, title: e.title } : state;
  }
}

export function addPending(state: ThreadState, p: PendingMessage): ThreadState {
  return { ...state, pending: [...state.pending, p] };
}

export function removePending(state: ThreadState, p: PendingMessage): ThreadState {
  return { ...state, pending: state.pending.filter((x) => x !== p) };
}

// ---- reading the transcript ---------------------------------------------------

export type Segment =
  | { kind: 'text'; text: string; streaming: boolean }
  | { kind: 'status'; text: string; streaming: boolean }
  | { kind: 'folded'; text: string }
  | { kind: 'tool'; item: ToolItem };

/**
 * A turn's items in display form. Two things differ from the stored items:
 * a folded message is told apart from Kevin's own status lines, and text
 * Kevin wrote before a tool call is a status line too. Only the text after
 * the last tool call is the reply; what came before was him saying what he
 * was about to do.
 */
export function segments(turn: Turn): Segment[] {
  const lastTool = turn.items.findLastIndex((i) => i.type === 'tool');
  return turn.items.map((item, i): Segment => {
    const streaming = turn.open && i === turn.items.length - 1 && turn.status === 'running';
    if (item.type === 'tool') return { kind: 'tool', item };
    if (item.type === 'status' && item.text.startsWith(FOLDED_PREFIX)) return { kind: 'folded', text: item.text.slice(FOLDED_PREFIX.length) };
    return { kind: item.type === 'text' && i > lastTool ? 'text' : 'status', text: item.text, streaming };
  });
}

export type WorkPart = Extract<Segment, { kind: 'status' | 'tool' }>;
export type Display = Extract<Segment, { kind: 'text' | 'folded' }> | { kind: 'work'; parts: WorkPart[] };

/**
 * Segments as the chat shows them: each unbroken run of status lines and tool
 * calls becomes one "work" entry, so a turn that used six tools is one line
 * above the reply, opened only when Ben wants the detail.
 */
export function display(segs: Segment[]): Display[] {
  const out: Display[] = [];
  for (const s of segs) {
    if (s.kind === 'text' || s.kind === 'folded') {
      out.push(s);
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === 'work') last.parts.push(s);
    else out.push({ kind: 'work', parts: [s] });
  }
  return out;
}

/** One line for a run of work: how many tool calls, which tools (each named once, in order), and how many did not succeed. */
export function workSummary(parts: WorkPart[]): { steps: number; names: string[]; failed: number; declined: number } {
  const tools = parts.flatMap((p) => (p.kind === 'tool' ? [p.item] : []));
  return {
    steps: tools.length,
    names: [...new Set(tools.map((t) => t.name))],
    failed: tools.filter((t) => t.state === 'error').length,
    declined: tools.filter((t) => t.state === 'denied').length,
  };
}

/** Plain words for how a turn ended, or null when it ended normally. */
export function endNote(turn: Turn): { tone: 'error' | 'muted'; text: string } | null {
  switch (turn.status) {
    case 'done':
    case 'running':
      return null;
    case 'stopped':
      return { tone: 'muted', text: 'Stopped.' };
    case 'blocked':
      return { tone: 'error', text: 'Stopped: this month’s spend cap is reached. Raise it in Settings to continue.' };
    case 'refused':
      return { tone: 'error', text: 'Kevin declined this request.' };
    case 'error':
      return { tone: 'error', text: turn.error ? `This turn failed: ${turn.error}` : 'This turn failed.' };
    default:
      return { tone: 'muted', text: `Ended: ${turn.status}` };
  }
}
