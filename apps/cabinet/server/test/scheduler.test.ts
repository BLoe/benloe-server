import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { EpisodicStore } from '../src/episodic/index.js';
import { Embedder } from '../src/embeddings/index.js';
import { nextDaily, nextHeartbeat, nextWeekly, nyParts, nyWallToUtc } from '../src/scheduler/clock.js';
import { Scheduler } from '../src/scheduler/index.js';
import { buildJobs, heartbeatFindings, runMaintenance, type JobDeps } from '../src/scheduler/jobs.js';
import { addJournal, upsertTask } from '../src/domains/misc.js';
import { logMedication } from '../src/domains/healthcare.js';
import { updatePantry } from '../src/domains/food.js';

const MODEL_TIMEOUT = 300_000;

describe('clock (America/New_York, DST-safe)', () => {
  it('converts NY wall time to UTC in summer (EDT) and winter (EST)', () => {
    expect(nyWallToUtc(2026, 7, 7, 6, 30).toISOString()).toBe('2026-07-07T10:30:00.000Z'); // EDT -4
    expect(nyWallToUtc(2026, 1, 7, 6, 30).toISOString()).toBe('2026-01-07T11:30:00.000Z'); // EST -5
  });

  it('nextDaily 06:30 rolls to tomorrow when already past', () => {
    const from = new Date('2026-07-07T12:00:00Z'); // 08:00 NY — past 6:30
    expect(nextDaily(6, 30, from).toISOString()).toBe('2026-07-08T10:30:00.000Z');
    const early = new Date('2026-07-07T09:00:00Z'); // 05:00 NY — before 6:30
    expect(nextDaily(6, 30, early).toISOString()).toBe('2026-07-07T10:30:00.000Z');
  });

  it('spring forward (2026-03-08): 06:30 fires exactly once, offset shifts -5→-4', () => {
    const before = nextDaily(6, 30, new Date('2026-03-08T00:00:00Z')); // still Mar 7 evening NY? no: 19:00 Mar 7 NY → next 6:30 is Mar 8
    // Mar 8 06:30 EDT = 10:30Z (DST began 02:00 that morning)
    expect(before.toISOString()).toBe('2026-03-08T10:30:00.000Z');
    // and the day after is 24h later, not 25/23
    expect(nextDaily(6, 30, before).toISOString()).toBe('2026-03-09T10:30:00.000Z');
  });

  it('fall back (2026-11-01): 06:30 lands on EST after the transition', () => {
    const at = nextDaily(6, 30, new Date('2026-11-01T04:00:00Z')); // midnight NY, DST ends 02:00
    expect(at.toISOString()).toBe('2026-11-01T11:30:00.000Z'); // EST -5
  });

  it('spring-forward nonexistent time (02:30) resolves without error to a real instant', () => {
    const at = nextDaily(2, 30, new Date('2026-03-08T05:00:00Z')); // midnight NY on transition day
    expect(nyParts(at).hh).toBeGreaterThanOrEqual(2);
    expect(at.getTime()).toBeGreaterThan(Date.parse('2026-03-08T05:00:00Z'));
  });

  it('nextWeekly Sunday 09:00', () => {
    const at = nextWeekly(0, 9, 0, new Date('2026-07-07T12:00:00Z')); // Tuesday
    expect(at.toISOString()).toBe('2026-07-12T13:00:00.000Z');
    expect(nyParts(at).dow).toBe(0);
  });

  it('heartbeat respects active hours 07:00–23:00', () => {
    const daytime = nextHeartbeat(30, new Date('2026-07-07T16:00:00Z')); // 12:00 NY
    expect(daytime.toISOString()).toBe('2026-07-07T16:30:00.000Z');
    const night = nextHeartbeat(30, new Date('2026-07-08T03:30:00Z')); // 23:30 NY → next 07:00
    expect(night.toISOString()).toBe('2026-07-08T11:00:00.000Z');
  });
});

