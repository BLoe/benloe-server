// Kevin's core tools and the `system` views behind Home, Jobs and Settings.
// Domain tools (pantry, workouts, ...) live in src/domains/.
import type Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { getSetting, nowIso, setSetting } from '../db.js';
import type { View } from '../domains.js';
import { readOnlyQuery, scheduleSpentThisMonth, systemJobs, type ScheduleRow } from '../jobs.js';
import type { Kevin } from '../kevin.js';
import { anthropic, monthStartIso, record, spend } from '../llm.js';
import { addFact, deleteFact, listFacts, logEvent, search, updateFact } from '../memory.js';
import { notify } from '../push.js';
import { localDay, nextRun } from '../time.js';
import { defineTool, ToolError, type ToolDef } from '../tools.js';

/** Set by index.ts once the runner exists; job_control needs it. */
export const runtime: { runner: import('../jobs.js').JobRunner | null } = { runner: null };

// ---- the sandboxed shell -----------------------------------------------------

// Commands that remove or overwrite things get a confirm button first.
const DESTRUCTIVE = /(^|[;&|(\s])(rm|rmdir|shred|truncate|dd|mkfs\S*|mv|chmod|chown|find\b.*-delete|git\s+(reset|clean|checkout))\b|>\s*[^>&\s]/;

function runShell(command: string, signal?: AbortSignal): Promise<{ code: number | null; out: string }> {
  const [bin, ...args] = config.shellLauncher;
  return new Promise((resolvePromise) => {
    execFile(bin!, [...args, command], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024, signal, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } }, (err, stdout, stderr) => {
      const out = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean).join('\n').trim();
      const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
      resolvePromise({ code: e ? (typeof e.code === 'number' ? e.code : null) : 0, out: e?.killed ? `${out}\n[stopped: ran longer than 120 seconds]` : out || (e && typeof e.code !== 'number' ? e.message : '') });
    });
  });
}

/** Resolves a path inside the sandbox folder; anything that leaves it is refused. */
export function sandboxPath(p: string): string {
  const root = resolve(config.shellDir);
  const target = resolve(root, p.replace(/^\/+/, ''));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== target) throw new ToolError('That path is outside the sandbox folder.');
  return target;
}

// ---- research sub-agent ------------------------------------------------------

async function research(kevin: Kevin, question: string, ctx: { threadId?: string | null; turnId?: number | null; jobKey?: string | null; signal?: AbortSignal }): Promise<string> {
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 10 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8, max_content_tokens: 20_000 },
  ] as unknown as Anthropic.ToolUnion[];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  for (let i = 0; i < 6; i++) {
    const res = await anthropic().messages.create(
      {
        model: config.models.small, max_tokens: 8000, output_config: { effort: 'medium' }, tools, messages,
        system: `You are a research assistant working for Kevin, Ben's personal agent. Today is ${localDay()}. Search and read until you can answer the question from current sources, then write the answer: lead with the conclusion, give the specifics (numbers, dates, names), note where sources disagree, and end with a "Sources" list of the URLs you relied on. 400 words at most.`,
      },
      { signal: ctx.signal },
    );
    record(kevin.db, { purpose: 'research', threadId: ctx.threadId, turnId: ctx.turnId, jobKey: ctx.jobKey }, config.models.small, res.usage);
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
      continue;
    }
    if (res.stop_reason === 'refusal') throw new ToolError('The research model declined this question.');
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
    return text || 'The research came back empty.';
  }
  throw new ToolError('The research ran too long without finishing.');
}

// ---- tools -------------------------------------------------------------------

