// IRON PR is the app Ben has used for years to record his lifts with his
// personal trainer (weights.benloe.com, database data/weights.db). It stays
// exactly as it is. Kevin only reads it:
//
//  - The file is read into memory and opened from those bytes, so Kevin never
//    holds a lock on the live database and cannot write to it even by mistake.
//  - What is read is copied into Kevin's own ironpr_* tables (a mirror), so
//    the model can query it with SQL like everything else and the Workouts
//    page can show it.
//
// There are no write tools here and there must never be one: anything Ben
// wants changed in IRON PR, he changes in IRON PR.
//
// IRON PR has an account per person (its rows carry the artanis user id), so
// only Ben's rows are copied: those whose userId is his account's id, which
// Kevin learns from his own signed-in requests (OWNER_ACCOUNT_KEY in http.ts).
// Until Kevin knows it, nothing is mirrored and the mirror is emptied: another
// person's lifts, and their free-text exercise names, must never reach Ben's
// pages or the model.
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { type DB, getSetting, nowIso, OWNER_ACCOUNT_KEY, setSetting } from '../db.js';
import { defineDomain } from '../domains.js';
import { localDay } from '../time.js';

// The source file is writable by another uid (claude-worker owns /srv/benloe/data), so it is treated as
// hostile: a crafted database can make SQLite run forever (a view over an endless recursive query in
// place of a table) or take all memory, and better-sqlite3 cannot be interrupted. So it is never opened
// in this process. A short-lived child process reads it (refusing a symlink or anything but a regular
// file under ironprLimits.fileBytes), opens it from memory, checks that the three names are plain tables,
// reads at most ironprLimits.rows of each, and is killed at the deadline. What comes back is validated row by
// row here before anything is stored.

/** What the reader allows. An object so a test can tighten it. */
export const ironprLimits = {
  /** The largest IRON PR file that is read. Two years of Ben's lifts are about 50 KB. */
  fileBytes: 64 * 1024 * 1024,
  /** Rows read per table; more than this and the sync fails rather than mirror part of it. */
  rows: 50_000,
  /** Seconds the reader may take before it is killed. */
  seconds: 10,
};

const SQLITE = createRequire(import.meta.url).resolve('better-sqlite3');

// Plain JavaScript, run with `node -e`: one JSON request on stdin, one JSON reply on stdout.
const READER = `
const fs = require('fs');
let input = '';
process.stdin.on('data', (c) => (input += c)).on('end', () => {
  const req = JSON.parse(input);
  let reply;
  try {
    // O_NOFOLLOW: a symlink planted at the path is refused, not followed to some other file.
    const fd = fs.openSync(req.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('not a regular file');
    if (st.size > req.maxBytes) throw new Error('the file is ' + st.size + ' bytes, more than the ' + req.maxBytes + ' allowed');
    const bytes = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = fs.readSync(fd, bytes, off, st.size - off, off); if (!n) break; off += n; }
    fs.closeSync(fd);
    // From bytes, not from the path: no lock on the live file, no journal, no way to write back.
    const db = new (require(req.lib))(bytes.subarray(0, off));
    db.pragma('hard_heap_limit = ' + 256 * 1024 * 1024);
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('the copy was mid-write or damaged');
    const kinds = Object.fromEntries(db.prepare("SELECT name, type FROM sqlite_master WHERE name IN ('exercises', 'workouts', 'pr_history')").all().map((r) => [r.name, r.type]));
    for (const t of ['exercises', 'workouts', 'pr_history']) if (kinds[t] !== 'table') throw new Error(t + ' is not a table');
    const read = (sql) => {
      const rows = db.prepare(sql).raw(false).all(req.owner, req.maxRows + 1);
      if (rows.length > req.maxRows) throw new Error('more than ' + req.maxRows + ' rows in one table');
      return rows;
    };
    reply = {
      exercises: read('SELECT id, name, createdAt FROM exercises WHERE userId = ? LIMIT ?'),
      entries: read('SELECT id, exerciseId, weight, reps, oneRM, createdAt FROM workouts WHERE userId = ? LIMIT ?'),
      prs: read('SELECT id, exerciseId, weight, previousWeight, createdAt FROM pr_history WHERE userId = ? LIMIT ?'),
    };
  } catch (e) {
    reply = { error: String((e && e.message) || e) };
  }
  process.stdout.write(JSON.stringify(reply), () => process.exit(0));
});
`;

interface Read { exercises: unknown[]; entries: unknown[]; prs: unknown[] }

