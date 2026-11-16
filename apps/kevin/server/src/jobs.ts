// The job system. System jobs (declared here, in code) and the schedules
// Kevin creates (rows in `schedules`) share one runner and one ledger:
// every run is a row in job_runs with an outcome of did-work,
// nothing-to-do or errored, so "did my reminder fire?" is a lookup.
import { execFile } from 'node:child_process';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { bus } from './bus.js';
import { config } from './config.js';
import { nowIso, parseJson } from './db.js';
import type { Kevin } from './kevin.js';
import { RefusalError, small, spend, monthStartIso } from './llm.js';
import { embedPending, logEvent } from './memory.js';
import { notify } from './push.js';
import { readOnlyQuery } from './sql.js';
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

/** Failed attempts after which the memory job stops trying a stretch of conversation. */
export const MEMORY_MAX_ATTEMPTS = 5;
/** Wait before attempt n+1: 20 min, 40 min, 80 min, 160 min (the job itself runs every 10). */
const memoryBackoffMs = (failures: number): number => 10 * 60_000 * 2 ** failures;

/** A short, stable name for why a model call failed: the same cause gives the same text on every attempt. */
function failureCause(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return `the model API answered ${status}`;
  return e instanceof Error ? (e.name === 'Error' ? e.message : e.name).slice(0, 80) : 'unknown error';
}

const memory: SystemJob = {
  name: 'memory',
  description: 'Writes a summary of each conversation that has gone quiet into the daily log, and indexes it for recall.',
  everyMinutes: 10,
  run: async (kevin) => {
    const { db } = kevin;
    const now = Date.now();
    const quietBefore = new Date(now - 10 * 60_000).toISOString();
    const threads = db
      .prepare(
        `SELECT t.id, t.title, t.memory_upto, t.memory_failures FROM threads t
         WHERE t.updated_at < ? AND (t.memory_retry_at IS NULL OR t.memory_retry_at <= ?)
           AND EXISTS (SELECT 1 FROM turns u WHERE u.thread_id = t.id AND u.id > t.memory_upto AND u.status != 'running')
         LIMIT 10`,
      )
      .all(quietBefore, new Date(now).toISOString()) as { id: string; title: string; memory_upto: number; memory_failures: number }[];
    const settled = db.prepare('UPDATE threads SET memory_upto = ?, memory_failures = 0, memory_retry_at = NULL WHERE id = ?');
    let done = 0;
    let declined = 0;
    let abandoned = 0;
    const retrying: string[] = [];
    // Each conversation on its own: one that fails is put aside and the rest still get their summaries.
    for (const t of threads) {
      if (spend(db).blocked) break;
      const turns = db.prepare("SELECT id, user_ui, assistant_ui FROM turns WHERE thread_id = ? AND id > ? AND status != 'running' ORDER BY id").all(t.id, t.memory_upto) as { id: number; user_ui: string; assistant_ui: string }[];
      const upto = turns.at(-1)!.id;
      try {
        const text = turns
          .map((u) => {
            const user = String(parseJson<{ text?: string }>(u.user_ui, {}).text ?? '');
            const parsed = parseJson<{ type: string; text?: string; name?: string }[]>(u.assistant_ui, []);
            const items = Array.isArray(parsed) ? parsed : [];
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
        settled.run(upto, t.id);
        done++;
      } catch (e) {
        if (e instanceof RefusalError) {
          // Asking again would be refused again (and billed again): these turns are passed over for good.
          console.warn(`memory: the model declined to summarise thread ${t.id} (turns up to ${upto}); skipped`);
          settled.run(upto, t.id);
          declined++;
          continue;
        }
        console.error(`memory: summarising thread ${t.id} failed (attempt ${t.memory_failures + 1} of ${MEMORY_MAX_ATTEMPTS})`, e);
        if (t.memory_failures + 1 >= MEMORY_MAX_ATTEMPTS) {
          settled.run(upto, t.id);
          abandoned++;
        } else {
          db.prepare('UPDATE threads SET memory_failures = memory_failures + 1, memory_retry_at = ? WHERE id = ?').run(new Date(now + memoryBackoffMs(t.memory_failures + 1)).toISOString(), t.id);
          const cause = failureCause(e);
          if (!retrying.includes(cause)) retrying.push(cause);
        }
      }
    }
    const embedded = await embedPending(db).catch((e) => {
      console.error('embedding failed', e);
      return 0;
    });
    const parts = [
      done ? `${done} conversation(s) summarised` : '',
      declined ? `${declined} skipped (the model declined to summarise)` : '',
      embedded ? `${embedded} item(s) embedded` : '',
    ].filter(Boolean);
    // A failure is the run's outcome, so the ledger shows it. The wording carries no counts or times, so a
    // cause that keeps recurring produces the same notification, which the runner sends once a day.
    if (abandoned) return { outcome: 'errored', detail: [`gave up summarising a conversation after ${MEMORY_MAX_ATTEMPTS} failed attempts; it is left out of long-term memory`, ...parts].join('; ') };
    if (retrying.length) return { outcome: 'errored', detail: [`a conversation could not be summarised (${retrying.join('; ')}); it will be tried again later`, ...parts].join('; ') };
    return parts.length ? { outcome: 'did-work', detail: parts.join(', ') } : { outcome: 'nothing-to-do' };
  },
};

const backup: SystemJob = {
  name: 'backup',
  description: 'Nightly snapshot of the database, documents and uploads. Seven days are kept on this server; offsite copy needs a bucket.',
  cron: '30 3 * * *',
  run: async (kevin) => {
    const { day, files } = await writeBackup(kevin);
    return { outcome: 'did-work', detail: `local snapshot ${day} written (database${files ? ' + files' : ''}); offsite copy is not configured` };
  },
};

/** Snapshots kept. */
export const BACKUPS_KEPT = 7;

/**
 * Writes one snapshot to backups/<day>/ and prunes old ones.
 *
 * A snapshot is built in backups/<day>.partial and gets its final name only after the database copy
 * has passed SQLite's integrity check and the archive of files has been read back. So a folder with
 * a date for a name is always a complete snapshot, and those are the only ones retention counts: a
 * run of failed nights cannot push the last good snapshots out. A failed build is deleted.
 */
export async function writeBackup(kevin: Kevin, day = localDay()): Promise<{ day: string; files: boolean }> {
  const root = join(config.dataDir, 'backups');
  const partial = join(root, `${day}.partial`);
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true, mode: 0o700 });
  let files = false;
  try {
    const copyPath = join(partial, 'kevin.db');
    await kevin.db.backup(copyPath);
    const copy = new Database(copyPath, { fileMustExist: true });
    try {
      // The copy leaves write-ahead mode, so the snapshot is one self-contained file with no side files.
      copy.pragma('journal_mode = DELETE');
      const verdict = copy.pragma('integrity_check', { simple: true });
      if (verdict !== 'ok') throw new Error(`the database copy failed its integrity check: ${String(verdict).slice(0, 200)}`);
    } finally {
      copy.close();
    }
    const parts = ['documents', 'uploads'].filter((p) => existsSync(join(config.dataDir, p)));
    if (parts.length) {
      const archive = join(partial, 'files.tar.gz');
      await run(backupTools.tar, ['-czf', archive, '-C', config.dataDir, ...parts], { timeout: 10 * 60_000 });
      // Read back end to end: a truncated or corrupt archive fails here, not on the day it is needed.
      await run(backupTools.tar, ['-tzf', archive], { timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 });
      files = true;
    }
    const final = join(root, day);
    // A second run on the same day replaces that day's snapshot, and only now that the new one is whole.
    rmSync(final, { recursive: true, force: true });
    renameSync(partial, final);
  } catch (e) {
    rmSync(partial, { recursive: true, force: true });
    throw e;
  }
  const entries = readdirSync(root);
  for (const d of entries.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(0, -BACKUPS_KEPT)) rmSync(join(root, d), { recursive: true, force: true });
  // Left by a run that was killed before it could clean up after itself.
  for (const d of entries.filter((d) => /^\d{4}-\d{2}-\d{2}\.partial$/.test(d))) rmSync(join(root, d), { recursive: true, force: true });
  return { day, files };
}