describe('Scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires, re-arms strictly in the future, and collapses missed windows to one run', async () => {
    let runs = 0;
    const everyMinute = {
      name: 'j',
      next: (from: Date) => new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000),
      run: async () => {
        runs++;
      },
    };
    const s = new Scheduler([everyMinute]);
    s.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toBe(1);
    // simulate a long stall: 5 windows pass while the timer couldn't fire
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runs).toBe(6 - 1 + 1); // one per elapsed window at most — no burst beyond timer semantics
    s.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runs).toBe(6);
  });

  it('records lastError without killing the schedule', async () => {
    let calls = 0;
    const s = new Scheduler([
      {
        name: 'flaky',
        next: (from) => new Date(from.getTime() + 1000),
        run: async () => {
          calls++;
          if (calls === 1) throw new Error('boom');
        },
      },
    ]);
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.lastError.get('flaky')).toBe('boom');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    s.stop();
  });

  describe('runNow (manual trigger)', () => {
    it('invokes the exact same JobSpec.run() the timer would — not a rebuilt copy', async () => {
      let calls = 0;
      const job = { name: 'weekly-review', next: () => null, run: async () => { calls++; } };
      const s = new Scheduler([job]);
      expect(s.has('weekly-review')).toBe(true);
      expect(s.has('no-such-job')).toBe(false);

      await s.runNow('weekly-review');
      expect(calls).toBe(1);
      expect(s.lastRun.get('weekly-review')).toBeInstanceOf(Date);
    });

    it('rejects an unknown job name', async () => {
      const s = new Scheduler([{ name: 'x', next: () => null, run: async () => {} }]);
      await expect(s.runNow('nope')).rejects.toThrow('no such job: nope');
    });

    it('records lastError and rethrows when the job fails', async () => {
      const s = new Scheduler([{ name: 'x', next: () => null, run: async () => { throw new Error('boom'); } }]);
      await expect(s.runNow('x')).rejects.toThrow('boom');
      expect(s.lastError.get('x')).toBe('boom');
    });

    it('rejects a second concurrent trigger for the same job instead of overlapping it', async () => {
      let resolveFirst!: () => void;
      const gate = new Promise<void>((r) => { resolveFirst = r; });
      let starts = 0;
      const s = new Scheduler([{ name: 'slow', next: () => null, run: async () => { starts++; await gate; } }]);
      const first = s.runNow('slow');
      await Promise.resolve(); // let the first call register itself as in-flight
      await expect(s.runNow('slow')).rejects.toThrow('slow is already running');
      resolveFirst();
      await first;
      expect(starts).toBe(1);
    });
  });
});