/** Reads Ben's rows of the file in a child process. Rejects with a plain Error on any failure or at the deadline. */
function readSource(path: string, owner: string): Promise<Read> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', '-e', READER], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    const out: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`reading IRON PR took longer than ${ironprLimits.seconds} seconds and was stopped`))), ironprLimits.seconds * 1000);
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) finish(() => reject(new Error('reading IRON PR returned too much data')));
      else out.push(c);
    });
    child.stderr.resume();
    child.on('error', (e) => finish(() => reject(new Error(`the IRON PR reader could not be started: ${e.message}`))));
    child.on('close', () =>
      finish(() => {
        let reply: Partial<Read> & { error?: string };
        try {
          reply = JSON.parse(Buffer.concat(out).toString('utf8')) as typeof reply;
        } catch {
          return void reject(new Error('the IRON PR reader ended without an answer (it ran out of memory or crashed)'));
        }
        if (reply.error != null) return void reject(new Error(`IRON PR could not be read: ${reply.error}`));
        if (!Array.isArray(reply.exercises) || !Array.isArray(reply.entries) || !Array.isArray(reply.prs)) return void reject(new Error('the IRON PR reader answered in an unexpected shape'));
        resolve(reply as Read);
      }),
    );
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ lib: SQLITE, path, owner, maxBytes: ironprLimits.fileBytes, maxRows: ironprLimits.rows }));
  });
}

// ---- validating what came back ----------------------------------------------------------

const text = (s: unknown, max = 120): string => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const id = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);
const num = (v: unknown, max = 100_000): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
/** IRON PR stores milliseconds (Prisma); a numeric string or an ISO date is accepted too. Null when it is not a date from 1990 to a year ahead. */
const when = (v: unknown): string | null => {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? (/^\d+$/.test(v) ? Number(v) : Date.parse(v)) : NaN;
  if (!Number.isFinite(ms) || ms < Date.UTC(1990, 0, 1) || ms > Date.now() + 366 * 86_400_000) return null;
  return new Date(ms).toISOString();
};

interface Exercise { id: string; name: string; at: string }
interface Entry { id: string; exerciseId: string; weight: number; reps: number; oneRM: number; at: string }
interface Pr { id: string; exerciseId: string; weight: number; previousWeight: number | null; at: string }

function validate(r: Read): { exercises: Exercise[]; entries: Entry[]; prs: Pr[]; dropped: number } {
  let dropped = 0;
  const keep = <T>(rows: unknown[], fn: (o: Record<string, unknown>) => T | null): T[] =>
    rows.flatMap((row) => {
      const v = row && typeof row === 'object' ? fn(row as Record<string, unknown>) : null;
      if (v === null) dropped++;
      return v === null ? [] : [v];
    });
  const exercises = keep(r.exercises, (o) => {
    const i = id(o.id);
    const name = text(o.name);
    const at = when(o.createdAt);
    return i && name && at ? { id: i, name, at } : null;
  });
  const known = new Set(exercises.map((e) => e.id));
  const entries = keep(r.entries, (o) => {
    const i = id(o.id);
    const ex = id(o.exerciseId);
    const weight = num(o.weight, 5000);
    const reps = num(o.reps, 1000);
    const oneRM = num(o.oneRM, 10_000);
    const at = when(o.createdAt);
    return i && ex && known.has(ex) && weight !== null && reps !== null && oneRM !== null && at ? { id: i, exerciseId: ex, weight, reps: Math.round(reps), oneRM, at } : null;
  });
  const prs = keep(r.prs, (o) => {
    const i = id(o.id);
    const ex = id(o.exerciseId);
    const weight = num(o.weight, 5000);
    const prev = o.previousWeight == null ? null : num(o.previousWeight, 5000);
    const at = when(o.createdAt);
    return i && ex && known.has(ex) && weight !== null && (o.previousWeight == null || prev !== null) && at ? { id: i, exerciseId: ex, weight, previousWeight: prev, at } : null;
  });
  return { exercises, entries, prs, dropped };
}

export interface SyncResult { ok: boolean; changed: boolean; exercises?: number; entries?: number; prs?: number; skipped?: number; error?: string }

/** Where the mirror's state is kept: the source file's stamp and whose rows it holds, so a change of either re-reads it. */
const STAMP_KEY = 'ironpr_stamp';

/** One sync at a time per database and file: calls made while one runs share its result. */
const inflight = new WeakMap<DB, Map<string, Promise<SyncResult>>>();

/**
 * Copies Ben's rows in IRON PR into the ironpr_* tables. Never throws. A failed read leaves the last good
 * mirror in place; not knowing which account is Ben's empties it, so it never holds anyone else's rows.
 * Calls made while one is running share it.
 */
export function syncIronPr(db: DB, path = config.ironPrDb, force = false): Promise<SyncResult> {
  const running = inflight.get(db) ?? inflight.set(db, new Map()).get(db)!;
  const current = running.get(path);
  if (current) return current;
  const p = doSync(db, path, force).finally(() => running.delete(path));
  running.set(path, p);
  return p;
}

