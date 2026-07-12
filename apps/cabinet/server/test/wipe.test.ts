import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { EpisodicStore } from '../src/episodic/index.js';
import { MemoryStore } from '../src/memory/index.js';
import { MEMORY_TEMPLATES } from '../src/memory/templates.js';
import {
  CABINET_CLEAR_TABLES,
  CABINET_KEEP_TABLES,
  EPISODIC_CLEAR_TABLES,
  EPISODIC_KEEP_TABLES,
  MEMORY_CARVEOUT_FILES,
  MEMORY_KEEP_FILES,
  MEMORY_RESET_FILES,
  UnclassifiedWipeTargetError,
  buildManifest,
  formatManifest,
  parseArgs,
  wipe,
} from '../src/scripts/wipe.js';
import { upsertGoal } from '../src/domains/misc.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-wipe-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Seeds a recipe -> recipe_ingredient (child, cascade) and recipe -> food_log
 * (child, NO cascade) pair. recipe_ingredient sits alphabetically AFTER recipe
 * in CABINET_CLEAR_TABLES, so deleting recipe before recipe_ingredient with
 * foreign_keys ON would throw — this is the real case that makes disabling FK
 * enforcement for the bulk clear a correctness requirement, not a nicety. */
function seedFkLinkedRows(cabinet: CabinetDb): void {
  cabinet.db.exec(`INSERT INTO recipe (id, title) VALUES (1, 'Test Recipe')`);
  cabinet.db.exec(`INSERT INTO recipe_ingredient (id, recipe_id, name) VALUES (1, 1, 'flour')`);
  cabinet.db.exec(
    `INSERT INTO food_log (id, eaten_at, local_day, description, recipe_id) VALUES (1, '2026-01-01T00:00:00Z', '2026-01-01', 'test meal', 1)`,
  );
}

describe('parseArgs', () => {
  it('defaults to plan mode, default data dir, yes=false', () => {
    const args = parseArgs([]);
    expect(args.mode).toBe('plan');
    expect(args.yes).toBe(false);
    expect(args.dataDir).toBe('/srv/benloe/data/cabinet');
  });

  it('--execute alone does not imply --yes', () => {
    const args = parseArgs(['--execute']);
    expect(args.mode).toBe('execute');
    expect(args.yes).toBe(false);
  });

  it('--execute --yes sets both', () => {
    const args = parseArgs(['--execute', '--yes']);
    expect(args.mode).toBe('execute');
    expect(args.yes).toBe(true);
  });

  it('--data-dir overrides the default', () => {
    const args = parseArgs(['--data-dir', '/tmp/somewhere']);
    expect(args.dataDir).toBe('/tmp/somewhere');
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--nuke-everything'])).toThrow(/unknown argument/);
  });

  it('rejects --data-dir with no value', () => {
    expect(() => parseArgs(['--data-dir'])).toThrow(/needs a value/);
  });
});

describe('memory file classification completeness', () => {
  it('every MEMORY_TEMPLATES key is in exactly one of keep/carveout/reset', () => {
    const known = [...MEMORY_KEEP_FILES, ...MEMORY_CARVEOUT_FILES, ...MEMORY_RESET_FILES];
    expect(new Set(known).size).toBe(known.length); // no file double-classified
    expect(new Set(known)).toEqual(new Set(Object.keys(MEMORY_TEMPLATES)));
  });

  it('STANDING_ORDERS.md is carved out, not folded into keep', () => {
    expect(MEMORY_CARVEOUT_FILES).toContain('STANDING_ORDERS.md');
    expect(MEMORY_KEEP_FILES).not.toContain('STANDING_ORDERS.md');
  });
});

