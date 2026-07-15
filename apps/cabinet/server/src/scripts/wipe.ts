/**
 * Category-aware data-reset tool: clears Ben's structured records (cabinet.db
 * QS/app tables, episodic.db's conversation/journal chunks) and resets his
 * profile narrative files back to blank seed templates — while leaving
 * Cabinet's own operational "brain" completely untouched: schema/migrations,
 * the lesson bank (episodic.db's lesson/vec_lesson), and the instruction/
 * character/platform memory files (IDENTITY/SOUL/VOICE/PLATFORM/HEARTBEAT/
 * ONBOARDING.md + domains/platform.md). Not something exposed to the chat
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
 * ## Why scoped DELETE, not whole-file deletion (the superseded design)
 * The previous version of this tool deleted cabinet.db/episodic.db wholesale,
 * specifically to dodge a sqlite-vec hazard: episodic.db's vec0 virtual
 * tables (vec_chunk, vec_lesson) keep internal shadow tables that must never
 * be DELETEd directly, only through the virtual table itself. That reasoning
 * was sound but the conclusion was too blunt — episodic.db's `lesson` table
 * (Cabinet's portable, cross-conversation insight — brain, not Ben's data)
 * lived in the same file as `chunk` (100% dogfooding fixture text, verified
 * 2026-07-12 by sampling the first and last 5 of all 439 rows: test-harness
 * messages, PALS-architecture checks, the build of this very tool — none of
 * it real Ben content), so a whole-file wipe destroyed both indiscriminately.
 *
 * Verified empirically (scratch copy of the real episodic.db, 2026-07-12):
 * running
 *   DELETE FROM vec_chunk;
 *   DELETE FROM chunk;
 * through better-sqlite3 + sqlite-vec — i.e. addressing the vec0 table by
 * its declared name, never its shadow tables (vec_chunk_info/_chunks/_rowids/
 * _vector_chunks00) directly — cleanly zeroed chunk/vec_chunk while leaving
 * lesson/vec_lesson byte-identical, a KNN search against the surviving
 * vec_lesson still ran correctly afterward, and PRAGMA integrity_check
 * returned 'ok'. So the vec0 hazard is specifically about the shadow tables,
 * not about scoped DELETE against the vec0 table itself — no dump-and-
 * restore machinery needed.
 *
 * cabinet.db has no vec0 tables at all (confirmed via sqlite_master), so the
 * hazard never applied there — every CLEAR table gets a plain `DELETE FROM`.
 * foreign_keys enforcement is turned off for the duration of the clear
 * (openDb() turns it ON for normal operation; some CLEAR tables reference
 * others without ON DELETE CASCADE, e.g. food_log.recipe_id, so deleting in
 * anything but exact dependency order would trip FK checks mid-transaction —
 * simpler and equally correct to disable checks for this one bulk operation,
 * since the end state is zero rows in every referencing and referenced table
 * either way) and the pragma is per-connection, not persisted to the file —
 * the live server's own connection is unaffected once this script's
 * dedicated connection closes.
 *
 * ## The KEEP/CLEAR split
 * Every table and every memory file must be explicitly classified — see
 * CABINET_KEEP_TABLES/CABINET_CLEAR_TABLES, EPISODIC_KEEP_TABLES/
 * EPISODIC_CLEAR_TABLES, and MEMORY_KEEP_FILES/MEMORY_RESET_FILES/
 * MEMORY_CARVEOUT_FILES below. buildManifest() throws (UnclassifiedWipeTargetError)
 * if it finds a table holding rows, or a memory file, that isn't in any of
 * these lists — a newly added table/file can't silently slip through unwiped
 * (a records table that escapes CLEAR corrupts every future calculation the
 * way the pre-wipe fixture data did) or unintentionally wiped (a brain file
 * that escapes KEEP loses real operational history). main() runs
 * buildManifest() unconditionally before checking --plan vs --execute, so
 * this guard fires in both modes; wipe() re-checks it independently too, so
 * a caller that invokes wipe() directly (bypassing main()/buildManifest, as
 * the test suite does) gets the same protection.
 *
 * STANDING_ORDERS.md is a third, distinct case: not brain, not a records
 * fixture — it's Ben's own real governance input. MemoryStore.update()
 * already refuses to let the conversational agent touch it (approval-gated,
 * Ben-only); this tool matches that refusal by excluding it from the reset
 * loop entirely (MEMORY_CARVEOUT_FILES), rather than resetting it via the
 * same raw writeFileSync loop everything else in MEMORY_TEMPLATES goes
 * through. That is a fix, not a stylistic choice: the previous wipe()
 * looped over ALL of Object.entries(MEMORY_TEMPLATES) with no carve-out, so
 * a wipe would have silently blanked real standing orders had Ben ever set
 * any — harmless only by accident, because the file happened to still be
 * the empty placeholder.
 *
 * NOTE: unlike the old whole-file-delete design, a scoped DELETE against a
 * db file the live cabinet-api process holds open (WAL mode) can become
 * visible to that process's own reads without a restart. Restarting
 * afterward is still good hygiene (clean connection state) but is no longer
 * the load-bearing step that makes the wipe "take effect" — the scoped
 * DELETE plus its WAL checkpoint is already durable on its own.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { openDb } from '../db/index.js';
import { EpisodicStore } from '../episodic/index.js';
import { MEMORY_TEMPLATES } from '../memory/templates.js';

const IS_ENTRY = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

/** cabinet.db classification — every real (non-internal) table must be in exactly one of these two lists. */
export const CABINET_KEEP_TABLES = ['schema_migration'];
export const CABINET_CLEAR_TABLES = [
  'account',
  'action_audit',
  'activity_plan_entry',
  'approval',
  'body_metric',
  'budget',
  'claim',
  'contact',
  'document',
  'food_log',
  'goal',
  'grocery_list_item',
  'habit_event',
  'hard_constraint',
  'health_daily',
  'holding',
  'hsa_contribution',
  'insurance_plan',
  'journal_entry',
  'lab_result',
  'meal_plan_entry',
  'medication',
  'message',
  'mood_log',
  'pantry_item',
  'price_watch',
  'prior_auth',
  'reading_item',
  'recipe',
  'recipe_ingredient',
  'retrieval_log',
  'subscription',
  'task',
  'chat',
  'token_usage',
  'transaction_row',
  'workout',
  'workout_set',
];

