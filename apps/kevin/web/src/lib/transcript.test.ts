import { describe, expect, it } from 'vitest';
import { addPending, applyEvent, display, emptyThread, endNote, fromPayload, mergeSnapshot, progress, segments, workSummary, type ThreadEvent, type ThreadState } from './transcript';
import type { ThreadPayload, ToolItem, TurnPayload, UiItem } from './types';

const T = 't1';
const ev = <E extends ThreadEvent['type']>(type: E, rest: Omit<Extract<ThreadEvent, { type: E }>, 'type' | 'threadId'>): ThreadEvent => ({ type, threadId: T, ...rest }) as ThreadEvent;
const run = (state: ThreadState, events: ThreadEvent[]) => events.reduce(applyEvent, state);
const tool = (id: string, state: ToolItem['state'], extra: Partial<ToolItem> = {}): ToolItem => ({ type: 'tool', id, name: 'remember', input: {}, state, ...extra });

const start = () => run(emptyThread(T), [ev('turn_start', { turnId: 1, user: { text: 'hi' } })]);

function turnPayload(over: Partial<TurnPayload> = {}): TurnPayload {
  return { id: 1, started_at: '2026-11-14T20:00:00.000Z', ended_at: null, status: 'running', model: 'claude-sonnet-5-5', error: null, cost_usd: 0, user: { text: 'hi' }, items: [], ...over };
}
function payload(turns: TurnPayload[], running = turns.some((t) => t.status === 'running')): ThreadPayload {
  return { id: T, title: 'Chat', origin: 'chat', created_at: '', updated_at: '', archived: 0, running, turns };
}

