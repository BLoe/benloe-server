/**
 * Per-visitor session, held in a signed cookie.
 *
 * There is no login here and there should not be: a Sleeper username and every
 * REST endpoint this app reads are public. The session only answers "whose
 * leagues am I looking at", so it needs to be tamper-evident, not secret.
 *
 * Hand-rolled rather than pulling in a cookie/JWT dependency — it is ~60 lines
 * of HMAC and it is fully tested.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'sleeper_desk';
/** Long enough that a casual visitor is not re-entering their name constantly. */
export const MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export interface Session {
  userId: string;
  username: string;
  /** Issued-at, seconds. Used to expire server-side as well as via the cookie. */
  iat: number;
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function hmac(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

export function signSession(session: Session, secret: string): string {
  const payload = b64url(JSON.stringify(session));
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = hmac(payload, secret);

  // Constant-time compare; timingSafeEqual throws on length mismatch.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(fromB64url(payload).toString('utf8')) as Session;
    if (!parsed?.userId || !parsed?.username || typeof parsed.iat !== 'number') return null;
    if (Date.now() / 1000 - parsed.iat > MAX_AGE_SECONDS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Minimal cookie-header parser — we only ever read our own cookie. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

export function cookieHeader(value: string, opts: { secure: boolean; maxAge?: number }): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAge ?? MAX_AGE_SECONDS}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export const clearCookieHeader = (secure: boolean) => cookieHeader('', { secure, maxAge: 0 });

/**
 * Sleeper usernames are 1-64 chars of letters, digits, underscore and hyphen.
 * Validated before it ever reaches a URL, since this endpoint is public.
 */
export function isValidUsername(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(name.trim());
}
