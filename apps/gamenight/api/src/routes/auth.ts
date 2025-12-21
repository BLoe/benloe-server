import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

// Check authentication status for the gamenight app
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: {
      id: req.user!.id,
      email: req.user!.email,
      name: req.user!.name,
      avatar: req.user!.avatar,
      timezone: req.user!.timezone,
      createdAt: req.user!.createdAt,
      lastLoginAt: req.user!.lastLoginAt,
    },
  });
});

// Logout endpoint that clears the cookie
router.post('/logout', (_req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    domain: process.env['NODE_ENV'] === 'production' ? '.benloe.com' : undefined,
  });

  res.json({ message: 'Logged out successfully' });
});

export { router as authRoutes };