/** Tests replace the archiver to make it fail. */
export const backupTools = { tar: 'tar' };

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
export interface AgentPayload {
  prompt: string;
  deep?: boolean;
  thread_id?: string;
  /** May the run change Ben's data? Off unless Ben turned it on: see runSchedule. */
  writes?: boolean;
}

/**
 * What a schedule's runs have cost this month. Summed from `usage`, where every model request is
 * recorded as it happens with the job it belongs to, and not from the ledger's per-run totals, which
 * a run that was cut off by a restart never gets to write.
 */
export function scheduleSpentThisMonth(kevin: Kevin, id: number): number {
  return (kevin.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage WHERE job_key = ? AND at >= ?').get(`schedule:${id}`, monthStartIso()) as { s: number }).s;
}

/**
 * Puts right what a stop of the process left half-done. Called once at startup, before the runner.
 *
 * - A turn still marked running can never finish: it is closed as an error.
 * - A job run with no end was cut off: it is closed as errored, with what it had spent taken from
 *   `usage`, and Ben is told, because the thing it was doing (a reminder, a backup) did not happen and
 *   its timetable has already moved on.
 * - An upload whose text was never extracted is marked failed, so it does not look as if it is still
 *   being read.
 * Returns what it found, for the startup log.
 */
export async function recoverFromRestart(kevin: Kevin): Promise<{ turns: number; jobRuns: string[]; attachments: number }> {
  const { db } = kevin;
  const now = nowIso();
  const turns = db.prepare("UPDATE turns SET status = 'error', error = 'interrupted by a restart', ended_at = ? WHERE status = 'running'").run(now).changes;
  const open = db.prepare('SELECT id, job_key, started_at FROM job_runs WHERE ended_at IS NULL ORDER BY id').all() as { id: number; job_key: string; started_at: string }[];
  for (const r of open) {
    const cost = (db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage WHERE job_key = ? AND at >= ?').get(r.job_key, r.started_at) as { s: number }).s;
    db.prepare("UPDATE job_runs SET ended_at = ?, outcome = 'errored', detail = 'interrupted by a restart', cost_usd = ? WHERE id = ?").run(now, cost, r.id);
  }
  const attachments = db.prepare("UPDATE attachments SET extract_status = 'failed' WHERE extract_status = 'pending'").run().changes;
  // The heartbeat is not news. Everything else that was cut off is one notification.
  const cut = [...new Set(open.map((r) => r.job_key).filter((k) => k !== 'system:heartbeat'))];
  if (cut.length) {
    const names = cut.map((k) => (k.startsWith('schedule:') ? ((db.prepare('SELECT name FROM schedules WHERE id = ?').get(Number(k.slice(9))) as { name: string } | undefined)?.name ?? k) : k.slice(7)));
    await notify(db, { title: 'Interrupted by a restart', body: `These were running when Kevin restarted and did not finish: ${names.join(', ')}.${cut.some((k) => k.startsWith('schedule:')) ? ' A schedule among them did not do its work this time; it runs again at its next time, if it has one.' : ''}${cut.some((k) => k.startsWith('system:')) ? ' A system job runs again at its next time.' : ''}`, link: '/jobs', source: 'restart' })
      .catch((e) => console.error('could not send the restart notification', e));
  }
  return { turns, jobRuns: cut, attachments };
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
    const { rows } = await readOnlyQuery(kevin, p.sql, 20);
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
  const result = await send(kevin, threadId, { text: p.prompt, deep: p.deep }, { origin: 'job', jobKey: key, effort: p.deep ? 'high' : 'medium', spendCapUsd: remaining, readOnly: p.writes !== true });
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

  /**
   * One pass over everything that is due. Ticks may overlap (the timer does not wait for a slow one):
   * a schedule is claimed in the database before it runs and a system job is held in `inflight`, so
   * two ticks never run the same thing. Reminders go first, so a slow system job does not hold them up.
   */
  async tick(now = new Date()): Promise<void> {
    this.lastTick = now.getTime();
    const due = this.kevin.db.prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at').all(now.toISOString()) as ScheduleRow[];
    for (const s of due) {
      // An agent turn can take minutes; it must not hold up the reminders behind it.
      const p = this.runScheduleNow(s, now);
      if (s.action === 'agent_turn') p.catch((e) => console.error(`schedule ${s.id} failed outside its run`, e));
      else await p;
    }
    for (const job of this.jobs) {
      if (this.systemDue(job, now)) await this.execute(`system:${job.name}`, () => job.run(this.kevin));
    }
  }

  async runScheduleNow(s: ScheduleRow, now = new Date()): Promise<RunResult | null> {
    const key = `schedule:${s.id}`;
    if (this.inflight.has(key)) return null;
    // Advance first, so a crash mid-run cannot make it fire in a loop. The update is also the claim:
    // it only applies if the row is still as it was read, so a second tick holding the same stale row
    // changes nothing and does not run it again.
    let next: Date | null = null;
    try {
      next = nextRun(s.trigger_type, s.trigger_value, now, now);
    } catch (e) {
      // A stored trigger that no longer parses: this run still happens, and the schedule is switched off below.
      console.error(`schedule ${s.id} has an unusable trigger (${s.trigger_type} "${s.trigger_value}"); disabling it`, e);
      next = null;
    }
    const claimed = this.kevin.db
      .prepare('UPDATE schedules SET last_run_at = ?, next_run_at = ?, enabled = ? WHERE id = ? AND next_run_at IS ? AND last_run_at IS ?')
      .run(now.toISOString(), next?.toISOString() ?? null, next ? s.enabled : 0, s.id, s.next_run_at, s.last_run_at).changes;
    if (!claimed) return null;
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
      const title = `Job failed: ${key.startsWith('schedule:') ? this.scheduleName(key) : key.slice(7)}`;
      const body = result.detail?.slice(0, 300) ?? '';
      // A job that fails every ten minutes for one reason is one piece of news. The ledger has every run;
      // Ben is told again only when the reason changes or a day has passed.
      const told = db.prepare('SELECT 1 FROM notifications WHERE source = ? AND title = ? AND body = ? AND at > ?').get(key, title, body, new Date(Date.now() - 24 * 3600_000).toISOString());
      if (!told) await notify(db, { title, body, link: '/jobs', source: key }).catch((e) => console.error(`could not send the failure notification for ${key}`, e));
    }
    return result;
  }

  private scheduleName(key: string): string {
    return (this.kevin.db.prepare('SELECT name FROM schedules WHERE id = ?').get(Number(key.slice(9))) as { name: string } | undefined)?.name ?? key;
  }
}
