// What a turn does when things go wrong around it: a schedule and Ben in the same thread, a setup
// failure, a damaged history row, Stop at an awkward moment, and the spend caps mid-turn.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { bus, type BusEvent } from '../src/bus.js';
import { setSetting } from '../src/db.js';
import { defineDomain } from '../src/domains.js';
import { JobRunner, MEMORY_MAX_ATTEMPTS } from '../src/jobs.js';
import { appLink } from '../src/push.js';
import { logUnhandledRejections } from '../src/process.js';
import { createThread, getThread, isRunning, send, stop } from '../src/threads.js';
import { defineTool } from '../src/tools.js';
import { FakeModel, type Reply, text, toolUse } from './fake-model.js';
import { call, makeKevin, ok, view } from './helpers.js';

let slowGate: Promise<void> = Promise.resolve();
const toy = defineDomain({
  name: 'toy',
  migrations: [{ id: 'toy-001', sql: 'CREATE TABLE toys (id INTEGER PRIMARY KEY, name TEXT NOT NULL);' }],
  tools: [
    defineTool({ name: 'toy_add', description: 'Add a toy.', input: z.object({ name: z.string() }), touches: ['toy'], run: ({ name }, ctx) => ({ id: Number(ctx.db.prepare('INSERT INTO toys (name) VALUES (?)').run(name).lastInsertRowid) }) }),
    defineTool({ name: 'toy_slow', description: 'Waits.', input: z.object({}), run: async () => { await slowGate; return 'slow done'; } }),
    // Writes, then Ben presses Stop before the turn gets any further.
    defineTool({ name: 'toy_add_then_stop', description: 'Adds a toy.', input: z.object({ name: z.string() }), touches: ['toy'], run: ({ name }, ctx) => { ctx.db.prepare('INSERT INTO toys (name) VALUES (?)').run(name); stop(ctx.threadId!); return { added: name }; } }),
  ],
});

let model: FakeModel;
let events: BusEvent[];
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  model = new FakeModel();
  events = [];
  bus.removeAllListeners('event');
  bus.subscribe((e) => events.push(e));
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errors.mockRestore());

const stored = (kevin: any, threadId: string) => kevin.db.prepare('SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id').all(threadId).map((r: any) => ({ role: r.role, content: JSON.parse(r.content) }));
const turns = (kevin: any, threadId: string) => kevin.db.prepare('SELECT id, origin, status, ended_at, error, user_ui FROM turns WHERE thread_id = ? ORDER BY id').all(threadId) as any[];
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const idle = async (threadId: string) => { for (let i = 0; i < 100 && isRunning(threadId); i++) await settle(5); await settle(); };
const big = { input_tokens: 10_000, output_tokens: 4000 }; // $0.06 on the main model