async function doSync(db: DB, path: string, force: boolean): Promise<SyncResult> {
  const owner = getSetting<string | null>(db, OWNER_ACCOUNT_KEY, null);
  if (typeof owner !== 'string' || !owner) {
    if (getSetting<string>(db, STAMP_KEY, '') !== 'no-owner') {
      db.transaction(() => {
        db.exec('DELETE FROM ironpr_prs; DELETE FROM ironpr_entries; DELETE FROM ironpr_exercises;');
        setSetting(db, STAMP_KEY, 'no-owner');
      })();
    }
    return { ok: false, changed: false, error: 'Kevin does not know yet which IRON PR account is Ben\'s. He learns it the next time Ben opens Kevin while signed in.' };
  }
  let stamp: string;
  try {
    // lstat: a symlink is refused here, and again (O_NOFOLLOW) where the file is opened.
    const st = lstatSync(path);
    if (!st.isFile()) return { ok: false, changed: false, error: 'IRON PR database is not a regular file' };
    if (st.size > ironprLimits.fileBytes) return { ok: false, changed: false, error: `IRON PR database is ${st.size} bytes, more than the ${ironprLimits.fileBytes} read` };
    stamp = `${st.mtimeMs}:${st.size}:${owner}`;
  } catch {
    return { ok: false, changed: false, error: 'IRON PR database not found' };
  }
  if (!force && getSetting<string>(db, STAMP_KEY, '') === stamp) return { ok: true, changed: false };
  let rows: ReturnType<typeof validate>;
  try {
    rows = validate(await readSource(path, owner));
  } catch (e) {
    return { ok: false, changed: false, error: e instanceof Error ? e.message : String(e) };
  }
  const names = new Map(rows.exercises.map((e) => [e.id, e.name]));
  db.transaction(() => {
    db.exec('DELETE FROM ironpr_prs; DELETE FROM ironpr_entries; DELETE FROM ironpr_exercises;');
    const insE = db.prepare('INSERT OR IGNORE INTO ironpr_exercises (id, name, created_at) VALUES (?,?,?)');
    for (const e of rows.exercises) insE.run(e.id, e.name, e.at);
    const insW = db.prepare('INSERT OR IGNORE INTO ironpr_entries (id, exercise_id, exercise, date, weight_lbs, reps, one_rm_lbs, logged_at) VALUES (?,?,?,?,?,?,?,?)');
    for (const w of rows.entries) insW.run(w.id, w.exerciseId, names.get(w.exerciseId), localDay(new Date(w.at)), w.weight, w.reps, w.oneRM, w.at);
    const insP = db.prepare('INSERT OR IGNORE INTO ironpr_prs (id, exercise_id, exercise, date, weight_lbs, previous_weight_lbs, set_at) VALUES (?,?,?,?,?,?,?)');
    for (const p of rows.prs) insP.run(p.id, p.exerciseId, names.get(p.exerciseId), localDay(new Date(p.at)), p.weight, p.previousWeight, p.at);
    setSetting(db, STAMP_KEY, stamp);
    setSetting(db, 'ironpr_synced_at', nowIso());
  })();
  if (rows.dropped) console.error(`IRON PR: ${rows.dropped} row(s) were left out: not in the expected shape, or for an exercise that is not Ben's`);
  return { ok: true, changed: true, exercises: rows.exercises.length, entries: rows.entries.length, prs: rows.prs.length, ...(rows.dropped ? { skipped: rows.dropped } : {}) };
}

interface EntryRow { id: string; exercise_id: string; exercise: string; date: string; weight_lbs: number; reps: number; one_rm_lbs: number; logged_at: string }