describe('applyEvent', () => {
  it('starts a running turn with the user message', () => {
    const s = start();
    expect(s.running).toBe(true);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ id: 1, status: 'running', user: { text: 'hi' }, items: [] });
  });

  it('ignores a repeated turn_start', () => {
    const s = run(start(), [ev('turn_start', { turnId: 1, user: { text: 'hi' } })]);
    expect(s.turns).toHaveLength(1);
  });

  it('ignores events for another thread', () => {
    const s = start();
    expect(applyEvent(s, { type: 'text_delta', threadId: 'other', turnId: 1, text: 'x' })).toBe(s);
  });

  it('ignores deltas for a turn it never saw start', () => {
    const s = start();
    expect(applyEvent(s, ev('text_delta', { turnId: 99, text: 'x' }))).toBe(s);
  });

  it('appends text deltas into one block', () => {
    const s = run(start(), [ev('text_delta', { turnId: 1, text: 'Hel' }), ev('text_delta', { turnId: 1, text: 'lo' })]);
    expect(s.turns[0]!.items).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(s.turns[0]!.open).toBe(true);
  });

  it('starts a new block after block_stop', () => {
    const s = run(start(), [
      ev('text_delta', { turnId: 1, text: 'One' }),
      ev('block_stop', { turnId: 1 }),
      ev('text_delta', { turnId: 1, text: 'Two' }),
    ]);
    expect(s.turns[0]!.items).toEqual([{ type: 'text', text: 'One' }, { type: 'text', text: 'Two' }]);
  });

  it('keeps status and text as separate blocks even without a block_stop between them', () => {
    const s = run(start(), [ev('status_delta', { turnId: 1, text: 'Checking the pantry' }), ev('text_delta', { turnId: 1, text: 'You have eggs.' })]);
    expect(s.turns[0]!.items).toEqual([{ type: 'status', text: 'Checking the pantry' }, { type: 'text', text: 'You have eggs.' }]);
  });

  it('upserts a tool by id and keeps its position', () => {
    const s = run(start(), [
      ev('status_delta', { turnId: 1, text: 'Saving' }),
      ev('block_stop', { turnId: 1 }),
      ev('tool', { turnId: 1, item: tool('a', 'running') }),
      ev('block_stop', { turnId: 1 }),
      ev('tool', { turnId: 1, item: tool('b', 'running') }),
      ev('tool', { turnId: 1, item: tool('a', 'running', { input: { text: 'likes tea' } }) }),
      ev('tool', { turnId: 1, item: tool('a', 'ok', { input: { text: 'likes tea' }, preview: '{"id":1}', ms: 12 }) }),
    ]);
    const items = s.turns[0]!.items;
    expect(items.map((i) => i.type)).toEqual(['status', 'tool', 'tool']);
    expect(items[1]).toMatchObject({ id: 'a', state: 'ok', preview: '{"id":1}', ms: 12, input: { text: 'likes tea' } });
    expect(items[2]).toMatchObject({ id: 'b', state: 'running' });
  });

  it('does not append text into a block that a tool closed', () => {
    const s = run(start(), [ev('text_delta', { turnId: 1, text: 'A' }), ev('tool', { turnId: 1, item: tool('a', 'running') }), ev('text_delta', { turnId: 1, text: 'B' })]);
    expect(s.turns[0]!.items.map((i) => (i.type === 'tool' ? 'tool' : i.text))).toEqual(['A', 'tool', 'B']);
  });

  it('copies tool items so later server mutations cannot leak in', () => {
    const item = tool('a', 'running');
    const s = run(start(), [ev('tool', { turnId: 1, item })]);
    item.state = 'ok';
    expect((s.turns[0]!.items[0] as ToolItem).state).toBe('running');
  });

  it('shows a folded message as a status item, as the server stores it', () => {
    const s = run(start(), [ev('text_delta', { turnId: 1, text: 'Working' }), ev('user_folded', { turnId: 1, text: 'also milk' }), ev('text_delta', { turnId: 1, text: 'Added milk.' })]);
    expect(s.turns[0]!.items).toEqual([
      { type: 'text', text: 'Working' },
      { type: 'status', text: 'Ben: also milk' },
      { type: 'text', text: 'Added milk.' },
    ]);
    expect(segments(s.turns[0]!).map((x) => x.kind)).toEqual(['text', 'folded', 'text']);
  });

  it('does not duplicate a folded message already present from a snapshot', () => {
    const s = run(start(), [ev('user_folded', { turnId: 1, text: 'also milk' }), ev('user_folded', { turnId: 1, text: 'also milk' })]);
    expect(s.turns[0]!.items).toHaveLength(1);
  });

  it('ends the turn: status, cost, error; drops empty blocks; fails tools left running', () => {
    const s = run(start(), [
      ev('status_delta', { turnId: 1, text: '  ' }),
      ev('block_stop', { turnId: 1 }),
      ev('text_delta', { turnId: 1, text: 'Partial' }),
      ev('tool', { turnId: 1, item: tool('a', 'running') }),
      ev('turn_end', { turnId: 1, status: 'error', costUsd: 0.0123, error: 'boom' }),
    ]);
    const t = s.turns[0]!;
    expect(s.running).toBe(false);
    expect(t).toMatchObject({ status: 'error', costUsd: 0.0123, error: 'boom', open: false });
    expect(t.items).toEqual([{ type: 'text', text: 'Partial' }, tool('a', 'error')]);
    expect(endNote(t)).toEqual({ tone: 'error', text: 'This turn failed: boom' });
  });

  it('tracks confirm requests until they are resolved or the turn ends', () => {
    let s = run(start(), [ev('confirm_request', { turnId: 1, confirmId: 'c1', tool: 'confirm', summary: 'Run this command?\nrm x' })]);
    expect(s.confirms).toEqual([{ confirmId: 'c1', turnId: 1, summary: 'Run this command?\nrm x' }]);
    s = applyEvent(s, ev('confirm_request', { turnId: 1, confirmId: 'c1', tool: 'confirm', summary: 'again' }));
    expect(s.confirms).toHaveLength(1);
    expect(applyEvent(s, { type: 'confirm_resolved', threadId: T, confirmId: 'c1', approved: true }).confirms).toEqual([]);
    expect(applyEvent(s, ev('turn_end', { turnId: 1, status: 'stopped', costUsd: 0 })).confirms).toEqual([]);
  });

  it('takes a new title from thread_updated', () => {
    expect(applyEvent(start(), { type: 'thread_updated', threadId: T, title: 'Dinner plans' }).title).toBe('Dinner plans');
    expect(applyEvent(start(), { type: 'thread_updated', threadId: T }).title).toBe('New chat');
  });

  it('never mutates the previous state', () => {
    const a = start();
    const frozen = JSON.stringify(a);
    run(a, [ev('text_delta', { turnId: 1, text: 'x' }), ev('tool', { turnId: 1, item: tool('a', 'ok') }), ev('turn_end', { turnId: 1, status: 'done', costUsd: 1 })]);
    expect(JSON.stringify(a)).toBe(frozen);
  });
});