/**
 * episodic.db classification. lesson/vec_lesson are Cabinet's portable,
 * cross-conversation insight (brain) — never touched. chunk/vec_chunk hold
 * raw conversation/journal/document text — cleared (see file doc comment for
 * the 2026-07-12 sampling that confirmed all 439 rows are dogfooding
 * chatter). The vec0 shadow tables and sqlite's own sqlite_sequence are
 * internal machinery tied to their parent table's lifecycle, never
 * addressed directly, and excluded from classification entirely.
 */
export const EPISODIC_KEEP_TABLES = ['lesson', 'vec_lesson'];
export const EPISODIC_CLEAR_TABLES = ['chunk', 'vec_chunk'];
const EPISODIC_INTERNAL_PATTERN = /^(vec_chunk_|vec_lesson_)/;
const SQLITE_MANAGED_TABLES = new Set(['sqlite_sequence']);

/**
 * Memory-file classification. KEEP files are Cabinet's own operational
 * self-knowledge — identity, character, platform know-how, and the
 * instruction docs (HEARTBEAT.md's checklist, ONBOARDING.md's interview
 * script) that shape how Cabinet operates rather than record who Ben is.
 * RESET files are Ben's profile narrative, blanked back to template.
 * STANDING_ORDERS.md is deliberately its own third bucket — see the
 * file-level doc comment above — never folded into KEEP by default so its
 * exclusion stays a documented decision, not an accident of list-ordering.
 */
export const MEMORY_KEEP_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'VOICE.md',
  'PLATFORM.md',
  'HEARTBEAT.md',
  'ONBOARDING.md',
  'domains/platform.md',
];
export const MEMORY_CARVEOUT_FILES = ['STANDING_ORDERS.md'];
export const MEMORY_RESET_FILES = [
  'USER.md',
  'GOALS.md',
  'PREFERENCES.md',
  'domains/health.md',
  'domains/nutrition.md',
  'domains/training.md',
  'domains/mind.md',
  'domains/money.md',
  'domains/admin.md',
  'domains/social.md',
];

/** Thrown by the classification guard — a table with data, or a memory file, that isn't explicitly keep/clear/carveout. */
export class UnclassifiedWipeTargetError extends Error {}

