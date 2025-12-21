import { Request, Response, NextFunction } from 'express';
import { AuthUser } from '../types';

async function validateTokenWithAuthService(token: string): Promise<AuthUser | null> {
  try {
    const authServiceUrl = process.env['AUTH_SERVICE_URL'] || 'http://localhost:3002';

    const response = await fetch(`${authServiceUrl}/api/auth/me`, {
      method: 'GET',
      headers: {
        Cookie: `token=${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { user: AuthUser };
    return data.user;
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies['token'];

    if (!token) {
      return handleAuthFailure(res, 'Authentication required');
    }

    // Validate token by making a request to the auth service
    const user = await validateTokenWithAuthService(token);

    if (!user) {
      clearAuthCookie(res);
      return handleAuthFailure(res, 'Authentication failed');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    clearAuthCookie(res);
    return handleAuthFailure(res, 'Invalid or expired token');
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies['token'];

    if (!token) {
      return next();
    }

    const user = await validateTokenWithAuthService(token);
    if (user) {
      req.user = user;
    }

    next();
  } catch {
    // Silent fail for optional auth
    next();
  }
}

function handleAuthFailure(res: Response, error: string): void {
  res.status(401).json({ error });
}

function clearAuthCookie(res: Response): void {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    domain: process.env['NODE_ENV'] === 'production' ? '.benloe.com' : undefined,
  });
}
