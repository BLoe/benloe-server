/**
 * Who is allowed to see league chat, and as whom.
 *
 * Chat is the only part of Sleeper that requires being signed in. Each visitor
 * signs in for themselves and gets their own token, so chat is per-visitor like
 * everything else. A server-wide token (SLEEPER_TOKEN) is still honoured, but
 * only ever for the account it actually belongs to — on a public site, handing
 * one person's token to another visitor would expose their private league
 * conversations.
 *
 * Kept pure and separate so every branch can be tested without a real token.
 */

export interface ChatAccessInput {
  /** Fixture mode serves a synthetic feed and is exempt. */
  fixtures: boolean;
  /** Sleeper user_id of the visitor making the request; null if signed out. */
  visitorId: string | null;
  /** True when this visitor has signed in to Sleeper and we hold their token. */
  hasOwnToken: boolean;
  /** A server-wide token exists in the environment. */
  hasServerToken: boolean;
  /** Sleeper user_id that server-wide token belongs to; null if unknown. */
  serverTokenOwnerId: string | null;
}

export type ChatDenial = {
  allowed: false;
  status: number;
  code: 'noSession' | 'needsLogin';
  error: string;
};

export type ChatAccess =
  | { allowed: true; using: 'fixtures' | 'own' | 'server' }
  | ChatDenial;

export function chatAccess(input: ChatAccessInput): ChatAccess {
  if (input.fixtures) return { allowed: true, using: 'fixtures' };

  if (!input.visitorId) {
    return {
      allowed: false,
      status: 401,
      code: 'noSession',
      error: 'Enter your Sleeper username to continue.',
    };
  }

  // A visitor's own token always wins — it is unambiguously theirs.
  if (input.hasOwnToken) return { allowed: true, using: 'own' };

  // The server-wide token is usable only by the account that owns it.
  if (
    input.hasServerToken &&
    input.serverTokenOwnerId &&
    input.serverTokenOwnerId === input.visitorId
  ) {
    return { allowed: true, using: 'server' };
  }

  return {
    allowed: false,
    status: 403,
    code: 'needsLogin',
    error: 'Connect your Sleeper account to read league chat.',
  };
}