function assertMemoryFilesClassified(): void {
  const known = new Set([...MEMORY_KEEP_FILES, ...MEMORY_CARVEOUT_FILES, ...MEMORY_RESET_FILES]);
  const unclassified = Object.keys(MEMORY_TEMPLATES).filter((f) => !known.has(f));
  if (unclassified.length > 0) {
    throw new UnclassifiedWipeTargetError(
      `wipe: memory file(s) not classified as keep/carveout/reset — refusing until fixed: ${unclassified.join(', ')}`,
    );
  }
}

export interface TableCount {
  name: string;
  /** -1 = a classified table that refused a bare COUNT(*) — reported, not fatal. */
  rows: number;
  action: 'clear' | 'keep';
}

export interface MemoryFileStatus {
  name: string;
  isTemplate: boolean;
  bytes: number;
  action: 'reset' | 'keep' | 'carveout';
}

export interface WipeManifest {
  dataDir: string;
  cabinetDbExists: boolean;
  episodicDbExists: boolean;
  cabinetTables: TableCount[];
  episodicTables: TableCount[];
  memoryFiles: MemoryFileStatus[];
}

/**
 * Classify every addressable (non-internal) table in a db file as clear or
 * keep. Throws UnclassifiedWipeTargetError if any table holding rows isn't
 * in either list — the guard that stops a newly added table from silently
 * slipping through unwiped or unintentionally wiped. Opens read-only —
 * never mutates. `setup` loads any extension the connection needs before
 * counting rows (episodic.db's vec0 tables need sqlite-vec loaded or a bare
 * COUNT(*) against them throws "no such module: vec0" and gets misreported
 * as an unreadable/internal table instead of a real count).
 */
function classifyTables(
  dbPath: string,
  dbLabel: string,
  keep: string[],
  clear: string[],
  isInternal: (name: string) => boolean,
  setup?: (db: Database.Database) => void,
): TableCount[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    setup?.(db);
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
      .filter((n) => !isInternal(n));
    const keepSet = new Set(keep);
    const clearSet = new Set(clear);
    const result: TableCount[] = [];
    const unclassifiedPopulated: string[] = [];
    for (const name of names) {
      let rows: number;
      try {
        rows = (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
      } catch {
        rows = -1;
      }
      if (keepSet.has(name)) {
        result.push({ name, rows, action: 'keep' });
      } else if (clearSet.has(name)) {
        result.push({ name, rows, action: 'clear' });
      } else if (rows !== 0) {
        unclassifiedPopulated.push(`${name} (${rows === -1 ? 'internal?' : rows} row(s))`);
      }
    }
    if (unclassifiedPopulated.length > 0) {
      throw new UnclassifiedWipeTargetError(
        `wipe: ${dbLabel} has unclassified table(s) holding data — refusing until classified as keep or clear: ${unclassifiedPopulated.join(', ')}`,
      );
    }
    return result;
  } finally {
    db.close();
  }
}

function classifyCabinetTables(dbPath: string): TableCount[] {
  return classifyTables(dbPath, 'cabinet.db', CABINET_KEEP_TABLES, CABINET_CLEAR_TABLES, () => false);
}

function classifyEpisodicTables(dbPath: string): TableCount[] {
  return classifyTables(
    dbPath,
    'episodic.db',
    EPISODIC_KEEP_TABLES,
    EPISODIC_CLEAR_TABLES,
    (n) => EPISODIC_INTERNAL_PATTERN.test(n) || SQLITE_MANAGED_TABLES.has(n),
    (db) => sqliteVec.load(db),
  );
}

