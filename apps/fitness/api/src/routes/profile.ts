import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get user profile
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    let profile = await prisma.userProfile.findUnique({
      where: { userId },
    });

    // Create default profile if doesn't exist
    if (!profile) {
      profile = await prisma.userProfile.create({
        data: { userId },
      });
    }

    // Parse JSON fields
    const profileWithParsedJson = {
      ...profile,
      constraints: profile.constraints ? JSON.parse(profile.constraints) : null,
    };

    res.json({ profile: profileWithParsedJson });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { primaryGoalSummary, goalType, targetDate, constraints, notes } = req.body;

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        ...(primaryGoalSummary !== undefined && { primaryGoalSummary }),
        ...(goalType !== undefined && { goalType }),
        ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
        ...(constraints !== undefined && { constraints: JSON.stringify(constraints) }),
        ...(notes !== undefined && { notes }),
      },
      create: {
        userId,
        primaryGoalSummary,
        goalType: goalType || 'general',
        targetDate: targetDate ? new Date(targetDate) : null,
        constraints: constraints ? JSON.stringify(constraints) : null,
        notes,
      },
    });

    const profileWithParsedJson = {
      ...profile,
      constraints: profile.constraints ? JSON.parse(profile.constraints) : null,
    };

    res.json({ profile: profileWithParsedJson });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export { router as profileRoutes };
