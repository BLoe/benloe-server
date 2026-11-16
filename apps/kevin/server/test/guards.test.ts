// Restrictions are tested where they are enforced: at the call, with the model (or a caller) asking
// for the thing it was never offered. Each test here fails if its guard is taken out.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { extract, MAX_EXTRACT_CHARS, saveUpload } from '../src/attachments.js';
import { bus } from '../src/bus.js';
import { config } from '../src/config.js';
import { MAX_SCHEDULES, MAX_SUGGESTIONS_BYTES, runtime } from '../src/core/index.js';
import { setSetting } from '../src/db.js';
import { defineDomain } from '../src/domains.js';
import { assertSafeRegex, compileRule, SEED_RULES, SLOW_RULE_MS } from '../src/domains/_money/categorize.js';
import money from '../src/domains/money.js';
import spaces from '../src/domains/spaces.js';
import { BACKUPS_KEPT, backupTools, JobRunner, writeBackup } from '../src/jobs.js';
import { readOnlyQuery } from '../src/sql.js';
import { createThread, send, stop } from '../src/threads.js';
import { defineTool, type ToolCtx } from '../src/tools.js';
import { FakeModel, text, toolUse } from './fake-model.js';
import { call, makeKevin, ok, view } from './helpers.js';

const toy = defineDomain({
  name: 'toy',
  migrations: [{ id: 'toy-001', sql: 'CREATE TABLE toys (id INTEGER PRIMARY KEY, name TEXT NOT NULL);' }],
  tools: [defineTool({ name: 'toy_add', description: 'Add a toy.', input: z.object({ name: z.string() }), touches: ['toy'], run: ({ name }, ctx) => ({ id: Number(ctx.db.prepare('INSERT INTO toys (name) VALUES (?)').run(name).lastInsertRowid) }) })],
});

let model: FakeModel;
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  model = new FakeModel();
  bus.removeAllListeners('event');
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errors.mockRestore());
const logged = (needle: string) => errors.mock.calls.some((c: unknown[]) => c.map(String).join(' ').includes(needle));
const as = (kevin: any, source: ToolCtx['source'], confirm = false): ToolCtx => ({ db: kevin.db, source, threadId: null, turnId: null, confirm: () => Promise.resolve(confirm) });
const at = (...p: string[]) => join(config.shellDir, ...p);
const stored = (kevin: any, threadId: string) => kevin.db.prepare('SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id').all(threadId).map((r: any) => ({ role: r.role, content: JSON.parse(r.content) }));

