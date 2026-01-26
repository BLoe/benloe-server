import { Request, Response, NextFunction } from 'express';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

async function validateTokenWithAuthService(token: string): Promise<AuthUser | null> {
  try {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3002';

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
    const token = req.cookies.token;

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await validateTokenWithAuthService(token);

    if (!user) {
      clearAuthCookie(res);
      res.status(401).json({ error: 'Authentication failed' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    clearAuthCookie(res);
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
}

function clearAuthCookie(res: Response): void {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
  });
}
