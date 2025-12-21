import { Router } from 'express';
import { z } from 'zod';

import { authService } from '../services/auth';

const router = Router();

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
