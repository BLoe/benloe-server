import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REVIEW_EVENT, accepts, inlineComment, renderFailureBody, renderReviewBody } from '../src/format.mjs';

const base = { summary: 'Adds a thing.', headSha: 'abcdef1234567890', durationMs: 60_000 };

test('a clean review says so and does not imply work remains', () => {
  const md = renderReviewBody({ ...base, bodyFindings: [], inlineFindings: [] });
  assert.match(md, /accepted\. Nothing found/);
  assert.match(md, /0 critical · 0 important · 0 suggestions/);
});

test('a critical finding drives the verdict', () => {
  const md = renderReviewBody({
    ...base,
    bodyFindings: [{ severity: 'critical', title: 'Token in diff', detail: 'x' }],
    inlineFindings: [],
  });
  assert.match(md, /not accepted/);
  assert.match(md, /1 critical/);
});

test('important findings do not claim the PR is unmergeable', () => {
  const md = renderReviewBody({
    ...base,
    bodyFindings: [{ severity: 'important', title: 'No test', detail: 'x' }],
    inlineFindings: [],
  });
  assert.match(md, /not accepted/);
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

test('acceptance blocks on critical and important, not on suggestions', () => {
  assert.ok(accepts([]));
  assert.ok(accepts([{ severity: 'suggestion' }, { severity: 'suggestion' }]));
  assert.ok(!accepts([{ severity: 'important' }]));
  assert.ok(!accepts([{ severity: 'critical' }]));
  assert.ok(!accepts([{ severity: 'suggestion' }, { severity: 'important' }]));
});

test('the review event approves when clean and never requests changes', () => {
  assert.equal(REVIEW_EVENT([]), 'APPROVE');
  assert.equal(REVIEW_EVENT([{ severity: 'suggestion' }]), 'APPROVE');
  assert.equal(REVIEW_EVENT([{ severity: 'important' }]), 'COMMENT');
  assert.equal(REVIEW_EVENT([{ severity: 'critical' }]), 'COMMENT');
  // A stochastic reviewer that can block would wedge the queue on one
  // confident false positive, unattended.
  for (const f of [[], [{ severity: 'critical' }], [{ severity: 'important' }], [{ severity: 'suggestion' }]]) {
    assert.notEqual(REVIEW_EVENT(f), 'REQUEST_CHANGES');
  }
});

test('the rendered verdict never disagrees with the posted event', () => {
  // These are two renderings of one decision; drift between them would show a
  // reader "accepted" on a PR GitHub shows as merely commented, or worse.
  const cases = [
    [[], true],
    [[{ severity: 'suggestion', title: 't', detail: 'd' }], true],
    [[{ severity: 'important', title: 't', detail: 'd' }], false],
    [[{ severity: 'critical', title: 't', detail: 'd' }], false],
    [[{ severity: 'critical', title: 't', detail: 'd' }, { severity: 'suggestion', title: 'u', detail: 'd' }], false],
  ];
  for (const [findings, shouldAccept] of cases) {
    const md = renderReviewBody({ ...base, bodyFindings: findings, inlineFindings: [] });
    assert.equal(REVIEW_EVENT(findings) === 'APPROVE', shouldAccept);
    assert.equal(/Verdict: accepted/.test(md), shouldAccept, `verdict text disagreed for ${JSON.stringify(findings)}`);
  }
});
