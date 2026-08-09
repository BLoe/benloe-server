import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ALLOWED_TOOLS, parseResult, renderPrompt } from '../src/review.mjs';

test('renderPrompt substitutes every placeholder', () => {
  const out = renderPrompt('PR {{NUMBER}} in {{REPO}} by {{AUTHOR}}', { NUMBER: 7, REPO: 'a/b', AUTHOR: 'ben' });
  assert.equal(out, 'PR 7 in a/b by ben');
});

test('renderPrompt blanks an unsupplied placeholder rather than leaving the literal', () => {
  // A literal "{{BODY}}" reaching the model reads as a template bug the model
  // will then try to interpret; an empty string is unambiguous.
  assert.equal(renderPrompt('body: {{BODY}}.', {}), 'body: .');
});

test('parseResult unwraps the doubly-encoded structured output', () => {
  const stdout = JSON.stringify({
    is_error: false,
    result: JSON.stringify({ summary: 'ok', findings: [{ severity: 'important', title: 't', detail: 'd' }] }),
  });
  const r = parseResult(stdout);
  assert.ok(r.ok);
  assert.equal(r.data.summary, 'ok');
  assert.equal(r.data.findings.length, 1);
});

test('parseResult accepts an already-parsed result object', () => {
  const stdout = JSON.stringify({ result: { summary: 'ok', findings: [] } });
  const r = parseResult(stdout);
  assert.ok(r.ok);
  assert.deepEqual(r.data.findings, []);
});

test('parseResult reports a CLI-level error as a failure, not an empty review', () => {
  // The dangerous case: is_error with an empty findings-ish payload would
  // otherwise post "nothing found" on a PR nobody actually reviewed.
  const r = parseResult(JSON.stringify({ is_error: true, result: 'Credit balance too low' }));
  assert.ok(!r.ok);
  assert.match(r.error, /Credit balance/);
});

test('parseResult rejects output that is not JSON at all', () => {
  const r = parseResult('command not found: claude');
  assert.ok(!r.ok);
});

test('parseResult rejects a result missing the schema fields', () => {
  const r = parseResult(JSON.stringify({ result: JSON.stringify({ notes: 'hi' }) }));
  assert.ok(!r.ok);
  assert.match(r.error, /schema/);
});

test('the tool allowlist grants no write, edit, or mutating git capability', () => {
  // `merge-base` is read-only and must survive this check, so the mutating
  // subcommands are matched up to their `:` rather than as a bare prefix.
  const forbidden = /^(Write|Edit|NotebookEdit|WebFetch)$|Bash\(git (add|commit|push|checkout|reset|rebase|merge|clean|rm):/;
  for (const tool of ALLOWED_TOOLS) {
    assert.ok(!forbidden.test(tool), `allowlist should not contain ${tool}`);
  }
});