describe('pending messages', () => {
  const p = (text: string) => ({ text, attachments: [] });

  it('clears when the turn it started arrives', () => {
    const s = applyEvent(addPending(emptyThread(T), p('hi')), ev('turn_start', { turnId: 1, user: { text: 'hi' } }));
    expect(s.pending).toEqual([]);
  });

  it('clears when it is folded into the running turn', () => {
    const s = run(addPending(start(), p('also milk')), [ev('user_folded', { turnId: 1, text: 'also milk ' })]);
    expect(s.pending).toEqual([]);
  });

  it('clears only one of two identical messages per event', () => {
    const s = run(addPending(addPending(start(), p('ok')), p('ok')), [ev('user_folded', { turnId: 1, text: 'ok' })]);
    expect(s.pending).toHaveLength(1);
  });

  it('survives a snapshot that does not show it yet, and clears on one that does', () => {
    const local = addPending(start(), p('also milk'));
    expect(mergeSnapshot(local, payload([turnPayload()])).pending).toHaveLength(1);
    expect(mergeSnapshot(local, payload([turnPayload({ items: [{ type: 'status', text: 'Ben: also milk' }] })])).pending).toEqual([]);
  });
});

describe('mergeSnapshot (reconnect, tab focus)', () => {
  const items = (text: string): UiItem[] => [{ type: 'text', text }];

  it('takes the server copy when there is no local state or a different thread', () => {
    const snap = payload([turnPayload({ status: 'done', items: items('Hello') })]);
    expect(mergeSnapshot(null, snap)).toEqual(fromPayload(snap));
    expect(mergeSnapshot(emptyThread('other'), snap).id).toBe(T);
  });

  it('takes the server copy of a running turn when the stream dropped and the server is ahead', () => {
    const local = run(start(), [ev('text_delta', { turnId: 1, text: 'Hel' })]);
    const merged = mergeSnapshot(local, payload([turnPayload({ items: [...items('Hello there'), tool('a', 'running')] })]));
    expect(merged.turns[0]!.items).toEqual([...items('Hello there'), tool('a', 'running')]);
    expect(merged.running).toBe(true);
  });

  it('keeps the local copy of a running turn when events outran the request', () => {
    const local = run(start(), [ev('text_delta', { turnId: 1, text: 'Hello there, Ben' })]);
    const merged = mergeSnapshot(local, payload([turnPayload({ items: items('Hello') })]));
    expect(merged.turns[0]!.items).toEqual(items('Hello there, Ben'));
    expect(merged.turns[0]!.open).toBe(true);
    // and the stream carries on appending to it
    expect(applyEvent(merged, ev('text_delta', { turnId: 1, text: '!' })).turns[0]!.items).toEqual(items('Hello there, Ben!'));
  });

  it('keeps a turn_end that arrived before a stale snapshot still saying "running"', () => {
    const local = run(start(), [ev('text_delta', { turnId: 1, text: 'Done.' }), ev('turn_end', { turnId: 1, status: 'done', costUsd: 0.01 })]);
    const merged = mergeSnapshot(local, payload([turnPayload({ items: items('Do') })]));
    expect(merged.turns[0]).toMatchObject({ status: 'done', costUsd: 0.01, items: items('Done.') });
    expect(merged.running).toBe(false);
  });

  it('lets the server copy of a finished turn win outright', () => {
    const local = run(start(), [ev('text_delta', { turnId: 1, text: 'Local text that is longer' }), ev('turn_end', { turnId: 1, status: 'done', costUsd: 0 })]);
    const merged = mergeSnapshot(local, payload([turnPayload({ status: 'done', cost_usd: 0.02, items: items('Stored') })]));
    expect(merged.turns[0]).toMatchObject({ status: 'done', costUsd: 0.02, items: items('Stored') });
  });

  it('keeps a turn that started after the snapshot was taken', () => {
    const local = run(fromPayload(payload([turnPayload({ status: 'done' })])), [ev('turn_start', { turnId: 2, user: { text: 'next' } })]);
    const merged = mergeSnapshot(local, payload([turnPayload({ status: 'done' })], false));
    expect(merged.turns.map((t) => t.id)).toEqual([1, 2]);
    expect(merged.running).toBe(true);
  });

  it('keeps a pending confirm across a refetch while its turn runs, and drops it once it ended', () => {
    const local = run(start(), [ev('confirm_request', { turnId: 1, confirmId: 'c1', tool: 'confirm', summary: 'Overwrite?' })]);
    expect(mergeSnapshot(local, payload([turnPayload()])).confirms).toHaveLength(1);
    expect(mergeSnapshot(local, payload([turnPayload({ status: 'stopped' })])).confirms).toEqual([]);
  });

  it('shows confirms the server says are waiting, without doubling ones already on screen', () => {
    const waiting = { confirmId: 'c1', turnId: 1, summary: 'Overwrite?' };
    const snap = { ...payload([turnPayload()]), confirms: [waiting] };
    expect(mergeSnapshot(null, snap).confirms).toEqual([waiting]);
    const local = run(start(), [
      ev('confirm_request', { turnId: 1, confirmId: 'c1', tool: 'confirm', summary: 'Overwrite?' }),
      ev('confirm_request', { turnId: 1, confirmId: 'c2', tool: 'confirm', summary: 'Run this command?' }),
    ]);
    expect(mergeSnapshot(local, snap).confirms.map((c) => c.confirmId)).toEqual(['c1', 'c2']);
    expect(mergeSnapshot(local, { ...payload([turnPayload({ status: 'done' })]), confirms: [] }).confirms).toEqual([]);
  });

  it('measures progress by text length and finished tools', () => {
    const base = start().turns[0]!;
    expect(progress({ ...base, items: [] })).toBe(0);
    expect(progress({ ...base, items: [tool('a', 'ok')] })).toBeGreaterThan(progress({ ...base, items: [tool('a', 'running')] }));
    expect(progress({ ...base, items: items('abcd') })).toBeGreaterThan(progress({ ...base, items: items('abc') }));
  });
});

