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
import Database from 'better-sqlite3';
import { readFileSync, statSync } from 'node:fs';
import { config } from '../config.js';
import { type DB, getSetting, nowIso, setSetting } from '../db.js';
import { defineDomain } from '../domains.js';
import { localDay } from '../time.js';

interface SrcExercise { id: string; name: string; userId: string; createdAt: number | string }
interface SrcEntry { id: string; userId: string; exerciseId: string; weight: number; reps: number; oneRM: number; createdAt: number | string }
interface SrcPr { id: string; userId: string; exerciseId: string; weight: number; previousWeight: number | null; createdAt: number | string }

const iso = (t: number | string): string => new Date(typeof t === 'number' ? t : /^\d+$/.test(t) ? Number(t) : t).toISOString();
const text = (s: unknown, max = 120): string => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export interface SyncResult { ok: boolean; changed: boolean; exercises?: number; entries?: number; prs?: number; error?: string }

/** Copies IRON PR's current contents into the ironpr_* tables. Never throws; a failed read leaves the last good mirror in place. */
export function syncIronPr(db: DB, path = config.ironPrDb, force = false): SyncResult {
  let stamp: string;
  try {
    const st = statSync(path);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    return { ok: false, changed: false, error: 'IRON PR database not found' };
  }
  if (!force && getSetting(db, 'ironpr_stamp', '') === stamp) return { ok: true, changed: false };
  let src: Database.Database | null = null;
  try {
    // From bytes, not from the path: no lock, no journal, no way to write back.
    src = new Database(readFileSync(path));
    if ((src.pragma('quick_check', { simple: true }) as string) !== 'ok') throw new Error('copy was mid-write');
    const exercises = src.prepare('SELECT id, name, userId, createdAt FROM exercises').all() as SrcExercise[];
    const entries = src.prepare('SELECT id, userId, exerciseId, weight, reps, oneRM, createdAt FROM workouts').all() as SrcEntry[];
    const prs = src.prepare('SELECT id, userId, exerciseId, weight, previousWeight, createdAt FROM pr_history').all() as SrcPr[];
    const names = new Map(exercises.map((e) => [e.id, text(e.name)]));
    db.transaction(() => {
      db.exec('DELETE FROM ironpr_prs; DELETE FROM ironpr_entries; DELETE FROM ironpr_exercises;');
      const insE = db.prepare('INSERT INTO ironpr_exercises (id, name, created_at) VALUES (?,?,?)');
      for (const e of exercises) insE.run(text(e.id, 64), text(e.name), iso(e.createdAt));
      const insW = db.prepare('INSERT INTO ironpr_entries (id, exercise_id, exercise, date, weight_lbs, reps, one_rm_lbs, logged_at) VALUES (?,?,?,?,?,?,?,?)');
      for (const w of entries) {
        if (!names.has(w.exerciseId)) continue;
        const at = iso(w.createdAt);
        insW.run(text(w.id, 64), text(w.exerciseId, 64), names.get(w.exerciseId), localDay(new Date(at)), Number(w.weight), Math.round(Number(w.reps)), Number(w.oneRM), at);
      }
      const insP = db.prepare('INSERT INTO ironpr_prs (id, exercise_id, exercise, date, weight_lbs, previous_weight_lbs, set_at) VALUES (?,?,?,?,?,?,?)');
      for (const p of prs) {
        if (!names.has(p.exerciseId)) continue;
        const at = iso(p.createdAt);
        insP.run(text(p.id, 64), text(p.exerciseId, 64), names.get(p.exerciseId), localDay(new Date(at)), Number(p.weight), p.previousWeight == null ? null : Number(p.previousWeight), at);
      }
      setSetting(db, 'ironpr_stamp', stamp);
      setSetting(db, 'ironpr_synced_at', nowIso());
    })();
    return { ok: true, changed: true, exercises: exercises.length, entries: entries.length, prs: prs.length };
  } catch (e) {
    return { ok: false, changed: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    src?.close();
  }
}

interface EntryRow { id: string; exercise_id: string; exercise: string; date: string; weight_lbs: number; reps: number; one_rm_lbs: number; logged_at: string }

function overview(db: DB) {
  const sync = syncIronPr(db);
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
    home: (_p, db) => {
      syncIronPr(db);
      const since = localDay(new Date(Date.now() - 7 * 86_400_000));
      const rows = db.prepare('SELECT exercise, weight_lbs, previous_weight_lbs, date FROM ironpr_prs WHERE date >= ? AND previous_weight_lbs IS NOT NULL ORDER BY set_at DESC LIMIT 5').all(since) as { exercise: string; weight_lbs: number; previous_weight_lbs: number; date: string }[];
      if (!rows.length) return { cards: [] };
      return { cards: [{ title: rows.length === 1 ? 'New record this week' : `${rows.length} new records this week`, lines: rows.map((r) => `${r.exercise}: ${r.weight_lbs} lb (was ${r.previous_weight_lbs})`), link: '/workouts?tab=progress' }] };
    },
  },
});