describe('buildManifest', () => {
  it('reports no DBs and all-template memory on a totally fresh dataDir', () => {
    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    const m = buildManifest(dir);
    expect(m.cabinetDbExists).toBe(false);
    expect(m.episodicDbExists).toBe(false);
    expect(m.memoryFiles.every((f) => f.isTemplate)).toBe(true);
  });

  it('classifies cabinet.db tables as clear/keep and counts rows correctly', () => {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
    cabinet.close();

    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    memory.update('domains/health.md', '# Health\n\nreal content, not the template.', 'test');

    const m = buildManifest(dir);
    expect(m.cabinetDbExists).toBe(true);
    const goalTable = m.cabinetTables.find((t) => t.name === 'goal');
    expect(goalTable?.rows).toBe(1);
    expect(goalTable?.action).toBe('clear');
    const migrationTable = m.cabinetTables.find((t) => t.name === 'schema_migration');
    expect(migrationTable?.action).toBe('keep');
    expect(migrationTable!.rows).toBeGreaterThan(0);

    const health = m.memoryFiles.find((f) => f.name === 'domains/health.md');
    expect(health?.isTemplate).toBe(false);
    expect(health?.action).toBe('reset');
    const user = m.memoryFiles.find((f) => f.name === 'USER.md');
    expect(user?.isTemplate).toBe(true);
    expect(user?.action).toBe('reset');
    const identity = m.memoryFiles.find((f) => f.name === 'IDENTITY.md');
    expect(identity?.action).toBe('keep');
    const standing = m.memoryFiles.find((f) => f.name === 'STANDING_ORDERS.md');
    expect(standing?.action).toBe('carveout');
  });

  it('classifies episodic.db: chunk/vec_chunk clear, lesson/vec_lesson keep', () => {
    expect(EPISODIC_CLEAR_TABLES).toEqual(['chunk', 'vec_chunk']);
    expect(EPISODIC_KEEP_TABLES).toEqual(['lesson', 'vec_lesson']);
    const episodic = new EpisodicStore(join(dir, 'episodic.db'));
    episodic.insertChunk('conversation', 'message:test', null, 'dogfooding test chatter', new Float32Array(384).fill(0.01));
    episodic.insertLesson('test lesson', 'test', null, 0.9, new Float32Array(384).fill(0.02));
    episodic.close();

    const m = buildManifest(dir);
    expect(m.episodicDbExists).toBe(true);
    expect(m.episodicTables.find((t) => t.name === 'chunk')).toEqual({ name: 'chunk', rows: 1, action: 'clear' });
    expect(m.episodicTables.find((t) => t.name === 'vec_chunk')).toEqual({ name: 'vec_chunk', rows: 1, action: 'clear' });
    expect(m.episodicTables.find((t) => t.name === 'lesson')).toEqual({ name: 'lesson', rows: 1, action: 'keep' });
    expect(m.episodicTables.find((t) => t.name === 'vec_lesson')).toEqual({ name: 'vec_lesson', rows: 1, action: 'keep' });
    // vec0 shadow tables and sqlite_sequence must not appear at all.
    expect(m.episodicTables.some((t) => t.name.startsWith('vec_chunk_'))).toBe(false);
    expect(m.episodicTables.some((t) => t.name.startsWith('vec_lesson_'))).toBe(false);
    expect(m.episodicTables.some((t) => t.name === 'sqlite_sequence')).toBe(false);
  });

  it('throws UnclassifiedWipeTargetError when a populated table is not in either list', () => {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    cabinet.db.exec('CREATE TABLE mystery_table (id INTEGER PRIMARY KEY, x TEXT)');
    cabinet.db.exec("INSERT INTO mystery_table (x) VALUES ('unclassified data')");
    cabinet.close();

    expect(() => buildManifest(dir)).toThrow(UnclassifiedWipeTargetError);
    expect(() => buildManifest(dir)).toThrow(/mystery_table/);
  });

  it('does NOT throw when an unclassified table exists but is empty', () => {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    cabinet.db.exec('CREATE TABLE future_table (id INTEGER PRIMARY KEY)');
    cabinet.close();

    expect(() => buildManifest(dir)).not.toThrow();
  });
});

describe('formatManifest', () => {
  it('tells an all-blank dataDir there is nothing to do', () => {
    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    const text = formatManifest(buildManifest(dir));
    expect(text).toContain('Already blank — nothing for --execute to do.');
  });

  it('points at --execute --yes and lists CLEAR rows when there is real work', () => {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
    cabinet.close();
    const text = formatManifest(buildManifest(dir));
    expect(text).toContain('wipe --execute --yes');
    expect(text).toContain('CLEAR goal: 1 row(s)');
    expect(text).toContain('unclassified-table guard: passed');
  });

  it('marks STANDING_ORDERS.md as CARVEOUT in the printed manifest', () => {
    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    const text = formatManifest(buildManifest(dir));
    expect(text).toMatch(/STANDING_ORDERS\.md: CARVEOUT/);
  });
});

