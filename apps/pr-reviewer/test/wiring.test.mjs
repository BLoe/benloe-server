import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Importing poll.mjs is the whole point of this file.
 *
 * Every other test imports a leaf module, so a name poll.mjs imports but
 * github.mjs never exported produced a green suite and a dead service — an ESM
 * link error surfaces only when the module is actually loaded, and
 * `node --check` does not link. On 2026-08-10 that shipped and the reviewer
 * was down until someone read the log.
 *
 * poll.mjs no longer self-invokes on import, which is what makes this safe.
 */
test('poll.mjs links — every name it imports actually exists', async () => {
  const mod = await import('../src/poll.mjs');
  assert.ok(mod.CONFIG, 'CONFIG should be exported');
  assert.equal(typeof mod.main, 'function');
  assert.equal(typeof mod.reviewOne, 'function');
});

test('importing poll.mjs does not start a poll', async () => {
  // If it self-invoked, importing it here would hit GitHub and could post a
  // real review from a test run. The previous version of this test compared
  // process.exitCode before and after the import, which is unchanged whether
  // or not main() ran — it could not fail. isDirectRun is the actual switch,
  // so assert on that: under the test runner argv[1] is the runner, not
  // poll.mjs, and this flips to true the moment someone reintroduces an
  // unconditional main().
  const mod = await import('../src/poll.mjs');
  assert.equal(mod.isDirectRun, false, 'poll.mjs must not consider itself directly run under a test');
});

test('every src module links', async () => {
  for (const name of ['authors.mjs', 'diff.mjs', 'format.mjs', 'github.mjs', 'review.mjs', 'state.mjs']) {
    const mod = await import(`../src/${name}`);
    assert.ok(Object.keys(mod).length > 0, `${name} exported nothing`);
  }
});
