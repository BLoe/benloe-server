import type { Request, Response, NextFunction } from 'express';
import type { DB } from '../db';
import { readSettings } from '../db';

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

async function validateToken(token: string): Promise<AuthUser | null> {
  try {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3002';
    const response = await fetch(`${authServiceUrl}/api/auth/me`, {
      method: 'GET',
      headers: { Cookie: `token=${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { user: AuthUser };
    return data.user ?? null;
  } catch (error) {
    console.error('Auth validation failed:', error);
    return null;
  }
}

/**
 * The dashboard is for whoever runs the lineup, not for anyone who happens to
 * hold a benloe.com account. Signing in gets you as far as a 403; the allowlist
 * in settings decides the rest.
 */
/**
 * Test-only sign-in bypass.
 *
 * Playwright cannot hold a real Artanis session, so the integration tests set
 * KICKBALL_TEST_USER against a throwaway database. The production PM2 config
 * sets NODE_ENV=production, which makes this unreachable no matter what else is
 * in the environment.
 */
function testUser(): AuthUser | null {
  if (process.env.NODE_ENV === 'production') return null;
  const email = process.env.KICKBALL_TEST_USER;
  if (!email) return null;
  return { id: 'test-user', email, name: 'Test Manager' };
}

export function requireManager(db: DB) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const stub = testUser();
    if (stub) {
      req.user = stub;
      next();
      return;
    }

    const token = req.cookies?.token;
    if (!token) {
      res.status(401).json({ error: 'Sign in to open the dashboard.' });
      return;
    }

    const user = await validateToken(token);
    if (!user) {
      res.status(401).json({ error: 'That session has expired. Sign in again.' });
      return;
    }

    const allowlist = readSettings(db)
      .admin_emails.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (allowlist.length > 0 && !allowlist.includes(user.email.toLowerCase())) {
      res.status(403).json({ error: 'This dashboard is limited to the team managers.' });
      return;
    }

    req.user = user;
    next();
  };
}
