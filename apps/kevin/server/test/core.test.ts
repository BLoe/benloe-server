import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bus, type BusEvent } from '../src/bus.js';
import { defineDomain } from '../src/domains.js';
import { costOf } from '../src/llm.js';
import { ftsQuery, indexItem, keywordSearch } from '../src/memory.js';
import { nextCron, nextRun, parseCron, localDay } from '../src/time.js';
import { defineTool } from '../src/tools.js';
import { sandboxPath } from '../src/core/index.js';
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
    expect(ftsQuery('What did the doctor say about my cholesterol?')).toBe('"doctor" OR "say" OR "cholesterol"');
    expect(ftsQuery('the and of')).toBe('');
    expect(ftsQuery('"); DROP TABLE x; --')).toBe('"drop" OR "table"');
  });
  it('remembers facts into the prompt and recalls indexed text', async () => {
    const kevin = await makeKevin();
    const f = await ok(kevin, 'remember', { text: 'Ben is allergic to shellfish.', category: 'Food' });
    expect(f.category).toBe('food');
    expect((await view(kevin, 'system/facts'))[0].text).toMatch(/shellfish/);
    await ok(kevin, 'fact_update', { id: f.id, text: 'Ben is allergic to shellfish and peanuts.' });
    await ok(kevin, 'note', { text: 'Ben decided to switch dentists to Dr. Alvarez in March.' });
    indexItem(kevin.db, 'document', 7, 'Lab results 2026', 'LDL cholesterol 131 mg/dL, HDL 52');
    const hits = (await ok(kevin, 'recall', { query: 'cholesterol numbers' })).hits;
    expect(hits[0]).toMatchObject({ kind: 'document', ref: '7' });
    expect(keywordSearch(kevin.db, 'dentist')[0]!.kind).toBe('log-note');
    await ok(kevin, 'fact_update', { id: f.id, delete: true });
    expect(await view(kevin, 'system/facts')).toEqual([]);
  });
});

describe('sandbox files', () => {
  it('confines paths to the sandbox folder', () => {
    expect(() => sandboxPath('../etc/passwd')).toThrow();
    expect(() => sandboxPath('a/../../x')).toThrow();
    expect(sandboxPath('/notes/a.txt')).toMatch(/sandbox\/notes\/a\.txt$/);
    expect(() => sandboxPath('/etc/passwd/../../etc/shadow')).not.toThrow(); // stays inside: leading slashes are relative to the sandbox
  });
  it('refuses symlinks the shell could plant, whether they point at a file or a folder', async () => {
    const kevin = await makeKevin();
    const { symlinkSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { config } = await import('../src/config.js');
    const secret = join(config.dataDir, 'secret.txt');
    writeFileSync(secret, 'tax return');
    mkdirSync(join(config.shellDir, 'links'), { recursive: true });
    symlinkSync(secret, join(config.shellDir, 'links', 'file'));
    symlinkSync(config.dataDir, join(config.shellDir, 'links', 'dir'));
    symlinkSync('/nonexistent/x', join(config.shellDir, 'links', 'dangling'));
    for (const path of ['links/file', 'links/dir/secret.txt', 'links/dangling']) {
      expect((await call(kevin, 'file_read', { path })).ok, path).toBe(false);
      expect((await call(kevin, 'file_write', { path, content: 'x' })).ok, path).toBe(false);
    }
    expect((await call(kevin, 'file_write', { path: 'links/dir/new.txt', content: 'x' })).ok).toBe(false);
    const { readFileSync, existsSync } = await import('node:fs');
    expect(readFileSync(secret, 'utf8')).toBe('tax return');
    expect(existsSync(join(config.dataDir, 'new.txt'))).toBe(false);
  });
  it('writes, lists, reads, and asks before overwriting or deleting', async () => {
    const kevin = await makeKevin();
    await ok(kevin, 'file_write', { path: 'calc/in.csv', content: 'a,b\n1,2\n' });
    expect((await ok(kevin, 'file_list', { path: 'calc' })).entries[0]).toMatchObject({ name: 'in.csv', size: 8 });
    expect(await ok(kevin, 'file_read', { path: 'calc/in.csv' })).toBe('a,b\n1,2\n');
    expect((await call(kevin, 'file_write', { path: 'calc/in.csv', content: 'x' }, { confirm: false })).text).toMatch(/declined/);
    expect(await ok(kevin, 'shell', { command: 'echo $((6*7))' })).toMatch(/exit code: 0\n42/);
    expect((await call(kevin, 'shell', { command: 'rm -rf calc' }, { confirm: false })).text).toMatch(/declined/);
    expect(await ok(kevin, 'file_read', { path: 'calc/in.csv' })).toBe('a,b\n1,2\n');
  });
});
