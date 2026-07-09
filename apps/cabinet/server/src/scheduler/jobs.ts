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
import { runAgentCronJob } from '../gateway/transcript.js';
import { nextDaily, nextHeartbeat, nextWeekly } from './clock.js';
import type { JobSpec } from './index.js';

export interface JobDeps {
  db: Database.Database;
  runtime: Pick<AgentRuntime, 'run'>;
  approvals: ApprovalQueue;
  widgetBus: EventEmitter;
  episodic: EpisodicStore;
  embedder: Embedder;
  dataDir: string;
}

const push = (deps: JobDeps, event: string, data: unknown) => deps.widgetBus.emit('push', { event, data });

/**
 * Soft usage-budget alert (v1: simple absolute threshold).
 *
 * Metric = input_tokens + output_tokens + cache_write, summed over the
 * trailing 5h window (the window Max plan rate limits actually gate on).
 * cache_read is deliberately excluded: on a cache-healthy thread it's the
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

/** Get-or-create the singleton system thread for a scheduled job kind. */
function systemThread(db: Database.Database, id: string, kind: 'heartbeat' | 'cron', title: string): string {
  db.prepare('INSERT OR IGNORE INTO thread (id, title, kind) VALUES (?,?,?)').run(id, title, kind);
  return id;
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
      const threadId = systemThread(db, 'sys-heartbeat', 'heartbeat', 'Heartbeat');
      const { text } = await runAgentCronJob(deps.runtime, db, {
        threadId,
        kind: 'heartbeat',
        prompt: 'Work through HEARTBEAT.md against the findings in your snapshot. If anything needs Ben, write one short nudge. If not, reply HEARTBEAT_OK.',
        promptInput: { snapshot: findings.join('\n') },
      });
      if (!text.includes('HEARTBEAT_OK') && text) {
        push(deps, 'notice', { level: 'info', text: text.slice(0, 500), source: 'heartbeat' });
      }
    },
  };

  const briefing: JobSpec = {
    name: 'morning-briefing',
    next: (from) => nextDaily(6, 30, from),
    run: async () => {
      const today = localDay();
      const assembly = {
        date: today,
        weightTrend: weightTrend(db, 30),
        yesterdayMacros: dailyTotals(db, localDay(new Date(Date.now() - 86_400_000))),
        medsLow: medicationsLow(db),
        tasksToday: db.prepare("SELECT title, due_on, priority FROM task WHERE status='open' AND (due_on IS NULL OR due_on <= ?) ORDER BY priority LIMIT 5").all(today),
        pendingApprovals: deps.approvals.pending().length,
      };
      const threadId = systemThread(db, 'sys-briefing', 'cron', 'Briefings');
      await runAgentCronJob(deps.runtime, db, {
        threadId,
        kind: 'cron',
        prompt:
          'Assemble the morning briefing from the deterministic snapshot below. Call mcp__cabinet__render_widget with widgetType "briefing" and a sectioned data payload, then write a 2-3 sentence narrative. Numbers must come from the snapshot verbatim.',
        promptInput: { snapshot: JSON.stringify(assembly) },
      });
      push(deps, 'notice', { level: 'info', text: 'Morning briefing ready.', source: 'briefing' });
    },
  };

  const checkin: JobSpec = {
    name: 'evening-checkin',
    next: (from) => nextDaily(20, 30, from),
    run: async () => {
      const totals = dailyTotals(db);
      push(deps, 'widget', {
        widgetType: 'checkin',
        data: { date: totals.local_day, macros: totals, prompt: 'How was today? Tap mood / energy / stress.' },
      });
    },
  };

  const weekly: JobSpec = {
    name: 'weekly-review',
    next: (from) => nextWeekly(0, 9, 0, from), // Sunday 09:00 NY
    run: async () => {
      const threadId = systemThread(db, 'sys-weekly', 'cron', 'Weekly review');
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
      await runAgentCronJob(deps.runtime, db, { threadId, kind: 'cron', deep: true, prompt });
      push(deps, 'notice', { level: 'info', text: 'Weekly review complete.', source: 'weekly' });
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

  return [heartbeat, briefing, checkin, weekly, maintenance];
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

  // Rotation: keep the newest 30 daily backups per database file.
  for (const name of ['cabinet.db', 'episodic.db']) {
    const files = readdirSync(backupDir).filter((f) => f.includes(name)).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - 30))) rmSync(join(backupDir, stale));
  }

  // Embedding backfill for rows that missed indexing (§14). Loops over every
  // table in EMBEDDABLE_TABLES so a new embedding domain needs one registry
  // entry there, not a new copy of this loop.
  let backfilled = 0;
  for (const t of EMBEDDABLE_TABLES) {
    const pending = db
      .prepare(`SELECT id, ${t.textColumn} AS text FROM ${t.table} WHERE ${t.flagColumn} = 0 LIMIT 50`)
      .all() as { id: number; text: string }[];
    for (const row of pending) {
      try {
        await deps.episodic.indexText(deps.embedder, t.kind, t.sourceRef(row.id), null, row.text);
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
