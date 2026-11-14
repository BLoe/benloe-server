import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bus, type BusEvent } from '../src/bus.js';
import { setSetting } from '../src/db.js';
import { defineDomain } from '../src/domains.js';
import { loadHistory } from '../src/agent.js';
import { JobRunner } from '../src/jobs.js';
import { notify, subscribe, transport } from '../src/push.js';
import { compact, createThread, getThread, isRunning, resolveConfirm, send, stop } from '../src/threads.js';
import { defineTool } from '../src/tools.js';
import { FakeModel, text, thinking, toolUse } from './fake-model.js';
import { makeKevin, ok, view } from './helpers.js';

let slowGate: Promise<void> = Promise.resolve();
const toy = defineDomain({
  name: 'toy',
  migrations: [{ id: 'toy-001', sql: 'CREATE TABLE toys (id INTEGER PRIMARY KEY, name TEXT NOT NULL);' }],
  tools: [
    defineTool({ name: 'toy_add', description: 'Add a toy.', input: z.object({ name: z.string() }), touches: ['toy'], run: ({ name }, ctx) => ({ id: Number(ctx.db.prepare('INSERT INTO toys (name) VALUES (?)').run(name).lastInsertRowid) }) }),
    defineTool({ name: 'toy_slow', description: 'Waits.', input: z.object({}), run: async () => { await slowGate; return 'slow done'; } }),
  ],
});

