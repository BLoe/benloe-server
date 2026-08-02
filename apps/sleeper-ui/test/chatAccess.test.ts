import { describe, it, expect } from 'vitest';
import { chatAccess } from '../src/server/chatAccess.js';

const BEN = '810215947997663232';
const STRANGER = '483459259485384704';

const input = (over: Partial<Parameters<typeof chatAccess>[0]> = {}) => ({
  fixtures: false,
  hasToken: true,
  tokenOwnerId: BEN,
  visitorId: BEN,
  ...over,
});

describe('chatAccess', () => {
  it('allows the account the token belongs to', () => {
    expect(chatAccess(input())).toEqual({ allowed: true });
  });

  it('refuses a different signed-in visitor', () => {
    const got = chatAccess(input({ visitorId: STRANGER }));
    expect(got.allowed).toBe(false);
    if (got.allowed) throw new Error('unreachable');
    expect(got.status).toBe(403);
    expect(got.code).toBe('notChatOwner');
  });

  it('refuses a signed-out visitor before considering the token', () => {
    const got = chatAccess(input({ visitorId: null }));
    expect(got.allowed).toBe(false);
    if (got.allowed) throw new Error('unreachable');
    expect(got.status).toBe(401);
    expect(got.code).toBe('noSession');
  });

  it('reports a missing token', () => {
    const got = chatAccess(input({ hasToken: false, tokenOwnerId: null }));
    expect(got.allowed).toBe(false);
    if (got.allowed) throw new Error('unreachable');
    expect(got.status).toBe(503);
    expect(got.code).toBe('needsToken');
  });

  it('refuses a token it cannot attribute, even to a signed-in visitor', () => {
    // An unattributable token must never be used on anyone's behalf.
    const got = chatAccess(input({ tokenOwnerId: null }));
    expect(got.allowed).toBe(false);
    if (got.allowed) throw new Error('unreachable');
    expect(got.status).toBe(503);
  });

  it('never allows a stranger regardless of token state', () => {
    for (const over of [
      { hasToken: true, tokenOwnerId: BEN },
      { hasToken: true, tokenOwnerId: null },
      { hasToken: false, tokenOwnerId: null },
    ]) {
      const got = chatAccess(input({ ...over, visitorId: STRANGER }));
      expect(got.allowed).toBe(false);
    }
  });

  it('does not treat similar ids as equal', () => {
    expect(chatAccess(input({ visitorId: BEN + '0' })).allowed).toBe(false);
    expect(chatAccess(input({ visitorId: BEN.slice(0, -1) })).allowed).toBe(false);
  });

  it('exempts fixture mode so the screenshot harness needs no secret', () => {
    expect(chatAccess(input({ fixtures: true, hasToken: false, tokenOwnerId: null, visitorId: null })))
      .toEqual({ allowed: true });
  });
});