describe('wipe (execute)', () => {
  function seed() {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
    seedFkLinkedRows(cabinet);
    cabinet.close();

    const episodic = new EpisodicStore(join(dir, 'episodic.db'));
    episodic.insertChunk('conversation', 'message:test', null, 'dogfooding test chatter', new Float32Array(384).fill(0.01));
    episodic.insertLesson('real lesson', 'platform', null, 0.9, new Float32Array(384).fill(0.02));
    episodic.close();

    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    memory.update('USER.md', '# USER — Test Ben\n\nreal onboarding content, not the seed template.', 'seed');
    memory.update('PLATFORM.md', MEMORY_TEMPLATES['PLATFORM.md']! + '\n- a real operational learning appended here.', 'seed');
    // STANDING_ORDERS.md can't be written via MemoryStore.update() (it refuses —
    // by design). Simulate Ben having set real standing orders through
    // whatever privileged path actually manages that file, by writing it
    // directly to disk.
    writeFileSync(join(dir, 'memory', 'STANDING_ORDERS.md'), '# STANDING ORDERS\n\nReal Ben-authored standing order.\n');
  }

  it('clears every CABINET_CLEAR_TABLES row (including FK-linked ones) while keeping schema_migration', () => {
    seed();
    const before = new Database(join(dir, 'cabinet.db'), { readonly: true });
    const migrationsBefore = (before.prepare('SELECT COUNT(*) AS n FROM schema_migration').get() as { n: number }).n;
    before.close();
    expect(migrationsBefore).toBeGreaterThan(0);

    const result = wipe(dir, 'teststamp');
    expect(result.cabinetCleared.sort()).toEqual([...CABINET_CLEAR_TABLES].sort());

    const after = new Database(join(dir, 'cabinet.db'), { readonly: true });
    for (const t of CABINET_CLEAR_TABLES) {
      const n = (after.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
      expect(n, `${t} should be empty after wipe`).toBe(0);
    }
    for (const t of CABINET_KEEP_TABLES) {
      const n = (after.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
      expect(n, `${t} should be preserved`).toBe(migrationsBefore);
    }
    expect(after.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    after.close();
  });

  it('clears chunk/vec_chunk but preserves lesson/vec_lesson and its KNN search', () => {
    seed();
    wipe(dir, 'teststamp');

    const episodic = new EpisodicStore(join(dir, 'episodic.db'));
    expect(episodic.db.prepare('SELECT COUNT(*) AS n FROM chunk').get()).toEqual({ n: 0 });
    expect(episodic.db.prepare('SELECT COUNT(*) AS n FROM vec_chunk').get()).toEqual({ n: 0 });
    const lessons = episodic.db.prepare('SELECT text FROM lesson').all();
    expect(lessons).toEqual([{ text: 'real lesson' }]);

    const hits = episodic.searchLessons(new Float32Array(384).fill(0.02), 4);
    expect(hits.some((h) => h.text === 'real lesson')).toBe(true);
    expect(episodic.db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    episodic.close();
  });

  it('resets MEMORY_RESET_FILES, keeps MEMORY_KEEP_FILES, and never touches STANDING_ORDERS.md', () => {
    seed();
    const result = wipe(dir, 'teststamp');
    expect(result.memoryReset.sort()).toEqual([...MEMORY_RESET_FILES].sort());

    const resetUser = readFileSync(join(dir, 'memory', 'USER.md'), 'utf8');
    expect(resetUser.trim()).toBe(MEMORY_TEMPLATES['USER.md']!.trim());

    // PLATFORM.md got real operational content appended pre-wipe — must survive untouched.
    const platform = readFileSync(join(dir, 'memory', 'PLATFORM.md'), 'utf8');
    expect(platform).toContain('a real operational learning appended here.');

    // STANDING_ORDERS.md must be byte-identical to what was written directly (never reset, never backed-up-over).
    const standing = readFileSync(join(dir, 'memory', 'STANDING_ORDERS.md'), 'utf8');
    expect(standing).toContain('Real Ben-authored standing order.');
  });

  it('backs up cabinet.db, episodic.db, and memory/ before mutating anything', () => {
    seed();
    const result = wipe(dir, 'teststamp');

    expect(result.backups).toHaveLength(2);
    for (const b of result.backups) expect(existsSync(b)).toBe(true);
    const backedUpCabinet = new Database(result.backups.find((b) => b.endsWith('cabinet.db'))!, { readonly: true });
    const goalCount = backedUpCabinet.prepare('SELECT COUNT(*) AS n FROM goal').get() as { n: number };
    expect(goalCount.n).toBe(1);
    backedUpCabinet.close();

    expect(result.memoryBackupDir).not.toBeNull();
    expect(existsSync(result.memoryBackupDir!)).toBe(true);
    const backedUpUser = readFileSync(join(result.memoryBackupDir!, 'USER.md'), 'utf8');
    expect(backedUpUser).toContain('real onboarding content');
  });

  it('is idempotent — wiping an already-blank dataDir is a harmless no-op', () => {
    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    expect(() => wipe(dir, 'teststamp2')).not.toThrow();
    expect(existsSync(join(dir, 'cabinet.db'))).toBe(false);
    expect(existsSync(join(dir, 'episodic.db'))).toBe(false);
  });

  it('--plan mode never touches anything (buildManifest is read-only)', () => {
    seed();
    buildManifest(dir); // the --plan path
    const cabinet = new Database(join(dir, 'cabinet.db'), { readonly: true });
    expect((cabinet.prepare('SELECT COUNT(*) AS n FROM goal').get() as { n: number }).n).toBe(1);
    cabinet.close();
    const episodic = new Database(join(dir, 'episodic.db'), { readonly: true });
    expect((episodic.prepare('SELECT COUNT(*) AS n FROM chunk').get() as { n: number }).n).toBe(1);
    episodic.close();
    const user = readFileSync(join(dir, 'memory', 'USER.md'), 'utf8');
    expect(user).toContain('real onboarding content');
  });

  it('throws UnclassifiedWipeTargetError instead of silently clearing an unknown populated table', () => {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    cabinet.db.exec('CREATE TABLE mystery_table (id INTEGER PRIMARY KEY, x TEXT)');
    cabinet.db.exec("INSERT INTO mystery_table (x) VALUES ('unclassified data')");
    cabinet.close();

    expect(() => wipe(dir, 'teststamp3')).toThrow(UnclassifiedWipeTargetError);
    // and nothing was mutated — no backup dir work, mystery_table row still there.
    const check = new Database(join(dir, 'cabinet.db'), { readonly: true });
    expect((check.prepare('SELECT COUNT(*) AS n FROM mystery_table').get() as { n: number }).n).toBe(1);
    check.close();
  });
});
