import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import {
  capacity,
  capacityLine,
  readWindows,
  recordRateLimitEvent,
  recordUsageSnapshot,
  INJECT_FLOOR,
  STALE_AFTER_MINUTES,
} from '../src/runtime/rateLimits.js';
import { idleBuilderDecision, repoDirty } from '../src/scheduler/jobs.js';

let dir: string;
let cabinet: CabinetDb;

/** 2026-08-10 14:00 NY — a weekday afternoon, inside BUILD_HOURS. */
const NOW = new Date('2026-08-10T18:00:00Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-ratelimit-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});
afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Seed one window with an observation age measured against NOW, not against
 * the wall clock — otherwise these tests would pass or fail depending on what
 * time of day CI happened to run.
 */
function seedWindow(key: string, utilization: number | null, opts: { status?: string | null; ageMinutes?: number; resetsAt?: string | null } = {}) {
  const observed = new Date(NOW.getTime() - (opts.ageMinutes ?? 0) * 60_000).toISOString();
  cabinet.db
    .prepare(
      `INSERT INTO rate_limit_state (window_key, utilization, resets_at, status, source, observed_at)
       VALUES (?, ?, ?, ?, 'event', datetime(?))
       ON CONFLICT(window_key) DO UPDATE SET
         utilization = excluded.utilization, resets_at = excluded.resets_at,
         status = excluded.status, observed_at = excluded.observed_at`,
    )
    .run(key, utilization, opts.resetsAt ?? null, opts.status ?? null, observed);
}

describe('rate limit ingest', () => {
  it('records a rate_limit_event into both current state and the sample history', () => {
    recordRateLimitEvent(cabinet.db, {
      status: 'allowed',
      rateLimitType: 'five_hour',
      utilization: 71,
      resetsAt: '2026-08-10T23:45:00Z',
    });
    const w = readWindows(cabinet.db, NOW);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ windowKey: 'five_hour', utilization: 71, status: 'allowed', source: 'event' });
    expect(cabinet.db.prepare('SELECT COUNT(*) AS n FROM rate_limit_sample').get()).toMatchObject({ n: 1 });

    // A second event updates state in place but appends to history.
    recordRateLimitEvent(cabinet.db, { status: 'allowed', rateLimitType: 'five_hour', utilization: 74 });
    expect(readWindows(cabinet.db, NOW)).toHaveLength(1);
    expect(readWindows(cabinet.db, NOW)[0]!.utilization).toBe(74);
    expect(cabinet.db.prepare('SELECT COUNT(*) AS n FROM rate_limit_sample').get()).toMatchObject({ n: 2 });
  });

  it('treats a 0-1 utilization as a fraction rather than reporting 0.71%', () => {
    recordRateLimitEvent(cabinet.db, { rateLimitType: 'five_hour', utilization: 0.71 });
    expect(readWindows(cabinet.db, NOW)[0]!.utilization).toBeCloseTo(71, 5);
  });

  it('drops an event with no recognisable window instead of storing it under a guessed key', () => {
    recordRateLimitEvent(cabinet.db, { utilization: 90 });
    recordRateLimitEvent(cabinet.db, null);
    recordRateLimitEvent(cabinet.db, 'nonsense');
    expect(readWindows(cabinet.db, NOW)).toHaveLength(0);
  });

  it('never throws on a malformed payload — telemetry must not kill a turn', () => {
    expect(() =>
      recordRateLimitEvent(cabinet.db, { rateLimitType: 'five_hour', utilization: { nope: true }, resetsAt: [] }),
    ).not.toThrow();
    // Stored, but with an honest null rather than a coerced number.
    expect(readWindows(cabinet.db, NOW)[0]!.utilization).toBeNull();
  });

  it('records a full usage snapshot including model-scoped and overage windows', () => {
    const wrote = recordUsageSnapshot(cabinet.db, {
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 33, resets_at: '2026-08-10T23:00:00Z' },
        seven_day: { utilization: 12, resets_at: '2026-08-14T00:00:00Z' },
        extra_usage: { is_enabled: true, utilization: 4 },
        model_scoped: [{ display_name: 'Opus', utilization: 51, resets_at: '2026-08-14T00:00:00Z' }],
      },
    });
    expect(wrote).toBe(true);
    const keys = readWindows(cabinet.db, NOW).map((w) => w.windowKey);
    expect(keys).toContain('five_hour');
    expect(keys).toContain('seven_day');
    expect(keys).toContain('overage');
    expect(keys).toContain('model:Opus');
  });

  it('returns false and writes nothing when the auth mode reports no rate limits', () => {
    expect(recordUsageSnapshot(cabinet.db, { rate_limits_available: false })).toBe(false);
    expect(recordUsageSnapshot(cabinet.db, null)).toBe(false);
    expect(readWindows(cabinet.db, NOW)).toHaveLength(0);
  });
});