describe('segments and endNote', () => {
  it('marks only the last open block of a running turn as streaming', () => {
    const s = run(start(), [ev('text_delta', { turnId: 1, text: 'A' }), ev('block_stop', { turnId: 1 }), ev('text_delta', { turnId: 1, text: 'B' })]);
    expect(segments(s.turns[0]!).map((x) => 'streaming' in x && x.streaming)).toEqual([false, true]);
    const ended = applyEvent(s, ev('turn_end', { turnId: 1, status: 'done', costUsd: 0 }));
    expect(segments(ended.turns[0]!).some((x) => 'streaming' in x && x.streaming)).toBe(false);
  });

  it('shows text written before a tool call as a status line, and text after the last tool as the reply', () => {
    const s = run(start(), [
      ev('text_delta', { turnId: 1, text: 'Let me check the pantry.' }),
      ev('block_stop', { turnId: 1 }),
    ]);
    expect(segments(s.turns[0]!).map((x) => x.kind)).toEqual(['text']);
    const after = run(s, [ev('tool', { turnId: 1, item: tool('a', 'ok') }), ev('text_delta', { turnId: 1, text: 'You have eggs.' })]);
    expect(segments(after.turns[0]!).map((x) => x.kind)).toEqual(['status', 'tool', 'text']);
  });

  it('says how a turn ended in plain words', () => {
    const t = start().turns[0]!;
    expect(endNote({ ...t, status: 'done' })).toBeNull();
    expect(endNote({ ...t, status: 'running' })).toBeNull();
    expect(endNote({ ...t, status: 'stopped' })).toEqual({ tone: 'muted', text: 'Stopped.' });
    expect(endNote({ ...t, status: 'blocked' })?.text).toMatch(/spend cap/);
    expect(endNote({ ...t, status: 'refused' })?.tone).toBe('error');
    expect(endNote({ ...t, status: 'error', error: null })?.text).toBe('This turn failed.');
  });
});

describe('display and workSummary', () => {
  const st = (text: string) => ({ kind: 'status' as const, text, streaming: false });
  const tl = (id: string, name: string, state: 'ok' | 'error' | 'denied' | 'running' = 'ok') => ({ kind: 'tool' as const, item: { ...tool(id, state), name } });
  const txt = (text: string) => ({ kind: 'text' as const, text, streaming: false });

  it('folds each unbroken run of status lines and tool calls into one work entry', () => {
    const d = display([st('Checking.'), tl('a', 'query'), tl('b', 'pantry_update'), { kind: 'folded', text: 'also milk' }, tl('c', 'pantry_update'), txt('Done.')]);
    expect(d.map((x) => x.kind)).toEqual(['work', 'folded', 'work', 'text']);
    expect(d[0]).toMatchObject({ parts: [{ kind: 'status' }, { kind: 'tool' }, { kind: 'tool' }] });
    expect(d[2]).toMatchObject({ parts: [{ kind: 'tool' }] });
  });

  it('leaves a turn with no tool calls untouched', () => {
    expect(display([txt('Hello.')])).toEqual([txt('Hello.')]);
    expect(display([])).toEqual([]);
  });

  it('counts steps, names each tool once in order, and counts what failed or was declined', () => {
    const parts = display([st('x'), tl('a', 'query'), tl('b', 'pantry_update', 'error'), tl('c', 'query'), tl('d', 'shell', 'denied')])[0] as { parts: Parameters<typeof workSummary>[0] };
    expect(workSummary(parts.parts)).toEqual({ steps: 4, names: ['query', 'pantry_update', 'shell'], failed: 1, declined: 1 });
    expect(workSummary([st('only words')])).toEqual({ steps: 0, names: [], failed: 0, declined: 0 });
  });
});