let model: FakeModel;
let events: BusEvent[];
beforeEach(() => {
  model = new FakeModel();
  events = [];
  bus.removeAllListeners('event');
  bus.subscribe((e) => events.push(e));
});
const stored = (kevin: any, threadId: string) => kevin.db.prepare('SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id').all(threadId).map((r: any) => ({ role: r.role, content: JSON.parse(r.content) }));
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('a turn', () => {
  it('streams a plain reply, stores it, and records what it cost', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin);
    model.reply({ content: [text('Hello Ben, the pantry is empty.')], usage: { input_tokens: 1000, output_tokens: 200 } }, { content: [text('Pantry check')] });
    const r = await send(kevin, t.id, { text: 'hi', page: '/pantry' });
    expect(r).toMatchObject({ status: 'done', text: 'Hello Ben, the pantry is empty.' });
    expect(r!.costUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 8);

    const req = model.requests[0]!;
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.output_config).toEqual({ effort: 'low' });
    // The stable prompt is the cached block; nothing time-dependent is in it.
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(req.system[0].text).toContain('You are Kevin');
    expect(req.system[0].text).toContain('CREATE TABLE toys');
    expect(req.system[0].text).not.toMatch(/\bnow: /);
    // Time and page ride in the user message; the conversation's tail is the second breakpoint.
    const user = req.messages.at(-1);
    expect(user.content[0].text).toMatch(/<context>\nnow: .*\npage Ben is on: \/pantry/);
    expect(user.content.at(-1)).toMatchObject({ text: 'hi', cache_control: { type: 'ephemeral' } });
    expect(req.tools.map((x: any) => x.name)).toEqual(expect.arrayContaining(['query', 'toy_add', 'web_search', 'web_fetch']));

    expect(events.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('')).toBe('Hello Ben, the pantry is empty.');
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['turn_start', 'turn_end']));
    const hist = stored(kevin, t.id);
    expect(hist.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(hist)).not.toContain('cache_control');
    await settle();
    expect(getThread(kevin, t.id)!.title).toBe('Pantry check');
    expect((await view(kevin, 'system/spend')).monthUsd).toBeGreaterThan(0);
  });

  it('runs tool calls in parallel, returns results in one message, and keeps thinking only within the turn', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin);
    model.reply(
      { content: [thinking('Adding both toys.'), text('On it.'), toolUse('a', 'toy_add', { name: 'kite' }), toolUse('b', 'toy_add', { name: 'robot' }), toolUse('c', 'toy_add', {})] },
      { content: [text('Added the kite and the robot.')] },
      { content: [text('Toys')] },
    );
    const r = await send(kevin, t.id, { text: 'add a kite and a robot' });
    expect(r!.status).toBe('done');
    expect(kevin.db.prepare('SELECT name FROM toys ORDER BY id').all()).toEqual([{ name: 'kite' }, { name: 'robot' }]);

    // Second request: the assistant message exactly as it came (thinking included), then every result together.
    const [, second] = model.requests;
    const msgs = second!.messages;
    expect(msgs.at(-2).content.map((b: any) => b.type)).toEqual(['thinking', 'text', 'tool_use', 'tool_use', 'tool_use']);
    const results = msgs.at(-1).content;
    expect(results.map((b: any) => b.type)).toEqual(['tool_result', 'tool_result', 'tool_result']);
    expect(results.map((b: any) => !!b.is_error)).toEqual([false, false, true]);

    // What is stored for later turns has no thinking.
    const hist = stored(kevin, t.id);
    expect(hist[1].content.map((b: any) => b.type)).toEqual(['text', 'tool_use', 'tool_use', 'tool_use']);
    const items = getThread(kevin, t.id)!.turns[0]!.items as any[];
    expect(items.map((i) => i.type)).toEqual(['status', 'text', 'tool', 'tool', 'tool', 'text']);
    expect(items.filter((i) => i.type === 'tool').map((i) => i.state)).toEqual(['ok', 'ok', 'error']);
    expect(events).toContainEqual({ type: 'data_changed', domains: ['toy'] });

    // The next turn sends that stored history, then the new message.
    model.reply({ content: [text('Two.')] });
    await send(kevin, t.id, { text: 'how many now?' });
    const third = model.requests.at(-1)!;
    expect(third.messages.length).toBe(5);
    expect(JSON.stringify(third.messages.slice(0, 4))).not.toContain('"thinking"');
  });

  it('folds a message sent mid-turn in after the last tool result, as Ben\'s own words', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin);
    let release!: () => void;
    slowGate = new Promise((r) => (release = r));
    model.reply({ content: [toolUse('s', 'toy_slow', {})] }, { content: [text('Done, and noted the bananas.')] }, { content: [text('T')] });
    const turn = send(kevin, t.id, { text: 'do the slow thing' });
    await settle();
    expect(isRunning(t.id)).toBe(true);
    expect(await send(kevin, t.id, { text: 'also add bananas' })).toBeNull();
    release();
    expect((await turn)!.status).toBe('done');
    const last = model.requests[1]!.messages.at(-1).content;
    expect(last.map((b: any) => b.type)).toEqual(['tool_result', 'text']);
    expect(last[1].text).toBe('also add bananas');
    expect(events.some((e) => e.type === 'user_folded')).toBe(true);
    expect(model.requests.length).toBeLessThanOrEqual(3); // one turn, not two
  });

  it('asks before a destructive command and tells the model when Ben says no', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin);
    model.reply({ content: [toolUse('x', 'shell', { command: 'rm -rf notes' })] }, { content: [text('Left it alone.')] }, { content: [text('T')] });
    const turn = send(kevin, t.id, { text: 'clean up' });
    await settle();
    const ask = events.find((e) => e.type === 'confirm_request') as any;
    expect(ask.summary).toContain('rm -rf notes');
    expect(resolveConfirm(t.id, ask.confirmId, false)).toBe(true);
    await turn;
    const result = model.requests[1]!.messages.at(-1).content[0];
    expect(result).toMatchObject({ type: 'tool_result', is_error: true });
    expect(result.content).toMatch(/Ben declined/);
    expect((getThread(kevin, t.id)!.turns[0]!.items as any[]).find((i) => i.type === 'tool').state).toBe('denied');
  });

  it('stops when Ben stops it, and leaves a history the next turn can use', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin);
    let release!: () => void;
    slowGate = new Promise((r) => (release = r));
    model.reply({ content: [text('Working.'), toolUse('s', 'toy_slow', {})] });
    const turn = send(kevin, t.id, { text: 'slow' });
    await settle();
    expect(stop(t.id)).toBe(true);
    release();
    expect((await turn)!.status).toBe('stopped');
    const hist = stored(kevin, t.id);
    // No tool call is left without its result.
    const calls = hist.flatMap((m: any) => m.content).filter((b: any) => b.type === 'tool_use').length;
    const results = hist.flatMap((m: any) => m.content).filter((b: any) => b.type === 'tool_result').length;
    expect(calls).toBe(results);
    model.reply({ content: [text('Back.')] }, { content: [text('T')] });
    expect((await send(kevin, t.id, { text: 'again' }))!.status).toBe('done');
  });

  it('uses the deep model only when asked', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin);
    model.reply({ content: [text('Thought about it.')] }, { content: [text('T')] });
    await send(kevin, t.id, { text: 'Think hard about whether to refinance.' });
    expect(model.requests[0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'high' } });
  });

  it('refuses to start once the monthly cap is reached, without calling the model', async () => {
    const kevin = await makeKevin();
    setSetting(kevin.db, 'monthly_cap_usd', 1);
    kevin.db.prepare("INSERT INTO usage (at, purpose, model, cost_usd) VALUES (?, 'turn', 'x', 1.5)").run(new Date().toISOString());
    const t = createThread(kevin);
    const r = await send(kevin, t.id, { text: 'hi' });
    expect(r).toMatchObject({ status: 'blocked' });
    expect(r!.text).toMatch(/spend cap/);
    expect(model.requests.length).toBe(0);
  });

  it('reports a refusal and a model error plainly', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin);
    model.reply({ content: [], stop_reason: 'refusal' }, { content: [text('T')] });
    expect((await send(kevin, t.id, { text: 'x' }))!.status).toBe('refused');
    model.queue = [];
    const r = await send(kevin, t.id, { text: 'y' }); // nothing queued: the fake throws
    expect(r!.status).toBe('error');
    expect(r!.text).toMatch(/Something went wrong/);
  });

  it('compacts a long thread into a summary and sends history from after it', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin);
    for (let i = 0; i < 6; i++) {
      model.reply({ content: [text(`answer ${i}`)] });
      if (i === 0) model.reply({ content: [text('T')] });
      await send(kevin, t.id, { text: `question ${i}` });
      await settle();
    }
    model.reply({ content: [text('Ben asked six questions; the first two are settled.')] });
    expect(await compact(kevin, t.id, 4)).toBe(true);
    const { messages, summary } = loadHistory(kevin, t.id);
    expect(summary).toMatch(/six questions/);
    expect(messages.length).toBe(8);
    expect(JSON.stringify(messages[0])).toContain('question 2');
    model.reply({ content: [text('ok')] });
    await send(kevin, t.id, { text: 'next' });
    const first = model.requests.at(-1)!.messages[0];
    expect(first.role).toBe('user');
    expect(first.content[0].text).toMatch(/<earlier_in_this_conversation>\nBen asked six questions/);
  });
});

