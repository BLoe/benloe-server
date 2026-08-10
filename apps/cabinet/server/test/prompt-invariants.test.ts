import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryStore } from '../src/memory/index.js';
import { TURN_DISCIPLINE, assemblePrompt } from '../src/runtime/prompt.js';

/**
 * Assertions about the prompt itself: no model, no network, no cost.
 *
 * These exist because the prompt architecture is being changed, and several of
 * its load-bearing properties were documented in prose and enforced by nothing
 * — most notably the byte-identical systemPrompt, whose violation has already
 * cost the prompt cache once (runtime/prompt.ts, verified 2026-07-09).
 */
function store(): MemoryStore {
  const dir = mkdtempSync(join(tmpdir(), 'cabinet-prompt-'));
  const mem = new MemoryStore(dir);
  mem.ensureTemplates();
  return mem;
}

describe('systemPrompt is stable across turns', () => {
  it('is byte-identical when only volatile inputs change', () => {
    // The cache-hit property AND the session-pool property: SessionSpec keys
    // the pool on this string's hash, so anything time-varying here respawns
    // the CLI subprocess (~3.1s) on every single turn.
    const mem = store();
    const a = assemblePrompt(mem, { kind: 'user', now: new Date('2026-08-10T12:00:00Z') });
    const b = assemblePrompt(mem, {
      kind: 'user',
      now: new Date('2026-08-11T23:59:59Z'),
      capacity: 'Account utilization: 71%.',
      interlocutor: { name: 'Ben', role: 'user', isOwner: true },
      lessons: [{ text: 'a recalled lesson', domain: 'health' }],
      snapshot: 'weight 278.4',
      profileGap: 'no confirmed plan yet',
      domainFiles: ['domains/health.md'],
    });
    expect(b.systemPrompt).toBe(a.systemPrompt);
  });

  it('carries none of the volatile values', () => {
    const mem = store();
    const { systemPrompt } = assemblePrompt(mem, {
      kind: 'user',
      now: new Date('2026-08-10T12:00:00Z'),
      snapshot: 'SNAPSHOT_SENTINEL',
      capacity: 'CAPACITY_SENTINEL',
      profileGap: 'GAP_SENTINEL',
      interlocutor: { name: 'INTERLOCUTOR_SENTINEL', role: 'user', isOwner: true },
      lessons: [{ text: 'LESSON_SENTINEL', domain: 'health' }],
    });
    for (const sentinel of ['SNAPSHOT', 'CAPACITY', 'GAP', 'INTERLOCUTOR', 'LESSON']) {
      expect(systemPrompt).not.toContain(`${sentinel}_SENTINEL`);
    }
    expect(systemPrompt).not.toContain('2026-08-10');
  });
});

describe('turnContext ordering', () => {
  it('ends with TURN_DISCIPLINE, so it lands immediately before Ben words', () => {
    // The highest-salience position available, and the reason the block exists
    // at all rather than living in a memory file.
    const mem = store();
    const { turnContext } = assemblePrompt(mem, {
      kind: 'user',
      snapshot: 'x',
      domainFiles: ['domains/health.md'],
    });
    expect(turnContext.endsWith(TURN_DISCIPLINE)).toBe(true);
  });

  it('puts the capacity line early, where it cannot compete for that slot', () => {
    const mem = store();
    const { turnContext } = assemblePrompt(mem, { kind: 'user', capacity: 'CAP_LINE' });
    expect(turnContext.indexOf('CAP_LINE')).toBeLessThan(turnContext.indexOf('<turn-discipline>'));
  });

  it('omits TURN_DISCIPLINE on heartbeats, which have nobody to narrate to', () => {
    const mem = store();
    const { turnContext } = assemblePrompt(mem, { kind: 'heartbeat' });
    expect(turnContext).not.toContain('<turn-discipline>');
  });
});

describe('the length rule can actually fire', () => {
  it('states a length expectation unconditionally, not only for one register', () => {
    // The regression this guards: from 2026-08-01 to 2026-08-10 the only
    // length instruction was scoped to desk register, and desk was never once
    // assigned in production — so the rule applied to nothing. A conditional
    // length rule must never be the only length rule again.
    const length = TURN_DISCIPLINE.slice(TURN_DISCIPLINE.indexOf('Length:'));
    const firstSentence = length.slice(0, length.indexOf('\n\n'));
    // Not just "does not say desk": ANY conditional in the opening clause
    // re-scopes the rule, and re-scoping it to some other never-true state is
    // the same bug wearing a different name.
    expect(firstSentence).not.toMatch(/\bregister\b|\bmode\b|\bif\b|\bwhen\b|\bunless\b|\bexcept\b|\bexempt\b/i);
    expect(firstSentence).toMatch(/short|brief|match the reply/i);
  });

  it('treats counsel as a widening rather than an exemption', () => {
    expect(TURN_DISCIPLINE).not.toMatch(/limits are suspended/i);
    expect(TURN_DISCIPLINE).toMatch(/widening of this rule, not an exemption/i);
  });

  it('shows the wanted shape by example, which steers better than prohibition', () => {
    expect(TURN_DISCIPLINE).toMatch(/RIGHT:/);
    expect(TURN_DISCIPLINE).toMatch(/WRONG:/);
  });

  it('tells the model to report consequence rather than mechanism, without licensing silence', () => {
    // The prohibition alone would collide with a rule this system holds
    // harder — silent failure is worse than noisy failure — so the escape
    // clause is load-bearing and must not be edited away as redundant.
    expect(TURN_DISCIPLINE).toMatch(/plumbing is not news/i);
    expect(TURN_DISCIPLINE).toMatch(/not permission to hide a failure/i);
  });

  it('still contains no self-verification instruction', () => {
    // Anthropic's Opus 5 guidance is explicit that "double-check your work"
    // style instructions compound into over-verification on this model and
    // should be REMOVED rather than reworded.
    expect(TURN_DISCIPLINE).not.toMatch(/double[- ]check|verify before responding|re-verify/i);
  });
});

describe('memory files a turn depends on', () => {
  it('drops a domain file that does not exist rather than failing the turn', () => {
    const mem = store();
    expect(() => assemblePrompt(mem, { kind: 'user', domainFiles: ['domains/nope.md'] })).not.toThrow();
  });

  it('places CORRECTIONS.md immediately AFTER USER.md, which is how it outranks it', () => {
    // The name of this test used to say "ahead of", while its assertion said
    // the opposite — and the assertion was the correct one, so the test could
    // not fail and actively misled a reader about the precedence rule.
    //
    // CORRECTIONS is append-only and wins conflicts with USER.md. It wins by
    // coming LATER: memory/index.ts puts it immediately after USER.md so the
    // correction is the last thing read on that subject. Adjacency is the
    // property worth pinning, not merely relative order — an unrelated file
    // inserted between them would break the intent while passing a
    // less-than check.
    const mem = store();
    const dir = (mem as unknown as { dir: string }).dir;
    writeFileSync(join(dir, 'CORRECTIONS.md'), '# CORRECTIONS\nC-1 | a correction\n');
    writeFileSync(join(dir, 'USER.md'), '# USER\nsomething about Ben\n');
    const { systemPrompt } = assemblePrompt(mem, { kind: 'user' });
    const files = [...systemPrompt.matchAll(/<memory file="([^"]+)">/g)].map((m) => m[1]);
    expect(files).toContain('CORRECTIONS.md');
    expect(files.indexOf('CORRECTIONS.md')).toBe(files.indexOf('USER.md') + 1);
  });
});
