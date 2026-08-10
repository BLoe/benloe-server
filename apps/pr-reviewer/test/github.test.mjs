import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { appJwt, readEnvKeys } from '../src/github.mjs';

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
