/* ============================================================================
   Cabinet v2 surface endpoints — the server side of web/src/lib/contracts.ts.
   A5 froze the API; A11 fleshes today/domains/recall into real DB-backed
   reads from the domain tables (see src/db/migrations/001_init.sql). Ops and
   memory were already real. Mounted behind the owner auth wall by buildApp.

   Kept dependency-free of the web package on purpose (server build's rootDir
   is `src`, and the two apps ship independently) — the shapes below mirror
   web/src/lib/contracts.ts field-for-field; keep them in lockstep by hand.
   ========================================================================== */
import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';
import { dailyTotals } from '../domains/food.js';
import { weightTrend } from '../domains/training.js';
import { medicationsLow } from '../domains/healthcare.js';
import type { MessagePart } from './fold.js';
import type { MemoryHistoryEntry } from '../memory/index.js';

interface MemoryLike {
  list(): string[];
  read(file: string): string;
  update(file: string, content: string, reason: string): void;
  /** Optional: narrower test fakes predate this and have no reason to grow it — the real MemoryStore always implements it. */
  history?(file: string, limit?: number): MemoryHistoryEntry[];
}
export interface SurfaceDeps {
  db: Database.Database;
  memory?: MemoryLike;
  queueDepth?: () => number;
}

const REVERSIBLE = /write|edit|title|update|log_|add_|upsert|import|render|memory/i;

/* ---------- local mirrors of web/src/lib/contracts.ts (kept in lockstep by hand) ---------- */
type Severity = 'ok' | 'warn' | 'crit';
type Tone = 'default' | 'ok' | 'warn' | 'crit';

// Exported (not just a local mirror) — scheduler/jobs.ts's evening-checkin
// job builds its InstrumentSpec[] payload against this same shape, a
// type-only import with no runtime coupling, so Today's card renderer and
// the job that produces its data can never silently drift out of sync.
export type InstrumentSpec =
  | { kind: 'dial'; label: string; value: number; max: number; unit?: string; sub?: string; tag?: string; tagTone?: Severity }
  | { kind: 'rule'; label: string; readout: string; unit?: string; points?: number[]; markerPct?: number; tag?: string; tagTone?: Severity }
  | { kind: 'ring'; label: string; value: number; max: number; center?: string; sub?: string; tag?: string; tagTone?: Severity }
  | { kind: 'gauge'; label: string; value: number; max: number; threshold?: number; leftLabel?: string; rightLabel?: string; tag?: string; tagTone?: Severity }
  | { kind: 'stat'; label: string; big: string; unit?: string; sub?: string; tone?: Tone; points?: number[]; pointsColor?: string; tag?: string; tagTone?: Severity };

interface AttentionAction { label: string; intent: string; primary?: boolean; }
interface AttentionItem {
  id: string; severity: 'warn' | 'crit'; badge?: string;
  title: string; meta?: string; detail: string; actions: AttentionAction[];
}
interface OvernightNote { count: number; summary: string; }
interface LogEntry { id: string; at: string; text: string; meta?: string; }
interface BriefingOutput { at: string; isCurrent: boolean; narrative: string; }
interface CheckinOutput { at: string; isCurrent: boolean; vitals: InstrumentSpec[]; prompt: string; }

/* ---------- durable cron output (mentorship: Today surface, briefing/checkin durability) ----------
   morning-briefing and evening-checkin persist to well-known system chats
   (sys-briefing, sys-checkin — see scheduler/jobs.ts) instead of relying on
   a live SSE push nobody may be connected for. This is the one shared read
   path both latestBriefing/latestCheckin below build on — same discipline as
   runAgentCronJob being the one shared *write* path for agent-turn jobs. */

function latestAssistantMessage(db: Database.Database, chatId: string): { createdAt: string; parts: MessagePart[] } | null {
  const row = db
    .prepare(`SELECT parts, created_at FROM message WHERE chat_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`)
    .get(chatId) as { parts: string; created_at: string } | undefined;
  if (!row) return null;
  try {
    return { createdAt: row.created_at, parts: JSON.parse(row.parts) as MessagePart[] };
  } catch (err) {
    // Should never happen — we control every writer of this column — but a
    // malformed blob must not 500 the whole Today surface, and silence would
    // make it indistinguishable from "no briefing yet." Log enough to find it.
    console.warn(`latestAssistantMessage: unparseable parts for chat ${chatId}: ${(err as Error).message}`);
    return null;
  }
}

