import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, queryReadonly, QueryGuardError, localDay, type CabinetDb } from '../src/db/index.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-db-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('applies once and is idempotent on rerun', () => {
    // openDb already migrated; a second run must be a no-op.
    expect(migrate(cabinet.db)).toEqual([]);
    const applied = cabinet.db.prepare('SELECT count(*) AS n FROM schema_migration').get() as { n: number };
    expect(applied.n).toBeGreaterThanOrEqual(1);
  });

  it('creates the domain and chat schema', () => {
    const tables = new Set(
      (cabinet.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    for (const t of [
      'thread', 'message', 'food_log', 'workout', 'workout_set', 'body_metric', 'health_daily',
      'mood_log', 'journal_entry', 'insurance_plan', 'claim', 'medication', 'lab_result',
      'hsa_contribution', 'transaction_row', 'task', 'contact', 'approval', 'action_audit', 'token_usage',
    ]) {
      expect(tables, `missing table ${t}`).toContain(t);
    }
    // accumulator columns used by healthcare math
    const cols = (cabinet.db.prepare('PRAGMA table_info(claim)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('applied_to_deductible');
    expect(cols).toContain('applied_to_oop');
  });

  it('enforces foreign keys', () => {
    expect(() =>
      cabinet.db.prepare("INSERT INTO message (id, thread_id, role, parts) VALUES ('m1','nope','user','[]')").run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('queryReadonly guard', () => {
  it('allows SELECT and WITH', () => {
    expect(queryReadonly(cabinet.readonlyDb, 'SELECT 1 AS one')).toEqual([{ one: 1 }]);
    expect(queryReadonly(cabinet.readonlyDb, 'WITH x AS (SELECT 2 AS two) SELECT two FROM x')).toEqual([{ two: 2 }]);
  });

  it('supports bound parameters', () => {
    cabinet.db.prepare("INSERT INTO thread (id, title) VALUES ('t1','hello')").run();
    expect(queryReadonly(cabinet.readonlyDb, 'SELECT title FROM thread WHERE id = ?', ['t1'])).toEqual([
      { title: 'hello' },
    ]);
  });

  it.each([
    ["INSERT INTO thread (id) VALUES ('x')"],
    ["UPDATE thread SET title='x'"],
    ['DELETE FROM thread'],
    ['DROP TABLE thread'],
    ['PRAGMA journal_mode=DELETE'],
    ["ATTACH DATABASE '/tmp/evil.db' AS evil"],
    ['VACUUM'],
  ])('rejects %s', (sql) => {
    expect(() => queryReadonly(cabinet.readonlyDb, sql)).toThrow(QueryGuardError);
  });

  it('rejects multi-statement chaining', () => {
    expect(() => queryReadonly(cabinet.readonlyDb, "SELECT 1; DELETE FROM thread")).toThrow(QueryGuardError);
  });

  it('rejects comment-disguised writes', () => {
    expect(() => queryReadonly(cabinet.readonlyDb, "/* SELECT */ DELETE FROM thread")).toThrow(QueryGuardError);
  });

  it('the readonly connection itself cannot write (defense in depth)', () => {
    expect(() => cabinet.readonlyDb.prepare("INSERT INTO thread (id) VALUES ('x')").run()).toThrow(
      /readonly/i,
    );
  });

  it('caps returned rows', () => {
    const insert = cabinet.db.prepare('INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)');
    const tx = cabinet.db.transaction(() => {
      for (let i = 0; i < 600; i++) insert.run('2026-01-01T00:00:00Z', '2026-01-01', 'weight_lb', i);
    });
    tx();
    expect(queryReadonly(cabinet.readonlyDb, 'SELECT * FROM body_metric')).toHaveLength(500);
  });
});

describe('localDay', () => {
  it('derives the New York calendar day across the UTC midnight boundary', () => {
    // 2026-07-08T02:30Z is still 2026-07-07 in New York (EDT, UTC-4)
    expect(localDay(new Date('2026-07-08T02:30:00Z'))).toBe('2026-07-07');
    // and 05:30Z has crossed into the 8th (01:30 EDT)
    expect(localDay(new Date('2026-07-08T05:30:00Z'))).toBe('2026-07-08');
    // winter (EST, UTC-5): 04:30Z on Jan 2 is still Jan 1 in NY
    expect(localDay(new Date('2026-01-02T04:30:00Z'))).toBe('2026-01-01');
  });
});
