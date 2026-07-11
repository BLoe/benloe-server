/**
 * Full data-reset tool: wipes cabinet.db, episodic.db, and resets the
 * curated memory files back to their blank seed templates. A deliberate
 * whole-person "start over" operation — NOT something exposed to the chat
 * agent as an MCP tool. Run it by hand:
 *
 *   npx tsx src/scripts/wipe.ts                  # --plan (default): report only, touches nothing
 *   npx tsx src/scripts/wipe.ts --plan
 *   npx tsx src/scripts/wipe.ts --execute --yes  # actually wipe (backs up first, always)
 *
 * Dry-run-first by design, mirroring the standing rule that a destructive
 * action snapshots/backs up before it acts: the default (no flags at all) is
 * --plan, and --execute alone is refused — it takes an explicit --yes too.
 * There is no ambiguous middle state where a bare `wipe` call touches data.
 *
 * Deleting the two db FILES (rather than DELETE FROM every table) sidesteps
 * a sqlite-vec hazard: episodic.db's vec0 virtual tables (vec_chunk,
 * vec_lesson) keep internal shadow tables that must never be DELETEd
 * directly, only through the virtual table itself — removing the whole file
 * avoids that entire class of "did I miss a shadow table" bug. cabinet.db's
 * schema is rebuilt from scratch on next boot by openDb()'s migration
 * runner; episodic.db's by EpisodicStore's constructor (both idempotent,
 * CREATE-IF-NOT-EXISTS-shaped already — see db/index.ts and
 * episodic/index.ts). Memory files are rewritten in place to their template
 * content and the reset is committed to the memory dir's own git history, so
 * it is itself one `git revert` away from undone on top of the file-level
 * backup below.
 *
 * NOTE: the running cabinet-api process holds cabinet.db/episodic.db open —
 * a wipe only takes effect after the process is restarted (same caveat as a
 * deploy). This tool does not restart anything itself.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { MEMORY_TEMPLATES } from '../memory/templates.js';

const IS_ENTRY = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export interface TableCount {
  name: string;
  /** -1 = an internal/shadow table that refused a bare COUNT(*) — reported, not fatal. */
  rows: number;
}

export interface MemoryFileStatus {
  name: string;
  isTemplate: boolean;
  bytes: number;
}

export interface WipeManifest {
  dataDir: string;
  cabinetDbExists: boolean;
  episodicDbExists: boolean;
  cabinetTables: TableCount[];
  episodicTables: TableCount[];
  memoryFiles: MemoryFileStatus[];
}

/** Every real (non-sqlite-internal) table in a sqlite file, with its row count. Opens read-only — never mutates. */
function countTables(dbPath: string): TableCount[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    return names.map((name) => {
      let rows: number;
      try {
        rows = (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
      } catch {
        rows = -1;
      }
      return { name, rows };
    });
  } finally {
    db.close();
  }
}

/** Read-only report of what a wipe would touch — the manifest --plan prints and --execute backs up before acting on. */
export function buildManifest(dataDir: string): WipeManifest {
  const cabinetPath = join(dataDir, 'cabinet.db');
  const episodicPath = join(dataDir, 'episodic.db');
  const memoryDir = join(dataDir, 'memory');

  const cabinetDbExists = existsSync(cabinetPath);
  const episodicDbExists = existsSync(episodicPath);

  const memoryFiles: MemoryFileStatus[] = Object.keys(MEMORY_TEMPLATES)
    .sort()
    .map((name) => {
      const full = join(memoryDir, name);
      if (!existsSync(full)) return { name, isTemplate: true, bytes: 0 };
      const content = readFileSync(full, 'utf8');
      return { name, isTemplate: content.trim() === MEMORY_TEMPLATES[name]!.trim(), bytes: Buffer.byteLength(content) };
    });

  return {
    dataDir,
    cabinetDbExists,
    episodicDbExists,
    cabinetTables: cabinetDbExists ? countTables(cabinetPath) : [],
    episodicTables: episodicDbExists ? countTables(episodicPath) : [],
    memoryFiles,
  };
}

export function formatManifest(m: WipeManifest): string {
  const lines: string[] = [];
  lines.push(`wipe --plan: ${m.dataDir}`, '');

  if (!m.cabinetDbExists && !m.episodicDbExists) {
    lines.push('(no cabinet.db or episodic.db found here — nothing to wipe on the DB side)');
  }
  for (const [label, exists, tables] of [
    ['cabinet.db', m.cabinetDbExists, m.cabinetTables],
    ['episodic.db', m.episodicDbExists, m.episodicTables],
  ] as const) {
    if (!exists) continue;
    const nonEmpty = tables.filter((t) => t.rows !== 0);
    lines.push(`${label} — ${tables.length} table(s), ${nonEmpty.length} with data:`);
    for (const t of nonEmpty) lines.push(`  ${t.name}: ${t.rows === -1 ? '(internal)' : t.rows} row(s)`);
    if (nonEmpty.length === 0) lines.push('  (already empty)');
  }

  const dirty = m.memoryFiles.filter((f) => !f.isTemplate);
  lines.push(`memory/ — ${m.memoryFiles.length} tracked file(s), ${dirty.length} holding real (non-template) content:`);
  for (const f of dirty) lines.push(`  ${f.name}: ${f.bytes} bytes`);
  if (dirty.length === 0) lines.push('  (already all blank templates)');

  lines.push('');
  const hasWork = m.cabinetDbExists || m.episodicDbExists || dirty.length > 0;
  lines.push(
    hasWork
      ? 'Execute with: wipe --execute --yes (backs up cabinet.db/episodic.db/memory/ first; cabinet-api must be restarted afterward to pick up the reset).'
      : 'Already blank — nothing for --execute to do.',
  );
  return lines.join('\n');
}