describe('Ben and a schedule in one thread', () => {
  it('runs Ben\'s message as his own chat turn after a scheduled turn, never inside it', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'job', 'Weekly plan');
    let release!: () => void;
    slowGate = new Promise((r) => (release = r));
    model.reply({ content: [toolUse('s', 'toy_slow', {})] }, { content: [text('Planned the week.')] }, { content: [text('Answering Ben.')] });
    const scheduled = send(kevin, t.id, { text: 'Plan the week.' }, { origin: 'job', jobKey: 'schedule:1', spendCapUsd: 5 });
    await settle();
    expect(isRunning(t.id)).toBe(true);
    const bens = send(kevin, t.id, { text: 'run the numbers in the shell' });
    release();
    expect((await scheduled)!.status).toBe('done');
    // Not folded: his message gets a result of its own.
    const mine = await bens;
    expect(mine).toMatchObject({ status: 'done', text: 'Answering Ben.' });
    expect(events.some((e) => e.type === 'user_folded')).toBe(false);
    expect(turns(kevin, t.id).map((u) => u.origin)).toEqual(['job', 'chat']);
    // The scheduled turn never saw his words.
    expect(JSON.stringify(model.requests[1]!.messages)).not.toContain('run the numbers');
    // His turn is a chat turn: it has the shell, and it is not told it is a schedule.
    const req = model.requests[2]!;
    expect(req.tools.map((x: any) => x.name)).toContain('shell');
    expect(model.requests[0]!.tools.map((x: any) => x.name)).not.toContain('shell');
    expect(JSON.stringify(req.messages.at(-1))).not.toMatch(/started by a schedule/);
    expect(req.messages.at(-1).content.at(-1).text).toBe('run the numbers in the shell');
    await idle(t.id);
  });

  it('sends a message that arrived too late to fold as a new chat turn with chat defaults, not the old turn\'s options', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [text('First answer.')] }, { content: [text('Second answer.')] });
    // The moment the first turn ends, and before the thread is free, Ben sends another message.
    let late: Promise<unknown> | null = null;
    bus.subscribe((e) => {
      if (e.type === 'turn_end' && !late) late = send(kevin, t.id, { text: 'one more thing' });
    });
    const first = await send(kevin, t.id, { text: 'think about it' }, { origin: 'chat', model: 'claude-opus-5-5', effort: 'high', spendCapUsd: 0.000001 });
    expect(first!.status).toBe('done');
    expect(await late).toBeNull(); // accepted into the running turn's queue
    await idle(t.id);
    const all = turns(kevin, t.id);
    expect(all.map((u) => [u.origin, u.status, JSON.parse(u.user_ui).text])).toEqual([['chat', 'done', 'think about it'], ['chat', 'done', 'one more thing']]);
    const second = model.requests.find((r) => JSON.stringify(r.messages.at(-1)).includes('one more thing'))!;
    expect(second.model).toBe('claude-sonnet-5-5');
    expect(second.output_config).toEqual({ effort: 'low' });
  });

  it('does not lose a message sent just as a scheduled turn ends, and runs it as chat', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'job', 'Scheduled');
    model.reply({ content: [text('Scheduled work done.')] }, { content: [text('Hello Ben.')] });
    let late: Promise<any> | null = null;
    bus.subscribe((e) => {
      if (e.type === 'turn_end' && !late) late = send(kevin, t.id, { text: 'are you there?' });
    });
    await send(kevin, t.id, { text: 'Do the job.' }, { origin: 'job', jobKey: 'schedule:2' });
    expect(await late).toMatchObject({ status: 'done', text: 'Hello Ben.' });
    expect(turns(kevin, t.id).map((u) => u.origin)).toEqual(['job', 'chat']);
    await idle(t.id);
  });

  it('logs a late message that cannot be run instead of leaving a rejection nobody handles', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      model.reply({ content: [text('Answer.')] });
      let sent = false;
      bus.subscribe((e) => {
        if (e.type !== 'turn_end' || sent) return;
        sent = true;
        void send(kevin, t.id, { text: 'too late' });
        // The thread disappears under the queued message, so its turn cannot even be recorded.
        kevin.db.pragma('foreign_keys = OFF');
        kevin.db.prepare('DELETE FROM threads WHERE id = ?').run(t.id);
        kevin.db.pragma('foreign_keys = ON');
      });
      await send(kevin, t.id, { text: 'hello' });
      await settle(50);
      expect(isRunning(t.id)).toBe(false);
      expect(errors.mock.calls.some((c: unknown[]) => String(c[0]).includes('a message that arrived mid-turn could not be run'))).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('logs an unhandled rejection and keeps the process running', async () => {
    const seen: [string, unknown][] = [];
    const remove = logUnhandledRejections((m, reason) => seen.push([m, reason]));
    try {
      const boom = new Error('nobody was waiting');
      void Promise.reject(boom);
      await settle(30);
      expect(seen).toEqual([['unhandled promise rejection', boom]]);
    } finally {
      remove();
    }
  });
});

