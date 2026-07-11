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

type Dimension =
  | 'goal'
  | 'metric'
  | 'user'
  | 'health'
  | 'training'
  | 'nutrition'
  | 'mind'
  | 'money'
  | 'admin'
  | 'social'
  | 'dietary'
  | 'physical';

const NARRATIVE_DIMENSIONS: Record<string, string> = {
  user: 'USER.md',
  health: 'domains/health.md',
  training: 'domains/training.md',
  nutrition: 'domains/nutrition.md',
  mind: 'domains/mind.md',
  money: 'domains/money.md',
  admin: 'domains/admin.md',
  social: 'domains/social.md',
};

/** Fills every completeness dimension except `skip` — dietary/physical are filled via the confirmedNone sentinel, not a real row. */
function fillEverythingExcept(skip: Dimension | null) {
  if (skip !== 'goal') upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
  if (skip !== 'metric') logBodyMetric(cabinet.db, { metric: 'weight_lb', value: 198 });
  for (const [dim, file] of Object.entries(NARRATIVE_DIMENSIONS)) {
    if (skip !== dim) memory.update(file, `# ${file}\n\nreal onboarding content, not the seed template.`, 'seed');
  }
  if (skip !== 'dietary') upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true });
  if (skip !== 'physical') upsertConstraint(cabinet.db, { kind: 'physical', confirmedNone: true });
}

describe('profileGap (mentorship Phase B: onboarding completeness gate)', () => {
  it('returns a non-null gap description on a completely fresh profile', () => {
    const gap = profileGap(cabinet.db, memory);
    expect(gap).not.toBeNull();
    expect(gap).toContain('goals');
    expect(gap).toContain('dietary');
    expect(gap).toContain('physical');
  });

  it('returns null once every dimension is satisfied — proves a confirmed-none SENTINEL alone (no real constraint rows) is sufficient, not just real rows', () => {
    fillEverythingExcept(null);
    expect(listConstraintsAreSentinelsOnly()).toBe(true); // sanity: this test really is exercising the sentinel path
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

  it.each<Dimension>([
    'goal',
    'metric',
    'user',
    'health',
    'training',
    'nutrition',
    'mind',
    'money',
    'admin',
    'social',
    'dietary',
    'physical',
  ])('stays non-null when only %s is missing', (skip) => {
    fillEverythingExcept(skip);
    expect(profileGap(cabinet.db, memory)).not.toBeNull();
  });

  it('mentions the specific missing dimension by name, not just "incomplete"', () => {
    fillEverythingExcept('physical');
    expect(profileGap(cabinet.db, memory)).toContain('physical constraints');
  });
});