/** Read-only report of what a wipe would touch — the manifest --plan prints and --execute backs up before acting on. */
export function buildManifest(dataDir: string): WipeManifest {
  assertMemoryFilesClassified();

  const cabinetPath = join(dataDir, 'cabinet.db');
  const episodicPath = join(dataDir, 'episodic.db');
  const memoryDir = join(dataDir, 'memory');

  const cabinetDbExists = existsSync(cabinetPath);
  const episodicDbExists = existsSync(episodicPath);

  const memoryFiles: MemoryFileStatus[] = Object.keys(MEMORY_TEMPLATES)
    .sort()
    .map((name) => {
      const action: MemoryFileStatus['action'] = MEMORY_CARVEOUT_FILES.includes(name)
        ? 'carveout'
        : MEMORY_KEEP_FILES.includes(name)
          ? 'keep'
          : 'reset';
      const full = join(memoryDir, name);
      if (!existsSync(full)) return { name, isTemplate: true, bytes: 0, action };
      const content = readFileSync(full, 'utf8');
      return {
        name,
        isTemplate: content.trim() === MEMORY_TEMPLATES[name]!.trim(),
        bytes: Buffer.byteLength(content),
        action,
      };
    });

  return {
    dataDir,
    cabinetDbExists,
    episodicDbExists,
    cabinetTables: cabinetDbExists ? classifyCabinetTables(cabinetPath) : [],
    episodicTables: episodicDbExists ? classifyEpisodicTables(episodicPath) : [],
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
    lines.push(`${label} — ${tables.length} classified table(s):`);
    for (const t of tables.filter((t) => t.action === 'clear')) {
      lines.push(`  CLEAR ${t.name}: ${t.rows === -1 ? '(internal)' : t.rows} row(s)`);
    }
    for (const t of tables.filter((t) => t.action === 'keep')) {
      lines.push(`  KEEP  ${t.name}: ${t.rows === -1 ? '(internal)' : t.rows} row(s)`);
    }
  }

  lines.push('', 'memory/:');
  for (const f of m.memoryFiles) {
    const label =
      f.action === 'carveout'
        ? 'CARVEOUT (never touched — Ben-only, approval-gated)'
        : f.action === 'keep'
          ? 'KEEP'
          : f.isTemplate
            ? 'RESET (already blank)'
            : `RESET (${f.bytes} bytes real content)`;
    lines.push(`  ${f.name}: ${label}`);
  }

  lines.push(
    '',
    'unclassified-table guard: passed — every table and memory file is explicitly keep/clear/carveout ' +
      '(buildManifest throws UnclassifiedWipeTargetError otherwise).',
  );

  const clearRowsPresent = [...m.cabinetTables, ...m.episodicTables].some((t) => t.action === 'clear' && t.rows > 0);
  const resetDirty = m.memoryFiles.some((f) => f.action === 'reset' && !f.isTemplate);
  const hasWork = clearRowsPresent || resetDirty;
  lines.push(
    '',
    hasWork
      ? 'Execute with: wipe --execute --yes (backs up cabinet.db/episodic.db/memory/ first; restart cabinet-api afterward for clean connection state).'
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

/**
 * Scoped DELETE across every CABINET_CLEAR_TABLES table, in one transaction.
 * foreign_keys is turned off first — see the file doc comment for why: some
 * CLEAR tables reference others without ON DELETE CASCADE, and the end state
 * (zero rows everywhere) makes exact dependency ordering unnecessary busywork.
 * A WAL checkpoint folds the deletes back into the main file afterward so the
 * reclaim is durable without depending on the live server to checkpoint.
 */
function clearCabinetRecords(dbPath: string): string[] {
  const { db, close } = openDb(dbPath);
  try {
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      for (const t of CABINET_CLEAR_TABLES) db.exec(`DELETE FROM "${t}"`);
    });
    tx();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    close();
  }
  return [...CABINET_CLEAR_TABLES];
}

/**
 * Scoped DELETE against chunk/vec_chunk only — lesson/vec_lesson are never
 * referenced here. This is the exact sequence verified empirically against a
 * scratch copy of the real episodic.db (see file doc comment): addressing
 * vec_chunk by its declared name is the sanctioned vec0 interface, distinct
 * from (and safe unlike) touching its shadow tables directly.
 */
function clearEpisodicChunks(dbPath: string): string[] {
  const store = new EpisodicStore(dbPath);
  try {
    const tx = store.db.transaction(() => {
      for (const t of EPISODIC_CLEAR_TABLES) store.db.exec(`DELETE FROM "${t}"`);
    });
    tx();
    store.db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    store.close();
  }
  return [...EPISODIC_CLEAR_TABLES];
}

export interface WipeResult {
  backups: string[];
  memoryBackupDir: string | null;
  cabinetCleared: string[];
  episodicCleared: string[];
  memoryReset: string[];
}

