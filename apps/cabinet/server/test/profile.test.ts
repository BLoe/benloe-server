import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { MemoryStore } from '../src/memory/index.js';
import { profileGap } from '../src/domains/profile.js';
import { upsertConstraint, upsertGoal } from '../src/domains/misc.js';
import { logBodyMetric } from '../src/domains/training.js';

let dir: string;
let cabinet: CabinetDb;
let memory: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-profile-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  memory = new MemoryStore(join(dir, 'memory'));
  memory.ensureTemplates();
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The v2 gate (2026-08-01) is four things, not twelve: a confirmed health
 * plan, at least one live goal projected from it, both constraint categories
 * genuinely asked about, and the baseline measurements the plan's math needs
 * (height specifically, plus any body metric). The eight rolling-narrative
 * files v1 demanded are no longer gates — they fill in when the topic comes up.
 */
type Dimension = 'plan' | 'goal' | 'height' | 'metric' | 'dietary' | 'physical';

function fillEverythingExcept(skip: Dimension | null) {
  if (skip !== 'plan') {
    memory.update('plans/health.md', '# PLAN: health\n\nPhase 0 confirmed with Ben 2026-08-01. 2,300 kcal, 190g protein.', 'confirmed');
  }
  if (skip !== 'goal') upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
  // The live schema names the unit into the metric ('height_in'), so the
  // test uses the real shape rather than a tidier invented one.
  if (skip !== 'height') logBodyMetric(cabinet.db, { metric: 'height_in', value: 72 });
  if (skip !== 'metric') logBodyMetric(cabinet.db, { metric: 'weight_lb', value: 278 });
  if (skip !== 'dietary') upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true });
  if (skip !== 'physical') upsertConstraint(cabinet.db, { kind: 'physical', confirmedNone: true });
}

describe('profileGap (v2: outcomes, not form fields)', () => {
  it('returns a non-null gap on a completely fresh profile', () => {
    const gap = profileGap(cabinet.db, memory);
    expect(gap).not.toBeNull();
    expect(gap).toContain('health plan');
    expect(gap).toContain('constraints never asked about');
  });

  it('names outcomes and NEVER tool names or raw field lists — the v1 bug that turned onboarding into an intake form', () => {
    const gap = profileGap(cabinet.db, memory) ?? '';
    for (const leak of ['upsert_goal', 'upsert_constraint', 'log_body_metric', 'update_memory', 'hard_constraint', 'confirmedNone']) {
      expect(gap).not.toContain(leak);
    }
    // And it says how to close them, because the agent recites this line.
    expect(gap).toContain('counsel conversation, not a form');
  });

  it('returns null once every dimension is satisfied — a confirmed-none SENTINEL alone is sufficient, not just real rows', () => {
    fillEverythingExcept(null);
    expect(listConstraintsAreSentinelsOnly()).toBe(true); // sanity: really exercising the sentinel path
    expect(profileGap(cabinet.db, memory)).toBeNull();
  });

  function listConstraintsAreSentinelsOnly(): boolean {
    const rows = cabinet.db.prepare('SELECT is_none_confirmation FROM hard_constraint').all() as { is_none_confirmation: number }[];
    return rows.length === 2 && rows.every((r) => r.is_none_confirmation === 1);
  }

  it('a real constraint row (not a sentinel) also satisfies its dimension', () => {
    fillEverythingExcept('dietary');
    upsertConstraint(cabinet.db, { kind: 'dietary', subject: 'shellfish', severity: 'allergy' });
    expect(profileGap(cabinet.db, memory)).toBeNull();
  });

  it.each<Dimension>(['plan', 'goal', 'height', 'metric', 'dietary', 'physical'])(
    'stays non-null when only %s is missing',
    (skip) => {
      fillEverythingExcept(skip);
      expect(profileGap(cabinet.db, memory)).not.toBeNull();
    },
  );

  it('a still-template plans/health.md does not count as a confirmed plan', () => {
    fillEverythingExcept('plan');
    // The seeded template is present on disk — presence is not confirmation.
    expect(memory.read('plans/health.md')).toContain('PHASE 0');
    expect(profileGap(cabinet.db, memory)).toContain('health plan');
  });

  it('the narrative domain files are no longer gates — an untouched domains/money.md does not block', () => {
    fillEverythingExcept(null);
    expect(memory.read('domains/money.md')).toContain('rolling narrative'); // still the template
    expect(profileGap(cabinet.db, memory)).toBeNull();
  });
});
