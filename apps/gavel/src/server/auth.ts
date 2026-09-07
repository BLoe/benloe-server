/**
 * Authentication, delegated to artanis.
 *
 * Artanis issues its cookie on `.benloe.com`, so a browser already signed in
 * anywhere on the box arrives here authenticated and this app never sees a
 * credential. Validation is one call to the auth service on localhost.
 *
 * This replaced a self-contained passphrase gate. The reasoning for the switch
 * is worth keeping: an app-local session would survive artanis being down, but
 * it is also NEW code on the critical path of a live draft, and twelve other
 * services already depend on artanis being up. A second auth system is more
 * surface to be wrong than the outage it insures against.
 *
 * The result is cached briefly so a burst of requests during a draft does not
 * become a burst of auth calls.
 */
import type { Request, Response, NextFunction } from 'express';

const AUTH_SERVICE = process.env.AUTH_SERVICE_URL || 'http://localhost:3002';
/** Only the owner opens this board. It is one person's draft. */
const OWNER = (process.env.GAVEL_OWNER_EMAIL || 'below413@gmail.com').toLowerCase();

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Short TTL: long enough to absorb a page's worth of calls, short enough that
 *  a revoked session stops working promptly. */
const TTL_MS = 30_000;
const cache = new Map<string, { user: AuthUser | null; at: number }>();

export async function validateToken(token: string): Promise<AuthUser | null> {
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user;

  let user: AuthUser | null = null;
  try {
    const res = await fetch(`${AUTH_SERVICE}/api/auth/me`, {
      headers: { Cookie: `token=${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { user?: AuthUser };
      user = data.user ?? null;
    }
  } catch (err) {
    // A failed lookup is not cached, so a transient blip does not lock the
    // board out for the whole TTL.
    console.error('[gavel] auth lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }

  cache.set(token, { user, at: Date.now() });
  return user;
}

/**
 * Test-only sign-in bypass, in the same shape kickball uses.
 *
 * Playwright cannot hold a real artanis session. Production sets
 * NODE_ENV=production, which makes this unreachable regardless of anything else
 * in the environment.
 */
function testUser(): AuthUser | null {
  if (process.env.NODE_ENV === 'production') return null;
  const email = process.env.GAVEL_TEST_USER;
  if (!email) return null;
  return { id: 'test-user', email, name: 'Test Owner' };
}

export function isOwner(user: AuthUser | null): boolean {
  return !!user && user.email.toLowerCase() === OWNER;
}

export async function currentUser(req: Request): Promise<AuthUser | null> {
  const stub = testUser();
  if (stub) return stub;
  const token = readCookie(req.headers.cookie, 'token');
  if (!token) return null;
  return validateToken(token);
}

export function requireOwner() {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sign in at auth.benloe.com.', needsAuth: true });
      return;
    }
    if (!isOwner(user)) {
      res.status(403).json({ error: 'This board is not yours.' });
      return;
    }
    req.user = user;
    next();
  };
}

/** Minimal cookie parser — we only ever read artanis's cookie. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