/** SQLite `datetime('now')` stamps are UTC "YYYY-MM-DD HH:MM:SS" — reparse as ISO before comparing/emitting. */
function toIso(sqliteUtc: string): string {
  return new Date(`${sqliteUtc.replace(' ', 'T')}Z`).toISOString();
}

function latestBriefing(db: Database.Database, today: string): BriefingOutput | null {
  const msg = latestAssistantMessage(db, 'sys-briefing');
  if (!msg) return null;
  const narrative = msg.parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .trim();
  if (!narrative) return null; // a turn that only called tools, no prose to lead with — treat as absent
  return { at: toIso(msg.createdAt), isCurrent: localDay(new Date(toIso(msg.createdAt))) === today, narrative };
}

function latestCheckin(db: Database.Database, today: string): CheckinOutput | null {
  const msg = latestAssistantMessage(db, 'sys-checkin');
  if (!msg) return null;
  const widget = msg.parts.find(
    (p): p is Extract<MessagePart, { type: 'widget' }> => p.type === 'widget' && p.widgetType === 'checkin',
  );
  const data = widget?.data as { vitals?: InstrumentSpec[]; prompt?: string } | undefined;
  if (!data?.vitals) return null;
  return { at: toIso(msg.createdAt), isCurrent: localDay(new Date(toIso(msg.createdAt))) === today, vitals: data.vitals, prompt: data.prompt ?? '' };
}

/* ---------- date helpers ---------- */
/** Monday-start ISO week for a 'YYYY-MM-DD' local_day. */
function startOfWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}
function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}
function formatClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}
function money(n: number): string {
  return `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}
function markerPctFor(points: number[], latest: number | null): number | undefined {
  if (points.length === 0 || latest === null) return undefined;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  return hi === lo ? 50 : Math.round(((latest - lo) / (hi - lo)) * 100);
}
/**
 * A goal's target_value by fuzzy title match — real-ish in the absence of a
 * stricter goal→metric link. Single-target lookup: Phase D build 3 made this
 * day-type-aware to fix Phase B FINDING 1 (two colliding calorie goals,
 * training/rest); build 4 reverted that when Ben's actual routine (heavy
 * lifts 2x/week, cardio every day) collapsed the training/rest binary and
 * the model simplified to one calorie target. There's exactly one active
 * calorie goal now, so the id-DESC collision FINDING 1 fixed is moot.
 */
export function goalTarget(db: Database.Database, domain: string, titleLike: string, fallback: number): number {
  const row = db
    .prepare(`SELECT target_value FROM goal WHERE active = 1 AND domain = ? AND lower(title) LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(domain, `%${titleLike}%`) as { target_value: number | null } | undefined;
  return row?.target_value ?? fallback;
}

