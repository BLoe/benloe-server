import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadState, markReviewed, saveState, wasReviewed } from '../src/state.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'pr-reviewer-')), 'state.json');

test('a missing state file reads as empty rather than throwing', () => {
  assert.deepEqual(loadState(join(tmpdir(), 'definitely-not-here', 'state.json')), { reviewed: {} });
});

test('round-trips a reviewed sha', () => {
  const path = tmp();
  saveState(path, markReviewed({ reviewed: {} }, 'abc123'));
  assert.ok(wasReviewed(loadState(path), 'abc123'));
  assert.ok(!wasReviewed(loadState(path), 'def456'));
});

test('a corrupt state file degrades to empty instead of crash-looping the timer', () => {
  const path = tmp();
  writeFileSync(path, '{ this is not json');
  assert.deepEqual(loadState(path), { reviewed: {} });
});

test('a structurally wrong state file is also rejected', () => {
  const path = tmp();
  writeFileSync(path, '["an array, not an object"]');
  assert.deepEqual(loadState(path), { reviewed: {} });
});

test('entries older than the retention window are pruned on save', () => {
  const path = tmp();
  const now = new Date('2026-08-09T00:00:00Z');
  const state = {
    reviewed: {
      fresh: '2026-08-01T00:00:00Z',
      stale: '2026-01-01T00:00:00Z',
    },
  };
  saveState(path, state, now);
  const back = loadState(path);
  assert.ok(wasReviewed(back, 'fresh'));
  assert.ok(!wasReviewed(back, 'stale'));
});

test('save leaves no .tmp file behind', () => {
  const path = tmp();
  saveState(path, markReviewed({ reviewed: {} }, 'abc'));
  assert.throws(() => readFileSync(`${path}.tmp`));
});