describe('capacity', () => {
  it('is unknown when nothing has been observed', () => {
    const cap = capacity(cabinet.db, NOW);
    expect(cap.unknown).toBe(true);
    expect(cap.worst).toBeNull();
  });

  it('is unknown when every reading is stale — a stale number is not evidence', () => {
    seedWindow('five_hour', 95, { ageMinutes: STALE_AFTER_MINUTES + 30 });
    const cap = capacity(cabinet.db, NOW);
    expect(cap.unknown).toBe(true);
    expect(cap.windows).toHaveLength(1); // still readable for display, just not counted
  });

  it('reports the worst fresh window and which one it was', () => {
    seedWindow('five_hour', 22);
    seedWindow('seven_day', 68);
    const cap = capacity(cabinet.db, NOW);
    expect(cap.worst).toBe(68);
    expect(cap.worstWindow).toBe('seven_day');
    expect(cap.warned).toBe(false);
  });

  it('flags a provider warning state independently of the percentage', () => {
    seedWindow('five_hour', 9, { status: 'allowed_warning' });
    expect(capacity(cabinet.db, NOW).warned).toBe(true);
  });
});

describe('capacityLine (the per-turn injection)', () => {
  it('says nothing when capacity is unknown', () => {
    expect(capacityLine(cabinet.db, NOW)).toBeNull();
  });

  it('stays silent below the floor — ambient scarcity talk causes manufactured caution', () => {
    seedWindow('five_hour', INJECT_FLOOR - 20);
    expect(capacityLine(cabinet.db, NOW)).toBeNull();
  });

  it('speaks above the floor, names the window, and carries the observation age', () => {
    seedWindow('five_hour', 71, { resetsAt: '2026-08-10T23:45:00Z', ageMinutes: 3 });
    const line = capacityLine(cabinet.db, NOW)!;
    expect(line).toContain('five_hour 71%');
    expect(line).toContain('resets');
    expect(line).toMatch(/Observed 3m ago/);
    // The framing matters as much as the number.
    expect(line).toContain('not as an instruction to conserve');
  });

  it('speaks on a warning state even when the number is low', () => {
    seedWindow('five_hour', 11, { status: 'allowed_warning' });
    expect(capacityLine(cabinet.db, NOW)).toContain('warning state');
  });

  it('omits stale windows from the line it prints', () => {
    seedWindow('five_hour', 83);
    seedWindow('seven_day', 99, { ageMinutes: STALE_AFTER_MINUTES + 10 });
    const line = capacityLine(cabinet.db, NOW)!;
    expect(line).toContain('five_hour 83%');
    expect(line).not.toContain('seven_day');
  });
});