/* ---------- today ---------- */
function todayView(db: Database.Database) {
  const today = localDay();
  const monthStart = startOfMonth(today);

  // Nutrition
  const totals = dailyTotals(db, today);
  const proteinTarget = goalTarget(db, 'nutrition', 'protein', 165);
  const kcalTarget = goalTarget(db, 'nutrition', 'calor', 2200);

  // Weight
  const wt = weightTrend(db, 7);
  const weightPoints = wt.points.map((p) => p.value);

  // Tasks
  const openTasks = db.prepare(`SELECT due_on FROM task WHERE status = 'open'`).all() as { due_on: string | null }[];
  const totalOpen = openTasks.length;
  const dueToday = openTasks.filter((t) => t.due_on === today).length;
  const overdue = openTasks.filter((t) => t.due_on !== null && t.due_on < today).length;

  // Money
  const monthTxns = db.prepare(`SELECT amount FROM transaction_row WHERE posted_on >= ? AND posted_on <= ?`).all(monthStart, today) as { amount: number }[];
  const inFlow = monthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outFlow = monthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = inFlow - outFlow;
  const dailyNet = db
    .prepare(`SELECT SUM(amount) net FROM transaction_row WHERE posted_on >= date(?, '-6 days') AND posted_on <= ? GROUP BY posted_on ORDER BY posted_on`)
    .all(today, today) as { net: number }[];
  const cashPoints = dailyNet.map((r) => Math.round(r.net));

  const vitals: InstrumentSpec[] = [
    {
      kind: 'dial', label: 'Nutrition · today',
      tag: totals.protein_g >= proteinTarget ? 'on track' : `${Math.round((totals.protein_g / proteinTarget) * 100)}%`,
      value: Math.round(totals.protein_g), max: Math.round(proteinTarget),
      unit: `/ ${Math.round(proteinTarget)} g protein`,
      sub: `${Math.round(totals.kcal)} / ${Math.round(kcalTarget)} kcal · ${totals.entries} meal${totals.entries === 1 ? '' : 's'}`,
    },
    {
      kind: 'rule', label: 'Weight · 7-day',
      tag: wt.weeklyDelta === null ? undefined : `${wt.weeklyDelta > 0 ? '+' : ''}${wt.weeklyDelta}`,
      readout: wt.latest === null ? '—' : String(wt.latest), unit: 'lb',
      points: weightPoints.length ? weightPoints : undefined,
      markerPct: markerPctFor(weightPoints, wt.latest),
    },
    {
      kind: 'ring', label: 'Tasks · due',
      tag: `${dueToday} today`, tagTone: overdue > 0 ? 'warn' : undefined,
      value: dueToday + overdue, max: Math.max(totalOpen, 1), center: String(dueToday + overdue),
      sub: overdue > 0 ? `${overdue} overdue` : undefined,
    },
    {
      kind: 'stat', label: 'Cash · month',
      tag: net >= 0 ? '+ flow' : '− flow',
      big: `${net >= 0 ? '+' : '-'}${money(net)}`, tone: net >= 0 ? 'ok' : 'warn',
      sub: `in ${money(inFlow)} · out ${money(outFlow)}`,
      points: cashPoints.length ? cashPoints : undefined, pointsColor: 'var(--patina)',
    },
  ];

  // Attention: real, from medications/budgets/tasks.
  const attention: AttentionItem[] = [];
  for (const m of medicationsLow(db, 7, today)) {
    const days = Math.max(m.daysLeft, 0);
    attention.push({
      id: `att-med-${m.name}`,
      severity: m.daysLeft <= 2 ? 'crit' : 'warn',
      badge: '℞',
      title: `${m.name} runs out in ${days} day${days === 1 ? '' : 's'}`,
      detail: `${days} day${days === 1 ? '' : 's'} of supply left. I can reorder on your say-so.`,
      actions: [
        { label: 'Reorder now', intent: `reorder ${m.name.toLowerCase()}`, primary: true },
        { label: 'Snooze', intent: `snooze ${m.name.toLowerCase()} refill` },
      ],
    });
  }
  const budgets = db.prepare(`SELECT category, monthly_limit FROM budget WHERE active = 1`).all() as { category: string; monthly_limit: number }[];
  for (const b of budgets) {
    const spent = (db.prepare(`SELECT COALESCE(SUM(-amount),0) s FROM transaction_row WHERE category = ? AND amount < 0 AND posted_on >= ?`).get(b.category, monthStart) as { s: number }).s;
    const pct = b.monthly_limit > 0 ? spent / b.monthly_limit : 0;
    if (pct >= 0.8) {
      const remaining = Math.max(0, b.monthly_limit - spent);
      attention.push({
        id: `att-budget-${b.category}`,
        severity: pct >= 1 ? 'crit' : 'warn',
        badge: '△',
        title: `${b.category} budget at ${Math.round(pct * 100)}%`,
        meta: `${money(remaining)} left`,
        detail: `Spent ${money(spent)} of ${money(b.monthly_limit)} this month.`,
        actions: [
          { label: 'Review spend', intent: `review ${b.category.toLowerCase()} spend` },
          { label: 'Let it ride', intent: `raise ${b.category.toLowerCase()} budget` },
        ],
      });
    }
  }
  if (overdue > 0 || dueToday > 0) {
    const due = db
      .prepare(`SELECT title FROM task WHERE status = 'open' AND due_on IS NOT NULL AND due_on <= ? ORDER BY due_on LIMIT 3`)
      .all(today) as { title: string }[];
    attention.push({
      id: 'att-tasks',
      severity: overdue > 0 ? 'crit' : 'warn',
      badge: '☐',
      title: overdue > 0 ? `${overdue} task${overdue === 1 ? '' : 's'} overdue` : `${dueToday} task${dueToday === 1 ? '' : 's'} due today`,
      meta: due.length ? due.map((t) => t.title).join(', ') : undefined,
      detail: due.length ? `Includes: ${due.map((t) => t.title).join('; ')}.` : 'Nothing named yet — check the admin board.',
      actions: [{ label: 'Review tasks', intent: 'review tasks' }],
    });
  }
  attention.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'crit' ? -1 : 1));

  const readParts: string[] = [
    `${Math.round(totals.protein_g)}g protein and ${Math.round(totals.kcal)} kcal logged today across ${totals.entries} meal${totals.entries === 1 ? '' : 's'}.`,
  ];
  if (wt.latest !== null) {
    readParts.push(`Weight ${wt.latest} lb${wt.weeklyDelta !== null ? `, ${wt.weeklyDelta > 0 ? '+' : ''}${wt.weeklyDelta} over 7 days` : ''}.`);
  }
  readParts.push(
    attention.length
      ? `${attention.length} item${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} a look.`
      : 'Nothing else needs a decision right now.',
  );

  const overnightRows = db
    .prepare(`SELECT tool, ts FROM action_audit WHERE session_kind IN ('cron','heartbeat') AND ts > datetime('now','-1 day') ORDER BY ts DESC`)
    .all() as { tool: string; ts: string }[];
  const overnight: OvernightNote | null = overnightRows.length
    ? { count: overnightRows.length, summary: `${[...new Set(overnightRows.map((r) => r.tool))].slice(0, 3).join(', ')}` }
    : null;

  return {
    greeting: 'Good morning, Ben.',
    greetingAccent: attention.some((a) => a.severity === 'crit') ? 'Needs a decision' : attention.length ? 'A few loose ends' : 'A quiet day',
    read: readParts.join(' '),
    attention,
    vitals,
    overnight,
    sweptAt: overnightRows[0]?.ts ? new Date(`${overnightRows[0].ts.replace(' ', 'T')}Z`).toISOString() : new Date().toISOString(),
    // The real morning-briefing/evening-checkin output, durable (see
    // latestBriefing/latestCheckin above) — greeting/read above stay as the
    // fallback the frontend renders only when these are null.
    briefing: latestBriefing(db, today),
    checkin: latestCheckin(db, today),
  };
}

