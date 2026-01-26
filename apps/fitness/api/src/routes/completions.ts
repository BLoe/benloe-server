import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get completions with optional date range
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate, limit } = req.query;

    const where: any = { userId };

    if (startDate || endDate) {
      where.completedDate = {};
      if (startDate) {
        where.completedDate.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.completedDate.lte = new Date(endDate as string);
      }
    }

    const completions = await prisma.workoutCompletion.findMany({
      where,
      orderBy: { completedDate: 'desc' },
      take: limit ? parseInt(limit as string) : 100,
    });

    res.json({ completions });
  } catch (error) {
    console.error('Error fetching completions:', error);
    res.status(500).json({ error: 'Failed to fetch completions' });
  }
});

// Get streak information
router.get('/streaks', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get all completions ordered by date
    const completions = await prisma.workoutCompletion.findMany({
      where: { userId },
      orderBy: { completedDate: 'desc' },
      select: { completedDate: true },
    });

    if (completions.length === 0) {
      res.json({
        currentStreak: 0,
        longestStreak: 0,
        totalWorkouts: 0,
        lastWorkoutDate: null,
      });
      return;
    }

    // Get unique dates (in case of multiple workouts per day)
    const uniqueDates = [...new Set(completions.map((c) => c.completedDate.toISOString().split('T')[0]))];
    uniqueDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    // Calculate current streak
    let currentStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < uniqueDates.length; i++) {
      const date = new Date(uniqueDates[i]);
      date.setHours(0, 0, 0, 0);

      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);

      // Allow for today or yesterday to start the streak
      if (i === 0) {
        const daysDiff = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 1) break; // No recent workout
      }

      if (date.getTime() === expectedDate.getTime() || (i === 0 && date.getTime() === expectedDate.getTime() - 86400000)) {
        currentStreak++;
      } else if (i > 0) {
        break;
      }
    }

    // Calculate longest streak
    let longestStreak = 0;
    let tempStreak = 1;

    for (let i = 1; i < uniqueDates.length; i++) {
      const prevDate = new Date(uniqueDates[i - 1]);
      const currDate = new Date(uniqueDates[i]);
      const daysDiff = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

    res.json({
      currentStreak,
      longestStreak,
      totalWorkouts: completions.length,
      lastWorkoutDate: uniqueDates[0],
    });
  } catch (error) {
    console.error('Error calculating streaks:', error);
    res.status(500).json({ error: 'Failed to calculate streaks' });
  }
});

// Get calendar data for a month
router.get('/calendar/:year/:month', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month) - 1; // JS months are 0-indexed

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59);

    const completions = await prisma.workoutCompletion.findMany({
      where: {
        userId,
        completedDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { completedDate: 'asc' },
    });

    // Group by date
    const calendarData: Record<string, any[]> = {};
    completions.forEach((c) => {
      const dateKey = c.completedDate.toISOString().split('T')[0];
      if (!calendarData[dateKey]) {
        calendarData[dateKey] = [];
      }
      calendarData[dateKey].push(c);
    });

    res.json({ calendarData, year, month: month + 1 });
  } catch (error) {
    console.error('Error fetching calendar:', error);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

// Mark workout complete
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { workoutName, completedDate, notes, duration, rating, workoutTemplateId } = req.body;

    if (!workoutName) {
      res.status(400).json({ error: 'Workout name is required' });
      return;
    }

    const date = completedDate ? new Date(completedDate) : new Date();
    date.setHours(0, 0, 0, 0);

    const completion = await prisma.workoutCompletion.create({
      data: {
        userId,
        workoutName,
        completedDate: date,
        notes,
        duration,
        rating,
        workoutTemplateId,
      },
    });

    res.json({ completion });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'This workout is already marked complete for this date' });
      return;
    }
    console.error('Error marking complete:', error);
    res.status(500).json({ error: 'Failed to mark workout complete' });
  }
});

// Delete completion
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.workoutCompletion.delete({
      where: { id },
    });

    res.json({ message: 'Completion deleted' });
  } catch (error) {
    console.error('Error deleting completion:', error);
    res.status(500).json({ error: 'Failed to delete completion' });
  }
});

export { router as completionRoutes };
