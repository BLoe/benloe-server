import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bus, type BusEvent } from '../src/bus.js';
import { config } from '../src/config.js';
import { defineDomain } from '../src/domains.js';
import { costOf } from '../src/llm.js';
import { ftsQuery, indexItem, keywordSearch } from '../src/memory.js';
import { nextCron, nextRun, parseCron, localDay } from '../src/time.js';
import { defineTool } from '../src/tools.js';
import { sandboxRel } from '../src/core/index.js';
import { call, makeKevin, ok, view } from './helpers.js';

const toy = defineDomain({
  name: 'toy',
  migrations: [{ id: 'toy-001', sql: 'CREATE TABLE toys (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1);' }],
  tools: [
    defineTool({
      name: 'toy_add',
      description: 'Add a toy.',
      input: z.object({ name: z.string().min(1), qty: z.number().int().min(1).default(1) }),
      touches: ['toy'],
      run: ({ name, qty }, ctx) => ({ id: Number(ctx.db.prepare('INSERT INTO toys (name, qty) VALUES (?, ?)').run(name, qty).lastInsertRowid) }),
    }),
  ],
  views: { list: (_p, db) => db.prepare('SELECT * FROM toys ORDER BY id').all() },
  promptNote: 'Toys are for tests.',
});

describe('time', () => {
  const tz = 'America/New_York';
  it('finds the next cron slot in Ben\'s timezone, across DST', () => {
    // Sundays 6pm Eastern. 2026-11-01 is the fall-back day; 18:00 EST = 23:00Z.
    expect(nextCron('0 18 * * 0', new Date('2026-10-31T12:00:00Z'), tz)!.toISOString()).toBe('2026-11-01T23:00:00.000Z');
    // In summer 18:00 EDT = 22:00Z.
    expect(nextCron('0 18 * * 0', new Date('2026-07-01T00:00:00Z'), tz)!.toISOString()).toBe('2026-07-05T22:00:00.000Z');
    expect(nextCron('*/15 9-10 * * 1-5', new Date('2026-11-13T14:16:00Z'), tz)!.toISOString()).toBe('2026-11-13T14:30:00.000Z');
    expect(nextCron('0 0 31 2 *', new Date('2026-01-01T00:00:00Z'), tz)).toBeNull();
  });
  const next = (expr: string, after: string, zone = tz) => nextCron(expr, new Date(after), zone)?.toISOString() ?? null;
  it('fires a wall-clock time once when the clocks go back and the hour happens twice', () => {
    // 2026-11-01 in New York: 01:00-01:59 happens in daylight time (05:xxZ) and again in standard time (06:xxZ).
    expect(next('30 1 * * *', '2026-10-31T12:00:00Z')).toBe('2026-11-01T05:30:00.000Z'); // the first 01:30
    expect(next('30 1 * * *', '2026-11-01T05:30:00Z')).toBe('2026-11-02T06:30:00.000Z'); // not the second 01:30 an hour later
    expect(next('30 1 * * *', '2026-11-01T06:10:00Z')).toBe('2026-11-02T06:30:00.000Z'); // asked from inside the repeated hour
    expect(next('50 1 * * *', '2026-11-01T05:45:00Z')).toBe('2026-11-01T05:50:00.000Z');
    expect(next('0,30 1 * * *', '2026-11-01T05:00:00Z')).toBe('2026-11-01T05:30:00.000Z');
    expect(next('0,30 1 * * *', '2026-11-01T05:30:00Z')).toBe('2026-11-02T06:00:00.000Z');
    expect(next('0 2 * * *', '2026-11-01T05:30:00Z')).toBe('2026-11-01T07:00:00.000Z'); // 02:00 EST, after both 01:xx hours
    // An every-hour expression is an interval: it fires in each real hour, including both 01:00s.
    expect(next('0 * * * *', '2026-11-01T04:00:00Z')).toBe('2026-11-01T05:00:00.000Z');
    expect(next('0 * * * *', '2026-11-01T05:00:00Z')).toBe('2026-11-01T06:00:00.000Z');
    expect(next('0 * * * *', '2026-11-01T06:00:00Z')).toBe('2026-11-01T07:00:00.000Z');
  });
  it('fires a wall-clock time once, just after the gap, when the clocks go forward over it', () => {
    // 2027-03-14 in New York: 02:00-02:59 does not happen; 01:59 EST (06:59Z) is followed by 03:00 EDT (07:00Z).
    expect(next('30 2 * * *', '2027-03-13T12:00:00Z')).toBe('2027-03-14T07:00:00.000Z');
    expect(next('30 2 * * *', '2027-03-14T07:00:00Z')).toBe('2027-03-15T06:30:00.000Z'); // once, then the normal 02:30 EDT
    // Four matches inside the gap are one firing.
    expect(next('*/15 2 * * *', '2027-03-14T06:00:00Z')).toBe('2027-03-14T07:00:00.000Z');
    expect(next('*/15 2 * * *', '2027-03-14T07:00:00Z')).toBe('2027-03-15T06:00:00.000Z');
    // A time in the gap and the real 03:30 the same day are two firings, in order.
    expect(next('30 2,3 * * *', '2027-03-14T06:00:00Z')).toBe('2027-03-14T07:00:00.000Z');
    expect(next('30 2,3 * * *', '2027-03-14T07:00:00Z')).toBe('2027-03-14T07:30:00.000Z');
    expect(next('30 1 * * *', '2027-03-14T00:00:00Z')).toBe('2027-03-14T06:30:00.000Z'); // the hour before is untouched
    expect(next('0 * * * *', '2027-03-14T06:00:00Z')).toBe('2027-03-14T07:00:00.000Z');
  });
  it('is unaffected on those dates in a zone that does not change its clocks', () => {
    // Phoenix is UTC-7 all year.
    expect(next('30 1 * * *', '2026-10-31T12:00:00Z', 'America/Phoenix')).toBe('2026-11-01T08:30:00.000Z');
    expect(next('30 1 * * *', '2026-11-01T08:30:00Z', 'America/Phoenix')).toBe('2026-11-02T08:30:00.000Z');
    expect(next('30 2 * * *', '2027-03-13T12:00:00Z', 'America/Phoenix')).toBe('2027-03-14T09:30:00.000Z');
    expect(next('30 2 * * *', '2027-03-14T09:30:00Z', 'America/Phoenix')).toBe('2027-03-15T09:30:00.000Z');
    expect(next('30 2 * * *', '2027-03-13T12:00:00Z', 'UTC')).toBe('2027-03-14T02:30:00.000Z');
  });
  it('never fires a schedule twice for one wall-clock time, and never skips a day, through a whole year', () => {
    for (const zone of [tz, 'America/Phoenix', 'Europe/London', 'Australia/Lord_Howe']) {
      for (const expr of ['30 1 * * *', '30 2 * * *', '0 0 * * *', '59 23 * * *']) {
        let at = new Date('2026-06-01T00:00:00Z');
        const fired: number[] = [];
        for (let i = 0; i < 365; i++) {
          at = nextCron(expr, at, zone)!;
          fired.push(at.getTime());
        }
        const gaps = fired.slice(1).map((t, i) => (t - fired[i]!) / 3600_000);
        // One firing per calendar day: always within an hour and a half of 24 hours apart (the gap rule can move one by up to an hour).
        expect(Math.min(...gaps), `${expr} ${zone}`).toBeGreaterThanOrEqual(22.5);
        expect(Math.max(...gaps), `${expr} ${zone}`).toBeLessThanOrEqual(25.5);
        expect(new Set(fired.map((t) => localDay(new Date(t), zone))).size, `${expr} ${zone}`).toBe(365);
      }
    }
  });
  it('treats day-of-month and day-of-week as either/or when both are set', () => {
    // The 1st, or any Monday. 2026-11-02 is a Monday.
    expect(nextCron('0 9 1 * 1', new Date('2026-11-01T15:00:00Z'), tz)!.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });
  it('rejects malformed cron', () => {
    for (const bad of ['* * * *', '61 * * * *', 'a b c d e', '5-1 * * * *']) expect(() => parseCron(bad)).toThrow();
  });
  it('handles the three trigger types', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(nextRun('once', '2026-11-15T18:00:00-05:00', now, null)!.toISOString()).toBe('2026-11-15T23:00:00.000Z');
    expect(nextRun('once', '2026-11-15T18:00:00-05:00', now, now)).toBeNull();
    expect(nextRun('interval', '90', now, now)!.toISOString()).toBe('2026-11-14T13:30:00.000Z');
    expect(() => nextRun('interval', '0', now, null)).toThrow();
    expect(() => nextRun('once', 'tomorrow', now, null)).toThrow();
    expect(localDay(new Date('2026-11-15T03:30:00Z'), tz)).toBe('2026-11-14');
  });
});

