import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { localDay } from '../db/index.js';

// ---------- mind ----------
export function logMood(
  db: Database.Database,
  m: { mood?: number; energy?: number; stress?: number; note?: string; when?: Date },
): number {
  const when = m.when ?? new Date();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO mood_log (logged_at, local_day, mood, energy, stress, note) VALUES (?,?,?,?,?,?)')
    .run(when.toISOString(), localDay(when), m.mood ?? null, m.energy ?? null, m.stress ?? null, m.note ?? null);
  return Number(lastInsertRowid);
}

export function addJournal(db: Database.Database, body: string, when: Date = new Date()): number {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO journal_entry (written_at, local_day, body) VALUES (?,?,?)')
    .run(when.toISOString(), localDay(when), body);
  return Number(lastInsertRowid);
}

// ---------- money ----------
/**
 * Hand-rolled CSV import (date,amount,merchant[,category]). Idempotent via a
 * content hash per row; re-importing the same file inserts nothing new.
 */
export function importTransactionsCsv(
  db: Database.Database,
  csv: string,
  accountId: number | null = null,
): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO transaction_row (account_id, posted_on, amount, merchant, category, source, import_hash)
     VALUES (?,?,?,?,?, 'csv', ?)`,
  );
  const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
  const tx = db.transaction(() => {
    for (const line of lines) {
      if (/^date\s*,/i.test(line)) continue; // header
      const cols = splitCsvLine(line);
      if (cols.length < 3) { skipped++; continue; }
      const [date, amountRaw, merchant, category] = cols;
      const amount = Number(amountRaw!.replace(/[$,]/g, ''));
      if (!date || Number.isNaN(amount)) { skipped++; continue; }
      const hash = createHash('sha256').update(`${accountId}|${date}|${amount}|${merchant ?? ''}`).digest('hex');
      const r = stmt.run(accountId, date, amount, merchant ?? null, category ?? null, hash);
      if (r.changes > 0) inserted++;
      else skipped++;
    }
  });
  tx();
  return { inserted, skipped };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// ---------- life admin / social ----------
export function upsertTask(
  db: Database.Database,
  t: { id?: number; title: string; notes?: string; domain?: string; due_on?: string; recur_rule?: string; priority?: number; status?: 'open' | 'done' | 'snoozed' | 'cancelled' },
): number {
  if (t.id) {
    db.prepare(
      'UPDATE task SET title=?, notes=COALESCE(?,notes), domain=COALESCE(?,domain), due_on=COALESCE(?,due_on), recur_rule=COALESCE(?,recur_rule), priority=COALESCE(?,priority), status=COALESCE(?,status) WHERE id=?',
    ).run(t.title, t.notes ?? null, t.domain ?? null, t.due_on ?? null, t.recur_rule ?? null, t.priority ?? null, t.status ?? null, t.id);
    return t.id;
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO task (title, notes, domain, due_on, recur_rule, priority, status) VALUES (?,?,?,?,?,?,?)')
    .run(t.title, t.notes ?? null, t.domain ?? null, t.due_on ?? null, t.recur_rule ?? null, t.priority ?? 3, t.status ?? 'open');
  return Number(lastInsertRowid);
}

export function upsertContact(
  db: Database.Database,
  c: { name: string; relationship?: string; birthday?: string; keep_in_touch_days?: number; last_contacted_on?: string; gift_ideas?: string; notes?: string },
): number {
  const existing = db.prepare('SELECT id FROM contact WHERE lower(name) = lower(?)').get(c.name) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE contact SET relationship=COALESCE(?,relationship), birthday=COALESCE(?,birthday), keep_in_touch_days=COALESCE(?,keep_in_touch_days), last_contacted_on=COALESCE(?,last_contacted_on), gift_ideas=COALESCE(?,gift_ideas), notes=COALESCE(?,notes) WHERE id=?',
    ).run(c.relationship ?? null, c.birthday ?? null, c.keep_in_touch_days ?? null, c.last_contacted_on ?? null, c.gift_ideas ?? null, c.notes ?? null, existing.id);
    return existing.id;
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO contact (name, relationship, birthday, keep_in_touch_days, last_contacted_on, gift_ideas, notes) VALUES (?,?,?,?,?,?,?)')
    .run(c.name, c.relationship ?? null, c.birthday ?? null, c.keep_in_touch_days ?? null, c.last_contacted_on ?? null, c.gift_ideas ?? null, c.notes ?? null);
  return Number(lastInsertRowid);
}

export function addPriceWatch(db: Database.Database, w: { item: string; url?: string; target_price?: number }): number {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO price_watch (item, url, target_price) VALUES (?,?,?)')
    .run(w.item, w.url ?? null, w.target_price ?? null);
  return Number(lastInsertRowid);
}

// ---------- goals (bi-temporal: supersede, don't overwrite — mentorship item 4) ----------
export interface GoalPrior { id: number; target_value: number | null; unit: string | null; cadence: string | null }
export interface GoalUpsertResult { id: number; supersededPrevious: GoalPrior | null }

/**
 * Structured, machine-readable goals (target_value/unit/cadence) — the ones
 * a Vitals dial compares "today's number" against (see surfaces.ts's
 * goalTarget()). Deliberately distinct from GOALS.md, which stays
 * narrative/qualitative context for the prompt, not a number a dial tracks.
 *
 * "The same goal" = (domain, normalized title) — exact match, not fuzzy.
 * goalTarget()'s LIKE-based read is safe to be loose because the caller
 * controls the search term (surfaces.ts's own code); a WRITE that deactivates
 * a row must not risk silently superseding the wrong goal via substring
 * fuzziness (e.g. "bench 1RM" matching "bench 1RM warm-up").
 *
 * Bi-temporal history needs no new column: `created_at` (already on the
 * table) stamps when a row became the belief; the next row for the same
 * (domain, title) — if any — marks, by its own created_at, when it stopped
 * being one. No superseded_at needed unless that becomes a hot lookup.
 */
export function upsertGoal(
  db: Database.Database,
  g: { domain: string; title: string; target_value?: number; unit?: string; cadence?: string },
): GoalUpsertResult {
  if (g.target_value === undefined && g.cadence === undefined) {
    throw new Error('a goal needs at least a target_value or a cadence — an empty goal row tracks nothing');
  }
  const normalizedTitle = g.title.trim().toLowerCase();
  const run = db.transaction((): GoalUpsertResult => {
    const prior = db
      .prepare(`SELECT id, target_value, unit, cadence FROM goal WHERE active = 1 AND domain = ? AND lower(trim(title)) = ?`)
      .get(g.domain, normalizedTitle) as GoalPrior | undefined;
    if (prior) {
      db.prepare('UPDATE goal SET active = 0 WHERE id = ?').run(prior.id);
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO goal (title, domain, target_value, unit, cadence, active) VALUES (?,?,?,?,?,1)')
      .run(g.title, g.domain, g.target_value ?? null, g.unit ?? null, g.cadence ?? null);
    return { id: Number(lastInsertRowid), supersededPrevious: prior ?? null };
  });
  return run();
}
