import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inlineComment, renderFailureBody, renderReviewBody } from '../src/format.mjs';

const base = { summary: 'Adds a thing.', headSha: 'abcdef1234567890', durationMs: 60_000 };

test('a clean review says so and does not imply work remains', () => {
  const md = renderReviewBody({ ...base, bodyFindings: [], inlineFindings: [] });
  assert.match(md, /Nothing found/);
  assert.match(md, /0 critical · 0 important · 0 suggestions/);
});

test('a critical finding drives the verdict', () => {
  const md = renderReviewBody({
    ...base,
    bodyFindings: [{ severity: 'critical', title: 'Token in diff', detail: 'x' }],
    inlineFindings: [],
  });
  assert.match(md, /needs changes before merge/);
  assert.match(md, /1 critical/);
});

test('important findings do not claim the PR is unmergeable', () => {
  const md = renderReviewBody({
    ...base,
    bodyFindings: [{ severity: 'important', title: 'No test', detail: 'x' }],
    inlineFindings: [],
  });
  assert.match(md, /mergeable, but/);
});

test('inline findings are counted in the body and linked, not duplicated in full', () => {
  const md = renderReviewBody({
    ...base,
    bodyFindings: [],
    inlineFindings: [{ severity: 'important', title: 'Off by one', detail: 'the long explanation', file: 'a.ts', line: 12 }],
  });
  assert.match(md, /1 important/);
  assert.match(md, /inline at `a\.ts:12`/);
  assert.ok(!md.includes('the long explanation'), 'inline detail should not be repeated in the body');
});

test('body findings keep their full detail and location', () => {
  const md = renderReviewBody({
    ...base,
    bodyFindings: [{ severity: 'suggestion', title: 'Rename', detail: 'because clarity', file: 'b.ts', line: 4 }],
    inlineFindings: [],
  });
  assert.match(md, /because clarity/);
  assert.match(md, /`b\.ts:4`/);
});

test('the strengths section is omitted when there is nothing to say', () => {
  assert.ok(!renderReviewBody({ ...base, bodyFindings: [], inlineFindings: [] }).includes('Worth keeping'));
  assert.match(
    renderReviewBody({ ...base, strengths: ['good tests'], bodyFindings: [], inlineFindings: [] }),
    /Worth keeping/,
  );
});

test('a failure body is unmistakably a reviewer failure, not a clean bill of health', () => {
  const md = renderFailureBody('claude exited 1', 'abcdef1234567890');
  assert.match(md, /failed/i);
  assert.match(md, /has not been reviewed/);
  assert.ok(!/Verdict/.test(md));
});

test('inlineComment builds the shape the GitHub reviews API expects', () => {
  const c = inlineComment({ severity: 'critical', title: 'T', detail: 'D', file: 'a.ts', line: 3, agent: 'code-reviewer' });
  assert.deepEqual(Object.keys(c).sort(), ['body', 'line', 'path']);
  assert.equal(c.path, 'a.ts');
  assert.equal(c.line, 3);
  assert.match(c.body, /Critical: T/);
  assert.match(c.body, /code-reviewer/);
});
