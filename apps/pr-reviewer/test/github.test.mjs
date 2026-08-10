import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { appJwt, dismissStaleApprovals, postReview, readEnvKeys, reviewerCredentials } from '../src/github.mjs';

function envFile(contents) {
  const path = join(mkdtempSync(join(tmpdir(), 'pr-reviewer-env-')), '.env');
  writeFileSync(path, contents);
  return path;
}

test('readEnvKeys returns only the requested keys', () => {
  const path = envFile(['WANTED=yes', 'SECRET_UNRELATED=nope', 'ALSO_WANTED=sure'].join('\n'));
  const out = readEnvKeys(path, ['WANTED', 'ALSO_WANTED']);
  assert.deepEqual(out, { WANTED: 'yes', ALSO_WANTED: 'sure' });
  assert.ok(!('SECRET_UNRELATED' in out), 'unrequested secrets must never be returned');
});

test('readEnvKeys strips surrounding quotes but keeps base64 padding', () => {
  const path = envFile(['A="quoted"', "B='single'", 'C=aGVsbG8='].join('\n'));
  assert.deepEqual(readEnvKeys(path, ['A', 'B', 'C']), { A: 'quoted', B: 'single', C: 'aGVsbG8=' });
});

test('readEnvKeys ignores comments and blank lines', () => {
  const path = envFile(['# a comment', '', '  ', 'A=1'].join('\n'));
  assert.deepEqual(readEnvKeys(path, ['A']), { A: '1' });
});

test('readEnvKeys throws a clear error for a missing file rather than returning empty', () => {
  // Returning {} here would surface much later as a confusing auth failure.
  assert.throws(() => readEnvKeys('/no/such/.env', ['A']), /cannot read env file/);
});

test('appJwt produces a verifiable RS256 token with a backdated iat', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const now = 1_770_000_000;
  const token = appJwt('4308475', pem, now);

  const [h, p, s] = token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(payload.iss, '4308475');
  assert.equal(payload.iat, now - 60, 'iat must be backdated to tolerate clock skew');
  assert.ok(payload.exp - payload.iat <= 600, 'GitHub rejects an expiry more than 10 minutes out');

  const v = createVerify('RSA-SHA256');
  v.update(`${h}.${p}`);
  v.end();
  assert.ok(v.verify(publicKey, Buffer.from(s, 'base64url')));
});

test('reviewerCredentials refuses to fall back to a write-capable identity', () => {
  // The dangerous silent path: cabinet-benloe holds contents:write, so a
  // fallback would turn a typo into a reviewer that can push to main.
  const path = envFile(['GITHUB_APP_ID=1', 'GITHUB_APP_INSTALLATION_ID=2', 'GITHUB_APP_PRIVATE_KEY_B64=eA=='].join('\n'));
  assert.throws(() => reviewerCredentials(path), /PR_REVIEWER_APP_ID/);
  assert.throws(() => reviewerCredentials(path), /will not fall back/);
});

test('reviewerCredentials names every missing key, not just the first', () => {
  const path = envFile('PR_REVIEWER_APP_ID=1');
  assert.throws(() => reviewerCredentials(path), /PR_REVIEWER_INSTALLATION_ID/);
  assert.throws(() => reviewerCredentials(path), /PR_REVIEWER_PRIVATE_KEY_B64/);
});



test('reviewerCredentials rejects a private key that base64-decoded to garbage', () => {
  // Buffer.from never throws, so a line-wrapped key would otherwise pass the
  // presence check and fail much later inside OpenSSL, naming nothing useful.
  const path = envFile(
    ['PR_REVIEWER_APP_ID=1', 'PR_REVIEWER_INSTALLATION_ID=2', `PR_REVIEWER_PRIVATE_KEY_B64=${Buffer.from('not a key').toString('base64')}`].join('\n'),
  );
  assert.throws(() => reviewerCredentials(path), /PR_REVIEWER_PRIVATE_KEY_B64/);
  assert.throws(() => reviewerCredentials(path), /not a valid private key/);
});