describe('a turn that fails outside the model call', () => {
  it('closes the turn, tells the page, keeps Ben\'s message and frees the thread when setup throws', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'chat', 'Titled');
    const realScope = kevin.scope;
    kevin.scope = () => { throw new Error('prompt could not be assembled'); };
    const r = await send(kevin, t.id, { text: 'add a kite' });
    expect(r).toMatchObject({ status: 'error', error: 'prompt could not be assembled' });
    expect(r!.text).toMatch(/Something went wrong on my side: prompt could not be assembled/);
    expect(model.requests.length).toBe(0);
    const [row] = turns(kevin, t.id);
    expect(row).toMatchObject({ status: 'error', error: 'prompt could not be assembled' });
    expect(row.ended_at).toBeTruthy();
    expect(events.filter((e) => e.type === 'turn_end')).toMatchObject([{ turnId: row.id, status: 'error' }]);
    expect(isRunning(t.id)).toBe(false);
    expect(getThread(kevin, t.id)!.running).toBe(false);
    // What he said is in the history, with a note that the turn failed, so the next turn can pick it up.
    const hist = stored(kevin, t.id);
    expect(hist.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(hist[0].content.at(-1).text).toBe('add a kite');
    expect(hist[1].content[0].text).toMatch(/This turn failed/);
    kevin.scope = realScope;
    model.reply({ content: [text('Added.')] });
    expect((await send(kevin, t.id, { text: 'try again' }))!.status).toBe('done');
    expect(JSON.stringify(model.requests[0]!.messages)).toContain('add a kite');
    await idle(t.id);
  });

  it('fails the same clean way when the facts block or the history query throws', async () => {
    const broken = defineDomain({ name: 'broken', promptState: () => { throw new Error('state query failed'); } });
    const kevin = await makeKevin([broken]);
    const t = createThread(kevin, 'chat', 'Titled');
    expect(await send(kevin, t.id, { text: 'hi' })).toMatchObject({ status: 'error', error: 'state query failed' });
    expect(turns(kevin, t.id)[0]).toMatchObject({ status: 'error' });
    expect(isRunning(t.id)).toBe(false);
  });

  it('runs without memory hits when the memory search fails', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    kevin.db.exec('DROP TABLE search_index');
    model.reply({ content: [text('Still here.')] });
    expect(await send(kevin, t.id, { text: 'what did the dentist say' })).toMatchObject({ status: 'done', text: 'Still here.' });
    expect(errors.mock.calls.some((c: unknown[]) => String(c[0]).includes('memory search failed'))).toBe(true);
    await idle(t.id);
  });

  it('leaves a damaged stored message, and the turn it belongs to, out of the history instead of failing every later turn', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [text('One.')] });
    await send(kevin, t.id, { text: 'first question' });
    await idle(t.id);
    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' })] }, { content: [text('Two.')] });
    await send(kevin, t.id, { text: 'second question' });
    await idle(t.id);
    // The tool result of the second turn is cut off mid-JSON.
    const damaged = kevin.db.prepare("SELECT id, turn_id FROM messages WHERE thread_id = ? AND content LIKE '%tool_result%'").get(t.id) as { id: number; turn_id: number };
    kevin.db.prepare("UPDATE messages SET content = '[{\"type\":\"tool_result\",\"tool_use_id\":\"a\",\"conte' WHERE id = ?").run(damaged.id);
    const before = model.requests.length;
    model.reply({ content: [text('Three.')] });
    expect(await send(kevin, t.id, { text: 'third question' })).toMatchObject({ status: 'done', text: 'Three.' });
    const sent = JSON.stringify(model.requests[before]!.messages);
    expect(sent).toContain('first question');
    expect(sent).toContain('third question');
    // Neither half of the damaged turn is sent: a tool call without its result would be rejected by the API.
    expect(sent).not.toContain('second question');
    expect(sent).not.toContain('tool_use');
    expect(errors.mock.calls.some((c: unknown[]) => String(c[0]).includes(`stored message ${damaged.id}`))).toBe(true);
    // The page still loads when a turn's display rows are damaged too.
    kevin.db.prepare("UPDATE turns SET assistant_ui = '[{' , user_ui = 'x' WHERE id = ?").run(damaged.turn_id);
    expect(getThread(kevin, t.id)!.turns.map((u) => u.status)).toEqual(['done', 'done', 'done']);
    await idle(t.id);
  });
});

