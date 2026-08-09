import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressableLines, addressableMap, partitionFindings } from '../src/diff.mjs';

test('addressableLines counts added and context lines, not deletions', () => {
  const patch = ['@@ -1,3 +1,4 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;', '+const c = 4;', ' const d = 5;'].join('\n');
  // Right side: 1 context, 2 added, 3 added, 4 context. The deleted line
  // consumes no right-side number, which is the whole point of the filter.
  assert.deepEqual([...addressableLines(patch)].sort((x, y) => x - y), [1, 2, 3, 4]);
});

test('addressableLines honours the hunk header start line', () => {
  const patch = ['@@ -40,2 +120,2 @@ function f()', ' keep', '+added'].join('\n');
  assert.deepEqual([...addressableLines(patch)].sort((x, y) => x - y), [120, 121]);
});

test('addressableLines handles multiple hunks independently', () => {
  const patch = ['@@ -1,1 +1,1 @@', '+one', '@@ -50,1 +60,2 @@', ' ctx', '+two'].join('\n');
  assert.deepEqual([...addressableLines(patch)].sort((x, y) => x - y), [1, 60, 61]);
});

test('addressableLines ignores the no-newline marker', () => {
  const patch = ['@@ -1,1 +1,1 @@', '+one', '\\ No newline at end of file'].join('\n');
  assert.deepEqual([...addressableLines(patch)], [1]);
});

test('addressableLines returns empty for a missing patch (binary or truncated file)', () => {
  assert.equal(addressableLines(undefined).size, 0);
  assert.equal(addressableLines('').size, 0);
});

test('addressableLines ignores content before the first hunk header', () => {
  const patch = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,1 +5,1 @@', '+five'].join('\n');
  assert.deepEqual([...addressableLines(patch)], [5]);
});

test('partitionFindings sends unanchorable findings to the body, never drops them', () => {
  const map = addressableMap([{ filename: 'a.ts', patch: '@@ -1,1 +1,2 @@\n ctx\n+added' }]);
  const findings = [
    { file: 'a.ts', line: 2, title: 'anchored' },
    { file: 'a.ts', line: 99, title: 'line outside the diff' },
    { file: 'other.ts', line: 1, title: 'file not in the PR' },
    { title: 'no location at all' },
  ];
  const { inline, body } = partitionFindings(findings, map);
  assert.deepEqual(inline.map((f) => f.title), ['anchored']);
  assert.deepEqual(body.map((f) => f.title), ['line outside the diff', 'file not in the PR', 'no location at all']);
  assert.equal(inline.length + body.length, findings.length);
});

test('partitionFindings rejects a non-integer line rather than sending GitHub a bad anchor', () => {
  const map = addressableMap([{ filename: 'a.ts', patch: '@@ -1,1 +1,2 @@\n ctx\n+added' }]);
  const { inline, body } = partitionFindings([{ file: 'a.ts', line: '2', title: 'stringy' }], map);
  assert.equal(inline.length, 0);
  assert.equal(body.length, 1);
});