test('reviewerCredentials accepts a real key', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const path = envFile(
    ['PR_REVIEWER_APP_ID=1', 'PR_REVIEWER_INSTALLATION_ID=2', `PR_REVIEWER_PRIVATE_KEY_B64=${Buffer.from(pem).toString('base64')}`].join('\n'),
  );
  assert.equal(reviewerCredentials(path).privateKeyPem, pem);
});

test('postReview pins the review to the sha that was read', async () => {
  // Without commit_id, GitHub attaches the review to the head at submission
  // time — so a commit pushed during the minutes a review takes would collect
  // an APPROVE for code nobody read. That is the merge gate, silently wrong.
  let sent;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    await postReview('tok', 'o/r', 7, 'body', [], 'APPROVE', 'deadbeef');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent.commit_id, 'deadbeef');
  assert.equal(sent.event, 'APPROVE');
});

test('postReview omits commit_id rather than sending a null one', async () => {
  let sent;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    await postReview('tok', 'o/r', 7, 'body', []);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(!('commit_id' in sent));
  assert.equal(sent.event, 'COMMENT');
});

test('dismissStaleApprovals touches only our own approvals, and only approvals', async () => {
  // The login filter is the whole safety property: without it this would
  // dismiss a HUMAN's approval, which the bot has no business doing. The sha
  // is deliberately NOT filtered on — an approval at the current sha is the
  // one most in need of withdrawal when this run found a problem.
  const reviews = [
    { id: 1, state: 'APPROVED', user: { login: 'benloe-pr-reviewer[bot]' }, commit_id: 'old' },
    { id: 2, state: 'APPROVED', user: { login: 'benloe-pr-reviewer[bot]' }, commit_id: 'current' },
    { id: 3, state: 'APPROVED', user: { login: 'BLoe' }, commit_id: 'old' },
    { id: 4, state: 'COMMENTED', user: { login: 'benloe-pr-reviewer[bot]' }, commit_id: 'old' },
  ];
  const dismissed = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/reviews?per_page=100')) {
      return { ok: true, status: 200, json: async () => reviews };
    }
    dismissed.push(String(url).match(/reviews\/(\d+)\/dismissals/)?.[1]);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const n = await dismissStaleApprovals('tok', 'o/r', 7, 'benloe-pr-reviewer[bot]', 'current');
    assert.equal(n, 2, 'both of our approvals, at any sha');
    assert.deepEqual(dismissed, ['1', '2']);
    assert.ok(!dismissed.includes('3'), "a human's approval is never touched");
    assert.ok(!dismissed.includes('4'), 'a COMMENTED review is not an approval');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a failed dismissal does not abort the rest', async () => {
  const reviews = [
    { id: 1, state: 'APPROVED', user: { login: 'bot[bot]' }, commit_id: 'old' },
    { id: 2, state: 'APPROVED', user: { login: 'bot[bot]' }, commit_id: 'older' },
  ];
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/reviews?per_page=100')) return { ok: true, status: 200, json: async () => reviews };
    calls += 1;
    if (calls === 1) return { ok: false, status: 422, text: async () => 'nope' };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    await dismissStaleApprovals('tok', 'o/r', 7, 'bot[bot]', 'current');
    assert.equal(calls, 2, 'the second dismissal must still be attempted');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('dismissStaleApprovals withdraws an approval at the current sha too', async () => {
  // The case most in need of it: re-reviewing a sha we previously approved
  // and finding a problem this time. An earlier version exempted it, leaving
  // the old APPROVE standing next to the new COMMENT.
  const reviews = [{ id: 9, state: 'APPROVED', user: { login: 'bot[bot]' }, commit_id: 'current' }];
  const dismissed = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/reviews?per_page=100')) return { ok: true, status: 200, json: async () => reviews };
    dismissed.push(String(url).match(/reviews\/(\d+)\/dismissals/)?.[1]);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    assert.equal(await dismissStaleApprovals('tok', 'o/r', 7, 'bot[bot]', 'current'), 1);
    assert.deepEqual(dismissed, ['9']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
