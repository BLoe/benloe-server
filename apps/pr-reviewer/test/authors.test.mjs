import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_ALLOWED_AUTHORS, isAllowedAuthor, parseAllowedAuthors } from '../src/authors.mjs';

test('an unset allowlist falls back to Ben and Cabinet', () => {
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

test('allowed authors match case-insensitively and with or without the bot suffix', () => {
  const allowed = ['BLoe', 'cabinet-benloe[bot]'];
  for (const login of ['BLoe', 'bloe', 'BLOE', 'cabinet-benloe[bot]', 'cabinet-benloe', 'Cabinet-Benloe[bot]']) {
    assert.ok(isAllowedAuthor(login, allowed), `${login} should be allowed`);
  }
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
