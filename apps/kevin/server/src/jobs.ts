// The job system. System jobs (declared here, in code) and the schedules
// Kevin creates (rows in `schedules`) share one runner and one ledger:
// every run is a row in job_runs with an outcome of did-work,
// nothing-to-do or errored, so "did my reminder fire?" is a lookup.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { bus } from './bus.js';
import { config } from './config.js';
import { nowIso } from './db.js';
import type { Kevin } from './kevin.js';
import { small, spend, monthStartIso } from './llm.js';
import { embedPending, logEvent } from './memory.js';
import { notify } from './push.js';
import { createThread, send } from './threads.js';
import { localDay, nextCron, nextRun, type TriggerType } from './time.js';

const run = promisify(execFile);

export type Outcome = 'did-work' | 'nothing-to-do' | 'errored';
export interface RunResult { outcome: Outcome; detail?: string; costUsd?: number }

export interface SystemJob {
  name: string;
  description: string;
  /** Exactly one of these. Cron is in Ben's timezone. */
  everyMinutes?: number;
  cron?: string;
  run(kevin: Kevin): Promise<RunResult>;
}

export interface ScheduleRow {
  id: number; name: string; trigger_type: TriggerType; trigger_value: string; action: 'notify' | 'check' | 'agent_turn';
  payload: string; enabled: number; next_run_at: string | null; last_run_at: string | null; spend_cap_usd: number; created_at: string; created_by: string;
}

// ---- system jobs -------------------------------------------------------------

const heartbeat: SystemJob = {
  name: 'heartbeat',
  description: 'Proves the runner is alive; the watchdog alerts Ben when these stop.',
  everyMinutes: 10,
  run: async () => ({ outcome: 'nothing-to-do' }),
};

const memory: SystemJob = {
  name: 'memory',
  description: 'Writes a summary of each conversation that has gone quiet into the daily log, and indexes it for recall.',
  everyMinutes: 10,
  run: async (kevin) => {
    const { db } = kevin;
    const quietBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const threads = db
      .prepare(
        `SELECT t.id, t.title, t.memory_upto FROM threads t
         WHERE t.updated_at < ? AND EXISTS (SELECT 1 FROM turns u WHERE u.thread_id = t.id AND u.id > t.memory_upto AND u.status != 'running')
         LIMIT 10`,
      )
      .all(quietBefore) as { id: string; title: string; memory_upto: number }[];
    let done = 0;
    for (const t of threads) {
      if (spend(db).blocked) break;
      const turns = db.prepare("SELECT id, user_ui, assistant_ui FROM turns WHERE thread_id = ? AND id > ? AND status != 'running' ORDER BY id").all(t.id, t.memory_upto) as { id: number; user_ui: string; assistant_ui: string }[];
      const text = turns
        .map((u) => {
          const user = (JSON.parse(u.user_ui) as { text: string }).text;
          const items = JSON.parse(u.assistant_ui) as { type: string; text?: string; name?: string }[];
          const said = items.filter((i) => i.type === 'text').map((i) => i.text).join(' ');
          const did = items.filter((i) => i.type === 'tool').map((i) => i.name).join(', ');
          return `Ben: ${user}\nKevin${did ? ` (used ${did})` : ''}: ${said}`;
        })
        .join('\n\n')
        .slice(0, 60_000);
      const summary = await small(
        db,
        { purpose: 'memory', threadId: t.id, jobKey: 'system:memory' },
        'Summarise this conversation between Ben and his assistant Kevin for Kevin\'s long-term memory. Keep what would matter weeks from now: what Ben wanted, what was decided or changed, facts and numbers, preferences he showed, anything left open. Two to six sentences. If nothing in it is worth remembering, reply with exactly: NOTHING',
        `Conversation "${t.title}":\n\n${text}`,
        1500,
      );
      if (summary && summary.trim() !== 'NOTHING') logEvent(db, `${t.title}: ${summary}`, t.id, 'summary');
      db.prepare('UPDATE threads SET memory_upto = ? WHERE id = ?').run(turns.at(-1)!.id, t.id);
      done++;
    }
    const embedded = await embedPending(db).catch((e) => {
      console.error('embedding failed', e);
      return 0;
    });
    return done || embedded ? { outcome: 'did-work', detail: `${done} conversation(s) summarised${embedded ? `, ${embedded} item(s) embedded` : ''}` } : { outcome: 'nothing-to-do' };
  },
};

