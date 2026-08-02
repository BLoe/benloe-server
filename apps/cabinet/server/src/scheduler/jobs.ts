import type Database from 'better-sqlite3';
import type { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { localDay } from '../db/index.js';
import { medicationsLow } from '../domains/healthcare.js';
import { weightTrend } from '../domains/training.js';
import { dailyTotals } from '../domains/food.js';
import type { AgentRuntime } from '../runtime/agent.js';
import type { ApprovalQueue } from '../tiers/approvals.js';
import { EMBEDDABLE_TABLES, type EpisodicStore } from '../episodic/index.js';
import type { Embedder } from '../embeddings/index.js';
import { persistAssistantMessage, runAgentCronJob, systemChat } from '../gateway/transcript.js';
import type { InstrumentSpec } from '../gateway/surfaces.js';
import { substanceNights } from '../domains/substances.js';
import { recentHealth } from '../domains/health.js';
import { adherence, deriveHabits, deriveHabitsRange } from '../domains/adherence.js';
import { cravingsOn } from '../domains/cravings.js';
import { ankleLoadResponse } from '../domains/symptoms.js';
import { nextDaily, nextHeartbeat, nextWeekly, nyParts } from './clock.js';
import type { JobSpec } from './index.js';

export interface JobDeps {
  db: Database.Database;
  runtime: Pick<AgentRuntime, 'run'>;
  approvals: ApprovalQueue;
  widgetBus: EventEmitter;
  episodic: EpisodicStore;
  embedder: Embedder;
  dataDir: string;
  /**
   * Web push. Optional so tests and any future headless composition don't have
   * to stand one up — but in production its absence is the difference between
   * RHYTHM's schedule existing and RHYTHM's schedule happening.
   */
  pushService?: { send(msg: { kind: string; title: string; body: string; tag?: string; url?: string; silent?: boolean }): Promise<unknown> };
  /**
   * Plaid. Optional for the same reason pushService is — tests compose JobDeps
   * by hand — and its absence simply means the money-sync job isn't armed.
   */
  plaid?: {
    configured(): boolean;
    syncAll(): Promise<{ reports: unknown[]; net_worth: unknown }>;
  };
}

const push = (deps: JobDeps, event: string, data: unknown) => deps.widgetBus.emit('push', { event, data });

/**
 * Send a notification to Ben's devices, and never let a delivery failure take
 * down the job that was trying to send it. Fire-and-forget by design: a job's
 * real work (writing the briefing, logging the check-in) has already happened
 * by the time this runs, and blocking on a push service's latency would be
 * backwards.
 */
function notify(deps: JobDeps, msg: { kind: string; title: string; body: string; tag?: string; url?: string; silent?: boolean }): void {
  void deps.pushService?.send(msg)?.catch(() => {
    /* push/index.ts already records the failure in push_delivery */
  });
}

/**
 * The RHYTHM slots (RHYTHM.md, 2026-08-01). These are the load-bearing ones:
 * plans/health.md calls the 3:30 protein snack "the late-spike defuser" and
 * PLAYBOOK P4 says the evening war is won at 2pm, not 10pm. Each is a
 * deliberately cheap, model-free push — the point is that the appointment
 * arrives on time, not that Cabinet composes something clever about it.
 * Anything needing judgment belongs in the morning brief, which Ben reads.
 *
 * Times are NY wall clock and DST-safe via nextDaily (scheduler/clock.ts).
 */
const RHYTHM_PINGS: { name: string; hh: number; mm: number; title: string; body: string; silent?: boolean }[] = [
  {
    name: 'ping-afternoon-snack',
    hh: 15, mm: 30,
    title: 'Protein snack',
    body: "3:30. This is the one that defuses tonight — don't skip it.",
  },
  {
    name: 'ping-evening-block',
    hh: 19, mm: 30,
    title: "Tonight's block",
    body: 'Block starts now, before the craving window — not after.',
  },
  {
    name: 'ping-wind-down',
    hh: 22, mm: 30,
    title: 'Wind-down',
    body: 'Screens off. Ten minutes of stretching, then the book.',
    // Deliberately quiet: a wind-down ping that jolts is self-defeating.
    silent: true,
  },
];

/**
 * Ben's actual week (RHYTHM.md, confirmed by Ben 2026-08-01), indexed by
 * day-of-week so the morning brief can state the day's real shape instead of
 * asking him what's on. These are FIXED facts about his calendar, not
 * suggestions — the brief reads them out; it does not re-decide them.
 *
 * Kept here rather than in the prompt text because a cron prompt is a string
 * the model can drift from, while a snapshot field is data it was told to
 * quote verbatim.
 */
const DAY_ANCHORS: Record<number, string[]> = {
  0: ['Unstructured by default — weekend design is the open gap', 'Weekly review this evening'],
  1: ['WFH', 'Darts league in the evening (protected, social, out of the apartment)'],
  2: ['Office, 10 E 40th', 'Leaves ~5:30 and WALKS 40th → 27th to Emanuel — real ankle load right before lifting', 'Trainer ~5:45pm'],
  3: ['WFH — deep-work day, few meetings', 'NO evening anchor: structurally the worst night of the week, first target for evening design'],
  4: ['Office, 10 E 40th (sometimes skipped when tired)', 'Kickball at Heckscher Fields, bar after, Citi Bike home with Zach — social-night variant by default'],
  5: ['WFH', 'Trainer 9am on 27th', 'Tompkins Sq. Bagels after — protected ritual, budget around it, never target it'],
  6: ['Unstructured by default — weekend design is the open gap'],
};

/**
 * Soft usage-budget alert (v1: simple absolute threshold).
 *
 * Metric = input_tokens + output_tokens + cache_write, summed over the
 * trailing 5h window (the window Max plan rate limits actually gate on).
 * cache_read is deliberately excluded: on a cache-healthy chat it's the
 * biggest number by far (tens of thousands of tokens per turn just from
 * re-reading a stable system-prompt prefix) but reflects reused, not fresh,
 * work — folding it in would make a long, cheap, perfectly healthy chat
 * look like a runaway session and drown the signal in noise.
 *
 * Default threshold (500k/5h) is a deliberately generous "you're really
 * leaning on it" backstop, not a measured cap — Anthropic doesn't publish
 * exact Max-plan token limits, so there's no authoritative number to encode.
 * Tune via CABINET_USAGE_ALERT_TOKENS once real 429 behavior gives a signal;
 * set to 0 to disable.
 *
 * v2 (not built here): an anomaly-relative trigger — e.g. "this 5h window
 * is Nx the 7-day-median 5h window" — would adapt automatically instead of
 * requiring a hand-tuned constant. Worth it once there's enough history to
 * compute a meaningful median.
 */
const USAGE_ALERT_TOOL = 'usage-budget-alert';

function checkUsageBudget(deps: JobDeps): void {
  const threshold = Number(process.env.CABINET_USAGE_ALERT_TOKENS ?? 500_000);
  if (!(threshold > 0)) return; // 0 or unset-to-non-positive disables the check

  const row = deps.db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0) + COALESCE(SUM(cache_write),0) AS total
       FROM token_usage WHERE ts > datetime('now','-5 hours')`,
    )
    .get() as { total: number };
  if (row.total < threshold) return;

  // Debounce: fire once per rolling window, not once per heartbeat (every 30m).
  const alreadyAlerted = deps.db
    .prepare(`SELECT 1 FROM action_audit WHERE tool = ? AND ts > datetime('now','-5 hours') LIMIT 1`)
    .get(USAGE_ALERT_TOOL);
  if (alreadyAlerted) return;

  deps.db
    .prepare("INSERT INTO action_audit (tool, decision, session_kind) VALUES (?, 'ALERTED', 'heartbeat')")
    .run(USAGE_ALERT_TOOL);
  push(deps, 'notice', {
    level: 'warn',
    text: `Usage is running hot: ${row.total.toLocaleString()} tokens in the last 5h (threshold ${threshold.toLocaleString()}). Worth a look before you hit a wall.`,
    source: 'usage',
  });
}

/**
 * Deterministic pre-check (§11): most heartbeats resolve without any model
 * call at all — the checklist is SQL. Only real findings wake Haiku.
 */
export function heartbeatFindings(db: Database.Database, today = localDay()): string[] {
  const findings: string[] = [];
  const expiring = db
    .prepare("SELECT name, expires_on FROM pantry_item WHERE expires_on IS NOT NULL AND expires_on <= date(?, '+3 days') AND COALESCE(quantity,1) > 0")
    .all(today) as { name: string; expires_on: string }[];
  for (const e of expiring) findings.push(`pantry: ${e.name} expires ${e.expires_on}`);
  for (const m of medicationsLow(db, 5, today)) findings.push(`medication: ${m.name} has ~${m.daysLeft} days left`);
  const due = db
    .prepare("SELECT title, due_on FROM task WHERE status = 'open' AND due_on IS NOT NULL AND due_on <= ?")
    .all(today) as { title: string; due_on: string }[];
  for (const t of due) findings.push(`task due: ${t.title} (${t.due_on})`);
  const watches = db
    .prepare('SELECT item, last_price, target_price FROM price_watch WHERE active = 1 AND last_price IS NOT NULL AND target_price IS NOT NULL AND last_price <= target_price')
    .all() as { item: string; last_price: number; target_price: number }[];
  for (const w of watches) findings.push(`price hit: ${w.item} at $${w.last_price} (target $${w.target_price})`);
  return findings;
}

export function buildJobs(deps: JobDeps): JobSpec[] {
  const { db } = deps;

  const heartbeat: JobSpec = {
    name: 'heartbeat',
    next: (from) => nextHeartbeat(30, from),
    run: async () => {
      checkUsageBudget(deps); // SQL-only, zero model cost — runs every tick regardless of findings
      const findings = heartbeatFindings(db);
      if (findings.length === 0) {
        db.prepare("INSERT INTO action_audit (tool, decision, session_kind) VALUES ('heartbeat','HEARTBEAT_OK','heartbeat')").run();
        return; // zero model cost
      }
      const chatId = systemChat(db, 'sys-heartbeat', 'heartbeat', 'Heartbeat');
      const { text } = await runAgentCronJob(deps.runtime, db, {
        chatId,
        kind: 'heartbeat',
        prompt: 'Work through HEARTBEAT.md against the findings in your snapshot. If anything needs Ben, write one short nudge. If not, reply HEARTBEAT_OK.',
        promptInput: { snapshot: findings.join('\n') },
      });
      if (!text.includes('HEARTBEAT_OK') && text) {
        push(deps, 'notice', { level: 'info', text: text.slice(0, 500), source: 'heartbeat' });
      }
    },
  };

  /**
   * The brief is WRITTEN at 06:30 and ANNOUNCED later, deliberately.
   *
   * Until tonight this job pushed an alerting notification at 06:30. Ben woke
   * at 09:03 on 2026-08-01; RHYTHM's wording is "brief waiting at wake," which
   * is not the same thing as a phone buzzing two and a half hours before he
   * opens his eyes. A system whose first act of the day is to wake him early
   * and then ask him to rate his restfulness is measuring its own interference.
   *
   * So: generate early, so it is genuinely waiting whenever he surfaces; alert
   * separately, at an hour he is plausibly already awake (`morning-nudge`).
   */
  const briefing: JobSpec = {
    name: 'morning-briefing',
    next: (from) => nextDaily(6, 30, from),
    run: async () => {
      const today = localDay();
      const yesterday = localDay(new Date(Date.now() - 86_400_000));
      const dow = nyParts(new Date()).dow;

      // Derive yesterday's habits before reading adherence, so anything logged
      // late last night counts toward the streak Ben sees this morning.
      deriveHabits(db, yesterday);
      deriveHabits(db, today);

      const assembly = {
        date: today,
        weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow],
        anchors: DAY_ANCHORS[dow] ?? [],
        weightTrend: weightTrend(db, 30),
        yesterdayMacros: dailyTotals(db, yesterday),
        lastNight: substanceNights(db, 2)[0] ?? null,
        health: recentHealth(db, 3),
        ankle: ankleLoadResponse(db, 3),
        adherence: adherence(db, 7),
        cravingsYesterday: cravingsOn(db, yesterday).length,
        plannedMeals: db
          .prepare(
            `SELECT m.meal, COALESCE(r.title, m.ad_hoc_description) AS title, m.status
               FROM meal_plan_entry m LEFT JOIN recipe r ON r.id = m.recipe_id
              WHERE m.local_day = ? ORDER BY m.meal`,
          )
          .all(today),
        plannedActivity: db
          .prepare('SELECT kind, title, is_anchor, status FROM activity_plan_entry WHERE local_day = ? ORDER BY is_anchor DESC, id')
          .all(today),
        pantryStaples: db
          .prepare("SELECT name, location FROM pantry_item WHERE COALESCE(quantity, 1) > 0 ORDER BY is_staple DESC, name LIMIT 60")
          .all(),
        medsLow: medicationsLow(db),
        tasksToday: db.prepare("SELECT title, due_on, priority FROM task WHERE status='open' AND (due_on IS NULL OR due_on <= ?) ORDER BY priority LIMIT 5").all(today),
        pendingApprovals: deps.approvals.pending().length,
      };

      const chatId = systemChat(db, 'sys-briefing', 'cron', 'Briefings');
      await runAgentCronJob(deps.runtime, db, {
        chatId,
        kind: 'cron',
        // RHYTHM specifies this brief's SEQUENCE, and the old prompt ("assemble
        // a briefing, 2-3 sentences") produced none of it — no call to action,
        // no named breakfast, no named evening block. Those three are the
        // entire mechanism: PLAYBOOK P1 says Ben executes appointments and not
        // intentions, and TUNING E4 says a block chosen at the morning brief
        // survives while one chosen at 6pm does not. A brief that reports
        // numbers and stops is a dashboard, not scaffolding.
        prompt: [
          'Write the morning brief. RHYTHM.md fixes the order; follow it exactly and do not reorder or drop steps.',
          '',
          '1. WEIGH-IN + MOOD PROMPT. Open by asking for this morning\'s weight and a mood/restfulness read. One line.',
          '2. THE DAY, COMPRESSED. Trend line vs. band, today\'s anchors (in `anchors`), what is already on the calendar. Numbers verbatim from the snapshot — never invent one.',
          '3. TONIGHT, ALREADY DECIDED. Name ONE dinner and ONE evening block, as decisions already made, not options. Use `plannedMeals`/`plannedActivity` if populated; otherwise CHOOSE them yourself from `pantryStaples` and the day\'s anchors and state the choice flatly. A menu here is a failure — the charter\'s prime directive is to remove decisions, and E4 says a block named now survives while one named at 6pm dies.',
          '4. THE CALL TO ACTION. One direct imperative line: up now, ten minutes of floor work, timer framing. This ends the scroll and it is the single most load-bearing line in the brief. Never soften it into an invitation.',
          '5. BREAKFAST, NAMED. Protein-forward, from what is actually in `pantryStaples`. No decision left for Ben.',
          '',
          'Then call mcp__cabinet__render_widget with widgetType "briefing" and a sectioned payload carrying the same content.',
          '',
          'Constraints: Phase 0 has NO calorie or protein target — report intake as observation, never as a percentage of a target you invented. Ben cooks on a poor electric stove; prefer the Instant Pot and air fryer. He likes heat, dislikes yellow mustard and pickles, and would pick fish last. If `adherence` shows a goal with unmeasured=true, that means nobody wrote it down — do NOT report it as a miss.',
        ].join('\n'),
        promptInput: { snapshot: JSON.stringify(assembly) },
      });
      push(deps, 'notice', { level: 'info', text: 'Morning briefing ready.', source: 'briefing' });
    },
  };

  /**
   * The alerting half of the morning brief.
   *
   * Later on weekends, because Ben's weekends are unstructured by his own
   * account and an 8am buzz on a Saturday buys nothing. Skipped entirely once
   * a weight is already logged — he is demonstrably up and the ping would be
   * pure noise, and a notification that fires when it has nothing to add is
   * how a channel gets muted.
   */
  const morningNudge: JobSpec = {
    name: 'morning-nudge',
    next: (from) => {
      const weekday = nextDaily(8, 0, from);
      const weekend = nextDaily(9, 30, from);
      // Pick whichever of the two lands on the correct kind of day first.
      const isWeekend = (d: Date) => [0, 6].includes(nyParts(d).dow);
      return isWeekend(weekday) ? weekend : weekday;
    },
    run: async () => {
      const today = localDay();
      const weighed = db
        .prepare("SELECT 1 FROM body_metric WHERE local_day = ? AND lower(metric) LIKE '%weight%' LIMIT 1")
        .get(today);
      if (weighed) return;
      notify(deps, {
        kind: 'briefing',
        title: 'Morning',
        body: "Brief's waiting — weight, the day's shape, tonight's block.",
        tag: 'cabinet-briefing',
      });
    },
  };

  const checkin: JobSpec = {
    name: 'evening-checkin',
    next: (from) => nextDaily(20, 30, from),
    run: async () => {
      const totals = dailyTotals(db);
      const vitals: InstrumentSpec[] = [
        {
          kind: 'stat', label: 'Protein · tonight',
          big: String(Math.round(totals.protein_g)), unit: 'g',
          sub: `${Math.round(totals.kcal)} kcal · ${totals.entries} meal${totals.entries === 1 ? '' : 's'}`,
        },
      ];
      // The check-in is the ONLY collection point for the three things no
      // query can see: the evening ankle reading, whether tonight's block
      // actually started, and whether Ben left the apartment. Goals 4/5/6 are
      // unscoreable without them, and the ankle number is what turns the step
      // count from a dose into a dose-response. Asking for them here costs one
      // extra line; not asking costs the entire measurement.
      const prompt =
        'How was today? Tap mood / energy / stress — then one line back: ankle out of 10, did tonight\'s block start, were you out of the apartment.';
      const payload = { vitals, prompt };
      // Durable write (mentorship: Today surface, briefing/checkin durability)
      // — no agent turn here on purpose (deliberately cheap, SQL-only, same
      // spirit as heartbeat's zero-model-cost path), so this goes straight to
      // the message table instead of through runAgentCronJob. Same INSERT
      // persistAssistantMessage every other path uses, not a second one.
      const chatId = systemChat(db, 'sys-checkin', 'cron', 'Evening check-in');
      persistAssistantMessage(db, chatId, [{ type: 'widget', widgetType: 'checkin', data: payload }]);
      // Ephemeral live push, unchanged in spirit — kept for a future SSE
      // consumer; the durable write above is what actually closes the gap.
      push(deps, 'widget', payload);
      notify(deps, {
        kind: 'checkin',
        title: 'Check-in',
        body: `${Math.round(totals.protein_g)}g protein today. How did it go?`,
        tag: 'cabinet-checkin',
      });
    },
  };

  const weekly: JobSpec = {
    name: 'weekly-review',
    // Sunday 19:30 NY. RHYTHM.md puts the weekly review on Sunday EVENING —
    // it is the week's finish line (PLAYBOOK P3), and it sets the headline
    // target for the week that starts the next morning. Firing it at 09:00
    // reviewed a Sunday that hadn't happened yet and landed the plan for the
    // week ten hours before Ben would act on it. 19:30 puts it after dinner,
    // at the head of the main block, with Monday still ahead of him.
    next: (from) => nextWeekly(0, 19, 30, from),
    run: async () => {
      const chatId = systemChat(db, 'sys-weekly', 'cron', 'Weekly review');
      const prompt = [
        'Run the weekly review (§11):',
        '1. Use mcp__cabinet__query_db for cross-domain correlations (sleep×mood, protein×training days, spend by category, weight trend).',
        '2. Goal progress against GOALS.md.',
        '3. Rewrite each domains/*.md narrative you have new signal for via mcp__cabinet__update_memory (curated, ≤200 lines).',
        '4. Reflection pass: candidate lessons via mcp__cabinet__add_lesson (evidence + confidence required; escalations will be rejected).',
        '5. Promotion pass: call mcp__cabinet__list_promotable_lessons. For each one, decide its destination — domain "platform" goes in PLATFORM.md, ' +
          'every other domain (including a missing one — use judgment on the lesson\'s content to place it) goes in PREFERENCES.md. Read the target ' +
          'file first and merge/de-duplicate against what\'s already there rather than blindly appending — you may reword or combine lessons into the ' +
          "existing prose. Write via mcp__cabinet__update_memory, then call mcp__cabinet__promote_lesson only after that write succeeds. If none are " +
          'eligible, say so and do nothing — do not lower the bar to manufacture a promotion.',
        '6. Finish with a render_widget briefing card summarizing the week and 3 focus points.',
      ].join('\n');
      await runAgentCronJob(deps.runtime, db, { chatId, kind: 'cron', deep: true, prompt });
      push(deps, 'notice', { level: 'info', text: 'Weekly review complete.', source: 'weekly' });
      notify(deps, {
        kind: 'weekly',
        title: 'Weekly review',
        body: "The week's read is up. This is the finish line — worth ten minutes.",
        tag: 'cabinet-weekly',
      });
    },
  };

  const maintenance: JobSpec = {
    name: 'maintenance',
    next: (from) => nextDaily(3, 0, from),
    // Return (not discard) the result — Scheduler.lastResult carries it onto
    // /api/healthz.jobs.maintenance.lastResult so "ran, produced backups" and
    // "ran, produced nothing" read as distinct states instead of both
    // collapsing into a bare successful lastRun timestamp.
    run: () => runMaintenance(deps),
  };

  // RHYTHM's fixed slots, each its own JobSpec so the scheduler's own health
  // surface reports them individually — a ping that silently stopped firing
  // should be visible as one dead job, not hidden inside a composite.
  const rhythmPings: JobSpec[] = RHYTHM_PINGS.map((p) => ({
    name: p.name,
    next: (from) => nextDaily(p.hh, p.mm, from),
    run: async () => {
      notify(deps, { kind: p.name, title: p.title, body: p.body, tag: p.name, silent: p.silent });
    },
  }));

  /**
   * Nightly money sync, 04:30.
   *
   * Timing is deliberate: after maintenance's 03:00 backup (so a bad sync
   * can't land in a snapshot before there's a clean copy of the night before)
   * and well before the 06:30 morning brief, so the brief reads fresh
   * balances. Banks also post overnight, which is why this isn't at midnight.
   *
   * Costs zero model tokens — plain HTTP and SQL, no agent turn. The webhook
   * already keeps transactions near-live; this job exists to catch what
   * webhooks miss (an institution that doesn't send them, a webhook dropped
   * while the server was down) and to write the daily net-worth row, which is
   * what turns a balance into a trend.
   */
  const moneySync: JobSpec = {
    name: 'money-sync',
    next: (from) => nextDaily(4, 30, from),
    run: async () => {
      if (!deps.plaid?.configured()) return { skipped: 'plaid not configured' };
      return deps.plaid.syncAll();
    },
  };

  return [heartbeat, briefing, morningNudge, checkin, weekly, maintenance, moneySync, ...rhythmPings];
}

/** 03:00 job (§11): backups, WAL checkpoint, embedding backfill, approval sweep, rotation. */
export async function runMaintenance(deps: JobDeps): Promise<{ backups: string[]; backfilled: number; expired: number }> {
  const { db, dataDir } = deps;
  const stamp = localDay();
  const backupDir = join(dataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });

  const backups: string[] = [];
  for (const name of ['cabinet.db', 'episodic.db']) {
    const src = join(dataDir, name);
    if (!existsSync(src)) continue;
    const dest = join(backupDir, `${stamp}-${name}`);
    // sqlite online backup via the CLI keeps us independent of connection state
    execFileSync('sqlite3', [src, `.backup '${dest}'`]);
    backups.push(dest);
  }
  db.pragma('wal_checkpoint(TRUNCATE)');

  // Optional encryption: gpg symmetric when a passphrase is configured.
  const pass = process.env.CABINET_BACKUP_PASSPHRASE;
  if (pass) {
    for (const f of [...backups]) {
      execFileSync('gpg', ['--batch', '--yes', '--symmetric', '--cipher-algo', 'AES256', '--passphrase', pass, f]);
      rmSync(f);
      backups[backups.indexOf(f)] = `${f}.gpg`;
    }
  }

  // A run that completes without throwing but ships zero backups (e.g. both
  // dataDir/{cabinet.db,episodic.db} were missing) must not look identical to
  // a healthy night on healthz — that's the exact "well-designed house, no
  // one living in it" gap this pass exists to close. This action_audit row is
  // the persisted half of the signal (survives a process restart, unlike
  // Scheduler.lastResult, which is in-memory only); the console.warn is the
  // immediate paper trail, same pattern as the backfill catch below.
  if (backups.length === 0) {
    console.warn(`maintenance: zero backups produced (dataDir=${dataDir})`);
    db.prepare("INSERT INTO action_audit (tool, decision, session_kind) VALUES ('maintenance-zero-backups','WARNED','cron')").run();
  }

  // Re-derive habit marks across the trailing fortnight.
  //
  // Derivation is idempotent, so this is cheap; the reason it runs nightly is
  // LATE-LANDING DATA. The Apple Health Shortcut fires at 23:45, a forgotten
  // meal gets logged the next morning, a weight gets backdated after a trip.
  // Any of those should retroactively count toward the day they belong to, and
  // without a sweep the only derivation that ever ran was the one at the
  // moment of the morning brief — permanently missing everything that arrived
  // afterward, which on the health-ingest path is nearly everything.
  deriveHabitsRange(db, 14);

  // Rotation: keep the newest 30 daily backups per database file.
  for (const name of ['cabinet.db', 'episodic.db']) {
    const files = readdirSync(backupDir).filter((f) => f.includes(name)).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - 30))) rmSync(join(backupDir, stale));
  }

  // Embedding backfill for rows that missed indexing (§14). Loops over every
  // table in EMBEDDABLE_TABLES so a new embedding domain needs one registry
  // entry there, not a new copy of this loop. `extract` (when present) can
  // return null to mean "looked at, not worth indexing" (too short, or a
  // parse failure) — flagged done either way so it's never rescanned forever.
  let backfilled = 0;
  for (const t of EMBEDDABLE_TABLES) {
    const where = t.where ? ` AND ${t.where}` : '';
    const pending = db
      .prepare(`SELECT id, ${t.textColumn} AS text FROM ${t.table} WHERE ${t.flagColumn} = 0${where} LIMIT 50`)
      .all() as { id: number; text: string }[];
    for (const row of pending) {
      const text = t.extract ? t.extract(row.text) : row.text;
      if (text === null) {
        db.prepare(`UPDATE ${t.table} SET ${t.flagColumn} = 1 WHERE id = ?`).run(row.id);
        continue; // skip-but-flag: not an error, just nothing worth a vector
      }
      try {
        await deps.episodic.indexText(deps.embedder, t.kind, t.sourceRef(row.id), null, text);
        db.prepare(`UPDATE ${t.table} SET ${t.flagColumn} = 1 WHERE id = ?`).run(row.id);
        backfilled++;
      } catch (err) {
        // Embedder down mid-backfill: must not fail silently — this warn is
        // the paper trail between now and tomorrow's retry.
        console.warn(`backfill: embed failed for ${t.table} id=${row.id}: ${(err as Error).message}`);
        break; // stop this table's batch — try again tomorrow
      }
    }
  }

  const expired = deps.approvals.expireOverdue();
  return { backups, backfilled, expired };
}
