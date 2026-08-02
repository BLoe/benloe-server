/**
 * Who is allowed to see league chat.
 *
 * Chat rides a single Sleeper bearer token, so unlike everything else in this
 * app it cannot be per-visitor: it belongs to exactly one account. On a public
 * site that makes this the one place where getting the check wrong would expose
 * someone's private league conversations to a stranger.
 *
 * Kept pure and separate so it can be tested without a real token.
 */

export interface ChatAccessInput {
  /** Fixture mode serves a synthetic feed and is exempt. */
  fixtures: boolean;
  hasToken: boolean;
  /** Sleeper user_id the token belongs to; null if unknown or invalid. */
  tokenOwnerId: string | null;
  /** Sleeper user_id of the visitor making the request; null if signed out. */
  visitorId: string | null;
}

export type ChatAccess =
  | { allowed: true }
  | { allowed: false; status: number; code: 'noSession' | 'needsToken' | 'notChatOwner'; error: string };

export function chatAccess(input: ChatAccessInput): ChatAccess {
  if (input.fixtures) return { allowed: true };

  if (!input.visitorId) {
    return {
      allowed: false,
      status: 401,
      code: 'noSession',
      error: 'Enter your Sleeper username to continue.',
    };
  }

  if (!input.hasToken) {
    return {
      allowed: false,
      status: 503,
      code: 'needsToken',
      error: 'Chat needs a Sleeper token. Set SLEEPER_TOKEN in /srv/benloe/.env.',
    };
  }

  // A token we cannot attribute is a token we must not use on anyone's behalf.
  if (!input.tokenOwnerId) {
    return {
      allowed: false,
      status: 503,
      code: 'needsToken',
      error: 'The configured Sleeper token is not valid.',
    };
  }

  if (input.visitorId !== input.tokenOwnerId) {
    return {
      allowed: false,
      status: 403,
      code: 'notChatOwner',
      error: 'League chat is only available to the account this server is signed in as.',
    };
  }

  return { allowed: true };
}