async function overview(db: DB) {
  const sync = await syncIronPr(db);
  const entries = db.prepare('SELECT * FROM ironpr_entries ORDER BY logged_at').all() as EntryRow[];
  const byExercise = new Map<string, EntryRow[]>();
  for (const e of entries) (byExercise.get(e.exercise_id) ?? byExercise.set(e.exercise_id, []).get(e.exercise_id)!).push(e);
  const exercises = (db.prepare('SELECT id, name FROM ironpr_exercises ORDER BY name COLLATE NOCASE').all() as { id: string; name: string }[]).map((x) => {
    const rows = byExercise.get(x.id) ?? [];
    const best = rows.reduce<EntryRow | null>((b, r) => (!b || r.weight_lbs > b.weight_lbs ? r : b), null);
    const last = rows.at(-1) ?? null;
    return {
      id: x.id, name: x.name, entries: rows.length,
      best_weight_lbs: best?.weight_lbs ?? null, best_reps: best?.reps ?? null, best_date: best?.date ?? null,
      best_one_rm_lbs: rows.length ? Math.max(...rows.map((r) => r.one_rm_lbs)) : null,
      last_weight_lbs: last?.weight_lbs ?? null, last_reps: last?.reps ?? null, last_date: last?.date ?? null,
      first_date: rows[0]?.date ?? null,
      // Oldest first, for a small chart.
      history: rows.map((r) => ({ date: r.date, weight_lbs: r.weight_lbs, reps: r.reps, one_rm_lbs: r.one_rm_lbs })),
    };
  });
  exercises.sort((a, b) => (b.last_date ?? '').localeCompare(a.last_date ?? '') || a.name.localeCompare(b.name));
  return {
    available: sync.ok || exercises.length > 0,
    error: sync.ok ? null : sync.error ?? null,
    synced_at: getSetting<string | null>(db, 'ironpr_synced_at', null),
    app_url: 'https://weights.benloe.com',
    totals: { exercises: exercises.length, entries: entries.length, first_date: entries[0]?.date ?? null, last_date: entries.at(-1)?.date ?? null },
    exercises,
    recent_prs: db.prepare('SELECT exercise, date, weight_lbs, previous_weight_lbs FROM ironpr_prs ORDER BY set_at DESC LIMIT 15').all(),
  };
}

export default defineDomain({
  name: 'ironpr',
  migrations: [
    {
      id: 'ironpr-001',
      sql: `
      CREATE TABLE ironpr_exercises (
        -- READ-ONLY MIRROR of IRON PR (weights.benloe.com), the app Ben logs his lifts in with his personal trainer. Refreshed automatically; rows here are replaced on each refresh.
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,                        -- as Ben named it there: 'Barbell Squat', 'Hex Bar Deadlift'
        created_at TEXT NOT NULL
      );
      CREATE TABLE ironpr_entries (
        -- One lift logged in IRON PR: the top weight for an exercise on a day, with the trainer.
        id TEXT PRIMARY KEY,
        exercise_id TEXT NOT NULL,
        exercise TEXT NOT NULL,                    -- ironpr_exercises.name, repeated here so no join is needed
        date TEXT NOT NULL,                        -- YYYY-MM-DD in Ben's timezone
        weight_lbs REAL NOT NULL,
        reps INTEGER NOT NULL,
        one_rm_lbs REAL NOT NULL,                  -- IRON PR's own estimated one-rep max for this lift
        logged_at TEXT NOT NULL                    -- UTC ISO
      );
      CREATE INDEX ironpr_entries_exercise ON ironpr_entries(exercise, date);
      CREATE TABLE ironpr_prs (
        -- Each time a personal record was set in IRON PR.
        id TEXT PRIMARY KEY,
        exercise_id TEXT NOT NULL,
        exercise TEXT NOT NULL,
        date TEXT NOT NULL,                        -- YYYY-MM-DD
        weight_lbs REAL NOT NULL,                  -- the new record
        previous_weight_lbs REAL,                  -- the record it beat; NULL for the first one
        set_at TEXT NOT NULL
      );
      `,
    },
  ],
  promptNote: `IRON PR (weights.benloe.com) is the separate app where Ben records his lifts with his personal trainer; he has used it for years and it stays the record of those sessions. You can read it through the ironpr_* tables, which mirror it and refresh on their own, and you have no way to write to it: when Ben wants something logged or fixed there, he does it in that app. Use it whenever strength comes up: his records (SELECT exercise, MAX(weight_lbs) FROM ironpr_entries GROUP BY exercise), how a lift has moved over time, when he last trained something, and as the starting weights when you write him a plan. Exercise names there are his trainer's wording and may differ from the names in workouts_exercises ("Barbell Bench Press" vs "Bench Press"); treat close names as the same lift. Lifts he logs with you go in the workouts tables as usual; the two are separate records and you can read both.`,
  views: {
    /** Everything the Workouts page shows about IRON PR, in one call. Refreshes the mirror if the app's data changed. */
    overview: (_p, db) => overview(db),
    /** A record set in IRON PR in the last 7 days is worth a line on Home. */
    home: async (_p, db) => {
      await syncIronPr(db);
      const since = localDay(new Date(Date.now() - 7 * 86_400_000));
      const rows = db.prepare('SELECT exercise, weight_lbs, previous_weight_lbs, date FROM ironpr_prs WHERE date >= ? AND previous_weight_lbs IS NOT NULL ORDER BY set_at DESC LIMIT 5').all(since) as { exercise: string; weight_lbs: number; previous_weight_lbs: number; date: string }[];
      if (!rows.length) return { cards: [] };
      return { cards: [{ title: rows.length === 1 ? 'New record this week' : `${rows.length} new records this week`, lines: rows.map((r) => `${r.exercise}: ${r.weight_lbs} lb (was ${r.previous_weight_lbs})`), link: '/workouts?tab=progress' }] };
    },
  },
});