/**
 * Performs the actual wipe. Backup first is not optional — it happens
 * unconditionally, even under --execute --yes — then CABINET_CLEAR_TABLES /
 * EPISODIC_CLEAR_TABLES rows are deleted in place (schema_migration and
 * lesson/vec_lesson untouched), and every MEMORY_RESET_FILES file is
 * rewritten to its blank seed template and committed to the memory dir's own
 * git history. MEMORY_KEEP_FILES and MEMORY_CARVEOUT_FILES are never written.
 */
export function wipe(dataDir: string, stamp: string = new Date().toISOString().replace(/[:.]/g, '-')): WipeResult {
  assertMemoryFilesClassified();

  const cabinetPath = join(dataDir, 'cabinet.db');
  const episodicPath = join(dataDir, 'episodic.db');
  const memoryDir = join(dataDir, 'memory');
  const backupDir = join(dataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });

  // Re-run the classification guard here too (not just via buildManifest) so
  // a caller that invokes wipe() directly — bypassing main()'s buildManifest
  // call, as the test suite does — still gets the same protection, and so a
  // data dir that changed shape between a --plan and this --execute is
  // re-checked rather than trusted from a stale manifest.
  if (existsSync(cabinetPath)) classifyCabinetTables(cabinetPath);
  if (existsSync(episodicPath)) classifyEpisodicTables(episodicPath);

  const backups: string[] = [];
  for (const [path, name] of [
    [cabinetPath, 'cabinet.db'],
    [episodicPath, 'episodic.db'],
  ] as const) {
    const b = backupDbFile(path, backupDir, stamp, name);
    if (b) backups.push(b);
  }

  let memoryBackupDir: string | null = null;
  if (existsSync(memoryDir)) {
    memoryBackupDir = join(backupDir, `${stamp}-memory`);
    cpSync(memoryDir, memoryBackupDir, { recursive: true });
  }

  const cabinetCleared = existsSync(cabinetPath) ? clearCabinetRecords(cabinetPath) : [];
  const episodicCleared = existsSync(episodicPath) ? clearEpisodicChunks(episodicPath) : [];

  const memoryReset: string[] = [];
  if (existsSync(memoryDir)) {
    for (const name of MEMORY_RESET_FILES) {
      const content = MEMORY_TEMPLATES[name];
      if (content === undefined) continue; // guarded against by assertMemoryFilesClassified; defensive only
      const full = join(memoryDir, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      memoryReset.push(name);
    }
    try {
      execFileSync('git', ['-C', memoryDir, 'add', '-A']);
      execFileSync('git', [
        '-C',
        memoryDir,
        'commit',
        '--quiet',
        '-m',
        "wipe: reset Ben's profile narrative files to blank seed templates (brain files + STANDING_ORDERS.md untouched)",
      ]);
    } catch (err) {
      // "nothing to commit" is fine (a write of byte-identical content must
      // be a no-op, not a throw) — anything else is not. Pre-existing bug
      // found while building item 5: git writes that message to STDOUT, not
      // stderr, so it never lands in execFileSync's thrown Error#message —
      // this check has silently never matched. Check stdout too.
      const out = `${(err as { stdout?: string }).stdout ?? ''} ${(err as Error).message}`;
      if (!out.includes('nothing to commit')) throw err;
    }
  }

  return { backups, memoryBackupDir, cabinetCleared, episodicCleared, memoryReset };
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

  let manifest: WipeManifest;
  try {
    manifest = buildManifest(args.dataDir);
  } catch (err) {
    if (err instanceof UnclassifiedWipeTargetError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
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
  console.log(
    `cabinet.db: cleared ${result.cabinetCleared.length} table(s) (schema_migration kept).${
      result.cabinetCleared.length === 0 ? ' (no cabinet.db found)' : ''
    }`,
  );
  console.log(
    `episodic.db: ${result.episodicCleared.length > 0 ? 'cleared chunk/vec_chunk (lesson/vec_lesson kept).' : '(no episodic.db found)'}`,
  );
  console.log(
    `memory: reset ${result.memoryReset.length} file(s) to blank templates (brain files and STANDING_ORDERS.md untouched).`,
  );
  console.log('restart cabinet-api recommended for clean connection state (the scoped DELETE is already durable via WAL checkpoint).');
}

if (IS_ENTRY) main();
