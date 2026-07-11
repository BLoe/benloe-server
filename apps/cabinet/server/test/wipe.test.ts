import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { EpisodicStore } from '../src/episodic/index.js';
import { MemoryStore } from '../src/memory/index.js';
import { MEMORY_TEMPLATES } from '../src/memory/templates.js';
import { buildManifest, formatManifest, parseArgs, wipe } from '../src/scripts/wipe.js';
import { upsertGoal } from '../src/domains/misc.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-wipe-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

describe('buildManifest', () => {
  it('reports no DBs and all-template memory on a totally fresh dataDir', () => {
    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    const m = buildManifest(dir);
    expect(m.cabinetDbExists).toBe(false);
    expect(m.episodicDbExists).toBe(false);
    expect(m.memoryFiles.every((f) => f.isTemplate)).toBe(true);
  });

  it('counts real rows in cabinet.db and flags a modified memory file', () => {
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

    const health = m.memoryFiles.find((f) => f.name === 'domains/health.md');
    expect(health?.isTemplate).toBe(false);
    const user = m.memoryFiles.find((f) => f.name === 'USER.md');
    expect(user?.isTemplate).toBe(true);
  });

  it('counts rows in episodic.db (including the lesson table)', () => {
    const episodic = new EpisodicStore(join(dir, 'episodic.db'));
    episodic.db.prepare("INSERT INTO lesson (text, domain) VALUES ('test lesson', 'test')").run();
    episodic.db.close();

    const m = buildManifest(dir);
    expect(m.episodicDbExists).toBe(true);
    const lessonTable = m.episodicTables.find((t) => t.name === 'lesson');
    expect(lessonTable?.rows).toBe(1);
  });
});

describe('formatManifest', () => {
  it('tells an all-blank dataDir there is nothing to do', () => {
    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    const text = formatManifest(buildManifest(dir));
    expect(text).toContain('Already blank — nothing for --execute to do.');
  });

  it('points at --execute --yes when there is real work', () => {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
    cabinet.close();
    const text = formatManifest(buildManifest(dir));
    expect(text).toContain('wipe --execute --yes');
    expect(text).toContain('goal: 1 row(s)');
  });
});

describe('wipe (execute)', () => {
  function seed() {
    const cabinet = openDb(join(dir, 'cabinet.db'));
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
    cabinet.close();

    const episodic = new EpisodicStore(join(dir, 'episodic.db'));
    episodic.db.prepare("INSERT INTO lesson (text, domain) VALUES ('test lesson', 'test')").run();
    episodic.db.close();

    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    memory.update('USER.md', '# USER — Test Ben\n\nreal onboarding content, not the seed template.', 'seed');
  }

  it('removes the db files and resets memory to blank templates, after backing everything up', () => {
    seed();
    const result = wipe(dir, 'teststamp');

    // DB files gone.
    expect(existsSync(join(dir, 'cabinet.db'))).toBe(false);
    expect(existsSync(join(dir, 'episodic.db'))).toBe(false);

    // Backups exist and hold the pre-wipe content.
    expect(result.backups).toHaveLength(2);
    for (const b of result.backups) expect(existsSync(b)).toBe(true);
    const backedUpCabinet = new Database(result.backups.find((b) => b.endsWith('cabinet.db'))!, { readonly: true });
    const goalCount = backedUpCabinet.prepare('SELECT COUNT(*) AS n FROM goal').get() as { n: number };
    expect(goalCount.n).toBe(1);
    backedUpCabinet.close();

    // Memory backed up too, and reset to blank templates in place.
    expect(result.memoryBackupDir).not.toBeNull();
    expect(existsSync(result.memoryBackupDir!)).toBe(true);
    const backedUpUser = readFileSync(join(result.memoryBackupDir!, 'USER.md'), 'utf8');
    expect(backedUpUser).toContain('real onboarding content');

    const resetUser = readFileSync(join(dir, 'memory', 'USER.md'), 'utf8');
    expect(resetUser.trim()).toBe(MEMORY_TEMPLATES['USER.md']!.trim());
  });

  it('is idempotent — wiping an already-blank dataDir is a harmless no-op', () => {
    const memory = new MemoryStore(join(dir, 'memory'));
    memory.ensureTemplates();
    expect(() => wipe(dir, 'teststamp2')).not.toThrow();
    expect(existsSync(join(dir, 'cabinet.db'))).toBe(false);
  });

  it('--plan mode never touches anything (buildManifest is read-only)', () => {
    seed();
    buildManifest(dir); // the --plan path
    expect(existsSync(join(dir, 'cabinet.db'))).toBe(true);
    expect(existsSync(join(dir, 'episodic.db'))).toBe(true);
    const user = readFileSync(join(dir, 'memory', 'USER.md'), 'utf8');
    expect(user).toContain('real onboarding content');
  });
});