describe('what a scheduled turn may not do, whatever the model asks for', () => {
  it('does not run the shell, even when the model calls it by name', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'job', 'Scheduled');
    model.reply({ content: [toolUse('s', 'shell', { command: 'echo ran > job-shell-ran.txt' })] }, { content: [text('Could not.')] });
    const r = await send(kevin, t.id, { text: 'Tidy up.' }, { origin: 'job', jobKey: 'schedule:1' });
    expect(r!.status).toBe('done');
    expect(model.requests[0]!.tools.map((x: any) => x.name)).not.toContain('shell');
    const result = model.requests[1]!.messages.at(-1).content[0];
    expect(result).toMatchObject({ type: 'tool_result', is_error: true });
    expect(result.content).toMatch(/"shell" is not available in a scheduled turn/);
    expect(existsSync(at('job-shell-ran.txt'))).toBe(false);
    expect(kevin.db.prepare("SELECT ok FROM tool_audit WHERE tool = 'shell'").all()).toEqual([{ ok: 0 }]);
    // The same call in a chat turn runs.
    const chat = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [toolUse('s', 'shell', { command: 'echo ran; touch chat-shell-ran.txt' })] }, { content: [text('Done.')] });
    await send(kevin, chat.id, { text: 'Tidy up.' });
    expect(existsSync(at('chat-shell-ran.txt'))).toBe(true);
  });

  it('refuses the shell for a job caller in the registry itself, with or without a turn around it', async () => {
    const kevin = await makeKevin();
    const r = await kevin.tools.call('shell', { command: 'touch direct-job-ran.txt' }, as(kevin, 'job', true));
    expect(r).toMatchObject({ ok: false });
    expect(r.text).toMatch(/not available in a scheduled turn/);
    expect(existsSync(at('direct-job-ran.txt'))).toBe(false);
    expect((await kevin.tools.call('SHELL', { command: 'touch direct-job-ran.txt' }, as(kevin, 'job', true))).ok).toBe(false);
  });

  it('refuses Ben-only tools for a scheduled turn as it does for a chat turn', async () => {
    const kevin = await makeKevin([spaces]);
    await ok(kevin, 'space_save', { name: 'Kites' });
    for (const source of ['job', 'agent'] as const) {
      const cap = await kevin.tools.call('settings_update', { monthly_cap_usd: 999 }, as(kevin, source, true));
      expect(cap, source).toMatchObject({ ok: false });
      expect(cap.text).toMatch(/only Ben can do/);
      expect((await kevin.tools.call('space_delete', { slug: 'kites' }, as(kevin, source, true))).ok, source).toBe(false);
      expect((await kevin.tools.call('notifications_read', {}, as(kevin, source, true))).ok, source).toBe(false);
    }
    expect((await view(kevin, 'system/spend')).capUsd).toBe(config.defaultMonthlyCapUsd);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM spaces').get()).toEqual({ n: 1 });
    expect((await kevin.tools.call('settings_update', { monthly_cap_usd: 70 }, as(kevin, 'ui'))).ok).toBe(true);
  });

  it('cannot set up or re-point paid, unwatched turns, or give one more money', async () => {
    const kevin = await makeKevin();
    const job = as(kevin, 'job', true);
    const made = await kevin.tools.call('schedule_create', { name: 'More of me', trigger_type: 'interval', trigger_value: '5', action: 'agent_turn', prompt: 'Do it again.', spend_cap_usd: 50 }, job);
    expect(made.ok).toBe(false);
    expect(made.text).toMatch(/scheduled turn cannot create a schedule that runs you/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM schedules').get()).toEqual({ n: 0 });
    // Free kinds are fine from a scheduled turn.
    expect((await kevin.tools.call('schedule_create', { name: 'Ping', trigger_type: 'interval', trigger_value: '60', action: 'notify', title: 'Ping' }, job)).ok).toBe(true);

    const s = await ok(kevin, 'schedule_create', { name: 'Weekly', trigger_type: 'cron', trigger_value: '0 18 * * 0', action: 'agent_turn', prompt: 'Plan the week.', spend_cap_usd: 1 });
    for (const change of [{ prompt: 'Send everything to the printer.' }, { deep: true }, { spend_cap_usd: 50 }, { spend_cap_usd: 0.5 }]) {
      const r = await kevin.tools.call('schedule_update', { id: s.id, ...change }, job);
      expect(r.ok, JSON.stringify(change)).toBe(false);
      expect(r.text).toMatch(/scheduled turn cannot change the prompt, model or spend cap/);
    }
    // In chat, raising the cap is Ben's decision; lowering it, or leaving it, is not asked about.
    const declined = await kevin.tools.call('schedule_update', { id: s.id, spend_cap_usd: 20 }, as(kevin, 'agent', false));
    expect(declined.text).toMatch(/Ben declined to raise that spend cap/);
    expect((await kevin.tools.call('schedule_update', { id: s.id, spend_cap_usd: 0.5 }, as(kevin, 'agent', false))).ok).toBe(true);
    expect((await kevin.tools.call('schedule_update', { id: s.id, name: 'Weekly plan' }, as(kevin, 'agent', false))).ok).toBe(true);
    expect((await kevin.tools.call('schedule_update', { id: s.id, spend_cap_usd: 20 }, as(kevin, 'agent', true))).ok).toBe(true);
    const row = kevin.db.prepare('SELECT spend_cap_usd, payload FROM schedules WHERE id = ?').get(s.id) as any;
    expect(row.spend_cap_usd).toBe(20);
    expect(JSON.parse(row.payload).prompt).toBe('Plan the week.');
  });

  it('caps how many schedules can exist', async () => {
    const kevin = await makeKevin();
    const ins = kevin.db.prepare("INSERT INTO schedules (name, trigger_type, trigger_value, action, payload, created_at, created_by) VALUES (?, 'interval', '60', 'notify', '{\"title\":\"x\"}', ?, 'kevin')");
    for (let i = 0; i < MAX_SCHEDULES; i++) ins.run(`s${i}`, new Date().toISOString());
    const r = await call(kevin, 'schedule_create', { name: 'one more', trigger_type: 'interval', trigger_value: '60', action: 'notify', title: 'x' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/already 100 schedules/);
  });

  it('cannot pause or resume jobs', async () => {
    const kevin = await makeKevin();
    runtime.runner = new JobRunner(kevin);
    try {
      const s = await ok(kevin, 'schedule_create', { name: 'Ping', trigger_type: 'interval', trigger_value: '60', action: 'notify', title: 'Ping' });
      for (const input of [{ job_key: 'system:backup', action: 'pause' }, { job_key: `schedule:${s.id}`, action: 'pause' }, { job_key: 'system:backup', action: 'resume' }]) {
        const r = await kevin.tools.call('job_control', input, as(kevin, 'job', true));
        expect(r.ok, JSON.stringify(input)).toBe(false);
        expect(r.text).toMatch(/scheduled turn cannot pause or resume jobs/);
      }
      expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM job_state WHERE paused = 1').get()).toEqual({ n: 0 });
      expect(kevin.db.prepare('SELECT enabled FROM schedules WHERE id = ?').get(s.id)).toEqual({ enabled: 1 });
      // In chat it can.
      expect((await kevin.tools.call('job_control', { job_key: 'system:prune', action: 'pause' }, as(kevin, 'agent'))).ok).toBe(true);
    } finally {
      runtime.runner = null;
    }
  });
});

