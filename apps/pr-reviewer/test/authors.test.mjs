import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_ALLOWED_AUTHORS, isAllowedAuthor, parseAllowedAuthors, selectPulls } from '../src/authors.mjs';

test('the default allowlist is exactly this set', () => {
  // Pinned by literal, not against the constant itself. CLAUDE.md calls this
  // "the primary prompt-injection control", and the sibling control
  // (ALLOWED_TOOLS) is pinned the same way: a widening must be a deliberate,
  // reviewable edit to a test, not something an agent slips into a list.
  assert.deepEqual(DEFAULT_ALLOWED_AUTHORS, ['BLoe', 'cabinet-benloe[bot]']);
});

test('an unset allowlist falls back to the default', () => {
  assert.deepEqual(parseAllowedAuthors(undefined), DEFAULT_ALLOWED_AUTHORS);
  assert.deepEqual(parseAllowedAuthors(''), DEFAULT_ALLOWED_AUTHORS);
  assert.deepEqual(parseAllowedAuthors('   '), DEFAULT_ALLOWED_AUTHORS);
});

test('a configured allowlist replaces the default and tolerates spacing', () => {
  assert.deepEqual(parseAllowedAuthors(' BLoe , benloe-carpenter[bot] ,'), ['BLoe', 'benloe-carpenter[bot]']);
});

test('an allowlist of nothing but separators fails loudly instead of silently defaulting', () => {
  assert.throws(() => parseAllowedAuthors(',,,'), /no logins/);
});

test('allowed authors match case-insensitively', () => {
  const allowed = ['BLoe', 'cabinet-benloe[bot]'];
  for (const login of ['BLoe', 'bloe', 'BLOE', 'cabinet-benloe[bot]', 'Cabinet-Benloe[bot]']) {
    assert.ok(isAllowedAuthor(login, allowed), `${login} should be allowed`);
  }
});

test('the [bot] suffix is significant — a bot actor and a plain account are different principals', () => {
  // An earlier version stripped [bot] from BOTH sides to be forgiving about a
  // hand-typed env var, which also made an ordinary account named
  // "cabinet-benloe" match the bot entry.
  assert.ok(!isAllowedAuthor('cabinet-benloe', ['cabinet-benloe[bot]']));
  assert.ok(!isAllowedAuthor('cabinet-benloe[bot]', ['cabinet-benloe']));
});

test('a stranger is refused', () => {
  assert.ok(!isAllowedAuthor('some-drive-by', ['BLoe']));
});

test('a lookalike login is refused rather than prefix-matched', () => {
  // The dangerous near-miss: substring or prefix matching would let
  // "bloe-attacker" or "notbloe" through.
  const allowed = ['BLoe', 'cabinet-benloe[bot]'];
  for (const login of ['bloe-attacker', 'notbloe', 'cabinet-benloe-evil', 'xcabinet-benloe']) {
    assert.ok(!isAllowedAuthor(login, allowed), `${login} must not be allowed`);
  }
});

test('a missing or empty author fails closed', () => {
  // A PR whose account was deleted has no user object; that must not fall
  // through into a review.
  for (const login of [undefined, null, '', '   ']) {
    assert.ok(!isAllowedAuthor(login, ['BLoe']));
  }
});

test('an empty allowlist reviews nobody rather than everybody', () => {
  assert.ok(!isAllowedAuthor('BLoe', []));
});

const pr = (number, login, extra = {}) => ({ number, user: { login }, head: { sha: `sha${number}` }, draft: false, ...extra });
const opts = (over = {}) => ({
  allowedAuthors: ['BLoe'],
  includeDrafts: false,
  onlyPr: null,
  dryRun: false,
  isReviewed: () => false,
  ...over,
});

test('selectPulls never lets a stranger through to the orchestrator', () => {
  // The property that actually matters. It used to live inline in main(),
  // which self-invokes on import and so could not be tested at all — deleting
  // the check left the entire suite green.
  const pulls = [pr(1, 'BLoe'), pr(2, 'drive-by'), pr(3, 'cabinet-benloe[bot]')];
  const { reviewable, declined } = selectPulls(pulls, opts());
  assert.deepEqual(reviewable.map((p) => p.number), [1]);
  assert.deepEqual(declined.map((d) => d.pr.number), [2, 3]);
  assert.match(declined[0].reason, /drive-by not in allowlist/);
});

test('selectPulls reports a missing author by name rather than crashing', () => {
  const { declined } = selectPulls([{ number: 9, head: { sha: 'x' } }], opts());
  assert.match(declined[0].reason, /\(none\) not in allowlist/);
});

test('selectPulls skips drafts, already-reviewed shas, and other PRs under onlyPr', () => {
  const pulls = [pr(1, 'BLoe'), pr(2, 'BLoe', { draft: true }), pr(3, 'BLoe')];
  assert.deepEqual(selectPulls(pulls, opts()).reviewable.map((p) => p.number), [1, 3]);
  assert.deepEqual(selectPulls(pulls, opts({ includeDrafts: true })).reviewable.map((p) => p.number), [1, 2, 3]);
  assert.deepEqual(selectPulls(pulls, opts({ onlyPr: 3 })).reviewable.map((p) => p.number), [3]);
  assert.deepEqual(selectPulls(pulls, opts({ isReviewed: (s) => s === 'sha1' })).reviewable.map((p) => p.number), [3]);
});

test('a dry run ignores the ledger but never ignores the allowlist', () => {
  const pulls = [pr(1, 'BLoe'), pr(2, 'drive-by')];
  const { reviewable, declined } = selectPulls(pulls, opts({ dryRun: true, isReviewed: () => true }));
  assert.deepEqual(reviewable.map((p) => p.number), [1]);
  assert.deepEqual(declined.map((d) => d.pr.number), [2]);
});

test('every skip carries a reason, not just the allowlist one', () => {
  // The docstring and the log both claimed all skips were reported while three
  // of the four branches dropped silently — a PR skipped as a draft looked
  // identical to one never seen.
  const pulls = [pr(1, 'BLoe'), pr(2, 'stranger'), pr(3, 'BLoe', { draft: true }), pr(4, 'BLoe')];
  const { reviewable, skipped } = selectPulls(pulls, opts({ isReviewed: (s) => s === 'sha4' }));
  assert.deepEqual(reviewable.map((p) => p.number), [1]);
  assert.equal(skipped.length, 3);
  for (const s of skipped) assert.ok(s.reason && s.kind, `#${s.pr.number} skipped without a reason`);
  assert.deepEqual(skipped.filter((s) => s.kind === 'declined').map((s) => s.pr.number), [2]);
  assert.deepEqual(skipped.filter((s) => s.kind === 'routine').map((s) => s.pr.number), [3, 4]);
  assert.match(skipped.find((s) => s.pr.number === 3).reason, /draft/);
  assert.match(skipped.find((s) => s.pr.number === 4).reason, /already reviewed/);
});

test('onlyPr skips are reported rather than dropped', () => {
  const { skipped } = selectPulls([pr(1, 'BLoe'), pr(2, 'BLoe')], opts({ onlyPr: 1 }));
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /PR_REVIEWER_ONLY_PR/);
});

test('declines are counted even when nothing is reviewable', () => {
  // Drives the summary line that must not read like a healthy idle tick.
  const { reviewable, declined } = selectPulls([pr(1, 'nope'), pr(2, 'also-nope')], opts());
  assert.equal(reviewable.length, 0);
  assert.equal(declined.length, 2);
});