describe('jobs', () => {
  it('fires a reminder once, records it, and disarms it', async () => {
    const kevin = await makeKevin();
    const runner = new JobRunner(kevin, []);
    const at = new Date(Date.now() + 60_000);
    const s = await ok(kevin, 'schedule_create', { name: 'Chicken', trigger_type: 'once', trigger_value: at.toISOString(), action: 'notify', title: 'Take the chicken out of the freezer', link: '/pantry' });
    await runner.tick(new Date());
    expect((await view(kevin, 'system/notifications')).items).toEqual([]);
    await runner.tick(new Date(at.getTime() + 1000));
    const inbox = await view(kevin, 'system/notifications');
    expect(inbox.items[0]).toMatchObject({ title: 'Take the chicken out of the freezer', link: '/pantry', source: `schedule:${s.id}` });
    expect(inbox.unread).toBe(1);
    await runner.tick(new Date(at.getTime() + 120_000));
    expect((await view(kevin, 'system/notifications')).items.length).toBe(1);
    const status = await ok(kevin, 'job_status', { job_key: `schedule:${s.id}` });
    expect(status.runs.map((r: any) => r.outcome)).toEqual(['did-work']);
    expect((await ok(kevin, 'schedule_list', {}))[0]).toMatchObject({ enabled: false, next_run_at: null });
  });

  it('notifies from a check only when its query returns rows', async () => {
    const kevin = await makeKevin([toy]);
    const runner = new JobRunner(kevin, []);
    const s = await ok(kevin, 'schedule_create', { name: 'Toys', trigger_type: 'interval', trigger_value: '60', action: 'check', sql: 'SELECT name FROM toys', title: 'You have toys' });
    const later = (h: number) => new Date(Date.now() + h * 3600_000 + 60_000);
    await runner.tick(later(1));
    await ok(kevin, 'toy_add', { name: 'kite' });
    await runner.tick(later(2));
    const runs = (await ok(kevin, 'job_status', { job_key: `schedule:${s.id}` })).runs;
    expect(runs.map((r: any) => r.outcome)).toEqual(['did-work', 'nothing-to-do']);
    expect((await view(kevin, 'system/notifications')).items[0]).toMatchObject({ title: 'You have toys', body: 'kite' });
    // A check must be a read.
    expect((await kevin.tools.call('schedule_create', { name: 'bad', trigger_type: 'interval', trigger_value: '5', action: 'check', sql: 'DELETE FROM toys', title: 'x' }, { db: kevin.db, source: 'agent', confirm: async () => true })).ok).toBe(false);
  });

  it('runs an agent turn on a schedule, within its own spend cap', async () => {
    const kevin = await makeKevin();
    const runner = new JobRunner(kevin, []);
    const s = await ok(kevin, 'schedule_create', { name: 'Weekly plan', trigger_type: 'cron', trigger_value: '0 18 * * 0', action: 'agent_turn', prompt: 'Plan the week.', spend_cap_usd: 0.05 });
    model.reply({ content: [text('Planned.')], usage: { input_tokens: 10_000, output_tokens: 4000 } }, { content: [text('T')] });
    const row = kevin.db.prepare('SELECT * FROM schedules WHERE id = ?').get(s.id) as any;
    const r1 = await runner.runScheduleNow(row);
    expect(r1).toMatchObject({ outcome: 'did-work' });
    expect(model.requests[0]!.messages[0].content[0].text).toMatch(/started by a schedule/);
    expect(model.requests[0]!.tools.map((t: any) => t.name)).not.toContain('shell');
    // $0.06 spent against a $0.05 cap: the next run is refused before any model call.
    const before = model.requests.length;
    const r2 = await runner.runScheduleNow(kevin.db.prepare('SELECT * FROM schedules WHERE id = ?').get(s.id) as any);
    expect(r2).toMatchObject({ outcome: 'errored' });
    expect(r2!.detail).toMatch(/spend cap/);
    expect(model.requests.length).toBe(before);
    expect((await view(kevin, 'system/schedules'))[0].spent_this_month_usd).toBeCloseTo(0.06, 4);
  });

  it('system jobs run on their cadence, can be paused, and the watchdog notices a silent ledger', async () => {
    const kevin = await makeKevin();
    let runs = 0;
    const runner = new JobRunner(kevin, [{ name: 'beat', description: '', everyMinutes: 10, run: async () => { runs++; return { outcome: 'nothing-to-do' }; } }]);
    const t0 = new Date();
    await runner.tick(t0);
    await runner.tick(new Date(t0.getTime() + 60_000));
    expect(runs).toBe(1);
    kevin.db.prepare("UPDATE job_runs SET started_at = ?").run(new Date(t0.getTime() - 11 * 60_000).toISOString());
    await runner.tick(t0);
    expect(runs).toBe(2);
    kevin.db.prepare("INSERT INTO job_state (job_key, paused) VALUES ('system:beat', 1)").run();
    kevin.db.prepare("UPDATE job_runs SET started_at = ?").run(new Date(t0.getTime() - 60 * 60_000).toISOString());
    await runner.tick(t0);
    expect(runs).toBe(2);
    expect(await runner.checkAlive(t0.getTime())).toBe(false);
    expect(await runner.checkAlive(t0.getTime())).toBe(false);
    const alerts = (await view(kevin, 'system/notifications')).items.filter((n: any) => n.source === 'watchdog');
    expect(alerts.length).toBe(1); // alerted once, not on every check
  });
});

