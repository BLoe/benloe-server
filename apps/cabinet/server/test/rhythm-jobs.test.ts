import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, localDay, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { EpisodicStore } from '../src/episodic/index.js';
import { Embedder } from '../src/embeddings/index.js';
import { nyParts } from '../src/scheduler/clock.js';
import { buildJobs, type JobDeps } from '../src/scheduler/jobs.js';
import { adherence } from '../src/domains/adherence.js';

/**
 * The RHYTHM wiring: does the schedule Cabinet actually runs match the
 * schedule RHYTHM.md specifies? Every case here corresponds to a real defect
 * found on the night before Phase 0 — a brief that pushed at 06:30 to a man
 * who wakes at 09:00, a Sunday-morning "weekly review" of a week that hadn't
 * finished, and a brief prompt that omitted the call to action entirely.
 */

let dir: string;
let cabinet: CabinetDb;
let deps: JobDeps;
let runtimeCalls: { kind: string; prompt: string }[];
let pushes: { kind: string; title: string; body: string }[];
let embedder: Embedder;
let episodic: EpisodicStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-rhythm-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  writeFileSync(join(dir, 'episodic.db'), '');
  episodic = new EpisodicStore(join(dir, 'episodic.db'));
  embedder = new Embedder();
  runtimeCalls = [];
  pushes = [];
  deps = {
    db: cabinet.db,
    runtime: {
      run: async (req: { kind: string; prompt: string }) => {
        runtimeCalls.push({ kind: req.kind, prompt: req.prompt });
        return { stopReason: 'success', sessionId: null };
      },
    } as never,
    approvals: new ApprovalQueue(cabinet.db),
    widgetBus: new EventEmitter(),
    episodic,
    embedder,
    dataDir: dir,
    pushService: {
      send: async (m: { kind: string; title: string; body: string }) => {
        pushes.push(m);
        return null;
      },
    },
  };
});

afterEach(async () => {
  await embedder.close();
  episodic.close();
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

const job = (name: string) => buildJobs(deps).find((j) => j.name === name)!;

describe('morning brief timing', () => {
  it('writes the brief at 06:30 WITHOUT pushing a notification', async () => {
    // The whole point of the split: generate early so it is waiting, but do
    // not buzz a phone hours before Ben opens his eyes.
    await job('morning-briefing').run();
    expect(runtimeCalls).toHaveLength(1);
    expect(pushes).toHaveLength(0);
  });

  it('schedules the nudge at 08:00 on weekdays and 09:30 on weekends', () => {
    const next = job('morning-nudge').next;
    // From Wednesday 2026-08-05 05:00 NY → same-day 08:00.
    const wed = next(new Date('2026-08-05T09:00:00Z'))!;
    const wedParts = nyParts(wed);
    expect(wedParts.dow).toBe(3);
    expect(wedParts.hh).toBe(8);

    // From Saturday 2026-08-08 05:00 NY → weekend hour, not 08:00.
    const sat = next(new Date('2026-08-08T09:00:00Z'))!;
    const satParts = nyParts(sat);
    expect([0, 6]).toContain(satParts.dow);
    expect(satParts.hh).toBe(9);
    expect(satParts.mm).toBe(30);
  });

  it('nudges when no weight is logged yet', async () => {
    await job('morning-nudge').run();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.kind).toBe('briefing');
  });

  it('stays silent once Ben has already weighed in — he is demonstrably up', async () => {
    cabinet.db
      .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)')
      .run(new Date().toISOString(), localDay(), 'weight_lb', 278.4);
    await job('morning-nudge').run();
    expect(pushes).toHaveLength(0);
  });
});

describe('morning brief content', () => {
  it("implements RHYTHM's sequence — weigh-in, the day, tonight, the CTA, breakfast", async () => {
    await job('morning-briefing').run();
    const prompt = runtimeCalls[0]!.prompt;
    expect(prompt).toMatch(/WEIGH-IN/);
    expect(prompt).toMatch(/CALL TO ACTION/);
    expect(prompt).toMatch(/BREAKFAST, NAMED/);
    expect(prompt).toMatch(/TONIGHT, ALREADY DECIDED/);
    // The anti-menu rule is the charter's prime directive; it must survive.
    expect(prompt).toMatch(/menu here is a failure/i);
  });

  it('forbids inventing an intake target, which Phase 0 does not have', async () => {
    await job('morning-briefing').run();
    expect(runtimeCalls[0]!.prompt).toMatch(/NO calorie or protein target/);
  });

  it("carries the day's real anchors in the snapshot rather than asking Ben what's on", async () => {
    await job('morning-briefing').run();
    const snapshot = JSON.stringify(runtimeCalls[0]);
    // Whatever weekday the test runs on, an anchors array is present.
    expect(snapshot).toMatch(/anchors/);
    expect(snapshot).toMatch(/adherence/);
  });

  it('derives habits before reporting adherence, so a late log still counts', async () => {
    cabinet.db
      .prepare('INSERT INTO goal (id, title, domain, target_value, unit, cadence) VALUES (?,?,?,?,?,?)')
      .run(1, 'Morning weigh-in logged (floor 1)', 'health', 1, 'log', 'daily');
    cabinet.db
      .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)')
      .run(new Date().toISOString(), localDay(), 'weight_lb', 278.4);

    await job('morning-briefing').run();
    expect(adherence(cabinet.db, 1).find((r) => r.goal_id === 1)?.actual).toBe(1);
  });
});

describe('weekly review timing', () => {
  it('runs Sunday EVENING, not Sunday morning', () => {
    const next = job('weekly-review').next(new Date('2026-08-03T12:00:00Z'))!;
    const p = nyParts(next);
    expect(p.dow).toBe(0); // Sunday
    expect(p.hh).toBe(19);
    expect(p.mm).toBe(30);
  });
});

describe('maintenance', () => {
  it('re-derives the trailing fortnight so late-landing data counts', async () => {
    cabinet.db
      .prepare('INSERT INTO goal (id, title, domain, target_value, unit, cadence) VALUES (?,?,?,?,?,?)')
      .run(1, 'Morning weigh-in logged (floor 1)', 'health', 1, 'log', 'daily');
    // A weight backdated three days — exactly the case the nightly sweep exists
    // for, since no brief ever ran a derivation for that day afterward.
    const threeDaysAgo = localDay(new Date(Date.now() - 3 * 86_400_000));
    cabinet.db
      .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)')
      .run(`${threeDaysAgo}T12:00:00Z`, threeDaysAgo, 'weight_lb', 279.1);

    expect(adherence(cabinet.db, 7).find((r) => r.goal_id === 1)?.actual).toBe(0);
    await job('maintenance').run();
    expect(adherence(cabinet.db, 7).find((r) => r.goal_id === 1)?.actual).toBe(1);
  });
});