const trigger = {
  trigger_type: z.enum(['once', 'cron', 'interval']).describe('once: one time. cron: a 5-field cron expression in Ben\'s timezone. interval: every N minutes.'),
  trigger_value: z.string().describe('once: ISO 8601 time with offset, e.g. 2026-11-15T18:00:00-05:00. cron: e.g. "0 18 * * 0" (Sundays 6pm). interval: minutes, e.g. "120".'),
};
const payloadShape = {
  title: z.string().max(120).optional().describe('notify and check: the notification title.'),
  body: z.string().max(1000).optional().describe('notify: the notification text.'),
  link: z.string().optional().describe('notify and check: the app page a tap should open, e.g. /pantry.'),
  sql: z.string().optional().describe('check: a single SELECT. A notification is sent only when it returns rows; the rows become the body.'),
  prompt: z.string().optional().describe('agent_turn: what you should do when this fires, written as an instruction to yourself.'),
  deep: z.boolean().optional().describe('agent_turn: use the deep model. Costs several times more.'),
};

function buildPayload(action: string, i: { title?: string; body?: string; link?: string; sql?: string; prompt?: string; deep?: boolean }, kevin: Kevin): string {
  if (action === 'notify') {
    if (!i.title) throw new ToolError('A notify schedule needs a title.');
    return JSON.stringify({ title: i.title, body: i.body, link: i.link });
  }
  if (action === 'check') {
    if (!i.sql || !i.title) throw new ToolError('A check schedule needs sql and a title.');
    try {
      readOnlyQuery(kevin, i.sql, 1);
    } catch (e) {
      throw new ToolError(`That SQL does not run: ${(e as Error).message}`);
    }
    return JSON.stringify({ sql: i.sql, title: i.title, link: i.link });
  }
  if (!i.prompt) throw new ToolError('An agent_turn schedule needs a prompt.');
  return JSON.stringify({ prompt: i.prompt, deep: i.deep });
}

const scheduleView = (kevin: Kevin, s: ScheduleRow) => ({
  id: s.id, name: s.name, trigger_type: s.trigger_type, trigger_value: s.trigger_value, action: s.action, payload: JSON.parse(s.payload) as unknown,
  enabled: !!s.enabled, next_run_at: s.next_run_at, last_run_at: s.last_run_at, created_by: s.created_by,
  ...(s.action === 'agent_turn' ? { spend_cap_usd: s.spend_cap_usd, spent_this_month_usd: scheduleSpentThisMonth(kevin, s.id) } : {}),
});