describe('idleBuilderDecision (the four gates)', () => {
  function eligibleTask(title = 'Wire the integrations page', priority = 2): number {
    const r = cabinet.db
      .prepare("INSERT INTO task (title, notes, priority, status, agent_eligible) VALUES (?, 'notes', ?, 'open', 1)")
      .run(title, priority);
    return Number(r.lastInsertRowid);
  }
  const busyNow = () =>
    cabinet.db.prepare("INSERT INTO token_usage (ts, session_kind) VALUES (datetime('now'), 'user')").run();

  it('declines during quiet hours regardless of everything else', () => {
    eligibleTask();
    seedWindow('five_hour', 5);
    const threeAm = new Date('2026-08-10T07:00:00Z'); // 03:00 NY
    expect(idleBuilderDecision(cabinet.db, threeAm)).toEqual({ run: false, skip: 'quiet-hours' });
  });

  it('declines while Ben is active — he gets the whole machine', () => {
    eligibleTask();
    seedWindow('five_hour', 5);
    busyNow();
    expect(idleBuilderDecision(cabinet.db, NOW)).toEqual({ run: false, skip: 'busy' });
  });

  it('ignores an old user turn — idleness is a window, not a flag', () => {
    eligibleTask();
    seedWindow('five_hour', 5);
    cabinet.db
      .prepare("INSERT INTO token_usage (ts, session_kind) VALUES (datetime('now','-3 hours'), 'user')")
      .run();
    expect(idleBuilderDecision(cabinet.db, NOW)).toMatchObject({ run: true });
  });

  it('declines when utilization is at or above the ceiling', () => {
    eligibleTask();
    seedWindow('five_hour', 62);
    expect(idleBuilderDecision(cabinet.db, NOW)).toEqual({ run: false, skip: 'capacity' });
  });

  it('declines outright on a provider warning state', () => {
    eligibleTask();
    seedWindow('five_hour', 4, { status: 'allowed_warning' });
    expect(idleBuilderDecision(cabinet.db, NOW)).toEqual({ run: false, skip: 'warned' });
  });

  it('allows exactly one blind run when capacity is unknown, then requires a reading', () => {
    const id = eligibleTask();
    const first = idleBuilderDecision(cabinet.db, NOW);
    expect(first).toMatchObject({ run: true, utilization: null });

    // The job records its run; a second blind attempt must decline.
    cabinet.db.prepare('INSERT INTO build_run (task_id, utilization) VALUES (?, NULL)').run(id);
    expect(idleBuilderDecision(cabinet.db, NOW)).toEqual({ run: false, skip: 'unknown-capacity-and-already-ran' });

    // A fresh reading unblocks it again.
    seedWindow('five_hour', 8);
    expect(idleBuilderDecision(cabinet.db, NOW)).toMatchObject({ run: true, utilization: 8 });
  });

  it('never picks up a task that was not explicitly marked agent-eligible', () => {
    seedWindow('five_hour', 5);
    cabinet.db.prepare("INSERT INTO task (title, priority, status) VALUES ('Book the PCP', 1, 'open')").run();
    expect(idleBuilderDecision(cabinet.db, NOW)).toEqual({ run: false, skip: 'no-eligible-task' });
  });

  it('picks the highest-priority eligible open task', () => {
    seedWindow('five_hour', 5);
    eligibleTask('lower priority build item', 4);
    eligibleTask('higher priority build item', 1);
    const d = idleBuilderDecision(cabinet.db, NOW);
    expect(d).toMatchObject({ run: true });
    expect((d as { task: { title: string } }).task.title).toBe('higher priority build item');
  });

  it('skips tasks that are already closed', () => {
    seedWindow('five_hour', 5);
    const id = eligibleTask();
    cabinet.db.prepare("UPDATE task SET status = 'done' WHERE id = ?").run(id);
    expect(idleBuilderDecision(cabinet.db, NOW)).toEqual({ run: false, skip: 'no-eligible-task' });
  });

  it('stops at the daily cap so a runaway loop is bounded by construction', () => {
    const id = eligibleTask();
    seedWindow('five_hour', 5);
    for (let i = 0; i < 6; i++) cabinet.db.prepare('INSERT INTO build_run (task_id, utilization) VALUES (?, 5)').run(id);
    expect(idleBuilderDecision(cabinet.db, NOW)).toEqual({ run: false, skip: 'daily-cap' });
  });
});

describe('repoDirty (the fifth gate)', () => {
  it('reports dirty for a repo with uncommitted changes and clean for one without', () => {
    const repo = mkdtempSync(join(tmpdir(), 'cabinet-repo-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    writeFileSync(join(repo, 'a.txt'), 'one');
    git('add', '-A');
    git('commit', '-qm', 'init');
    expect(repoDirty(repo)).toBe(false);
    writeFileSync(join(repo, 'a.txt'), 'two');
    expect(repoDirty(repo)).toBe(true);
    rmSync(repo, { recursive: true, force: true });
  });

  it('fails closed when the path is not a repo — an unknown tree state must never permit a commit', () => {
    expect(repoDirty(dir)).toBe(true);
  });
});