describe('things the model can make grow', () => {
  it('stops adding to the suggestions file once it is full', async () => {
    const kevin = await makeKevin();
    const file = join(config.dataDir, 'SUGGESTIONS.md');
    rmSync(file, { force: true });
    await ok(kevin, 'suggest_improvement', { suggestion: 'A tool for kite inventories would help.' });
    expect(readFileSync(file, 'utf8')).toContain('kite inventories');
    writeFileSync(file, 'x'.repeat(MAX_SUGGESTIONS_BYTES + 1));
    const r = await call(kevin, 'suggest_improvement', { suggestion: 'One more suggestion, please.' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/suggestions file is full/);
    expect(readFileSync(file).length).toBe(MAX_SUGGESTIONS_BYTES + 1);
    rmSync(file, { force: true });
  });

  it('makes no title or summary request once the month\'s cap is reached', async () => {
    const kevin = await makeKevin();
    setSetting(kevin.db, 'monthly_cap_usd', 0.05);
    const t = createThread(kevin); // untitled: a title would normally be asked for
    model.reply({ content: [text('Here you go.')], usage: { input_tokens: 10_000, output_tokens: 4000 } }, { content: [text('A title')] });
    expect((await send(kevin, t.id, { text: 'hello' }))!.status).toBe('done');
    await new Promise((r) => setTimeout(r, 50));
    expect(model.requests.length).toBe(1);
    expect(kevin.db.prepare('SELECT title FROM threads WHERE id = ?').get(t.id)).toEqual({ title: 'New chat' });
  });
});

describe('a tool the turn was not given', () => {
  it('is refused when the model calls it anyway: the tools of an area Ben switched off', async () => {
    const kevin = await makeKevin([toy]);
    setSetting(kevin.db, 'hidden_pages', ['/toy']);
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' })] }, { content: [text('That area is off.')] });
    await send(kevin, t.id, { text: 'add a kite' });
    expect(model.requests[0]!.tools.map((x: any) => x.name)).not.toContain('toy_add');
    expect(model.requests[1]!.messages.at(-1).content[0].content).toMatch(/"toy_add" is not one of the tools this turn has/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM toys').get()).toEqual({ n: 0 });
    // Switched back on, the same call works.
    setSetting(kevin.db, 'hidden_pages', []);
    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' })] }, { content: [text('Added.')] });
    await send(kevin, t.id, { text: 'add a kite' });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM toys').get()).toEqual({ n: 1 });
  });
});

describe('SQL the model writes', () => {
  it('runs only a single statement that reads: nothing that writes, and nothing that changes the connection', async () => {
    const kevin = await makeKevin([toy]);
    await ok(kevin, 'toy_add', { name: 'kite' });
    expect((await ok(kevin, 'query', { sql: 'SELECT name FROM toys' })).rows).toEqual([{ name: 'kite' }]);
    expect((await ok(kevin, 'query', { sql: 'WITH t AS (SELECT name FROM toys) SELECT count(*) AS n FROM t' })).rows).toEqual([{ n: 1 }]);
    const other = join(config.dataDir, 'attached.db');
    // These do not write to a table, so only the "must return rows" half of the check turns them away.
    for (const sql of ['BEGIN', 'BEGIN IMMEDIATE', 'COMMIT', 'SAVEPOINT s', 'RELEASE s', `ATTACH DATABASE '${other}' AS o`, 'DETACH DATABASE main', 'PRAGMA query_only = 0']) {
      const r = await call(kevin, 'query', { sql });
      expect(r.ok, sql).toBe(false);
      expect(r.text, sql).toMatch(/only a single read-only SELECT/);
    }
    for (const sql of ['DELETE FROM toys', "INSERT INTO toys (name) VALUES ('x') RETURNING id", 'DROP TABLE toys', "UPDATE toys SET name = 'x' RETURNING name", `VACUUM INTO '${other}'`, 'SELECT 1; DELETE FROM toys', 'CREATE TABLE x (a)']) {
      expect((await call(kevin, 'query', { sql })).ok, sql).toBe(false);
    }
    expect(existsSync(other)).toBe(false);
    expect(kevin.db.prepare('SELECT name FROM toys').all()).toEqual([{ name: 'kite' }]);
    expect(kevin.db.inTransaction).toBe(false);
    // The same check guards a schedule's SQL, when it is saved and each time it runs.
    expect((await call(kevin, 'schedule_create', { name: 'bad', trigger_type: 'interval', trigger_value: '5', action: 'check', sql: 'BEGIN', title: 'x' })).ok).toBe(false);
  });

  it('cannot write even if the statement check were wrong: the connection it runs on is read-only', async () => {
    const kevin = await makeKevin([toy]);
    await ok(kevin, 'toy_add', { name: 'kite' });
    // With the statement check left out, a write reaches SQLite, and SQLite refuses it.
    for (const sql of ['DELETE FROM toys RETURNING id', "INSERT INTO toys (name) VALUES ('x') RETURNING id", "UPDATE toys SET name = 'x' RETURNING id"]) {
      await expect(readOnlyQuery(kevin, sql, 200, { statementCheck: false }), sql).rejects.toThrow(/readonly database/);
    }
    expect(kevin.db.prepare('SELECT name FROM toys').all()).toEqual([{ name: 'kite' }]);
    // And with it in place, the same statements are turned away by the check, with its own message.
    await expect(readOnlyQuery(kevin, 'DELETE FROM toys RETURNING id')).rejects.toThrow(/only a single read-only SELECT/);
    expect((await call(kevin, 'query', { sql: "INSERT INTO toys (name) VALUES ('x') RETURNING id" })).text).toMatch(/only a single read-only SELECT/);
  });

  it('cancels a statement that never finishes, and the server keeps answering while it runs', async () => {
    const kevin = await makeKevin([toy]);
    config.sqlSeconds = 1;
    try {
      let ticks = 0;
      const timer = setInterval(() => ticks++, 20);
      const started = Date.now();
      const r = await call(kevin, 'query', { sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c' });
      clearInterval(timer);
      expect(r.ok).toBe(false);
      expect(r.text).toMatch(/still running after 1 seconds and was cancelled/);
      expect(Date.now() - started).toBeLessThan(4000);
      // The event loop was free the whole time: a blocked server would have ticked a handful of times at most.
      expect(ticks).toBeGreaterThan(25);
      // And the database is untouched and usable straight after.
      expect((await ok(kevin, 'query', { sql: 'SELECT 1 AS one' })).rows).toEqual([{ one: 1 }]);

      // A check schedule with such a statement is refused when it is made...
      const made = await call(kevin, 'schedule_create', { name: 'spin', trigger_type: 'interval', trigger_value: '5', action: 'check', sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c', title: 'x' });
      expect(made.text).toMatch(/That SQL does not run: .*cancelled/);
      // ...and one already stored fails its run instead of freezing the runner.
      kevin.db.prepare("INSERT INTO schedules (name, trigger_type, trigger_value, action, payload, next_run_at, created_at, created_by) VALUES ('spin', 'interval', '60', 'check', ?, ?, ?, 'kevin')")
        .run(JSON.stringify({ title: 'x', sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c' }), new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
      const runner = new JobRunner(kevin, []);
      await runner.tick(new Date());
      const run = kevin.db.prepare("SELECT outcome, detail FROM job_runs ORDER BY id DESC LIMIT 1").get() as any;
      expect(run.outcome).toBe('errored');
      expect(run.detail).toMatch(/cancelled/);
    } finally {
      config.sqlSeconds = 5;
    }
  });

  it('bounds what comes back: long values are cut, binary is named, and a huge result stops early', async () => {
    const kevin = await makeKevin([toy]);
    const one = (await ok(kevin, 'query', { sql: "SELECT printf('%.*c', 60000, 'k') AS long, zeroblob(10) AS bin, 9007199254740993 AS big" })).rows[0];
    expect(one.long).toMatch(/^k{50000}\[cut: 60000 characters; read the rest with substr\(\)\]$/);
    expect(one.bin).toBe('[binary, 10 bytes]');
    const many = await readOnlyQuery(kevin, "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 150) SELECT x, printf('%.*c', 40000, 'k') AS pad FROM c", 200);
    expect(many.cut).toBe(true);
    expect(many.rows.length).toBeLessThan(60);
    const text = (await call(kevin, 'query', { sql: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 150) SELECT x, printf('%.*c', 40000, 'k') AS pad FROM c" })).text;
    expect(text.length).toBeLessThan(45_000);
  });
});

describe('a write whose bookkeeping fails', () => {
  it('is still reported as done, and stays in the conversation\'s history with the other calls\' results', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'chat', 'Titled');
    // The daily log cannot be written: the write itself still goes through.
    kevin.db.exec('ALTER TABLE memory_log RENAME TO memory_log_gone');
    const direct = await call(kevin, 'toy_add', { name: 'direct' });
    expect(direct).toMatchObject({ ok: true, value: { id: 1 } });
    expect(logged('toy_add succeeded but its entry in the daily log could not be written')).toBe(true);

    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' }), toolUse('b', 'toy_add', { name: 'robot' })] }, { content: [text('Added both.')] });
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));
    const r = await send(kevin, t.id, { text: 'add a kite and a robot' });
    expect(r).toMatchObject({ status: 'done', text: 'Added both.' });
    expect(kevin.db.prepare('SELECT name FROM toys ORDER BY id').all()).toEqual([{ name: 'direct' }, { name: 'kite' }, { name: 'robot' }]);
    const hist = stored(kevin, t.id);
    expect(hist[1].content.filter((b: any) => b.type === 'tool_use').length).toBe(2);
    expect(hist[2].content.map((b: any) => [b.type, b.is_error ?? false])).toEqual([['tool_result', false], ['tool_result', false]]);
    expect(events.filter((e) => e.type === 'data_changed' && e.domains.includes('toy')).length).toBe(2);
  });

  it('keeps every other result when one call fails outside the tool', async () => {
    const kevin = await makeKevin([toy]);
    const t = createThread(kevin, 'chat', 'Titled');
    const real = kevin.tools.call.bind(kevin.tools);
    kevin.tools.call = async (name, input, ctx) => {
      const r = await real(name, input, ctx);
      if ((input as any).name === 'robot') throw new Error('disk full');
      return r;
    };
    model.reply({ content: [toolUse('a', 'toy_add', { name: 'kite' }), toolUse('b', 'toy_add', { name: 'robot' })] }, { content: [text('One of them is unclear.')] });
    const r = await send(kevin, t.id, { text: 'add a kite and a robot' });
    expect(r!.status).toBe('done');
    const results = model.requests[1]!.messages.at(-1).content;
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'a' });
    expect(results[0].is_error).toBeUndefined();
    expect(results[1]).toMatchObject({ type: 'tool_result', tool_use_id: 'b', is_error: true });
    expect(results[1].content).toMatch(/may or may not have taken effect.*disk full/);
  });
});

describe('what a request cost when it did not finish', () => {
  const usage = (kevin: any) => kevin.db.prepare('SELECT purpose, input_tokens, output_tokens, cost_usd FROM usage ORDER BY id').all() as any[];

  it('is recorded when Ben stops a reply mid-stream, and counts toward the turn and the month', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply({ content: [text('never finished')], usage: { input_tokens: 35_000 }, before: () => void stop(t.id) });
    const r = await send(kevin, t.id, { text: 'a long question' });
    expect(r!.status).toBe('stopped');
    expect(usage(kevin)).toMatchObject([{ purpose: 'turn', input_tokens: 35_000 }]);
    expect(r!.costUsd).toBeCloseTo(35_000 * 2 / 1e6, 4);
    expect((await view(kevin, 'system/spend')).monthUsd).toBeCloseTo(r!.costUsd, 8);
  });

  it('is recorded when the stream breaks off, with the output that had arrived estimated', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    const said = 'word '.repeat(600); // 3000 characters arrive before the connection drops
    model.reply({ content: [text(said)], usage: { input_tokens: 10_000 }, breaksWith: new Error('socket hang up') });
    const r = await send(kevin, t.id, { text: 'tell me a lot' });
    expect(r).toMatchObject({ status: 'error', error: 'socket hang up' });
    expect(usage(kevin)).toEqual([{ purpose: 'turn', input_tokens: 10_000, output_tokens: 1000, cost_usd: (10_000 * 2 + 1000 * 10) / 1e6 }]);
    expect(r!.costUsd).toBeCloseTo(0.03, 6);
  });

  it('records nothing for a request the API never started answering', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    const r = await send(kevin, t.id, { text: 'hello' }); // nothing queued: the fake fails before any reply
    expect(r!.status).toBe('error');
    expect(usage(kevin)).toEqual([]);
  });

  it('counts a broken-off scheduled turn against its schedule, so the next run sees the money as spent', async () => {
    const kevin = await makeKevin();
    const runner = new JobRunner(kevin, []);
    const s = await ok(kevin, 'schedule_create', { name: 'Weekly', trigger_type: 'cron', trigger_value: '0 18 * * 0', action: 'agent_turn', prompt: 'Plan the week.', spend_cap_usd: 0.05 });
    model.reply({ content: [text('x')], usage: { input_tokens: 30_000 }, breaksWith: new Error('overloaded') });
    const row = () => kevin.db.prepare('SELECT * FROM schedules WHERE id = ?').get(s.id) as any;
    expect(await runner.runScheduleNow(row())).toMatchObject({ outcome: 'errored', costUsd: expect.closeTo(0.06, 3) });
    const again = await runner.runScheduleNow(row());
    expect(again!.detail).toMatch(/spend cap .* is used up/);
    expect(model.requests.length).toBe(1);
  });

  it('is recorded for web research that breaks off', async () => {
    const kevin = await makeKevin();
    model.reply({ content: [text('partial findings')], usage: { input_tokens: 64_000, server_tool_use: { web_search_requests: 3 } }, breaksWith: new Error('connection reset') });
    const r = await call(kevin, 'web_research', { question: 'What is the tallest kite ever flown?' });
    expect(r.ok).toBe(false);
    expect(kevin.db.prepare('SELECT purpose, input_tokens, web_searches FROM usage').all()).toEqual([{ purpose: 'research', input_tokens: 64_000, web_searches: 3 }]);
  });
});

describe('the nightly backup', () => {
  const root = () => join(config.dataDir, 'backups');
  const days = () => (existsSync(root()) ? readdirSync(root()).sort() : []);
  beforeEach(() => rmSync(root(), { recursive: true, force: true }));

  it('writes a complete snapshot under the day\'s name, and a second run that day replaces it', async () => {
    const kevin = await makeKevin([toy]);
    mkdirSync(join(config.dataDir, 'documents'), { recursive: true });
    writeFileSync(join(config.dataDir, 'documents', 'kite-plan.txt'), 'two spars, one sail');
    await ok(kevin, 'toy_add', { name: 'kite' });
    expect(await writeBackup(kevin, '2026-03-01')).toEqual({ day: '2026-03-01', files: true });
    expect(days()).toEqual(['2026-03-01']);
    expect(readdirSync(join(root(), '2026-03-01')).sort()).toEqual(['files.tar.gz', 'kevin.db']);
    await ok(kevin, 'toy_add', { name: 'robot' });
    await writeBackup(kevin, '2026-03-01');
    expect(days()).toEqual(['2026-03-01']);
    const Database = (await import('better-sqlite3')).default;
    const copy = new Database(join(root(), '2026-03-01', 'kevin.db'), { readonly: true });
    expect(copy.prepare('SELECT name FROM toys ORDER BY id').all()).toEqual([{ name: 'kite' }, { name: 'robot' }]);
    copy.close();
  });

  it('leaves nothing behind when the archive fails, and failed nights never push out good snapshots', async () => {
    const kevin = await makeKevin([toy]);
    mkdirSync(join(config.dataDir, 'documents'), { recursive: true });
    const good = Array.from({ length: BACKUPS_KEPT }, (_, i) => `2026-03-0${i + 1}`);
    for (const day of good) await writeBackup(kevin, day);
    expect(days()).toEqual(good);
    const realTar = backupTools.tar;
    backupTools.tar = 'false'; // the archiver fails every night from here on
    try {
      for (const day of ['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']) {
        await expect(writeBackup(kevin, day)).rejects.toThrow();
      }
    } finally {
      backupTools.tar = realTar;
    }
    // Every good snapshot is still there; no folder, complete or partial, exists for a failed night.
    expect(days()).toEqual(good);
    // The job reports the failure in the ledger.
    const runner = new JobRunner(kevin);
    backupTools.tar = 'false';
    try {
      expect(await runner.runSystemNow('backup')).toMatchObject({ outcome: 'errored' });
    } finally {
      backupTools.tar = realTar;
    }
    expect(days()).toEqual(good);
    // A good night then rotates the oldest out, and clears a partial folder left by a killed run.
    mkdirSync(join(root(), '2026-03-20.partial'));
    await writeBackup(kevin, '2026-03-21');
    expect(days()).toEqual([...good.slice(1), '2026-03-21']);
  });

  it('refuses to call a database copy a snapshot when it does not pass the integrity check', async () => {
    const kevin = await makeKevin([toy]);
    const real = kevin.db.backup.bind(kevin.db);
    // The copy arrives damaged.
    (kevin.db as any).backup = async (dest: string) => {
      const r = await real(dest);
      const bytes = readFileSync(dest);
      // One page in the middle is overwritten: the file still opens as a database, and only a check of its contents notices.
      bytes.fill(0x5a, 8192, 12288);
      writeFileSync(dest, bytes);
      return r;
    };
    await expect(writeBackup(kevin, '2026-04-01')).rejects.toThrow(/integrity check/);
    expect(days()).toEqual([]);
  });
});

describe('uploads and their text', () => {
  // A one-page PDF that says "Kite inventory: 52 ripstop panels".
  const PDF = Buffer.from(
    'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2NCA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcwMCBUZCAoS2l0ZSBpbnZlbnRvcnk6IDUyIHJpcHN0b3AgcGFuZWxzKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM1NSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQyNQolJUVPRgo=',
    'base64',
  );

  it('reads a PDF\'s text in the extraction sandbox, never by running the parser in the server', async () => {
    const kevin = await makeKevin();
    const a = saveUpload(kevin.db, PDF, 'inventory.pdf');
    expect(a.kind).toBe('pdf');
    // Short text makes the model the second reader (a scan would have none): queue its answer.
    model.reply({ content: [text('Kite inventory: 52 ripstop panels (read by the model)')] });
    const launcher = config.extractLauncher;
    // With the sandbox unreachable there is no local fallback: pdftotext is not run at all.
    config.extractLauncher = ['unix:/nonexistent/extract.sock'];
    try {
      const failed = await extract(kevin.db, a.id);
      expect(logged('pdftotext failed for attachment')).toBe(true);
      expect(failed.extracted_text).toBe('Kite inventory: 52 ripstop panels (read by the model)');
    } finally {
      config.extractLauncher = launcher;
    }
    // Through the sandbox, the parser's own output is what is stored (padded so the model is not asked).
    const long = saveUpload(kevin.db, PDF, 'inventory-again.pdf');
    model.reply({ content: [text('from the model')] });
    const done = await extract(kevin.db, long.id);
    expect(done.extract_status).toBe('done');
    // This small page has under 200 characters, so the model is asked too; either way the sandbox ran and found the text.
    const requests = model.requests.length;
    expect(requests).toBe(2);
    const spy = join(config.dataDir, 'extract-spy.sh');
    const seen = join(config.dataDir, 'extract-seen.log');
    writeFileSync(spy, `#!/bin/bash\ntee ${JSON.stringify(seen)} | ${launcher.join(' ')}\n`, { mode: 0o755 });
    config.extractLauncher = [spy];
    try {
      model.reply({ content: [text('from the model')] });
      await extract(kevin.db, long.id);
    } finally {
      config.extractLauncher = launcher;
    }
    const sent = readFileSync(seen);
    expect(sent.includes(Buffer.from('exec pdftotext -layout -l 60 - -'))).toBe(true);
    expect(sent.includes(PDF)).toBe(true); // the bytes travel on standard input; no path into Ben's data is passed
    expect(sent.includes(Buffer.from(config.dataDir))).toBe(false);
  });

  it('says so in the stored text when a long file was cut', async () => {
    const kevin = await makeKevin();
    const body = 'kite,spar,sail\n'.repeat(20_000); // 300,000 characters
    const a = await extract(kevin.db, saveUpload(kevin.db, Buffer.from(body), 'kites.csv').id);
    expect(a.extracted_text!.length).toBeGreaterThan(MAX_EXTRACT_CHARS);
    expect(a.extracted_text).toMatch(/\[cut here: this is the first 200000 of 300000 characters of the file\]$/);
    const short = await extract(kevin.db, saveUpload(kevin.db, Buffer.from('kite,spar\n'), 'short.csv').id);
    expect(short.extracted_text).toBe('kite,spar\n');
  });

  it('leaves no row behind when the file cannot be written', async () => {
    const kevin = await makeKevin();
    const before = (kevin.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as any).n;
    const real = config.dataDir;
    // A data folder that cannot hold files: its path runs through an ordinary file.
    writeFileSync(join(real, 'not-a-folder'), 'x');
    config.dataDir = join(real, 'not-a-folder');
    try {
      expect(() => saveUpload(kevin.db, Buffer.from('x'), 'a.txt')).toThrow();
    } finally {
      config.dataDir = real;
    }
    expect((kevin.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as any).n).toBe(before);
  });

  it('money_import reads the whole file or fails; it never imports from the cut text', async () => {
    const kevin = await makeKevin([money]);
    const rows = Array.from({ length: 8000 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')},KITE SHOP ${i},-${(i % 90) + 1}.00`);
    const csv = `Date,Description,Amount\n${rows.join('\n')}\n`;
    expect(csv.length).toBeGreaterThan(MAX_EXTRACT_CHARS);
    const a = await extract(kevin.db, saveUpload(kevin.db, Buffer.from(csv), 'big.csv').id);
    const args = { attachment_id: a.id, account: 'Kite fund', create_account: { type: 'checking' } };
    const preview = await ok(kevin, 'money_import', { ...args, commit: false });
    expect(JSON.stringify(preview)).toContain('8000');
    // The file is gone from disk: the import stops with an error and adds nothing.
    rmSync(join(config.dataDir, a.path));
    const r = await call(kevin, 'money_import', { ...args, commit: true });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/could not be read from disk, so nothing was imported/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 0 });
  });
});

describe('regular expressions in money rules', () => {
  it('accepts the shipped rules and ordinary merchant patterns', () => {
    for (const [pattern, type] of SEED_RULES) if (type === 'regex') expect(() => assertSafeRegex(pattern), pattern).not.toThrow();
    for (const p of ['\\bhulu\\b', 'uber(?:eats)?\\b', 'netflix|hulu|disney\\+', 'sq \\*[a-z ]+ coffee', '\\d{4}$', 'payment.*thank you', 'costco(?: whse| gas)? #\\d+', 'whole ?foods|wholefds', '(?:tst|sq)\\* ?corner (cafe|deli)', '{literal}']) {
      expect(() => assertSafeRegex(p), p).not.toThrow();
    }
  });

  it('refuses the shapes that make matching time explode', () => {
    for (const p of ['(a+)+b', '(a|aa)+$', '(a*)*b', '(.*a){12}', '((a+)b)+', '(?:a+)+b', '(?<n>a+)+', 'a*a*b', '.*.*x', 'a?a?a?a?a?a+b', '(a)\\1', '(?=a)b', '(?<!a)b', '(a|b|c)+d', '([a-z]+)*x', 'x{1,50}y{1,50}', '(a|b)?(a|b)?c', 'k'.repeat(201)]) {
      expect(() => assertSafeRegex(p), p).toThrow(/cannot be used as a rule/);
    }
  });

  it('keeps the server responsive: the worst pattern it accepts finishes in milliseconds on the worst text', () => {
    const texts = ['a'.repeat(5000) + '!', 'ab'.repeat(2500), 'a '.repeat(2500)];
    for (const p of ['a*b', '.*x', 'a+$', 'a?a?a?a?a*b', 'a?a?a?a?[a-z ]+ coffee', 'a{1,50}b', '(?:a|aa|aaa|a)?a?a?a?a+b', '(a?a?a?a?a+)b']) {
      const rule = compileRule({ id: 1, pattern: p, match_type: 'regex', category: null, merchant: null, priority: 0 });
      const started = performance.now();
      for (const t of texts) rule.test(t);
      expect(performance.now() - started, p).toBeLessThan(SLOW_RULE_MS * 3);
    }
  });

  it('refuses such a rule from the model, and skips one already stored', async () => {
    const kevin = await makeKevin([money]);
    const r = await call(kevin, 'money_transactions_update', { rules: [{ pattern: '(a+)+b', match: 'regex', category: 'groceries' }] });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/cannot be used as a rule: it repeats a group/);
    expect(kevin.db.prepare("SELECT COUNT(*) AS n FROM money_rules WHERE pattern = '(a+)+b'").get()).toEqual({ n: 0 });
    // One stored before the check existed: importing does not run it.
    kevin.db.prepare("INSERT INTO money_rules (pattern, match_type, category, priority, created_at) SELECT '(a+)+b', 'regex', name, 100, ? FROM money_categories LIMIT 1").run(new Date().toISOString());
    const a = saveUpload(kevin.db, Buffer.from(`Date,Description,Amount\n2026-01-05,${'a'.repeat(40)}!,-5.00\n`), 'evil.csv');
    const started = Date.now();
    await ok(kevin, 'money_import', { attachment_id: a.id, account: 'Kite fund', create_account: { type: 'checking' }, commit: true });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(logged('is skipped')).toBe(true);
  });
});
