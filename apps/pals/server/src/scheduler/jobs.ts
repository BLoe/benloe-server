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
import type { EpisodicStore } from '../episodic/index.js';
import type { Embedder } from '../embeddings/index.js';
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
      const findings = heartbeatFindings(db);
      if (findings.length === 0) {
        db.prepare("INSERT INTO action_audit (tool, decision, session_kind) VALUES ('heartbeat','HEARTBEAT_OK','heartbeat')").run();
        return; // zero model cost
      }
      const threadId = systemThread(db, 'sys-heartbeat', 'heartbeat', 'Heartbeat');
      let text = '';
      await deps.runtime.run({
        threadId,
        kind: 'heartbeat',
        prompt: 'Work through HEARTBEAT.md against the findings in your snapshot. If anything needs Ben, write one short nudge. If not, reply HEARTBEAT_OK.',
        promptInput: { snapshot: findings.join('\n') },
        onEvent: (e) => {
          if (e.type === 'text-delta') text += e.delta;
        },
      });
      if (!text.includes('HEARTBEAT_OK') && text.trim()) {
        push(deps, 'notice', { level: 'info', text: text.trim().slice(0, 500), source: 'heartbeat' });
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
      await deps.runtime.run({
        threadId,
        kind: 'cron',
        prompt:
          'Assemble the morning briefing from the deterministic snapshot below. Call mcp__pals__render_widget with widgetType "briefing" and a sectioned data payload, then write a 2-3 sentence narrative. Numbers must come from the snapshot verbatim.',
        promptInput: { snapshot: JSON.stringify(assembly) },
        onEvent: () => {},
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
      await deps.runtime.run({
        threadId,
        kind: 'cron',
        deep: true,
        prompt: [
          'Run the weekly review (§11):',
          '1. Use mcp__pals__query_db for cross-domain correlations (sleep×mood, protein×training days, spend by category, weight trend).',
          '2. Goal progress against GOALS.md.',
          '3. Rewrite each domains/*.md narrative you have new signal for via mcp__pals__update_memory (curated, ≤200 lines).',
          '4. Reflection pass: candidate lessons via mcp__pals__add_lesson (evidence + confidence required; escalations will be rejected).',
          '5. Finish with a render_widget briefing card summarizing the week and 3 focus points.',
        ].join('\n'),
        onEvent: () => {},
      });
      push(deps, 'notice', { level: 'info', text: 'Weekly review complete.', source: 'weekly' });
    },
  };

  const maintenance: JobSpec = {
    name: 'maintenance',
    next: (from) => nextDaily(3, 0, from),
    run: async () => {
      await runMaintenance(deps);
    },
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
  for (const name of ['pals.db', 'episodic.db']) {
    const src = join(dataDir, name);
    if (!existsSync(src)) continue;
    const dest = join(backupDir, `${stamp}-${name}`);
    // sqlite online backup via the CLI keeps us independent of connection state
    execFileSync('sqlite3', [src, `.backup '${dest}'`]);
    backups.push(dest);
  }
  db.pragma('wal_checkpoint(TRUNCATE)');

  // Optional encryption: gpg symmetric when a passphrase is configured.
  const pass = process.env.PALS_BACKUP_PASSPHRASE;
  if (pass) {
    for (const f of [...backups]) {
      execFileSync('gpg', ['--batch', '--yes', '--symmetric', '--cipher-algo', 'AES256', '--passphrase', pass, f]);
      rmSync(f);
      backups[backups.indexOf(f)] = `${f}.gpg`;
    }
  }

  // Rotation: keep the newest 30 daily backups per database file.
  for (const name of ['pals.db', 'episodic.db']) {
    const files = readdirSync(backupDir).filter((f) => f.includes(name)).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - 30))) rmSync(join(backupDir, stale));
  }

  // Embedding backfill for journals that missed indexing (§14).
  const pending = db.prepare('SELECT id, body FROM journal_entry WHERE embedded = 0 LIMIT 50').all() as { id: number; body: string }[];
  let backfilled = 0;
  for (const j of pending) {
    try {
      await deps.episodic.indexText(deps.embedder, 'journal', `journal:${j.id}`, null, j.body);
      db.prepare('UPDATE journal_entry SET embedded = 1 WHERE id = ?').run(j.id);
      backfilled++;
    } catch {
      break; // embedder down — try again tomorrow
    }
  }

  const expired = deps.approvals.expireOverdue();
  return { backups, backfilled, expired };
}