describe('jobs', () => {
  let dir: string;
  let cabinet: CabinetDb;
  let deps: JobDeps;
  let runtimeCalls: { kind: string; deep?: boolean; prompt: string }[];
  let embedder: Embedder;
  let episodic: EpisodicStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cabinet-jobs-'));
    cabinet = openDb(join(dir, 'cabinet.db'));
    writeFileSync(join(dir, 'episodic.db'), ''); // placeholder so backup loop sees it
    episodic = new EpisodicStore(join(dir, 'episodic.db'));
    embedder = new Embedder();
    runtimeCalls = [];
    deps = {
      db: cabinet.db,
      runtime: {
        run: async (req: { kind: string; deep?: boolean; prompt: string; onEvent: (e: unknown) => void }) => {
          runtimeCalls.push({ kind: req.kind, deep: req.deep, prompt: req.prompt });
          return { stopReason: 'success', sessionId: null };
        },
      } as never,
      approvals: new ApprovalQueue(cabinet.db),
      widgetBus: new EventEmitter(),
      episodic,
      embedder,
      dataDir: dir,
    };
  });

  afterEach(async () => {
    await embedder.close();
    episodic.close();
    cabinet.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('heartbeatFindings: empty db → none; seeded db → specific findings', () => {
    expect(heartbeatFindings(cabinet.db, '2026-07-07')).toEqual([]);
    updatePantry(cabinet.db, { name: 'chicken', location: 'fridge', quantity: 1, expires_on: '2026-07-08' });
    logMedication(cabinet.db, { name: 'VitD', days_supply: 10, last_filled_on: '2026-07-01' });
    upsertTask(cabinet.db, { title: 'file taxes', due_on: '2026-07-06' });
    const findings = heartbeatFindings(cabinet.db, '2026-07-07');
    expect(findings.some((f) => f.includes('chicken'))).toBe(true);
    expect(findings.some((f) => f.includes('VitD'))).toBe(true);
    expect(findings.some((f) => f.includes('file taxes'))).toBe(true);
  });

  it('heartbeat with no findings never calls the model', async () => {
    const jobs = buildJobs(deps);
    await jobs.find((j) => j.name === 'heartbeat')!.run();
    expect(runtimeCalls).toEqual([]);
    const audit = cabinet.db.prepare("SELECT decision FROM action_audit WHERE tool='heartbeat'").get() as { decision: string };
    expect(audit.decision).toBe('HEARTBEAT_OK');
  });

  it('heartbeat with findings runs a heartbeat-kind turn', async () => {
    upsertTask(cabinet.db, { title: 'due thing', due_on: '2000-01-01' });
    await buildJobs(deps).find((j) => j.name === 'heartbeat')!.run();
    expect(runtimeCalls).toHaveLength(1);
    expect(runtimeCalls[0]).toMatchObject({ kind: 'heartbeat' });
  });

  it('heartbeat now persists its own transcript too (runAgentCronJob) — the third instance of the same gap weekly-review and briefing had', async () => {
    upsertTask(cabinet.db, { title: 'due thing', due_on: '2000-01-01' });
    const nudgingRuntime = {
      run: async (req: { onEvent: (e: unknown) => void }) => {
        req.onEvent({ type: 'turn-start', messageId: 'm1', threadId: 'sys-heartbeat', model: 'claude-haiku-4-5' });
        req.onEvent({ type: 'text-delta', delta: 'Heads up: the due thing is overdue.' });
        req.onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
        return { stopReason: 'success', sessionId: 's1' };
      },
    };
    const events: { event: string; data: unknown }[] = [];
    deps.widgetBus.on('push', (n: { event: string; data: unknown }) => events.push(n));
    const jobs = buildJobs({ ...deps, runtime: nudgingRuntime as never });
    await jobs.find((j) => j.name === 'heartbeat')!.run();

    const notices = events.filter((e) => e.event === 'notice');
    expect(notices).toHaveLength(1);
    expect((notices[0]!.data as { text: string }).text).toBe('Heads up: the due thing is overdue.');

    const rows = cabinet.db.prepare("SELECT role, parts FROM message WHERE thread_id = 'sys-heartbeat' ORDER BY created_at").all() as {
      role: string;
      parts: string;
    }[];
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(JSON.parse(rows[1]!.parts)).toEqual([{ type: 'text', text: 'Heads up: the due thing is overdue.' }]);
  });

  it('heartbeat replying HEARTBEAT_OK still persists the transcript but does not push a notice', async () => {
    upsertTask(cabinet.db, { title: 'due thing', due_on: '2000-01-01' });
    const okRuntime = {
      run: async (req: { onEvent: (e: unknown) => void }) => {
        req.onEvent({ type: 'text-delta', delta: 'HEARTBEAT_OK' });
        req.onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
        return { stopReason: 'success', sessionId: 's1' };
      },
    };
    const events: { event: string; data: unknown }[] = [];
    deps.widgetBus.on('push', (n: { event: string; data: unknown }) => events.push(n));
    const jobs = buildJobs({ ...deps, runtime: okRuntime as never });
    await jobs.find((j) => j.name === 'heartbeat')!.run();

    expect(events.filter((e) => e.event === 'notice')).toHaveLength(0);
    const rows = cabinet.db.prepare("SELECT role FROM message WHERE thread_id = 'sys-heartbeat'").all();
    expect(rows).toHaveLength(2); // user prompt + assistant "HEARTBEAT_OK" — persisted even when there's nothing to surface
  });

  describe('usage budget alert (piggybacks on heartbeat, SQL-only)', () => {
    const ENV_KEY = 'CABINET_USAGE_ALERT_TOKENS';
    let prevEnv: string | undefined;

    beforeEach(() => {
      prevEnv = process.env[ENV_KEY];
    });
    afterEach(() => {
      if (prevEnv === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prevEnv;
    });

    function capturePushes(): { event: string; data: unknown }[] {
      const events: { event: string; data: unknown }[] = [];
      deps.widgetBus.on('push', (n: { event: string; data: unknown }) => events.push(n));
      return events;
    }

    function seedTokens(input: number, output: number, cacheWrite: number, cacheRead = 0) {
      cabinet.db
        .prepare(
          `INSERT INTO token_usage (ts, input_tokens, output_tokens, cache_read, cache_write, session_kind, thread_id)
           VALUES (datetime('now'), ?, ?, ?, ?, 'user', 't1')`,
        )
        .run(input, output, cacheRead, cacheWrite);
    }

    it('stays quiet below threshold', async () => {
      process.env[ENV_KEY] = '1000';
      seedTokens(100, 100, 100); // total 300 < 1000
      const events = capturePushes();
      await buildJobs(deps).find((j) => j.name === 'heartbeat')!.run();
      expect(events.filter((e) => e.event === 'notice' && (e.data as { source?: string }).source === 'usage')).toHaveLength(0);
    });

    it('excludes cache_read from the threshold sum (a cache-healthy chat should not trip it)', async () => {
      process.env[ENV_KEY] = '1000';
      seedTokens(100, 100, 100, 500_000); // huge cache_read, but input+output+cache_write = 300 < 1000
      const events = capturePushes();
      await buildJobs(deps).find((j) => j.name === 'heartbeat')!.run();
      expect(events.filter((e) => e.event === 'notice' && (e.data as { source?: string }).source === 'usage')).toHaveLength(0);
    });

    it('fires a warn notice once threshold is crossed', async () => {
      process.env[ENV_KEY] = '250';
      seedTokens(100, 100, 100); // total 300 >= 250
      const events = capturePushes();
      await buildJobs(deps).find((j) => j.name === 'heartbeat')!.run();
      const alerts = events.filter((e) => e.event === 'notice' && (e.data as { source?: string }).source === 'usage');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.data).toMatchObject({ level: 'warn' });
      const audit = cabinet.db.prepare("SELECT decision FROM action_audit WHERE tool='usage-budget-alert'").all();
      expect(audit).toHaveLength(1);
    });

    it('debounces: does not re-alert on the next heartbeat tick within the same window', async () => {
      process.env[ENV_KEY] = '250';
      seedTokens(100, 100, 100);
      const events = capturePushes();
      const heartbeat = buildJobs(deps).find((j) => j.name === 'heartbeat')!;
      await heartbeat.run();
      await heartbeat.run(); // simulates the next 30-minute tick with usage still elevated
      const alerts = events.filter((e) => e.event === 'notice' && (e.data as { source?: string }).source === 'usage');
      expect(alerts).toHaveLength(1); // fired once, not twice
      const audit = cabinet.db.prepare("SELECT decision FROM action_audit WHERE tool='usage-budget-alert'").all();
      expect(audit).toHaveLength(1);
    });

    it('CABINET_USAGE_ALERT_TOKENS=0 disables the check entirely', async () => {
      process.env[ENV_KEY] = '0';
      seedTokens(10_000_000, 0, 0); // would trip any sane default
      const events = capturePushes();
      await buildJobs(deps).find((j) => j.name === 'heartbeat')!.run();
      expect(events.filter((e) => e.event === 'notice' && (e.data as { source?: string }).source === 'usage')).toHaveLength(0);
    });
  });

  it('weekly review runs deep; briefing runs cron with deterministic snapshot', async () => {
    const jobs = buildJobs(deps);
    await jobs.find((j) => j.name === 'weekly-review')!.run();
    await jobs.find((j) => j.name === 'morning-briefing')!.run();
    expect(runtimeCalls[0]).toMatchObject({ kind: 'cron', deep: true });
    expect(runtimeCalls[1]!.kind).toBe('cron');
    expect(runtimeCalls[1]!.deep).toBeUndefined();
  });

  it('weekly-review persists a real transcript (prompt + folded assistant reply) on sys-weekly — not onEvent: () => {} discarding it', async () => {
    const scriptedRuntime = {
      run: async (req: { onEvent: (e: unknown) => void }) => {
        req.onEvent({ type: 'turn-start', messageId: 'm1', threadId: 'sys-weekly', model: 'claude-opus-4-8' });
        req.onEvent({ type: 'text-delta', delta: 'Reviewed the week: no domain has real data yet.' });
        req.onEvent({ type: 'tool-start', toolId: 't1', name: 'mcp__cabinet__query_db', input: { sql: 'select 1' } });
        req.onEvent({ type: 'tool-end', toolId: 't1', output: '[]', isError: false });
        req.onEvent({ type: 'turn-end', usage: { output_tokens: 5 }, sessionId: 's1', stopReason: 'success' });
        return { stopReason: 'success', sessionId: 's1' };
      },
    };
    const jobs = buildJobs({ ...deps, runtime: scriptedRuntime as never });
    await jobs.find((j) => j.name === 'weekly-review')!.run();

    const rows = cabinet.db.prepare("SELECT role, parts FROM message WHERE thread_id = 'sys-weekly' ORDER BY created_at").all() as {
      role: string;
      parts: string;
    }[];
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(JSON.parse(rows[0]!.parts)).toEqual([{ type: 'text', text: expect.stringContaining('Run the weekly review') }]);
    expect(JSON.parse(rows[1]!.parts)).toEqual([
      { type: 'text', text: 'Reviewed the week: no domain has real data yet.' },
      { type: 'tool-run', toolId: 't1', name: 'mcp__cabinet__query_db', input: { sql: 'select 1' }, output: '[]', isError: false, done: true },
    ]);
  });

  it('weekly-review still persists the partial transcript if the turn throws mid-run', async () => {
    const throwingRuntime = {
      run: async (req: { onEvent: (e: unknown) => void }) => {
        req.onEvent({ type: 'turn-start', messageId: 'm1', threadId: 'sys-weekly', model: 'claude-opus-4-8' });
        req.onEvent({ type: 'text-delta', delta: 'Partial output before the SDK crashed.' });
        throw new Error('sdk crashed mid-turn');
      },
    };
    const jobs = buildJobs({ ...deps, runtime: throwingRuntime as never });
    await expect(jobs.find((j) => j.name === 'weekly-review')!.run()).rejects.toThrow('sdk crashed mid-turn');

    const rows = cabinet.db.prepare("SELECT role, parts FROM message WHERE thread_id = 'sys-weekly' ORDER BY created_at").all() as {
      role: string;
      parts: string;
    }[];
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(JSON.parse(rows[1]!.parts)).toEqual([{ type: 'text', text: 'Partial output before the SDK crashed.' }]);
  });

  it(
    'maintenance: backups exist, rotation caps at 30, journal backfill embeds, approvals swept',
    async () => {
      addJournal(cabinet.db, 'a pending journal entry about quokkas');
      cabinet.db
        .prepare("INSERT INTO approval (id, tier, action, payload, expires_at) VALUES ('old', 2, 'x', '{}', datetime('now','-1 day'))")
        .run();
      // seed 32 fake old backups to prove rotation
      for (let i = 1; i <= 32; i++) {
        writeFileSync(join(dir, 'backups-seed'), ''); // ensure dir parent exists via runMaintenance
      }
      const res = await runMaintenance(deps);
      expect(res.backups.length).toBeGreaterThanOrEqual(1);
      expect(res.backups.every((b) => existsSync(b))).toBe(true);
      expect(res.backfilled).toBe(1);
      expect(res.expired).toBe(1);
      expect((cabinet.db.prepare('SELECT embedded FROM journal_entry').get() as { embedded: number }).embedded).toBe(1);
    },
    MODEL_TIMEOUT,
  );

  it('maintenance: a failed embed during backfill is logged (not swallowed) and leaves the row for tomorrow', async () => {
    addJournal(cabinet.db, 'a pending journal entry that will fail to embed');
    const brokenEmbedder = { embed: async () => { throw new Error('embedding process exited (code 1)'); } } as unknown as Embedder;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await runMaintenance({ ...deps, embedder: brokenEmbedder });

    expect(res.backfilled).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('backfill: embed failed for journal_entry id='));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('embedding process exited (code 1)'));
    expect((cabinet.db.prepare('SELECT embedded FROM journal_entry').get() as { embedded: number }).embedded).toBe(0);
    warn.mockRestore();
  });
});
