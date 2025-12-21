import { Request, Response, NextFunction } from 'express';

import { authService } from '../services/auth';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string | null;
        avatar: string | null;
        timezone: string;
        createdAt: Date;
        lastLoginAt: Date | null;
      };
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies.token;

    if (!token) {
      return handleAuthFailure(req, res, 'Authentication required');
    }

    const decoded = await authService.verifyJWT(token);
    const user = await authService.getUserById(decoded.userId);

    if (!user) {
      res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        domain:
          process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
      });
      return handleAuthFailure(req, res, 'User not found');
    }

    req.user = user;
    next();
  } catch {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
    });
    return handleAuthFailure(req, res, 'Invalid or expired token');
  }
}

function handleAuthFailure(req: Request, res: Response, error: string): void {
  // Check if this is an API request
  if (
    req.path.startsWith('/api/') ||
    req.headers.accept?.includes('application/json')
  ) {
    res.status(401).json({ error });
    return;
  }

  // For page requests, redirect to login with the current path as redirect
  const redirectUrl = encodeURIComponent(req.originalUrl);
  res.redirect(`/?redirect=${redirectUrl}`);
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies.token;

  if (!token) {
    return next();
  }

  authService
    .verifyJWT(token)
    .then(async (decoded) => {
      const user = await authService.getUserById(decoded.userId);
      if (user) {
        req.user = user;
      }
      next();
    })
    .catch(() => {
      res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        domain:
          process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
      });
      next();
    });
}
