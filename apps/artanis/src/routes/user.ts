import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  timezone: z.string().optional(),
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const { user } = req;
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        timezone: user.timezone,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update user profile
router.patch('/profile', async (req, res) => {
  try {
    const { user } = req;
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const updates = updateProfileSchema.parse(req.body);
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: filteredUpdates,
    });

    return res.json({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        avatar: updatedUser.avatar,
        timezone: updatedUser.timezone,
        createdAt: updatedUser.createdAt,
        lastLoginAt: updatedUser.lastLoginAt,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: error.errors,
      });
    }

    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user sessions
router.get('/sessions', async (req, res) => {
  try {
    const { user } = req;
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const sessions = await prisma.session.findMany({
      where: {
        userId: user.id,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        createdAt: true,
        lastUsed: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true,
      },
      orderBy: { lastUsed: 'desc' },
    });

    return res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    return res.status(500).json({ error: 'Failed to get sessions' });
  }
});

export { router as userRoutes };
