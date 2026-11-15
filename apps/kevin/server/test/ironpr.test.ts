import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import ironpr, { syncIronPr } from '../src/domains/ironpr.js';
import { call, makeKevin, ok, view } from './helpers.js';

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** A database with IRON PR's real schema (Prisma: camelCase columns, integer millisecond timestamps). */
function fixture(name: string): string {
  mkdirSync(config.dataDir, { recursive: true });
  const path = join(config.dataDir, name);
  const db = new Database(path);
  db.exec(`
    CREATE TABLE "exercises" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "userId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "workouts" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "exerciseId" TEXT NOT NULL, "weight" REAL NOT NULL, "reps" INTEGER NOT NULL, "oneRM" REAL NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "pr_history" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "exerciseId" TEXT NOT NULL, "weight" REAL NOT NULL, "previousWeight" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  const t = (d: string) => Date.parse(d);
  db.prepare('INSERT INTO exercises VALUES (?,?,?,?)').run('sq', 'Barbell Squat', 'u1', t('2025-09-03T22:00:00Z'));
  db.prepare('INSERT INTO exercises VALUES (?,?,?,?)').run('bp', 'Barbell Bench Press', 'u1', t('2025-09-03T22:00:00Z'));
  const w = db.prepare('INSERT INTO workouts VALUES (?,?,?,?,?,?,?)');
  w.run('w1', 'u1', 'sq', 185, 1, 185, t('2025-09-03T22:10:00Z'));
  w.run('w2', 'u1', 'sq', 205, 1, 205, t('2026-06-10T22:10:00Z'));
  // 03:30 UTC on Nov 4 is the evening of Nov 3 in New York.
  w.run('w3', 'u1', 'sq', 215, 1, 215, t('2026-11-04T03:30:00Z'));
  w.run('w4', 'u1', 'bp', 155, 3, 170.5, t('2026-11-01T22:00:00Z'));
  const p = db.prepare('INSERT INTO pr_history VALUES (?,?,?,?,?,?)');
  p.run('p1', 'u1', 'sq', 185, null, t('2025-09-03T22:10:00Z'));
  p.run('p2', 'u1', 'sq', 215, 205, Date.now() - 86_400_000);
  db.close();
  return path;
}

describe('IRON PR mirror', () => {
  it('copies the app\'s data without changing a byte of it', async () => {
    const path = fixture('ironpr-a.db');
    const before = { sha: sha(path), mtime: statSync(path).mtimeMs };
    const kevin = await makeKevin([ironpr]);
    expect(syncIronPr(kevin.db, path)).toEqual({ ok: true, changed: true, exercises: 2, entries: 4, prs: 2 });
    expect(syncIronPr(kevin.db, path)).toEqual({ ok: true, changed: false }); // nothing new: no work
    expect(sha(path)).toBe(before.sha);
    expect(statSync(path).mtimeMs).toBe(before.mtime);
    // No journal or lock files appeared beside it.
    expect(() => statSync(`${path}-journal`)).toThrow();
    expect(() => statSync(`${path}-wal`)).toThrow();

    const q = await ok(kevin, 'query', { sql: 'SELECT exercise, MAX(weight_lbs) AS best FROM ironpr_entries GROUP BY exercise ORDER BY exercise' });
    expect(q.rows).toEqual([{ exercise: 'Barbell Bench Press', best: 155 }, { exercise: 'Barbell Squat', best: 215 }]);
    expect((await ok(kevin, 'query', { sql: "SELECT date FROM ironpr_entries WHERE id = 'w3'" })).rows).toEqual([{ date: '2026-11-03' }]);
  });

  it('gives Kevin no way to write to it', async () => {
    const kevin = await makeKevin([ironpr]);
    expect(ironpr.tools ?? []).toEqual([]);
    expect(kevin.tools.list().filter((t) => /iron/i.test(t.name))).toEqual([]);
    expect(kevin.stableSystem).toMatch(/no way to write to it/);
    expect(kevin.stableSystem).toContain('CREATE TABLE ironpr_entries');
    // The mirror itself is only reachable through the read-only query tool.
    expect((await call(kevin, 'query', { sql: 'DELETE FROM ironpr_entries' })).ok).toBe(false);
  });

  it('picks up new lifts, and keeps the last good copy when the app\'s file is unreadable', async () => {
    const path = fixture('ironpr-b.db');
    const kevin = await makeKevin([ironpr]);
    syncIronPr(kevin.db, path);
    const live = new Database(path);
    live.prepare('INSERT INTO workouts VALUES (?,?,?,?,?,?,?)').run('w5', 'u1', 'bp', 160, 1, 160, Date.now());
    live.close();
    const later = new Date(Date.now() + 5000);
    utimesSync(path, later, later);
    expect(syncIronPr(kevin.db, path)).toMatchObject({ ok: true, changed: true, entries: 5 });
    expect(syncIronPr(kevin.db, join(config.dataDir, 'missing.db'))).toMatchObject({ ok: false });
    expect((await ok(kevin, 'query', { sql: 'SELECT COUNT(*) AS n FROM ironpr_entries' })).rows).toEqual([{ n: 5 }]);
  });

  it('feeds the Workouts page and Home', async () => {
    const path = fixture('ironpr-c.db');
    Object.assign(config, { ironPrDb: path });
    const kevin = await makeKevin([ironpr]);
    const o = await view(kevin, 'ironpr/overview');
    expect(o).toMatchObject({ available: true, error: null, totals: { exercises: 2, entries: 4, first_date: '2025-09-03', last_date: '2026-11-03' } });
    const squat = o.exercises.find((e: any) => e.name === 'Barbell Squat');
    expect(squat).toMatchObject({ entries: 3, best_weight_lbs: 215, best_date: '2026-11-03', last_weight_lbs: 215, best_one_rm_lbs: 215 });
    expect(squat.history.map((h: any) => h.weight_lbs)).toEqual([185, 205, 215]);
    expect(o.exercises[0].name).toBe('Barbell Squat'); // most recently trained first
    expect(o.recent_prs[0]).toMatchObject({ exercise: 'Barbell Squat', weight_lbs: 215, previous_weight_lbs: 205 });
    expect((await view(kevin, 'ironpr/home')).cards).toEqual([{ title: 'New record this week', lines: ['Barbell Squat: 215 lb (was 205)'], link: '/workouts?tab=progress' }]);
  });
});