/* ---------- domains ---------- */
const DOMAIN_LABELS: Record<string, string> = {
  nutrition: 'Nutrition', training: 'Training', health: 'Health',
  money: 'Money', admin: 'Admin', people: 'People', play: 'Play',
};

function domainView(id: string, db: Database.Database) {
  const label = DOMAIN_LABELS[id];
  if (!label) return null;
  const today = localDay();

  if (id === 'nutrition') {
    const totals = dailyTotals(db, today);
    const proteinTarget = goalTarget(db, 'nutrition', 'protein', 165);
    const kcalTarget = goalTarget(db, 'nutrition', 'calor', 2200);
    const wt = weightTrend(db, 30);
    const points = wt.points.map((p) => p.value);
    const instruments: InstrumentSpec[] = [
      {
        kind: 'dial', label: 'Protein · today',
        tag: totals.protein_g >= proteinTarget ? 'on track' : `${Math.round((totals.protein_g / proteinTarget) * 100)}%`,
        value: Math.round(totals.protein_g), max: Math.round(proteinTarget), unit: `/ ${Math.round(proteinTarget)} g`,
        sub: `${Math.round((totals.protein_g / proteinTarget) * 100)}% of target`,
      },
      {
        kind: 'gauge', label: 'Calories · today',
        value: Math.round(totals.kcal), max: Math.round(kcalTarget),
        leftLabel: `${Math.round((totals.kcal / kcalTarget) * 100)}%`,
        rightLabel: `${Math.max(0, Math.round(kcalTarget - totals.kcal))} left`,
      },
    ];
    if (points.length) instruments.push({ kind: 'rule', label: 'Weight · 30-day', readout: String(wt.latest), unit: 'lb', points, markerPct: markerPctFor(points, wt.latest) });
    const rows = db.prepare(`SELECT id, eaten_at, description, kcal, protein_g FROM food_log ORDER BY eaten_at DESC LIMIT 5`).all() as
      { id: number; eaten_at: string; description: string; kcal: number | null; protein_g: number | null }[];
    const log: LogEntry[] = rows.map((r) => ({
      id: String(r.id), at: formatClock(r.eaten_at), text: r.description,
      meta: r.protein_g !== null || r.kcal !== null ? `~${Math.round(r.protein_g ?? 0)} g · ${Math.round(r.kcal ?? 0)} kcal` : undefined,
    }));
    const narrative = totals.entries > 0
      ? `${Math.round(totals.protein_g)}g protein and ${Math.round(totals.kcal)} kcal logged today across ${totals.entries} meal${totals.entries === 1 ? '' : 's'}.${wt.weeklyDelta !== null ? ` Weight moved ${wt.weeklyDelta > 0 ? '+' : ''}${wt.weeklyDelta} lb over the trailing week.` : ''}`
      : 'No meals logged yet today.';
    return { id, label, instruments, narrative, log };
  }

  if (id === 'training') {
    const weekStart = startOfWeek(today);
    const sessionsThisWeek = (db.prepare(`SELECT COUNT(*) c FROM workout WHERE local_day >= ?`).get(weekStart) as { c: number }).c;
    const last = db.prepare(`SELECT id, name, local_day FROM workout ORDER BY performed_at DESC LIMIT 1`).get() as
      { id: number; name: string | null; local_day: string } | undefined;
    const instruments: InstrumentSpec[] = [
      { kind: 'ring', label: 'Sessions · week', tag: `${sessionsThisWeek} / 4`, value: sessionsThisWeek, max: 4, center: String(sessionsThisWeek) },
    ];
    let lastSets = 0;
    if (last) {
      lastSets = (db.prepare(`SELECT COUNT(*) c FROM workout_set WHERE workout_id = ?`).get(last.id) as { c: number }).c;
      instruments.push({ kind: 'stat', label: 'Last lift', big: last.name ?? 'Workout', sub: `${last.local_day} · ${lastSets} set${lastSets === 1 ? '' : 's'}` });
    }
    const rows = db
      .prepare(`SELECT w.id id, w.name name, w.local_day local_day, (SELECT COUNT(*) FROM workout_set s WHERE s.workout_id = w.id) sets FROM workout w ORDER BY w.performed_at DESC LIMIT 5`)
      .all() as { id: number; name: string | null; local_day: string; sets: number }[];
    const log: LogEntry[] = rows.map((r) => ({ id: String(r.id), at: r.local_day, text: r.name ?? 'Workout', meta: `${r.sets} set${r.sets === 1 ? '' : 's'}` }));
    const narrative = last
      ? `${sessionsThisWeek} session${sessionsThisWeek === 1 ? '' : 's'} this week. Last: ${last.name ?? 'workout'} on ${last.local_day}, ${lastSets} set${lastSets === 1 ? '' : 's'}.`
      : 'No workouts logged yet.';
    return { id, label, instruments, narrative, log };
  }

  if (id === 'health') {
    const low = medicationsLow(db, 14, today);
    const claimsPending = (db.prepare(`SELECT COALESCE(SUM(patient_owed),0) s FROM claim WHERE status IN ('submitted','processed')`).get() as { s: number }).s;
    const instruments: InstrumentSpec[] = [];
    if (low.length) {
      const soonest = low.reduce((a, b) => (a.daysLeft < b.daysLeft ? a : b));
      instruments.push({ kind: 'stat', label: 'Meds', big: String(low.length), unit: 'refill due', tone: soonest.daysLeft <= 3 ? 'crit' : 'warn', sub: `${soonest.name} · ${Math.max(soonest.daysLeft, 0)}d left` });
    } else {
      instruments.push({ kind: 'stat', label: 'Meds', big: '0', sub: 'nothing due soon', tone: 'ok' });
    }
    instruments.push({ kind: 'stat', label: 'Claims', big: money(claimsPending), sub: claimsPending > 0 ? 'pending' : 'nothing pending', tone: claimsPending > 0 ? 'warn' : 'ok' });
    const rows = db.prepare(`SELECT id, drawn_on, panel, analyte, value, unit, flag FROM lab_result ORDER BY drawn_on DESC LIMIT 5`).all() as
      { id: number; drawn_on: string; panel: string | null; analyte: string; value: number | null; unit: string | null; flag: string | null }[];
    const log: LogEntry[] = rows.map((r) => ({
      id: String(r.id), at: r.drawn_on,
      text: `${r.panel ? `${r.panel} — ` : ''}${r.analyte}${r.value !== null ? ` ${r.value}${r.unit ?? ''}` : ''}`,
      meta: r.flag ? `flag ${r.flag}` : undefined,
    }));
    const narrative = low.length
      ? `${low.map((m) => `${m.name} refill in ${Math.max(m.daysLeft, 0)}d`).join('; ')}.`
      : 'No medication refills due soon. No open claims pending.';
    return { id, label, instruments, narrative, log };
  }

  if (id === 'money') {
    const monthStart = startOfMonth(today);
    const monthTxns = db.prepare(`SELECT amount FROM transaction_row WHERE posted_on >= ?`).all(monthStart) as { amount: number }[];
    const inFlow = monthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const outFlow = monthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const net = inFlow - outFlow;
    const dailyNet = db
      .prepare(`SELECT SUM(amount) net FROM transaction_row WHERE posted_on >= date(?, '-6 days') AND posted_on <= ? GROUP BY posted_on ORDER BY posted_on`)
      .all(today, today) as { net: number }[];
    const points = dailyNet.map((r) => Math.round(r.net));
    const instruments: InstrumentSpec[] = [
      { kind: 'stat', label: 'Net · month', big: `${net >= 0 ? '+' : '-'}${money(net)}`, tone: net >= 0 ? 'ok' : 'warn', points: points.length ? points : undefined, pointsColor: 'var(--patina)' },
    ];
    const budgets = db.prepare(`SELECT category, monthly_limit FROM budget WHERE active = 1 ORDER BY category LIMIT 3`).all() as { category: string; monthly_limit: number }[];
    for (const b of budgets) {
      const spent = (db.prepare(`SELECT COALESCE(SUM(-amount),0) s FROM transaction_row WHERE category = ? AND amount < 0 AND posted_on >= ?`).get(b.category, monthStart) as { s: number }).s;
      const pct = b.monthly_limit > 0 ? spent / b.monthly_limit : 0;
      instruments.push({ kind: 'gauge', label: b.category, value: Math.round(spent), max: Math.round(b.monthly_limit), threshold: 0.9, leftLabel: `${Math.round(pct * 100)}%`, rightLabel: `${money(Math.max(0, b.monthly_limit - spent))} left` });
    }
    const rows = db.prepare(`SELECT id, posted_on, amount, merchant, category FROM transaction_row ORDER BY posted_on DESC, id DESC LIMIT 5`).all() as
      { id: number; posted_on: string; amount: number; merchant: string | null; category: string | null }[];
    const log: LogEntry[] = rows.map((r) => ({
      id: String(r.id), at: r.posted_on, text: r.merchant ?? r.category ?? 'Transaction',
      meta: `${r.amount >= 0 ? '+' : '-'}${money(r.amount)}${r.category ? ` · ${r.category}` : ''}`,
    }));
    const narrative = `Net cash flow this month is ${net >= 0 ? '+' : '-'}${money(net)} (in ${money(inFlow)}, out ${money(outFlow)}).${budgets.length ? ` ${budgets.length} active budget${budgets.length === 1 ? '' : 's'} tracked.` : ''}`;
    return { id, label, instruments, narrative, log };
  }

  if (id === 'admin') {
    const openRows = db.prepare(`SELECT id, title, due_on FROM task WHERE status = 'open'`).all() as { id: number; title: string; due_on: string | null }[];
    const totalOpen = openRows.length;
    const dueToday = openRows.filter((r) => r.due_on === today).length;
    const overdue = openRows.filter((r) => r.due_on !== null && r.due_on < today).length;
    const instruments: InstrumentSpec[] = [
      { kind: 'ring', label: 'Tasks · open', tag: overdue > 0 ? `${overdue} overdue` : `${dueToday} today`, tagTone: overdue > 0 ? 'warn' : undefined, value: totalOpen, max: Math.max(totalOpen, 1), center: String(totalOpen), sub: `${dueToday} due today` },
    ];
    const rows = db.prepare(`SELECT id, title, due_on FROM task WHERE status = 'open' ORDER BY (due_on IS NULL), due_on LIMIT 5`).all() as
      { id: number; title: string; due_on: string | null }[];
    const log: LogEntry[] = rows.map((r) => ({
      id: String(r.id),
      at: r.due_on === null ? 'No date' : r.due_on < today ? 'Overdue' : r.due_on === today ? 'Today' : r.due_on,
      text: r.title, meta: r.due_on ? `due ${r.due_on}` : undefined,
    }));
    const narrative = totalOpen > 0
      ? `${totalOpen} open task${totalOpen === 1 ? '' : 's'}, ${dueToday} due today${overdue > 0 ? `, ${overdue} overdue` : ''}.`
      : 'No open tasks.';
    return { id, label, instruments, narrative, log };
  }

  if (id === 'people') {
    const overdueRows = db
      .prepare(`SELECT id, name FROM contact WHERE keep_in_touch_days IS NOT NULL AND last_contacted_on IS NOT NULL AND julianday('now') - julianday(last_contacted_on) > keep_in_touch_days`)
      .all() as { id: number; name: string }[];
    const instruments: InstrumentSpec[] = [
      { kind: 'stat', label: 'Overdue touchpoints', big: String(overdueRows.length), tone: overdueRows.length ? 'warn' : 'ok', sub: overdueRows.length ? overdueRows.map((r) => r.name).slice(0, 3).join(' · ') : 'all caught up' },
    ];
    const rows = db.prepare(`SELECT id, name, last_contacted_on FROM contact ORDER BY (last_contacted_on IS NULL) DESC, last_contacted_on DESC LIMIT 5`).all() as
      { id: number; name: string; last_contacted_on: string | null }[];
    const log: LogEntry[] = rows.map((r) => ({ id: String(r.id), at: r.last_contacted_on ?? 'never', text: r.name, meta: r.last_contacted_on ? undefined : 'no contact on record' }));
    const narrative = overdueRows.length
      ? `${overdueRows.length} contact${overdueRows.length === 1 ? '' : 's'} overdue for a check-in: ${overdueRows.map((r) => r.name).join(', ')}.`
      : 'No overdue touchpoints.';
    return { id, label, instruments, narrative, log };
  }

  // play
  const counts = db.prepare(`SELECT status, COUNT(*) c FROM reading_item GROUP BY status`).all() as { status: string; c: number }[];
  const byStatus: Record<string, number> = { backlog: 0, reading: 0, done: 0 };
  for (const r of counts) byStatus[r.status] = r.c;
  const instruments: InstrumentSpec[] = [
    { kind: 'ring', label: 'Reading', value: byStatus.reading ?? 0, max: Math.max((byStatus.backlog ?? 0) + (byStatus.reading ?? 0), 1), center: String(byStatus.reading ?? 0), sub: `${byStatus.backlog ?? 0} backlog` },
  ];
  const rows = db.prepare(`SELECT id, title, author, status, added_on FROM reading_item ORDER BY added_on DESC LIMIT 5`).all() as
    { id: number; title: string; author: string | null; status: string; added_on: string | null }[];
  const log: LogEntry[] = rows.map((r) => ({ id: String(r.id), at: r.added_on ?? '', text: r.author ? `${r.title} — ${r.author}` : r.title, meta: r.status }));
  const total = (byStatus.backlog ?? 0) + (byStatus.reading ?? 0) + (byStatus.done ?? 0);
  const narrative = total > 0 ? `${byStatus.reading ?? 0} in progress, ${byStatus.backlog ?? 0} in backlog, ${byStatus.done ?? 0} finished.` : 'Nothing on the reading list yet.';
  return { id, label, instruments, narrative, log };
}

