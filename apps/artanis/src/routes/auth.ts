import { Router, type Response } from 'express';
import { z } from 'zod';

import { authService } from '../services/auth';

const router = Router();

function setSessionCookie(res: Response, jwtToken: string): void {
  res.cookie('token', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    domain: process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
  });
}

const magicLinkSchema = z.object({
  email: z.string().email('Valid email is required'),
  redirectUrl: z.string().optional(),
});

const verifyTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Send magic link
router.post('/magic-link', async (req, res) => {
  try {
    console.log('Magic link request body:', req.body);
    const { email, redirectUrl } = magicLinkSchema.parse(req.body);

    await authService.sendMagicLink(email, redirectUrl);

    return res.json({
      message: 'Magic link sent successfully',
      email,
    });
  } catch (error) {
    console.error('Magic link error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: error.errors,
      });
    }

    return res.status(500).json({
      error: 'Failed to send magic link. Please try again.',
    });
  }
});

// Verify magic link token
router.post('/verify', async (req, res) => {
  try {
    const { token } = verifyTokenSchema.parse(req.body);

    const { user, jwtToken } = await authService.verifyMagicLink(token);

    // Set secure HTTP-only cookie
    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Allows navigation between subdomains while blocking CSRF
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      domain: process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
    });

    return res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Verify token error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: error.errors,
      });
    }

    return res.status(400).json({
      error:
        error instanceof Error ? error.message : 'Token verification failed',
    });
  }
});

// ---- agent browser login: exchange an agent key for a real session cookie ----
// So an agent (e.g. Benji) can drive the web UI in a browser, not just the API.

// POST with `Authorization: Bearer <agentKey>` → sets the session cookie + returns the JWT.
router.post('/agent-login', async (req, res) => {
  try {
    const authz = req.headers.authorization ?? '';
    const key = /^Bearer\s+/i.test(authz)
      ? authz.replace(/^Bearer\s+/i, '').trim()
      : String((req.body as { key?: string })?.key ?? '');
    if (!key) return res.status(400).json({ error: 'agent key required' });
    const { user, jwtToken } = await authService.agentLogin(key);
    setSessionCookie(res, jwtToken);
    return res.json({ token: jwtToken, user });
  } catch {
    return res.status(401).json({ error: 'Invalid agent key' });
  }
});

// GET convenience for a plain browser navigation:
//   /api/auth/agent-login?token=<agentKey>&redirect=<url>  → sets cookie + redirects.
router.get('/agent-login', async (req, res) => {
  try {
    const key = String(req.query.token ?? '');
    const redirect = String(req.query.redirect ?? 'https://cabinet.benloe.com');
    if (!key) return res.status(400).send('agent key required');
    const { jwtToken } = await authService.agentLogin(key);
    setSessionCookie(res, jwtToken);
    return res.redirect(redirect);
  } catch {
    return res.status(401).send('Invalid agent key');
  }
});

// Logout (clear all sessions)
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies.token;

    if (token) {
      try {
        const decoded = await authService.verifyJWT(token);
        await authService.logoutAllSessions(decoded.userId);
      } catch {
        // Token might be invalid, but we still want to clear the cookie
        console.log('Error during logout');
      }
    }

    // Clear cookie with same options as when it was set
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
    });
    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
    });
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// Check authentication status
router.get('/me', async (req, res) => {
  try {
    // Agent principals authenticate with a bearer access key instead of a
    // cookie session — resolves to their User (role "agent").
    const authz = req.headers.authorization;
    if (authz && /^Bearer\s+/i.test(authz)) {
      const rawKey = authz.replace(/^Bearer\s+/i, '').trim();
      const agent = await authService.verifyAgentKey(rawKey);
      return res.json({
        user: {
          id: agent.id,
          email: agent.email,
          name: agent.name,
          role: agent.role,
          createdAt: agent.createdAt,
          lastLoginAt: agent.lastLoginAt,
        },
      });
    }

    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
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
      return res.status(401).json({ error: 'User not found' });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.benloe.com' : undefined,
    });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export { router as authRoutes };