const backup: SystemJob = {
  name: 'backup',
  description: 'Nightly snapshot of the database, documents and uploads. Seven days are kept on this server; offsite copy needs a bucket.',
  cron: '30 3 * * *',
  run: async (kevin) => {
    const dir = join(config.dataDir, 'backups', localDay());
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    await kevin.db.backup(join(dir, 'kevin.db'));
    const parts = ['documents', 'uploads'].filter((p) => existsSync(join(config.dataDir, p)));
    if (parts.length) await run('tar', ['-czf', join(dir, 'files.tar.gz'), '-C', config.dataDir, ...parts], { timeout: 10 * 60_000 });
    const root = join(config.dataDir, 'backups');
    const old = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(0, -7);
    for (const d of old) rmSync(join(root, d), { recursive: true, force: true });
    return { outcome: 'did-work', detail: `local snapshot ${localDay()} written (database${parts.length ? ' + files' : ''}); offsite copy is not configured` };
  },
};

const prune: SystemJob = {
  name: 'prune',
  description: 'Trims the run ledger and the audit log so they stay small.',
  cron: '10 4 * * *',
  run: async (kevin) => {
    const a = kevin.db.prepare("DELETE FROM job_runs WHERE outcome = 'nothing-to-do' AND started_at < ?").run(new Date(Date.now() - 14 * 86_400_000).toISOString()).changes;
    const b = kevin.db.prepare('DELETE FROM tool_audit WHERE at < ?').run(new Date(Date.now() - 365 * 86_400_000).toISOString()).changes;
    return a + b ? { outcome: 'did-work', detail: `${a} ledger rows, ${b} audit rows removed` } : { outcome: 'nothing-to-do' };
  },
};

const ironpr: SystemJob = {
  name: 'ironpr',
  description: 'Refreshes Kevin\'s read-only copy of IRON PR (weights.benloe.com) so he can see the lifts logged there. Never writes to that app.',
  everyMinutes: 15,
  run: async (kevin) => {
    if (!kevin.domains.some((d) => d.name === 'ironpr')) return { outcome: 'nothing-to-do' };
    const { syncIronPr } = await import('./domains/ironpr.js');
    const r = syncIronPr(kevin.db);
    if (!r.ok) return { outcome: 'errored', detail: r.error };
    return r.changed ? { outcome: 'did-work', detail: `${r.entries} lifts, ${r.exercises} exercises, ${r.prs} records copied` } : { outcome: 'nothing-to-do' };
  },
};

export const systemJobs: SystemJob[] = [heartbeat, memory, backup, prune, ironpr];

// ---- schedules ---------------------------------------------------------------

export interface NotifyPayload { title: string; body?: string; link?: string }
export interface CheckPayload { sql: string; title: string; link?: string }
export interface AgentPayload { prompt: string; deep?: boolean; thread_id?: string }

