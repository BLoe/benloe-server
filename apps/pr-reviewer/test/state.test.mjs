import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  alreadyReportedFailure,
  loadState,
  markFailureReported,
  markReviewed,
  saveState,
  wasReviewed,
} from '../src/state.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'pr-reviewer-')), 'state.json');

test('a missing state file reads as empty rather than throwing', () => {
  assert.deepEqual(loadState(join(tmpdir(), 'definitely-not-here', 'state.json')), { reviewed: {}, failed: {} });
});

test('an identical failure is reported once per sha, not every five minutes forever', () => {
  const state = { reviewed: {}, failed: {} };
  const err = 'claude killed by SIGKILL\nstderr tail that varies between runs 12:04:11';
  assert.ok(!alreadyReportedFailure(state, 'abc', err));
  markFailureReported(state, 'abc', err);
  assert.ok(alreadyReportedFailure(state, 'abc', err));
  // The volatile stderr tail must not defeat de-duplication.
  assert.ok(alreadyReportedFailure(state, 'abc', 'claude killed by SIGKILL\ndifferent tail at 12:09:52'));
});

test('a different failure on the same sha is still reported', () => {
  const state = { reviewed: {}, failed: {} };
  markFailureReported(state, 'abc', 'orchestrator exceeded 20m timeout');
  assert.ok(!alreadyReportedFailure(state, 'abc', 'claude exited 1'));
});

test('a later successful review clears the recorded failure', () => {
  const state = { reviewed: {}, failed: {} };
  markFailureReported(state, 'abc', 'transient');
  markReviewed(state, 'abc');
  assert.ok(!alreadyReportedFailure(state, 'abc', 'transient'));
});

test('failure records survive a save/load round trip and are pruned with the rest', () => {
  const path = tmp();
  const state = { reviewed: {}, failed: {} };
  markFailureReported(state, 'fresh', 'boom', new Date('2026-08-08T00:00:00Z'));
  markFailureReported(state, 'stale', 'boom', new Date('2026-01-01T00:00:00Z'));
  saveState(path, state, new Date('2026-08-09T00:00:00Z'));
  const back = loadState(path);
  assert.ok(alreadyReportedFailure(back, 'fresh', 'boom'));
  assert.ok(!alreadyReportedFailure(back, 'stale', 'boom'));
});

test('a pre-existing ledger without a failed map still loads', () => {
  const path = tmp();
  writeFileSync(path, JSON.stringify({ reviewed: { abc: '2026-08-08T00:00:00Z' } }));
  const back = loadState(path);
  assert.ok(wasReviewed(back, 'abc'));
  assert.deepEqual(back.failed, {});
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
  assert.deepEqual(loadState(path), { reviewed: {}, failed: {} });
});

test('a structurally wrong state file is also rejected', () => {
  const path = tmp();
  writeFileSync(path, '["an array, not an object"]');
  assert.deepEqual(loadState(path), { reviewed: {}, failed: {} });
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