export function coreTools(kevin: Kevin): ToolDef[] {
  const { db } = kevin;
  return [
    defineTool({
      name: 'query',
      description: 'Run one read-only SQL SELECT against Kevin\'s SQLite database and get the rows as JSON. This is how you read anything: pantry, workouts, money, documents, schedules, the run ledger, the daily log. At most 200 rows come back, so aggregate or LIMIT in the SQL.',
      input: z.object({ sql: z.string().describe('A single SELECT (or WITH ... SELECT) statement.') }),
      run: ({ sql }) => {
        try {
          const rows = readOnlyQuery(kevin, sql, 200);
          return { rows, count: rows.length, ...(rows.length === 200 ? { note: 'Cut at 200 rows.' } : {}) };
        } catch (e) {
          throw new ToolError(`SQL error: ${(e as Error).message}`);
        }
      },
    }),
    defineTool({
      name: 'remember',
      description: 'Save a durable fact about Ben so it is in front of you in every future conversation: a preference, an allergy, a goal, a recurring commitment, how he likes something done. One fact per call, written as a full sentence.',
      input: z.object({ text: z.string().min(3).max(500), category: z.string().max(40).default('general').describe('e.g. food, health, fitness, money, family, preferences') }),
      touches: ['system'],
      run: ({ text, category }) => addFact(db, text, category),
    }),
    defineTool({
      name: 'fact_update',
      description: 'Correct or delete a saved fact by its id (the number in brackets in the facts list). Pass delete: true to remove it.',
      input: z.object({ id: z.number().int(), text: z.string().min(3).max(500).optional(), category: z.string().max(40).optional(), delete: z.boolean().optional() }),
      touches: ['system'],
      run: ({ id, text, category, delete: del }) => {
        if (del) {
          if (!deleteFact(db, id)) throw new ToolError(`No fact ${id}.`);
          return { deleted: id };
        }
        const cur = listFacts(db).find((f) => f.id === id);
        if (!cur) throw new ToolError(`No fact ${id}.`);
        updateFact(db, id, text ?? cur.text, category);
        return listFacts(db).find((f) => f.id === id);
      },
    }),
    defineTool({
      name: 'recall',
      description: 'Search your long-term memory: summaries of past conversations, the daily log of what changed, notes, and the text of stored documents and attachments. Use it when a question depends on something from before today.',
      input: z.object({
        query: z.string().min(2).describe('Words that would appear in what you are looking for.'),
        kinds: z.array(z.string()).optional().describe('Limit to kinds: log-summary, log-event, log-note, document, attachment, recipe.'),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      run: async ({ query, kinds, limit }) => ({ hits: await search(db, query, limit, kinds) }),
    }),
    defineTool({
      name: 'note',
      description: 'Write a note into today\'s log for your own future recall: something that happened or was decided that is worth finding later but is not a standing fact about Ben.',
      input: z.object({ text: z.string().min(3).max(2000) }),
      run: ({ text }, ctx) => ({ id: logEvent(db, text, ctx.threadId ?? null, 'note') }),
    }),
    defineTool({
      name: 'notify',
      description: 'Send Ben a notification now: it lands in the app inbox and as a push notification on his devices. For something he should see when he is not looking at this chat.',
      input: z.object({ title: z.string().min(1).max(120), body: z.string().max(1000).default(''), link: z.string().optional().describe('App page a tap opens, e.g. /pantry') }),
      run: async ({ title, body, link }, ctx) => notify(db, { title, body, link, source: ctx.jobKey ?? 'kevin' }),
    }),
    defineTool({
      name: 'schedule_create',
      description: 'Create a reminder or recurring job. action notify sends fixed text (free). action check runs a SQL SELECT on the schedule and notifies only if it returns rows (free). action agent_turn runs you with a stored prompt (costs money; give it spend_cap_usd per month).',
      input: z.object({ name: z.string().min(1).max(80), ...trigger, action: z.enum(['notify', 'check', 'agent_turn']), ...payloadShape, spend_cap_usd: z.number().min(0.05).max(50).default(1).describe('agent_turn only: the most this schedule may spend per month.') }),
      touches: ['system'],
      run: (i, ctx) => {
        let next: Date | null;
        try {
          next = nextRun(i.trigger_type, i.trigger_value, new Date(), null);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        if (i.trigger_type === 'once' && next && next.getTime() < Date.now() - 60_000) throw new ToolError('That time is in the past.');
        if (!next) throw new ToolError('That trigger never fires.');
        const id = db
          .prepare('INSERT INTO schedules (name, trigger_type, trigger_value, action, payload, next_run_at, spend_cap_usd, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(i.name, i.trigger_type, i.trigger_value, i.action, buildPayload(i.action, i, kevin), next.toISOString(), i.spend_cap_usd, nowIso(), ctx.source === 'ui' ? 'ben' : 'kevin').lastInsertRowid;
        return scheduleView(kevin, db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow);
      },
    }),
    defineTool({
      name: 'schedule_list',
      description: 'List the schedules that exist, with their next and last run times.',
      input: z.object({ include_disabled: z.boolean().default(true) }),
      run: ({ include_disabled }) => (db.prepare(`SELECT * FROM schedules ${include_disabled ? '' : 'WHERE enabled = 1'} ORDER BY enabled DESC, next_run_at`).all() as ScheduleRow[]).map((s) => scheduleView(kevin, s)),
    }),
    defineTool({
      name: 'schedule_update',
      description: 'Change a schedule: rename it, move its trigger, edit what it does, raise its spend cap, or enable/disable it. Only the fields you pass change.',
      input: z.object({ id: z.number().int(), name: z.string().min(1).max(80).optional(), trigger_type: trigger.trigger_type.optional(), trigger_value: trigger.trigger_value.optional(), ...payloadShape, enabled: z.boolean().optional(), spend_cap_usd: z.number().min(0.05).max(50).optional() }),
      touches: ['system'],
      run: (i) => {
        const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(i.id) as ScheduleRow | undefined;
        if (!s) throw new ToolError(`No schedule ${i.id}.`);
        const type = i.trigger_type ?? s.trigger_type;
        const value = i.trigger_value ?? s.trigger_value;
        const enabled = i.enabled ?? !!s.enabled;
        const old = JSON.parse(s.payload) as Record<string, unknown>;
        const payload = buildPayload(s.action, { ...old, ...Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)) } as never, kevin);
        let next: Date | null;
        try {
          // Re-enabling or moving a one-time schedule arms it again.
          next = nextRun(type, value, new Date(), i.trigger_value || i.enabled ? null : s.last_run_at ? new Date(s.last_run_at) : null);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const keepThread = (old.thread_id as string | undefined) && s.action === 'agent_turn' ? JSON.stringify({ ...(JSON.parse(payload) as object), thread_id: old.thread_id }) : payload;
        db.prepare('UPDATE schedules SET name = ?, trigger_type = ?, trigger_value = ?, payload = ?, enabled = ?, next_run_at = ?, spend_cap_usd = ? WHERE id = ?')
          .run(i.name ?? s.name, type, value, keepThread, enabled && next ? 1 : 0, enabled ? (next?.toISOString() ?? null) : null, i.spend_cap_usd ?? s.spend_cap_usd, s.id);
        return scheduleView(kevin, db.prepare('SELECT * FROM schedules WHERE id = ?').get(s.id) as ScheduleRow);
      },
    }),
    defineTool({
      name: 'schedule_delete',
      description: 'Delete a schedule for good. Its past runs stay in the ledger.',
      input: z.object({ id: z.number().int() }),
      touches: ['system'],
      run: ({ id }) => {
        if (!db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes) throw new ToolError(`No schedule ${id}.`);
        return { deleted: id };
      },
    }),
    defineTool({
      name: 'job_status',
      description: 'Read the run ledger: when jobs and schedules ran and how each run ended (did-work, nothing-to-do, errored). Use it to answer "did my reminder fire?" and "is the backup working?". job_key is "schedule:<id>" or "system:<name>"; omit it for the most recent runs of everything.',
      input: z.object({ job_key: z.string().optional(), limit: z.number().int().min(1).max(100).default(20), include_idle: z.boolean().default(false).describe('Include nothing-to-do runs.') }),
      run: ({ job_key, limit, include_idle }) => ({
        runs: db
          .prepare(`SELECT r.id, r.job_key, r.started_at, r.ended_at, r.outcome, r.detail, r.cost_usd, s.name AS schedule_name FROM job_runs r
                    LEFT JOIN schedules s ON r.job_key = 'schedule:' || s.id
                    WHERE (? IS NULL OR r.job_key = ?) ${include_idle || job_key ? '' : "AND r.outcome != 'nothing-to-do'"} ORDER BY r.id DESC LIMIT ?`)
          .all(job_key ?? null, job_key ?? null, limit),
        system_jobs: systemJobs.map((j) => j.name),
      }),
    }),
    defineTool({
      name: 'job_control',
      description: 'Run a schedule or system job right now, or pause/resume a system job. job_key is "schedule:<id>" or "system:<name>".',
      input: z.object({ job_key: z.string(), action: z.enum(['run_now', 'pause', 'resume']) }),
      touches: ['system'],
      run: async ({ job_key, action }) => {
        const runner = runtime.runner;
        if (!runner) throw new ToolError('The job runner is not started.');
        if (job_key.startsWith('schedule:')) {
          const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(Number(job_key.slice(9))) as ScheduleRow | undefined;
          if (!s) throw new ToolError(`No ${job_key}.`);
          if (action !== 'run_now') {
            db.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(action === 'resume' ? 1 : 0, s.id);
            return { job_key, enabled: action === 'resume' };
          }
          // Fired by hand: the regular timetable is left as it was.
          const r = await runner.runScheduleNow(s);
          db.prepare('UPDATE schedules SET next_run_at = ?, enabled = ? WHERE id = ?').run(s.next_run_at, s.enabled, s.id);
          return r ?? { note: 'already running' };
        }
        const name = job_key.replace(/^system:/, '');
        if (!systemJobs.some((j) => j.name === name)) throw new ToolError(`No system job "${name}". There are: ${systemJobs.map((j) => j.name).join(', ')}.`);
        if (action === 'run_now') return (await runner.runSystemNow(name)) ?? { note: 'already running' };
        db.prepare('INSERT INTO job_state (job_key, paused) VALUES (?, ?) ON CONFLICT(job_key) DO UPDATE SET paused = excluded.paused').run(`system:${name}`, action === 'pause' ? 1 : 0);
        return { job_key: `system:${name}`, paused: action === 'pause' };
      },
    }),
    defineTool({
      name: 'web_research',
      description: 'Hand a question to a research sub-agent that runs several web searches, reads the pages, and returns a synthesis with sources. Use it for anything needing more than one lookup: comparisons, "what are the current rules for...", product or recipe research. Give it the full question with the context it needs; it knows nothing about this conversation.',
      input: z.object({ question: z.string().min(10).max(4000) }),
      run: ({ question }, ctx) => research(kevin, question, ctx),
    }),
    defineTool({
      name: 'shell',
      description: 'Run a bash command in your sandbox folder on Ben\'s server. The sandbox has no network and sees only its own folder; it has python3, jq, awk, sed, pdftotext and the usual Unix tools. Use it for calculation, parsing and converting files. Output is capped at about 30,000 characters. Commands that delete or overwrite ask Ben to confirm first.',
      input: z.object({ command: z.string().min(1).max(8000) }),
      run: async ({ command }, ctx) => {
        if (DESTRUCTIVE.test(command) && !(await ctx.confirm(`Run this command?\n${command}`))) throw new ToolError('Ben declined to run that command.');
        const r = await runShell(command, ctx.signal);
        return `exit code: ${r.code ?? 'none'}\n${r.out.slice(0, 30_000) || '(no output)'}`;
      },
    }),
    defineTool({
      name: 'file_read',
      description: 'Read a text file from your sandbox folder (the same folder the shell works in). Path is relative to that folder.',
      input: z.object({ path: z.string(), max_chars: z.number().int().min(100).max(100_000).default(30_000) }),
      run: ({ path, max_chars }) => {
        const p = sandboxPath(path);
        if (!existsSync(p) || !statSync(p).isFile()) throw new ToolError(`No file at ${path}. file_list shows what is there.`);
        const text = readFileSync(p, 'utf8');
        return text.length > max_chars ? `${text.slice(0, max_chars)}\n[cut: file is ${text.length} characters]` : text;
      },
    }),
    defineTool({
      name: 'file_write',
      description: 'Write a text file into your sandbox folder, creating folders as needed, so the shell can work on it. Overwriting an existing file asks Ben to confirm first.',
      input: z.object({ path: z.string(), content: z.string().max(2_000_000) }),
      run: async ({ path, content }, ctx) => {
        const p = sandboxPath(path);
        if (existsSync(p) && !(await ctx.confirm(`Overwrite ${path} in the sandbox?`))) throw new ToolError('Ben declined to overwrite that file.');
        mkdirSync(dirname(p), { recursive: true, mode: 0o2770 });
        writeFileSync(p, content, { mode: 0o660 });
        return { written: path, chars: content.length };
      },
    }),
    defineTool({
      name: 'file_list',
      description: 'List the files in your sandbox folder, or in a subfolder of it.',
      input: z.object({ path: z.string().default('.') }),
      run: ({ path }) => {
        const p = sandboxPath(path);
        if (!existsSync(p)) return { entries: [] };
        return { entries: readdirSync(p, { withFileTypes: true }).slice(0, 500).map((e) => ({ name: e.name, dir: e.isDirectory(), size: e.isFile() ? statSync(join(p, e.name)).size : undefined })) };
      },
    }),
    defineTool({
      name: 'suggest_improvement',
      description: 'Record a suggestion for how you should be changed: a tool you lacked, a rule that got in the way, a page or feature that would help Ben. Claude Code builds you and Ben reviews these with it. Say what happened and what would have been better.',
      input: z.object({ suggestion: z.string().min(10).max(4000) }),
      run: ({ suggestion }, ctx) => {
        const file = join(config.dataDir, 'SUGGESTIONS.md');
        if (!existsSync(file)) writeFileSync(file, '# Suggestions from Kevin\n\nKevin appends here with `suggest_improvement`. Ben reviews them with Claude Code.\n', { mode: 0o600 });
        appendFileSync(file, `\n## ${nowIso()}${ctx.threadId ? ` (thread ${ctx.threadId})` : ''}\n\n${suggestion.trim()}\n`);
        return { recorded: true };
      },
    }),
    defineTool({
      name: 'settings_update',
      description: 'Change app settings.',
      agent: false,
      ui: true,
      input: z.object({ monthly_cap_usd: z.number().min(1).max(2000).optional() }),
      touches: ['system'],
      run: (i) => {
        if (i.monthly_cap_usd != null) setSetting(db, 'monthly_cap_usd', i.monthly_cap_usd);
        return { monthly_cap_usd: getSetting(db, 'monthly_cap_usd', config.defaultMonthlyCapUsd) };
      },
    }),
    defineTool({
      name: 'notifications_read',
      description: 'Mark notifications as read.',
      agent: false,
      ui: true,
      input: z.object({ ids: z.array(z.number().int()).optional().describe('Omit to mark everything read.') }),
      touches: ['system'],
      run: ({ ids }) => {
        const now = nowIso();
        if (!ids) return { marked: db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(now).changes };
        const st = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL');
        return { marked: ids.reduce((n, id) => n + st.run(now, id).changes, 0) };
      },
    }),
  ];
}

// ---- views: GET /api/view/system/<name> --------------------------------------

export function coreViews(kevin: Kevin): Record<string, View> {
  const { db } = kevin;
  const int = (v: string | undefined, d: number, max: number) => Math.min(max, Math.max(1, Number(v) || d));
  return {
    /** Month-to-date spend, the cap, and where the money went. */
    spend: () => ({
      ...spend(db),
      month_start: monthStartIso(),
      by_purpose: db.prepare('SELECT purpose, COUNT(*) AS requests, SUM(cost_usd) AS cost_usd FROM usage WHERE at >= ? GROUP BY purpose ORDER BY cost_usd DESC').all(monthStartIso()),
      by_model: db.prepare('SELECT model, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write_tokens, SUM(cost_usd) AS cost_usd FROM usage WHERE at >= ? GROUP BY model ORDER BY cost_usd DESC').all(monthStartIso()),
      by_day: db.prepare("SELECT substr(at, 1, 10) AS day, SUM(cost_usd) AS cost_usd FROM usage WHERE at >= ? GROUP BY day ORDER BY day").all(new Date(Date.now() - 30 * 86_400_000).toISOString()),
      recent_turns: db.prepare("SELECT u.id, u.thread_id, t.title, u.started_at, u.model, u.status, u.cost_usd FROM turns u JOIN threads t ON t.id = u.thread_id ORDER BY u.id DESC LIMIT 15").all(),
    }),
    facts: () => listFacts(db),
    schedules: () => (db.prepare('SELECT * FROM schedules ORDER BY enabled DESC, next_run_at IS NULL, next_run_at').all() as ScheduleRow[]).map((s) => scheduleView(kevin, s)),
    /** System jobs with their last run and whether they are paused. */
    jobs: () =>
      systemJobs.map((j) => {
        const key = `system:${j.name}`;
        const last = db.prepare('SELECT started_at, outcome, detail FROM job_runs WHERE job_key = ? ORDER BY id DESC LIMIT 1').get(key) as { started_at: string; outcome: string; detail: string | null } | undefined;
        const lastWork = db.prepare("SELECT started_at, outcome, detail FROM job_runs WHERE job_key = ? AND outcome != 'nothing-to-do' ORDER BY id DESC LIMIT 1").get(key);
        const paused = !!(db.prepare('SELECT paused FROM job_state WHERE job_key = ?').get(key) as { paused: number } | undefined)?.paused;
        return { job_key: key, name: j.name, description: j.description, cadence: j.cron ? `cron ${j.cron}` : `every ${j.everyMinutes} min`, paused, last_run: last ?? null, last_work: lastWork ?? null };
      }),
    /** The run ledger. ?job_key= &limit= &idle=1 to include nothing-to-do runs. */
    job_runs: (p) =>
      db
        .prepare(`SELECT r.id, r.job_key, r.started_at, r.ended_at, r.outcome, r.detail, r.cost_usd, s.name AS schedule_name FROM job_runs r
                  LEFT JOIN schedules s ON r.job_key = 'schedule:' || s.id
                  WHERE (? IS NULL OR r.job_key = ?) ${p.idle === '1' || p.job_key ? '' : "AND r.outcome != 'nothing-to-do'"} ORDER BY r.id DESC LIMIT ?`)
        .all(p.job_key ?? null, p.job_key ?? null, int(p.limit, 50, 500)),
    /** ?unread=1 &limit= */
    notifications: (p) => ({
      unread: (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get() as { n: number }).n,
      items: db.prepare(`SELECT id, at, title, body, link, source, read_at FROM notifications ${p.unread === '1' ? 'WHERE read_at IS NULL' : ''} ORDER BY id DESC LIMIT ?`).all(int(p.limit, 30, 200)),
    }),
    /** Today on the Home page: what is scheduled to fire in the next 24 hours. */
    agenda: () => ({
      today: localDay(),
      upcoming: (db.prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at').all(new Date(Date.now() + 24 * 3600_000).toISOString()) as ScheduleRow[]).map((s) => scheduleView(kevin, s)),
    }),
    /** ?q= */
    memory_search: (p) => (p.q ? search(db, p.q, int(p.limit, 12, 50)) : []),
    /** ?day=YYYY-MM-DD (default today) */
    memory_log: (p) => db.prepare('SELECT id, at, day, kind, thread_id, text FROM memory_log WHERE day = ? ORDER BY id DESC LIMIT 300').all(p.day ?? localDay()),
    /** ?limit= */
    audit: (p) => db.prepare('SELECT id, at, source, thread_id, tool, input, ok, result, ms FROM tool_audit ORDER BY id DESC LIMIT ?').all(int(p.limit, 50, 500)),
    suggestions: () => {
      const file = join(config.dataDir, 'SUGGESTIONS.md');
      return { text: existsSync(file) ? readFileSync(file, 'utf8') : '' };
    },
    health: () => ({
      runner_last_tick: runtime.runner?.lastTick ? new Date(runtime.runner.lastTick).toISOString() : null,
      last_backup: db.prepare("SELECT started_at, outcome, detail FROM job_runs WHERE job_key = 'system:backup' ORDER BY id DESC LIMIT 1").get() ?? null,
      offsite_backup: false,
      embeddings: !!config.openaiKey,
      push_devices: (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n,
      models: config.models,
    }),
  };
}