describe('Stop', () => {
  it('keeps the record of tools that had already run when Stop arrived', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [text('Adding it.'), toolUse('w', 'toy_add_then_stop', { name: 'kite' }), toolUse('v', 'toy_add', { name: 'robot' })] });
    const r = await send(kevin, t.id, { text: 'add a kite and a robot' });
    expect(r!.status).toBe('stopped');
    expect(model.requests.length).toBe(1);
    expect(kevin.db.prepare('SELECT name FROM toys ORDER BY name').all()).toEqual([{ name: 'kite' }, { name: 'robot' }]);
    const hist = stored(kevin, t.id);
    expect(hist.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(hist[1].content.filter((b: any) => b.type === 'tool_use').map((b: any) => b.name)).toEqual(['toy_add_then_stop', 'toy_add']);
    expect(hist[2].content).toMatchObject([{ type: 'tool_result', tool_use_id: 'w', content: '{"added":"kite"}' }, { type: 'tool_result', tool_use_id: 'v' }]);
    expect(hist[3].content[0].text).toBe('(Ben stopped this turn.)');
    await idle(t.id);
    // The next turn is told what was written.
    model.queue = [];
    model.reply({ content: [text('The kite and robot are already in.')] });
    const before = model.requests.length;
    await send(kevin, t.id, { text: 'did that go through?' });
    expect(JSON.stringify(model.requests[before]!.messages)).toContain('{\\"added\\":\\"kite\\"}');
    await idle(t.id);
  });

  it('keeps a message Ben sent during a stopped turn and runs it next', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'chat', 'Titled');
    let release!: () => void;
    slowGate = new Promise((r) => (release = r));
    model.reply({ content: [toolUse('s', 'toy_slow', {})] }, { content: [text('Bananas noted.')] });
    const turn = send(kevin, t.id, { text: 'slow' });
    await settle();
    expect(await send(kevin, t.id, { text: 'also bananas' })).toBeNull();
    stop(t.id);
    release();
    expect((await turn)!.status).toBe('stopped');
    await idle(t.id);
    expect(turns(kevin, t.id).map((u) => [u.status, JSON.parse(u.user_ui).text])).toEqual([['stopped', 'slow'], ['done', 'also bananas']]);
  });
});

describe('spend caps inside a turn', () => {
  it('stops a scheduled turn after the round that reaches its own cap', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'job', 'Scheduled');
    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' })], usage: big }, { content: [text('never sent')] });
    const r = await send(kevin, t.id, { text: 'Stock up.' }, { origin: 'job', jobKey: 'schedule:9', spendCapUsd: 0.05 });
    expect(r).toMatchObject({ status: 'error', error: 'spend cap of $0.05 reached' });
    expect(r!.costUsd).toBeCloseTo(0.06, 6);
    expect(model.requests.length).toBe(1);
    // The write that happened is in the history, with why the run ended.
    const hist = stored(kevin, t.id);
    expect(hist.at(-2).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'a' });
    expect(hist.at(-1).content[0].text).toMatch(/reached its spend cap of \$0\.05/);
    expect(turns(kevin, t.id)[0]).toMatchObject({ status: 'error' });
  });

  it('lets a scheduled turn under its cap carry on', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'job', 'Scheduled');
    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' })], usage: big }, { content: [text('Stocked.')] });
    expect(await send(kevin, t.id, { text: 'Stock up.' }, { origin: 'job', spendCapUsd: 0.07 })).toMatchObject({ status: 'done', text: 'Stocked.' });
    expect(model.requests.length).toBe(2);
  });

  it('stops any turn after the round that reaches the monthly cap', async () => {
    const kevin = await makeKevin([toy]);
    setSetting(kevin.db, 'monthly_cap_usd', 1);
    kevin.db.prepare("INSERT INTO usage (at, purpose, model, cost_usd) VALUES (?, 'turn', 'x', 0.95)").run(new Date().toISOString());
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' })], usage: big }, { content: [text('never sent')] });
    const r = await send(kevin, t.id, { text: 'add a kite' });
    expect(r).toMatchObject({ status: 'blocked', error: 'monthly spend cap reached' });
    expect(r!.text).toMatch(/this month’s spend cap is reached/);
    expect(model.requests.length).toBe(1);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM toys').get()).toEqual({ n: 1 });
    expect(stored(kevin, t.id).at(-1).content[0].text).toMatch(/monthly spend cap/);
  });

  it('applies both caps when the model pauses mid-reply and would otherwise just be asked to continue', async () => {
    const kevin = await makeKevin();
    const job = createThread(kevin, 'job', 'Scheduled');
    model.reply({ content: [text('Part one,')], stop_reason: 'pause_turn', usage: big }, { content: [text('never sent')] });
    expect(await send(kevin, job.id, { text: 'Long job.' }, { origin: 'job', spendCapUsd: 0.05 })).toMatchObject({ status: 'error', error: 'spend cap of $0.05 reached' });
    expect(model.requests.length).toBe(1);

    model.queue = [];
    setSetting(kevin.db, 'monthly_cap_usd', 0.1); // $0.06 is spent; one more such reply reaches it
    const chat = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [text('Part one,')], stop_reason: 'pause_turn', usage: big }, { content: [text('never sent')] });
    expect(await send(kevin, chat.id, { text: 'Long answer please.' })).toMatchObject({ status: 'blocked' });
    expect(model.requests.length).toBe(2);
  });

  it('continues a paused reply when no cap is reached', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [text('Part one, ')], stop_reason: 'pause_turn' }, { content: [text('part two.')] });
    const r = await send(kevin, t.id, { text: 'Long answer please.' });
    expect(r).toMatchObject({ status: 'done', text: 'Part one, part two.' });
    // The paused reply went back to the model as it was.
    expect(model.requests[1]!.messages.at(-1)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Part one, ' }] });
    await idle(t.id);
  });

  it('checks the caps before answering a message Ben folded into the turn', async () => {
    const kevin = await makeKevin();
    setSetting(kevin.db, 'monthly_cap_usd', 0.05);
    const t = createThread(kevin, 'chat', 'Titled');
    let folded: Promise<unknown> | null = null;
    model.reply({ content: [text('Here you go.')], usage: big, before: () => { folded = send(kevin, t.id, { text: 'and another thing' }); } }, { content: [text('never sent')] });
    const r = await send(kevin, t.id, { text: 'hello' });
    expect(await folded).toBeNull();
    expect(r).toMatchObject({ status: 'blocked' });
    expect(model.requests.length).toBe(1);
    await idle(t.id);
  });
});

