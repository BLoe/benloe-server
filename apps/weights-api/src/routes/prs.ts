import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// GET /api/prs - Get user's current PRs for all exercises
router.get('/', authenticate, async (req, res) => {
  try {
    const exercises = await prisma.exercise.findMany({
      where: { userId: req.user!.id },
      include: {
        workouts: {
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
    });

    const prs: Record<string, { weight: number; createdAt: Date }> = {};

    exercises.forEach(exercise => {
      if (exercise.workouts.length > 0) {
        const maxWorkout = exercise.workouts[0];
        prs[exercise.id] = {
          weight: maxWorkout.weight,
          createdAt: maxWorkout.createdAt,
        };
      }
    });

    res.json({ prs });
  } catch (error) {
    console.error('Error fetching PRs:', error);
    res.status(500).json({ error: 'Failed to fetch PRs' });
  }
});

// GET /api/prs/history - Get PR history for all exercises
router.get('/history', authenticate, async (req, res) => {
  try {
    const history = await prisma.pRHistory.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ history });
  } catch (error) {
    console.error('Error fetching PR history:', error);
    res.status(500).json({ error: 'Failed to fetch PR history' });
  }
});

// POST /api/prs - Update a PR for an exercise
router.post('/', authenticate, async (req, res) => {
  try {
    const { exerciseId, weight } = req.body;

    if (!exerciseId || !weight || weight <= 0) {
      return res.status(400).json({ error: 'Exercise ID and weight are required' });
    }

    // Verify exercise belongs to user
    const exercise = await prisma.exercise.findFirst({
      where: {
        id: exerciseId,
        userId: req.user!.id,
      },
    });

    if (!exercise) {
      return res.status(404).json({ error: 'Exercise not found' });
    }

    // Get current PR
    const currentBest = await prisma.workout.findFirst({
      where: {
        exerciseId,
        userId: req.user!.id,
      },
      orderBy: { weight: 'desc' },
    });

    const currentPR = currentBest?.weight || 0;

    // Only allow updates that are actual improvements
    if (weight <= currentPR) {
      return res.status(400).json({
        error: `New weight (${weight} lbs) must be greater than current PR (${currentPR} lbs)`,
      });
    }

    // Create new workout entry representing the PR
    const newWorkout = await prisma.workout.create({
      data: {
        exerciseId,
        userId: req.user!.id,
        weight: weight,
        reps: 1, // PRs are single rep maxes for simplicity
        oneRM: weight, // Since it's 1 rep, 1RM equals the weight
      },
    });

    // Record in PR history
    const historyEntry = await prisma.pRHistory.create({
      data: {
        exerciseId,
        userId: req.user!.id,
        weight: weight,
        previousWeight: currentPR > 0 ? currentPR : null,
      },
    });

    res.status(201).json({
      pr: {
        weight: weight,
        createdAt: newWorkout.createdAt,
      },
      history: historyEntry,
    });
  } catch (error) {
    console.error('Error updating PR:', error);
    res.status(500).json({ error: 'Failed to update PR' });
  }
});

export { router as prRoutes };
