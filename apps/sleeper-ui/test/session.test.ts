import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  COOKIE_NAME,
  MAX_AGE_SECONDS,
  cookieHeader,
  clearCookieHeader,
  isValidUsername,
  readCookie,
  signSession,
  verifySession,
  type Session,
} from '../src/server/session.js';

const SECRET = 'test-secret-value';
const now = () => Math.floor(Date.now() / 1000);
const session = (over: Partial<Session> = {}): Session => ({
  userId: '810215947997663232',
  username: 'benloe',
  iat: now(),
  ...over,
});

describe('signSession / verifySession', () => {
  it('round-trips a session', () => {
    const s = session();
    const got = verifySession(signSession(s, SECRET), SECRET);
    expect(got).toEqual(s);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession(session(), SECRET);
    expect(verifySession(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    // Swap in another user id and keep the original signature.
    const token = signSession(session(), SECRET);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify(session({ userId: 'attacker' })))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signSession(session(), SECRET);
    const [payload, sig] = token.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(verifySession(`${payload}.${flipped}`, SECRET)).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const bad of [undefined, '', 'nodot', '.', '.sig', 'onlypayload.']) {
      expect(verifySession(bad as any, SECRET)).toBeNull();
    }
  });

  it('rejects a correctly signed payload that is not session JSON', () => {
    // Signed with the right secret, so only the shape check can reject it.
    const payload = Buffer.from('not json').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifySession(`${payload}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a session missing required fields', () => {
    expect(verifySession(signSession({ userId: '', username: 'x', iat: now() }, SECRET), SECRET)).toBeNull();
    expect(verifySession(signSession({ userId: 'x', username: '', iat: now() }, SECRET), SECRET)).toBeNull();
    expect(
      verifySession(signSession({ userId: 'x', username: 'y' } as any, SECRET), SECRET)
    ).toBeNull();
  });

  it('rejects an expired session', () => {
    const old = session({ iat: now() - MAX_AGE_SECONDS - 60 });
    expect(verifySession(signSession(old, SECRET), SECRET)).toBeNull();
  });

  it('accepts a session just inside the window', () => {
    const fresh = session({ iat: now() - MAX_AGE_SECONDS + 120 });
    expect(verifySession(signSession(fresh, SECRET), SECRET)).not.toBeNull();
  });

  it('survives a username with url-unsafe characters', () => {
    const s = session({ username: 'a-b_c' });
    expect(verifySession(signSession(s, SECRET), SECRET)?.username).toBe('a-b_c');
  });
});

describe('readCookie', () => {
  it('finds the named cookie among others', () => {
    expect(readCookie('a=1; sleeper_desk=abc; b=2', COOKIE_NAME)).toBe('abc');
  });

  it('handles a single cookie and surrounding whitespace', () => {
    expect(readCookie('sleeper_desk=xyz', COOKIE_NAME)).toBe('xyz');
    expect(readCookie('  sleeper_desk = xyz ', COOKIE_NAME)).toBe('xyz');
  });

  it('decodes url-encoded values', () => {
    expect(readCookie('sleeper_desk=a%2Eb', COOKIE_NAME)).toBe('a.b');
  });

  it('returns undefined when absent or headerless', () => {
    expect(readCookie('other=1', COOKIE_NAME)).toBeUndefined();
    expect(readCookie(undefined, COOKIE_NAME)).toBeUndefined();
  });

  it('does not match a cookie whose name merely ends with ours', () => {
    expect(readCookie('not_sleeper_desk=nope', COOKIE_NAME)).toBeUndefined();
  });
});

describe('cookieHeader', () => {
  it('is HttpOnly and SameSite=Lax', () => {
    const h = cookieHeader('v', { secure: false });
    expect(h).toContain('HttpOnly');
    expect(h).toContain('SameSite=Lax');
    expect(h).toContain(`Max-Age=${MAX_AGE_SECONDS}`);
    expect(h).not.toContain('Secure');
  });

  it('adds Secure in production', () => {
    expect(cookieHeader('v', { secure: true })).toContain('Secure');
  });

  it('expires immediately when cleared', () => {
    expect(clearCookieHeader(true)).toContain('Max-Age=0');
  });

  it('round-trips through readCookie', () => {
    const token = signSession(session(), SECRET);
    const header = cookieHeader(token, { secure: true });
    const value = header.split(';')[0].split('=').slice(1).join('=');
    expect(readCookie(`${COOKIE_NAME}=${value}`, COOKIE_NAME)).toBe(token);
  });
});

describe('isValidUsername', () => {
  it('accepts realistic Sleeper usernames', () => {
    for (const ok of ['BenLoe', 'benloe', 'a', 'user_123', 'some-name', 'A'.repeat(64)]) {
      expect(isValidUsername(ok)).toBe(true);
    }
  });

  it('rejects anything that could alter a request path', () => {
    for (const bad of [
      '',
      ' ',
      'a/b',
      '../../etc/passwd',
      'name?x=1',
      'name#frag',
      'na me',
      'user@host',
      'A'.repeat(65),
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isValidUsername(bad)).toBe(false);
    }
  });
});
