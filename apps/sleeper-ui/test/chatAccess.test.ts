import { describe, it, expect } from 'vitest';
import { chatAccess, type ChatAccessInput } from '../src/server/chatAccess.js';

const BEN = '810215947997663232';
const STRANGER = '483459259485384704';

const input = (over: Partial<ChatAccessInput> = {}): ChatAccessInput => ({
  fixtures: false,
  visitorId: BEN,
  hasOwnToken: false,
  hasServerToken: false,
  serverTokenOwnerId: null,
  ...over,
});

const deny = (r: ReturnType<typeof chatAccess>) => {
  if (r.allowed) throw new Error('expected a denial');
  return r;
};

describe('chatAccess', () => {
  it("allows a visitor who has connected their own account", () => {
    expect(chatAccess(input({ hasOwnToken: true }))).toEqual({ allowed: true, using: 'own' });
  });

  it('prefers a visitor own token over the server token', () => {
    const got = chatAccess(
      input({ hasOwnToken: true, hasServerToken: true, serverTokenOwnerId: BEN })
    );
    expect(got).toEqual({ allowed: true, using: 'own' });
  });

  it('lets the server token be used by the account that owns it', () => {
    const got = chatAccess(input({ hasServerToken: true, serverTokenOwnerId: BEN }));
    expect(got).toEqual({ allowed: true, using: 'server' });
  });

  it('never lends the server token to a different visitor', () => {
    const got = deny(
      chatAccess(input({ visitorId: STRANGER, hasServerToken: true, serverTokenOwnerId: BEN }))
    );
    expect(got.status).toBe(403);
    expect(got.code).toBe('needsLogin');
  });

  it('refuses a server token it cannot attribute', () => {
    const got = deny(chatAccess(input({ hasServerToken: true, serverTokenOwnerId: null })));
    expect(got.code).toBe('needsLogin');
  });

  it('refuses a signed-out visitor before considering any token', () => {
    const got = deny(
      chatAccess(input({ visitorId: null, hasOwnToken: true, hasServerToken: true, serverTokenOwnerId: BEN }))
    );
    expect(got.status).toBe(401);
    expect(got.code).toBe('noSession');
  });

  it('asks an unconnected visitor to sign in', () => {
    const got = deny(chatAccess(input()));
    expect(got.status).toBe(403);
    expect(got.code).toBe('needsLogin');
  });

  it('does not treat near-miss ids as the same account', () => {
    for (const id of [BEN + '0', BEN.slice(0, -1), ' ' + BEN]) {
      const got = chatAccess(input({ visitorId: id, hasServerToken: true, serverTokenOwnerId: BEN }));
      expect(got.allowed).toBe(false);
    }
  });

  it('exempts fixture mode so the screenshot harness needs no secret', () => {
    expect(chatAccess(input({ fixtures: true, visitorId: null }))).toEqual({
      allowed: true,
      using: 'fixtures',
    });
  });
});