/* ---------- recall ---------- */
function recall(query: string, db: Database.Database) {
  const q = query.trim();
  if (!q) return { query, results: [] };
  const like = `%${q}%`;
  const journalRows = db
    .prepare(`SELECT id, local_day, body FROM journal_entry WHERE body LIKE ? ORDER BY written_at DESC LIMIT 5`)
    .all(like) as { id: number; local_day: string; body: string }[];
  const chatRows = db
    .prepare(`SELECT id, title, updated_at FROM chat WHERE title LIKE ? AND kind = 'user' ORDER BY updated_at DESC LIMIT 5`)
    .all(like) as { id: string; title: string | null; updated_at: string }[];

  const results = [
    ...journalRows.map((r, i) => ({
      source: 'episodic' as const,
      title: `Journal · ${r.local_day}`,
      snippet: r.body.length > 140 ? `${r.body.slice(0, 140)}…` : r.body,
      provenance: `journal · ${r.local_day}`,
      score: Math.max(0.5, 0.9 - i * 0.05),
      ref: `journal:${r.id}`,
    })),
    ...chatRows.map((r, i) => ({
      source: 'chat' as const,
      title: r.title ?? 'Untitled chat',
      snippet: `Chat updated ${r.updated_at}`,
      provenance: `chat · ${r.updated_at}`,
      score: Math.max(0.4, 0.85 - i * 0.05),
      ref: `chat:${r.id}`,
    })),
  ];
  results.sort((a, b) => b.score - a.score);
  return { query, results };
}