describe('push', () => {
  it('sends to every device and forgets one whose subscription is gone', async () => {
    const kevin = await makeKevin();
    const { config } = await import('../src/config.js');
    const keys = (await import('web-push')).generateVAPIDKeys();
    Object.assign(config, { vapidPublic: keys.publicKey, vapidPrivate: keys.privateKey });
    const sent: string[] = [];
    const real = transport.send;
    transport.send = (async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push(payload);
    }) as never;
    try {
      subscribe(kevin.db, { endpoint: 'https://push.example/ok', keys: { p256dh: 'a', auth: 'b' } }, 'phone');
      subscribe(kevin.db, { endpoint: 'https://push.example/gone', keys: { p256dh: 'a', auth: 'b' } }, 'old phone');
      expect(() => subscribe(kevin.db, { endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } }, null)).toThrow();
      const r = await notify(kevin.db, { title: 'Hi', body: 'There', link: 'https://evil.example/x' });
      expect(r.pushed).toBe(1);
      expect(JSON.parse(sent[0]!)).toMatchObject({ title: 'Hi', body: 'There', link: '/' }); // only in-app links survive
      expect((await view(kevin, 'system/health')).push_devices).toBe(1);
    } finally {
      transport.send = real;
      Object.assign(config, { vapidPublic: '', vapidPrivate: '' });
    }
  });
});