/** Runs a read-only statement; anything that writes is refused. */
export function readOnlyQuery(kevin: Kevin, sql: string, limit = 200): Record<string, unknown>[] {
  const stmt = kevin.db.prepare(sql);
  if (!stmt.readonly || !stmt.reader) throw new Error('only a single read-only SELECT is allowed here');
  const out: Record<string, unknown>[] = [];
  for (const row of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export function scheduleSpentThisMonth(kevin: Kevin, id: number): number {
  return (kevin.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM job_runs WHERE job_key = ? AND started_at >= ?').get(`schedule:${id}`, monthStartIso()) as { s: number }).s;
}

async function runSchedule(kevin: Kevin, s: ScheduleRow): Promise<RunResult> {
  const key = `schedule:${s.id}`;
  if (s.action === 'notify') {
    const p = JSON.parse(s.payload) as NotifyPayload;
    await notify(kevin.db, { title: p.title, body: p.body, link: p.link, source: key });
    return { outcome: 'did-work', detail: `sent "${p.title}"` };
  }
  if (s.action === 'check') {
    const p = JSON.parse(s.payload) as CheckPayload;
    const rows = readOnlyQuery(kevin, p.sql, 20);
    if (!rows.length) return { outcome: 'nothing-to-do', detail: 'query returned no rows' };
    const body = rows.slice(0, 8).map((r) => Object.values(r).filter((v) => v != null).join(' · ')).join('\n') + (rows.length > 8 ? `\n…and ${rows.length - 8} more` : '');
    await notify(kevin.db, { title: p.title, body, link: p.link, source: key });
    return { outcome: 'did-work', detail: `${rows.length} row(s); sent "${p.title}"` };
  }
  const p = JSON.parse(s.payload) as AgentPayload;
  const remaining = s.spend_cap_usd - scheduleSpentThisMonth(kevin, s.id);
  if (remaining <= 0) return { outcome: 'errored', detail: `this schedule's monthly spend cap ($${s.spend_cap_usd.toFixed(2)}) is used up` };
  let threadId = p.thread_id;
  if (!threadId || !kevin.db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
    threadId = createThread(kevin, 'job', s.name).id;
    kevin.db.prepare('UPDATE schedules SET payload = ? WHERE id = ?').run(JSON.stringify({ ...p, thread_id: threadId }), s.id);
  }
  const result = await send(kevin, threadId, { text: p.prompt, deep: p.deep }, { origin: 'job', jobKey: key, effort: p.deep ? 'high' : 'medium', spendCapUsd: remaining });
  if (!result) return { outcome: 'errored', detail: 'the turn did not start' };
  return {
    outcome: result.status === 'done' ? 'did-work' : 'errored',
    detail: result.status === 'done' ? result.text.slice(0, 300) : (result.error ?? result.status),
    costUsd: result.costUsd,
  };
}

// ---- the runner --------------------------------------------------------------

export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private inflight = new Set<string>();
  private alerted = false;
  lastTick = 0;

  constructor(private kevin: Kevin, private jobs: SystemJob[] = systemJobs) {}

  start(tickMs = 30_000): void {
    this.timer = setInterval(() => void this.tick().catch((e) => console.error('job tick failed', e)), tickMs);
    // Deliberately a separate timer from the one it watches.
    this.watchdog = setInterval(() => void this.checkAlive().catch((e) => console.error('watchdog failed', e)), 5 * 60_000);
    setTimeout(() => void this.tick().catch((e) => console.error('job tick failed', e)), 5_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.watchdog) clearInterval(this.watchdog);
  }

  /** Alerts Ben once when the ledger has gone quiet for 30 minutes, then restarts the tick. */
  async checkAlive(now = Date.now()): Promise<boolean> {
    const last = this.kevin.db.prepare('SELECT MAX(started_at) AS at FROM job_runs').get() as { at: string | null };
    const quiet = !last.at || now - Date.parse(last.at) > 30 * 60_000;
    if (!quiet) {
      this.alerted = false;
      return true;
    }
    if (!this.alerted) {
      this.alerted = true;
      await notify(this.kevin.db, { title: 'Kevin’s job runner has stopped', body: `No job has recorded a run since ${last.at ?? 'startup'}. Reminders and backups are not firing. Restarting it now.`, link: '/jobs', source: 'watchdog' });
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.inflight.clear();
      this.timer = setInterval(() => void this.tick().catch((e) => console.error('job tick failed', e)), 30_000);
    }
    return false;
  }

  private lastRun(key: string): string | null {
    return (this.kevin.db.prepare('SELECT MAX(started_at) AS at FROM job_runs WHERE job_key = ?').get(key) as { at: string | null }).at;
  }

  systemDue(job: SystemJob, now: Date): boolean {
    const key = `system:${job.name}`;
    const state = this.kevin.db.prepare('SELECT paused FROM job_state WHERE job_key = ?').get(key) as { paused: number } | undefined;
    if (state?.paused) return false;
    const last = this.lastRun(key);
    if (job.everyMinutes) return !last || now.getTime() - Date.parse(last) >= job.everyMinutes * 60_000;
    // First sighting of a cron job: wait for its next slot.
    const since = last ? new Date(last) : new Date(now.getTime() - 60_000);
    const next = nextCron(job.cron!, since);
    return !!next && next <= now;
  }

  async tick(now = new Date()): Promise<void> {
    this.lastTick = now.getTime();
    for (const job of this.jobs) {
      if (this.systemDue(job, now)) await this.execute(`system:${job.name}`, () => job.run(this.kevin));
    }
    const due = this.kevin.db.prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at').all(now.toISOString()) as ScheduleRow[];
    for (const s of due) {
      // An agent turn can take minutes; it must not hold up the reminders behind it.
      const p = this.runScheduleNow(s, now);
      if (s.action !== 'agent_turn') await p;
    }
  }

  async runScheduleNow(s: ScheduleRow, now = new Date()): Promise<RunResult | null> {
    const key = `schedule:${s.id}`;
    if (this.inflight.has(key)) return null;
    // Advance first, so a crash mid-run cannot make it fire in a loop.
    let next: Date | null = null;
    try {
      next = nextRun(s.trigger_type, s.trigger_value, now, now);
    } catch {
      next = null;
    }
    this.kevin.db.prepare('UPDATE schedules SET last_run_at = ?, next_run_at = ?, enabled = ? WHERE id = ?').run(now.toISOString(), next?.toISOString() ?? null, next ? s.enabled : 0, s.id);
    return this.execute(key, () => runSchedule(this.kevin, s));
  }

  async runSystemNow(name: string): Promise<RunResult | null> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`no system job named "${name}"`);
    return this.execute(`system:${job.name}`, () => job.run(this.kevin));
  }

  private async execute(key: string, fn: () => Promise<RunResult>): Promise<RunResult | null> {
    if (this.inflight.has(key)) return null;
    this.inflight.add(key);
    const { db } = this.kevin;
    const id = db.prepare('INSERT INTO job_runs (job_key, started_at) VALUES (?, ?)').run(key, nowIso()).lastInsertRowid;
    let result: RunResult;
    try {
      result = await fn();
    } catch (e) {
      console.error(`job ${key} failed`, e);
      result = { outcome: 'errored', detail: e instanceof Error ? e.message : String(e) };
    } finally {
      this.inflight.delete(key);
    }
    db.prepare('UPDATE job_runs SET ended_at = ?, outcome = ?, detail = ?, cost_usd = ? WHERE id = ?').run(nowIso(), result.outcome, result.detail?.slice(0, 1000) ?? null, result.costUsd ?? 0, id);
    // The Jobs page shows the ledger; idle heartbeats are not worth a refresh.
    if (result.outcome !== 'nothing-to-do') bus.publish({ type: 'data_changed', domains: ['system'] });
    if (result.outcome === 'errored' && key !== 'system:heartbeat') {
      await notify(db, { title: `Job failed: ${key.startsWith('schedule:') ? this.scheduleName(key) : key.slice(7)}`, body: result.detail?.slice(0, 300), link: '/jobs', source: key }).catch(() => undefined);
    }
    return result;
  }

  private scheduleName(key: string): string {
    return (this.kevin.db.prepare('SELECT name FROM schedules WHERE id = ?').get(Number(key.slice(9))) as { name: string } | undefined)?.name ?? key;
  }
}