export function registerSurfaceRoutes(app: Express, deps: SurfaceDeps): void {
  const { db } = deps;

  app.get('/api/today', (_req: Request, res: Response) => res.json(todayView(db)));

  app.get('/api/domains/:domain', (req: Request, res: Response) => {
    const v = domainView(req.params.domain!, db);
    if (!v) return res.status(404).json({ error: 'no such domain' });
    res.json(v);
  });

  // Ops — REAL, from the audit trail.
  app.get('/api/ops', (req: Request, res: Response) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const rows = db
      .prepare(
        `SELECT id, ts, tool, tier, args, result, decision, chat_id, session_kind
         FROM action_audit ${kind ? 'WHERE session_kind = ?' : ''} ORDER BY id DESC LIMIT 200`,
      )
      .all(...(kind ? [kind] : [])) as Array<Record<string, unknown>>;
    const entries = rows.map((r) => ({
      id: String(r.id),
      at: String(r.ts),
      tool: String(r.tool),
      action: String(r.tool),
      reason: String(r.result ?? ''),
      tier: Number(r.tier ?? 4),
      kind: String(r.session_kind ?? 'user'),
      result: String(r.decision ?? ''),
      chatId: (r.chat_id as string) ?? null,
      reversible: REVERSIBLE.test(String(r.tool)),
      reverted: false,
    }));
    res.json({ entries });
  });

  app.post('/api/ops/:id/revert', (_req: Request, res: Response) => {
    // Real rollback (git/backup/audit-inverse) lands in A11; the contract is frozen.
    res.json({ ok: true });
  });

  // Memory — REAL, from the curated store when injected.
  app.get('/api/memory', (_req: Request, res: Response) => {
    if (!deps.memory) return res.json({ files: [], lessons: [] });
    const files = deps.memory.list()
      .filter((f) => !f.startsWith('domains/'))
      .map((name) => {
        // history() is the real paper trail (mentorship: item 5) — a diff is
        // one read away here instead of an SSH session. updatedAt used to be
        // hardcoded null (a permanent "never edited" lie in the Brain UI for
        // files that plainly had been); it's the latest commit's date now.
        const history = deps.memory!.history?.(name) ?? [];
        return {
          name,
          content: deps.memory!.read(name),
          updatedAt: history[0]?.at ?? null,
          editable: name !== 'STANDING_ORDERS.md',
          history,
        };
      });
    res.json({ files, lessons: [] });
  });

  app.put('/api/memory/:name', (req: Request, res: Response) => {
    const content = (req.body as { content?: string })?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    if (!deps.memory) return res.status(503).json({ error: 'memory store unavailable' });
    try {
      deps.memory.update(req.params.name!, content, 'edited via Brain surface');
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get('/api/recall', (req: Request, res: Response) => {
    res.json(recall(typeof req.query.q === 'string' ? req.query.q : '', db));
  });

  app.post('/api/command', (req: Request, res: Response) => {
    const intent = (req.body as { intent?: string })?.intent;
    if (typeof intent !== 'string' || !intent.trim()) return res.status(400).json({ error: 'intent required' });
    const id = randomUUID();
    const by = (req as { principal?: { email?: string } }).principal?.email ?? null;
    db.prepare('INSERT INTO chat (id, title, kind, created_by) VALUES (?,?,?,?)').run(id, null, 'user', by);
    res.status(201).json({ chatId: id });
  });
}