describe('pricing', () => {
  it('prices each token class and web searches', () => {
    const n = { input: 1e6, output: 1e6, cacheRead: 1e6, write5m: 1e6, write1h: 1e6, webSearches: 100 };
    expect(costOf('claude-sonnet-5-5', n)).toBeCloseTo(2 + 10 + 0.1 + 2.5 + 4 + 1, 6);
    expect(costOf('claude-opus-5-5', { ...n, webSearches: 0 })).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 6);
    // Haiku's long-prompt rate card starts above 100K prompt tokens.
    expect(costOf('claude-haiku-5-5', { input: 50_000, output: 1000, cacheRead: 0, write5m: 0, write1h: 0, webSearches: 0 })).toBeCloseTo(0.005 + 0.0005, 6);
    expect(costOf('claude-haiku-5-5', { input: 200_000, output: 0, cacheRead: 0, write5m: 0, write1h: 0, webSearches: 0 })).toBeCloseTo(0.1, 6);
    // An unknown model is priced high, never free.
    expect(costOf('mystery', { ...n, webSearches: 0 })).toBe(costOf('claude-opus-5-5', { ...n, webSearches: 0 }));
  });
});

describe('tools', () => {
  it('validates, runs, audits, logs and announces a write', async () => {
    const kevin = await makeKevin([toy]);
    const events: BusEvent[] = [];
    const off = bus.subscribe((e) => events.push(e));
    const bad = await call(kevin, 'toy_add', { qty: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/name/);
    expect(await ok(kevin, 'toy_add', { name: 'robot', qty: 2 })).toEqual({ id: 1 });
    off();
    expect(await view(kevin, 'toy/list')).toEqual([{ id: 1, name: 'robot', qty: 2 }]);
    expect(events).toContainEqual({ type: 'data_changed', domains: ['toy'] });
    const audit = kevin.db.prepare('SELECT tool, ok FROM tool_audit ORDER BY id').all();
    expect(audit).toEqual([{ tool: 'toy_add', ok: 0 }, { tool: 'toy_add', ok: 1 }]);
    expect((kevin.db.prepare("SELECT text FROM memory_log WHERE kind = 'event'").get() as { text: string }).text).toMatch(/^toy_add .*robot/);
  });
  it('tolerates a tool name in the wrong case and explains an unknown one', async () => {
    const kevin = await makeKevin([toy]);
    expect((await call(kevin, 'Toy_Add', { name: 'x' })).ok).toBe(true);
    expect((await call(kevin, 'toy_remove', {})).text).toMatch(/No tool named.*toy_add/);
  });
  it('keeps Ben-only tools from the agent and agent-only tools from the UI', async () => {
    const kevin = await makeKevin();
    expect((await call(kevin, 'settings_update', { monthly_cap_usd: 500 })).ok).toBe(false);
    expect((await call(kevin, 'settings_update', { monthly_cap_usd: 80 }, { source: 'ui' })).ok).toBe(true);
    expect((await view(kevin, 'system/spend')).capUsd).toBe(80);
    expect((await call(kevin, 'shell', { command: 'echo hi' }, { source: 'ui' })).ok).toBe(false);
    expect(kevin.tools.apiTools().map((t) => t.name)).not.toContain('settings_update');
  });
  it('sends the model a sorted tool list with JSON schemas', async () => {
    const kevin = await makeKevin([toy]);
    const tools = kevin.tools.apiTools();
    expect(tools.map((t) => t.name)).toEqual([...tools.map((t) => t.name)].sort());
    const add = tools.find((t) => t.name === 'toy_add')!;
    expect(add.input_schema).toMatchObject({ type: 'object', required: ['name'] });
  });
});

describe('query', () => {
  it('reads, and refuses anything that writes', async () => {
    const kevin = await makeKevin([toy]);
    await ok(kevin, 'toy_add', { name: 'kite' });
    expect((await ok(kevin, 'query', { sql: 'SELECT name FROM toys' })).rows).toEqual([{ name: 'kite' }]);
    for (const sql of ['DELETE FROM toys', "INSERT INTO toys (name) VALUES ('x')", 'DROP TABLE toys', "UPDATE toys SET name = 'x'", 'PRAGMA journal_mode = DELETE', 'SELECT 1; DELETE FROM toys']) {
      expect((await call(kevin, 'query', { sql })).ok, sql).toBe(false);
    }
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM toys').get()).toEqual({ n: 1 });
  });
});

describe('memory', () => {
  it('builds a safe FTS query from free text', () => {
    expect(ftsQuery('What did the club say about my kitestring?')).toBe('"club" OR "say" OR "kitestring"');
    expect(ftsQuery('the and of')).toBe('');
    expect(ftsQuery('"); DROP TABLE x; --')).toBe('"drop" OR "table"');
  });
  it('remembers facts into the prompt and recalls indexed text', async () => {
    const kevin = await makeKevin();
    // Invented fixtures: a kite collector's notes. Nothing here describes a real person.
    const f = await ok(kevin, 'remember', { text: 'The test owner flies box kites on windy days.', category: 'Hobbies' });
    expect(f.category).toBe('hobbies');
    expect((await view(kevin, 'system/facts'))[0].text).toMatch(/box kites/);
    await ok(kevin, 'fact_update', { id: f.id, text: 'The test owner flies box kites and delta kites.' });
    await ok(kevin, 'note', { text: 'Decided to move the kite workshop to the blue shed in Marchember.' });
    indexItem(kevin.db, 'document', 7, 'Kite inventory 2026', 'Spool of zephyrline 131 metres, 52 ripstop panels');
    const hits = (await ok(kevin, 'recall', { query: 'zephyrline length' })).hits;
    expect(hits[0]).toMatchObject({ kind: 'document', ref: '7' });
    expect(keywordSearch(kevin.db, 'workshop')[0]!.kind).toBe('log-note');
    await ok(kevin, 'fact_update', { id: f.id, delete: true });
    expect(await view(kevin, 'system/facts')).toEqual([]);
  });
});

describe('sandbox files', () => {
  const fs = () => import('node:fs');
  const at = (...p: string[]) => join(config.shellDir, ...p);

  it('turns a path from the model into one relative to the sandbox, as text only', () => {
    expect(() => sandboxRel('../etc/passwd')).toThrow(/outside/);
    expect(() => sandboxRel('a/../../x')).toThrow(/outside/);
    expect(() => sandboxRel('a\0b')).toThrow();
    expect(sandboxRel('/notes/a.txt')).toBe('notes/a.txt');
    expect(sandboxRel('/etc/passwd/../../etc/shadow')).toBe('etc/shadow'); // leading slashes mean the sandbox folder
    expect(sandboxRel('')).toBe('.');
  });

  it('refuses a path that leaves the sandbox through a symlink: the file itself, a parent folder, or a dangling link', async () => {
    const kevin = await makeKevin();
    const { symlinkSync, writeFileSync, mkdirSync, readdirSync } = await fs();
    const secret = join(config.dataDir, 'secret.txt');
    writeFileSync(secret, 'tax return');
    mkdirSync(at('links', 'deep'), { recursive: true });
    symlinkSync(secret, at('links', 'file'));
    symlinkSync(config.dataDir, at('links', 'dir'));
    symlinkSync(config.dataDir, at('links', 'deep', 'dir'));
    symlinkSync('/nonexistent/x', at('links', 'dangling'));
    for (const path of ['links/file', 'links/dir/secret.txt', 'links/deep/dir/secret.txt', 'links/dangling', 'links/dir/../dir/secret.txt']) {
      expect((await call(kevin, 'file_read', { path })).text, path).toMatch(/outside the sandbox/);
      expect((await call(kevin, 'file_write', { path, content: 'x' })).text, path).toMatch(/outside the sandbox/);
    }
    expect((await call(kevin, 'file_write', { path: 'links/dir/new.txt', content: 'x' })).ok).toBe(false);
    expect((await call(kevin, 'file_write', { path: 'links/dir/sub/new.txt', content: 'x' })).ok).toBe(false);
    expect((await call(kevin, 'file_list', { path: 'links/dir' })).text).toMatch(/outside the sandbox/);
    expect(readFileSync(secret, 'utf8')).toBe('tax return');
    expect(readdirSync(config.dataDir)).not.toContain('new.txt');
    expect(existsSync(join(config.dataDir, 'sub'))).toBe(false);
    // The listing names a link as a link and does not follow it.
    const listed = (await ok(kevin, 'file_list', { path: 'links' })).entries;
    expect(listed.find((e: any) => e.name === 'dir')).toMatchObject({ symlink: true, dir: false });
    // A link that stays inside the sandbox is the shell's own business and works.
    writeFileSync(at('links', 'real.txt'), 'inside');
    symlinkSync(at('links', 'real.txt'), at('links', 'alias'));
    expect(await ok(kevin, 'file_read', { path: 'links/alias' })).toBe('inside');
  });

  it('does every file operation through the launcher, never in the server process', async () => {
    const kevin = await makeKevin();
    const { writeFileSync, mkdirSync } = await fs();
    mkdirSync(at('direct'), { recursive: true });
    writeFileSync(at('direct', 'there.txt'), 'already here');
    const launcher = config.shellLauncher;
    // A launcher that runs nothing: if the server touched the sandbox itself, these would still succeed.
    config.shellLauncher = ['false'];
    try {
      expect((await call(kevin, 'file_read', { path: 'direct/there.txt' })).ok).toBe(false);
      expect((await call(kevin, 'file_list', { path: 'direct' })).ok).toBe(false);
      expect((await call(kevin, 'file_write', { path: 'direct/new.txt', content: 'x' })).ok).toBe(false);
      expect((await call(kevin, 'file_write', { path: 'newdir/new.txt', content: 'x' })).ok).toBe(false);
    } finally {
      config.shellLauncher = launcher;
    }
    expect(existsSync(at('direct', 'new.txt'))).toBe(false);
    expect(existsSync(at('newdir'))).toBe(false);
  });

  it('passes the path and the content as data: nothing the model writes is run or expanded by a shell', async () => {
    const kevin = await makeKevin();
    const { writeFileSync, mkdirSync, chmodSync } = await fs();
    // Records every request sent to the sandbox, then passes it on to the real runner.
    const log = join(config.dataDir, `requests-${Date.now()}.log`);
    const spy = join(config.dataDir, 'spy-launcher.sh');
    const launcher = config.shellLauncher;
    writeFileSync(spy, `#!/bin/bash\ntee -a ${JSON.stringify(log)} | ${launcher.join(' ')}\n`);
    chmodSync(spy, 0o755);
    config.shellLauncher = [spy];
    const name = 'it\'s $(touch pwned-by-path) `touch pwned-by-tick`; touch pwned-by-semi & "q".txt';
    const content = '$(touch pwned-by-content)\n`touch pwned-by-content`\n\0binary\ttab\n';
    mkdirSync(at('data'), { recursive: true });
    try {
      await ok(kevin, 'file_write', { path: `data/${name}`, content });
      expect(await ok(kevin, 'file_read', { path: `data/${name}` })).toBe(content);
      expect((await ok(kevin, 'file_list', { path: 'data' })).entries).toEqual([{ name, dir: false, size: Buffer.byteLength(content) }]);
    } finally {
      config.shellLauncher = launcher;
    }
    expect(readFileSync(at('data', name), 'utf8')).toBe(content);
    for (const dir of [config.shellDir, at('data'), process.cwd()]) {
      for (const f of ['pwned-by-path', 'pwned-by-tick', 'pwned-by-semi', 'pwned-by-content']) expect(existsSync(join(dir, f)), `${dir}/${f}`).toBe(false);
    }
    // Each request is: the script bash runs, then the bytes for its standard input. The script is the
    // same fixed text every time and holds neither the path nor the content; those are in the input.
    const raw = readFileSync(log);
    const scripts: string[] = [];
    const inputs: Buffer[] = [];
    for (let at = 0; at < raw.length; ) {
      expect(raw.subarray(at, at + 4).toString('latin1')).toBe('KSB1');
      const scriptLen = raw.readUInt32BE(at + 8);
      scripts.push(raw.subarray(at + 12, at + 12 + scriptLen).toString('utf8'));
      const inputLen = Number(raw.readBigUInt64BE(at + 12 + scriptLen));
      inputs.push(raw.subarray(at + 20 + scriptLen, at + 20 + scriptLen + inputLen));
      at += 20 + scriptLen + inputLen;
    }
    expect(scripts.length).toBe(3);
    expect(new Set(scripts).size).toBe(1);
    expect(scripts[0]).not.toContain('pwned');
    expect(scripts[0]).not.toContain('binary');
    expect(inputs[0]!.includes(Buffer.from(`write\0${config.shellDir}\0data/${name}\0create\0${content}`))).toBe(true);
  });

  it('writes, lists, reads, and asks before overwriting or deleting', async () => {
    const kevin = await makeKevin();
    await ok(kevin, 'file_write', { path: 'calc/in.csv', content: 'a,b\n1,2\n' });
    expect((await ok(kevin, 'file_list', { path: 'calc' })).entries[0]).toMatchObject({ name: 'in.csv', size: 8 });
    expect(await ok(kevin, 'file_list', { path: 'nowhere' })).toEqual({ entries: [] });
    expect(await ok(kevin, 'file_read', { path: 'calc/in.csv' })).toBe('a,b\n1,2\n');
    expect((await call(kevin, 'file_read', { path: 'calc/none.csv' })).text).toMatch(/No file at/);
    expect((await call(kevin, 'file_read', { path: 'calc' })).text).toMatch(/not a file/);
    expect((await call(kevin, 'file_write', { path: 'calc', content: 'x' })).text).toMatch(/is a folder/);
    // An existing file is replaced only with Ben's yes; a no leaves every byte of it.
    expect((await call(kevin, 'file_write', { path: 'calc/in.csv', content: 'x' }, { confirm: false })).text).toMatch(/declined/);
    expect(readFileSync(at('calc', 'in.csv'), 'utf8')).toBe('a,b\n1,2\n');
    await ok(kevin, 'file_write', { path: 'calc/in.csv', content: 'c\n3\n' });
    expect(readFileSync(at('calc', 'in.csv'), 'utf8')).toBe('c\n3\n');
    // What file_write made, the shell can read and change (in production both are the same uid).
    expect(await ok(kevin, 'shell', { command: 'echo 4 >> calc/in.csv && cat calc/in.csv' })).toMatch(/exit code: 0\nc\n3\n4/);
    expect(await ok(kevin, 'shell', { command: 'echo $((6*7))' })).toMatch(/exit code: 0\n42/);
    expect((await call(kevin, 'shell', { command: 'rm -rf calc' }, { confirm: false })).text).toMatch(/declined/);
    expect(await ok(kevin, 'file_read', { path: 'calc/in.csv' })).toBe('c\n3\n4\n');
    expect(await ok(kevin, 'file_read', { path: 'calc/in.csv', max_chars: 100 })).toBe('c\n3\n4\n');
    await ok(kevin, 'file_write', { path: 'calc/big.txt', content: 'é'.repeat(500) });
    expect(await ok(kevin, 'file_read', { path: 'calc/big.txt', max_chars: 100 })).toBe(`${'é'.repeat(100)}\n[cut: file is 1000 bytes]`);
  });

  it('reports a failing shell command with its exit code and output, and ends one that Ben stops', async () => {
    const kevin = await makeKevin();
    expect(await ok(kevin, 'shell', { command: 'echo out; echo err >&2; exit 3' })).toBe('exit code: 3\nout\n\n[stderr]\nerr');
    expect(await ok(kevin, 'shell', { command: 'pwd -P' })).toBe(`exit code: 0\n${realpathSync(config.shellDir)}`);
    expect(await ok(kevin, 'shell', { command: 'kill -KILL $$' })).toMatch(/^exit code: 137/);
  });

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const pidsIn = (file: string) => readFileSync(at(file), 'utf8').trim().split(/\s+/).map(Number);
  const gone = async (pids: number[]) => {
    for (let i = 0; i < 100 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 20));
    return pids.filter(alive);
  };

  it('kills the command and its children when Ben presses Stop', async () => {
    const kevin = await makeKevin();
    const abort = new AbortController();
    const running = kevin.tools.call('shell', { command: 'sleep 300 & echo $! $$ > stop.pids; sleep 300' }, { db: kevin.db, source: 'agent', confirm: () => Promise.resolve(true), signal: abort.signal });
    for (let i = 0; i < 100 && !existsSync(at('stop.pids')); i++) await new Promise((r) => setTimeout(r, 20));
    const pids = pidsIn('stop.pids');
    expect(pids.every(alive)).toBe(true);
    abort.abort();
    const r = await running;
    expect(r.text).toMatch(/^exit code: none\n\(no output\)\n\[stopped by Ben/);
    expect(await gone(pids)).toEqual([]);
  });

  it('enforces the time limit on a command that ignores every signal it can', async () => {
    const kevin = await makeKevin();
    config.shellSeconds = 1;
    try {
      const started = Date.now();
      const r = await ok<string>(kevin, 'shell', { command: "trap '' TERM INT HUP QUIT; echo $$ > limit.pids; while :; do sleep 0.1; done" });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(r).toMatch(/^exit code: none\n\(no output\)\n\[stopped: ran longer than 1 seconds/);
      expect(await gone(pidsIn('limit.pids'))).toEqual([]);
    } finally {
      config.shellSeconds = 115;
    }
  });

  it('returns when the command is done even though something it started still holds its output open', async () => {
    const kevin = await makeKevin();
    const started = Date.now();
    // A background child in the same session: it is killed when the command ends.
    expect(await ok(kevin, 'shell', { command: 'sleep 300 & echo $! > bg.pids; echo done' })).toBe('exit code: 0\ndone');
    expect(await gone(pidsIn('bg.pids'))).toEqual([]);
    // One that left the session keeps the pipe open and is out of the runner's reach (in production the
    // systemd unit ends it). The call still returns.
    expect(await ok(kevin, 'shell', { command: 'setsid sleep 300 & echo $! > escaped.pids; echo done' })).toBe('exit code: 0\ndone');
    expect(Date.now() - started).toBeLessThan(5000);
    for (const pid of pidsIn('escaped.pids')) if (alive(pid)) process.kill(pid, 'SIGKILL');
  });

  it('stops a command that floods its output, and says when the sandbox cannot be reached', async () => {
    const kevin = await makeKevin();
    const flood = await ok<string>(kevin, 'shell', { command: 'echo $$ > flood.pids; yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(flood).toMatch(/^exit code: none\naaaa/);
    expect(flood).toMatch(/\[output cut: it was \d+ characters\]/);
    expect(flood).toMatch(/\[stopped: wrote more than 2 MB of output\]$/);
    expect(await gone(pidsIn('flood.pids'))).toEqual([]);
    const launcher = config.shellLauncher;
    config.shellLauncher = ['unix:/nonexistent/kevin-sandbox.sock'];
    try {
      const r = await call(kevin, 'shell', { command: 'echo hi' });
      expect(r.ok).toBe(false);
      expect(r.text).toMatch(/could not be run: the sandbox is not available/);
    } finally {
      config.shellLauncher = launcher;
    }
  });
});