describe('the memory job', () => {
  const apiDown = () => { throw Object.assign(new Error('Overloaded (request id req_123)'), { status: 529 }); };
  /** A thread with one finished turn that went quiet an hour ago. */
  const quietThread = (kevin: any, title: string) => {
    const t = createThread(kevin, 'chat', title);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    kevin.db.prepare("INSERT INTO turns (thread_id, started_at, ended_at, status, user_ui, assistant_ui) VALUES (?,?,?,'done',?,?)").run(t.id, hourAgo, hourAgo, JSON.stringify({ text: `question in ${title}` }), JSON.stringify([{ type: 'text', text: 'answer' }]));
    kevin.db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(hourAgo, t.id);
    return t.id;
  };
  const state = (kevin: any, id: string) => kevin.db.prepare('SELECT memory_upto, memory_failures, memory_retry_at FROM threads WHERE id = ?').get(id) as { memory_upto: number; memory_failures: number; memory_retry_at: string | null };
  const failurePushes = async (kevin: any) => (await view(kevin, 'system/notifications', { limit: '100' })).items.filter((n: any) => n.title === 'Job failed: memory');
  /** Replies by which conversation the request is about, since the job takes them in the database's order. */
  const answer = (by: Record<string, Reply>) => {
    model.route = (params) => by[Object.keys(by).find((k) => JSON.stringify(params.messages).includes(`Conversation \\"${k}\\"`))!];
  };
  const down: Reply = { content: [], before: apiDown };

  it('summarises the other conversations when one is refused and one fails, and does not ask again for either straight away', async () => {
    const kevin = await makeKevin();
    const runner = new JobRunner(kevin);
    const good = quietThread(kevin, 'Garden');
    const refused = quietThread(kevin, 'Clinic');
    const failing = quietThread(kevin, 'Budget');
    answer({ Garden: { content: [text('Ben is planting tomatoes in May.')] }, Clinic: { content: [], stop_reason: 'refusal' }, Budget: down });
    const r = await runner.runSystemNow('memory');
    expect(model.requests.length).toBe(3);
    // The good one is in the log; the refused one is passed over for good; the failed one waits.
    expect(kevin.db.prepare("SELECT text FROM memory_log WHERE kind = 'summary'").all()).toEqual([{ text: 'Garden: Ben is planting tomatoes in May.' }]);
    expect(state(kevin, good)).toMatchObject({ memory_failures: 0, memory_retry_at: null });
    expect(state(kevin, good).memory_upto).toBeGreaterThan(0);
    expect(state(kevin, refused)).toMatchObject({ memory_failures: 0, memory_retry_at: null });
    expect(state(kevin, refused).memory_upto).toBeGreaterThan(0);
    expect(state(kevin, failing)).toMatchObject({ memory_upto: 0, memory_failures: 1 });
    expect(Date.parse(state(kevin, failing).memory_retry_at!)).toBeGreaterThan(Date.now() + 15 * 60_000);
    expect(r).toMatchObject({ outcome: 'errored' });
    expect(r!.detail).toMatch(/could not be summarised \(the model API answered 529\); it will be tried again later; 1 conversation\(s\) summarised; 1 skipped \(the model declined to summarise\)/);
    expect((await failurePushes(kevin)).length).toBe(1);

    // Ten minutes later: nothing is due, so no request is made and nothing is billed.
    const again = await runner.runSystemNow('memory');
    expect(again).toMatchObject({ outcome: 'nothing-to-do' });
    expect(model.requests.length).toBe(3);
  });

  it('retries a failing conversation with growing waits, tells Ben once, and gives up after the limit', async () => {
    const kevin = await makeKevin();
    const runner = new JobRunner(kevin);
    const failing = quietThread(kevin, 'Budget');
    answer({ Budget: down });
    const waits: number[] = [];
    for (let attempt = 1; attempt <= MEMORY_MAX_ATTEMPTS; attempt++) {
      const before = Date.now();
      const r = await runner.runSystemNow('memory');
      expect(r, `attempt ${attempt}`).toMatchObject({ outcome: 'errored' });
      expect(model.requests.length).toBe(attempt);
      const s = state(kevin, failing);
      if (attempt < MEMORY_MAX_ATTEMPTS) {
        expect(s).toMatchObject({ memory_upto: 0, memory_failures: attempt });
        waits.push(Math.round((Date.parse(s.memory_retry_at!) - before) / 60_000));
        // Not due yet: the job leaves it alone.
        await runner.runSystemNow('memory');
        expect(model.requests.length).toBe(attempt);
        kevin.db.prepare('UPDATE threads SET memory_retry_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), failing);
      } else {
        // Given up: the turns are marked done with, so the job stops paying to fail.
        expect(s).toMatchObject({ memory_failures: 0, memory_retry_at: null });
        expect(s.memory_upto).toBeGreaterThan(0);
        expect(r!.detail).toMatch(/gave up summarising a conversation after 5 failed attempts/);
      }
    }
    expect(waits).toEqual([20, 40, 80, 160]);
    // Four failures with one cause are one notification; giving up is a second, different one.
    const pushes = await failurePushes(kevin);
    expect(pushes.map((n: any) => n.body).sort()).toEqual([
      'a conversation could not be summarised (the model API answered 529); it will be tried again later',
      'gave up summarising a conversation after 5 failed attempts; it is left out of long-term memory',
    ]);
    expect(await runner.runSystemNow('memory')).toMatchObject({ outcome: 'nothing-to-do' });
    expect(model.requests.length).toBe(MEMORY_MAX_ATTEMPTS);
  });

  it('summarises a conversation again once a failed attempt is followed by a good one', async () => {
    const kevin = await makeKevin();
    const runner = new JobRunner(kevin);
    const id = quietThread(kevin, 'Budget');
    answer({ Budget: down });
    await runner.runSystemNow('memory');
    kevin.db.prepare('UPDATE threads SET memory_retry_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
    answer({ Budget: { content: [text('Ben set a grocery budget of $600.')] } });
    expect(await runner.runSystemNow('memory')).toMatchObject({ outcome: 'did-work', detail: '1 conversation(s) summarised' });
    expect(state(kevin, id)).toMatchObject({ memory_failures: 0, memory_retry_at: null });
  });

  it('tells Ben about a job that keeps failing for one reason once, and again when the reason changes', async () => {
    const kevin = await makeKevin();
    let why = 'disk full';
    const runner = new JobRunner(kevin, [{ name: 'flaky', description: '', everyMinutes: 10, run: async () => { throw new Error(why); } }]);
    const pushes = async () => (await view(kevin, 'system/notifications', { limit: '100' })).items.filter((n: any) => n.title === 'Job failed: flaky').map((n: any) => n.body);
    for (let i = 0; i < 4; i++) await runner.runSystemNow('flaky');
    expect(await pushes()).toEqual(['disk full']);
    why = 'permission denied';
    await runner.runSystemNow('flaky');
    await runner.runSystemNow('flaky');
    expect((await pushes()).sort()).toEqual(['disk full', 'permission denied']);
    // Every run is still in the ledger.
    expect((await ok(kevin, 'job_status', { job_key: 'system:flaky' })).runs.length).toBe(6);
    // A day later the same failure is worth saying again.
    kevin.db.prepare('UPDATE notifications SET at = ?').run(new Date(Date.now() - 25 * 3600_000).toISOString());
    await runner.runSystemNow('flaky');
    expect((await pushes()).length).toBe(3);
  });
});

describe('notification links', () => {
  it('accepts only a path inside the app', () => {
    for (const good of ['/', '/pantry', '/s/car-maintenance', '/money?tab=budgets', '/chat/0123abcd-ef', '/settings#memory']) expect(appLink(good), good).toBe(good);
    for (const bad of [
      '//evil.example/signin', '/\\evil.example', '/\\/evil.example', '\\\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 'pantry', '',
      '/\t/evil.example', '/\n/evil.example', '/ok\\..\\x', '/a\u0000b', '/a\u007fb', `/${'a'.repeat(600)}`, null, undefined, 7, { toString: () => '/pantry' },
    ]) expect(appLink(bad), String(bad)).toBeNull();
  });

  it('refuses a notify or a schedule whose link leaves the app, and says why', async () => {
    const kevin = await makeKevin();
    for (const link of ['//evil.example/signin', '/\\evil.example', 'https://evil.example']) {
      const n = await call(kevin, 'notify', { title: 'Sign in again', link });
      expect(n.ok, link).toBe(false);
      expect(n.text).toMatch(/link must be a page in this app/);
      const s = await call(kevin, 'schedule_create', { name: 'x', trigger_type: 'interval', trigger_value: '60', action: 'notify', title: 'Sign in again', link });
      expect(s.ok, link).toBe(false);
    }
    expect((await view(kevin, 'system/notifications')).items).toEqual([]);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM schedules').get()).toEqual({ n: 0 });
    const sched = await ok(kevin, 'schedule_create', { name: 'x', trigger_type: 'interval', trigger_value: '60', action: 'notify', title: 'Pantry', link: '/pantry' });
    expect((await call(kevin, 'schedule_update', { id: sched.id, link: '//evil.example' })).ok).toBe(false);
    expect((await ok(kevin, 'notify', { title: 'Pantry', link: '/pantry' })).id).toBeGreaterThan(0);
    expect((await view(kevin, 'system/notifications')).items[0]).toMatchObject({ link: '/pantry' });
  });

  it('drops a bad link that reaches the sender by another road (a stored schedule from before the check)', async () => {
    const kevin = await makeKevin();
    const runner = new JobRunner(kevin, []);
    kevin.db.prepare("INSERT INTO schedules (name, trigger_type, trigger_value, action, payload, next_run_at, created_at, created_by) VALUES ('old', 'interval', '60', 'notify', ?, ?, ?, 'kevin')")
      .run(JSON.stringify({ title: 'Old', link: '//evil.example/x' }), new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
    await runner.tick(new Date());
    expect((await view(kevin, 'system/notifications')).items[0]).toMatchObject({ title: 'Old', link: null });
    expect(events.find((e) => e.type === 'notification')).toMatchObject({ link: null });
  });
});