export interface ParsedArgs {
  mode: 'plan' | 'execute';
  dataDir: string;
  yes: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let mode: 'plan' | 'execute' = 'plan';
  let dataDir = process.env.CABINET_DATA_DIR ?? '/srv/benloe/data/cabinet';
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') mode = 'plan';
    else if (a === '--execute') mode = 'execute';
    else if (a === '--yes') yes = true;
    else if (a === '--data-dir') {
      const next = argv[++i];
      if (!next) throw new Error('--data-dir needs a value');
      dataDir = next;
    } else {
      throw new Error(`wipe: unknown argument '${a}'`);
    }
  }
  return { mode, dataDir, yes };
}

/** Timestamped sqlite `.backup` of a db file — same technique as scheduler/jobs.ts's nightly maintenance backup. */
function backupDbFile(src: string, backupDir: string, stamp: string, name: string): string | null {
  if (!existsSync(src)) return null;
  const dest = join(backupDir, `${stamp}-${name}`);
  execFileSync('sqlite3', [src, `.backup '${dest}'`]);
  return dest;
}

export interface WipeResult {
  backups: string[];
  memoryBackupDir: string | null;
}

/**
 * Performs the actual wipe. Backup first is not optional — it happens
 * unconditionally, even under --execute --yes — then cabinet.db/episodic.db
 * (and their -wal/-shm sidecars, so a stale WAL page can't resurrect old
 * rows once a fresh file is created) are deleted, and every memory file is
 * rewritten to its blank seed template and committed to the memory dir's own
 * git history.
 */
export function wipe(dataDir: string, stamp: string = new Date().toISOString().replace(/[:.]/g, '-')): WipeResult {
  const backupDir = join(dataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });

  const backups: string[] = [];
  for (const name of ['cabinet.db', 'episodic.db']) {
    const b = backupDbFile(join(dataDir, name), backupDir, stamp, name);
    if (b) backups.push(b);
  }

  const memoryDir = join(dataDir, 'memory');
  let memoryBackupDir: string | null = null;
  if (existsSync(memoryDir)) {
    memoryBackupDir = join(backupDir, `${stamp}-memory`);
    cpSync(memoryDir, memoryBackupDir, { recursive: true });
  }

  for (const name of ['cabinet.db', 'cabinet.db-wal', 'cabinet.db-shm', 'episodic.db', 'episodic.db-wal', 'episodic.db-shm']) {
    const p = join(dataDir, name);
    if (existsSync(p)) rmSync(p);
  }

  if (existsSync(memoryDir)) {
    for (const [name, content] of Object.entries(MEMORY_TEMPLATES)) {
      const full = join(memoryDir, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    try {
      execFileSync('git', ['-C', memoryDir, 'add', '-A']);
      execFileSync('git', ['-C', memoryDir, 'commit', '--quiet', '-m', 'wipe: reset all memory files to blank seed templates']);
    } catch (err) {
      // Same "nothing to commit is fine" tolerance as MemoryStore.commit —
      // git writes that message to stdout, not the thrown error's message.
      const out = `${(err as { stdout?: Buffer | string }).stdout ?? ''} ${(err as Error).message}`;
      if (!out.includes('nothing to commit')) throw err;
    }
  }

  return { backups, memoryBackupDir };
}

function main(): void {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  const manifest = buildManifest(args.dataDir);
  console.log(formatManifest(manifest));

  if (args.mode === 'plan') {
    console.log('\n(dry run — no files were touched. pass --execute --yes to actually wipe.)');
    return;
  }

  if (!args.yes) {
    console.error('\nwipe: refusing --execute without --yes — this is the one destructive tool in the repo; be deliberate.');
    process.exitCode = 1;
    return;
  }

  console.log('\nwiping...');
  const result = wipe(args.dataDir);
  console.log(`backed up: ${result.backups.join(', ') || '(none — nothing existed to back up)'}`);
  if (result.memoryBackupDir) console.log(`memory dir backed up to: ${result.memoryBackupDir}`);
  console.log('cabinet.db and episodic.db removed; memory files reset to blank templates.');
  console.log('restart cabinet-api to pick up the reset — it holds the old db files open until then.');
}

if (IS_ENTRY) main();
