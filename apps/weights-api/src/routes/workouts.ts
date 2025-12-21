import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Calculate 1RM using Epley formula
function calculate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// GET /api/workouts - Get user's workouts with optional filtering
router.get('/', authenticate, async (req, res) => {
  try {
    const { exerciseId, limit = '100' } = req.query;

    const where: any = {};

    // First verify the exercise belongs to the user
    if (exerciseId) {
      const exercise = await prisma.exercise.findFirst({
        where: {
          id: exerciseId as string,
          userId: req.user!.id,
        },
      });

      if (!exercise) {
        return res.status(404).json({ error: 'Exercise not found' });
      }

      where.exerciseId = exerciseId as string;
    }

    const workouts = await prisma.workout.findMany({
      where: {
        userId: req.user!.id,
        ...where,
      },
      include: {
        exercise: true,
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
    });

    res.json({ workouts });
  } catch (error) {
    console.error('Error fetching workouts:', error);
    res.status(500).json({ error: 'Failed to fetch workouts' });
  }
});

// POST /api/workouts - Create new workout
router.post('/', authenticate, async (req, res) => {
  try {
    const { exerciseId, weight, reps } = req.body;

    if (!exerciseId || !weight || !reps) {
      return res.status(400).json({
        error: 'exerciseId, weight, and reps are required',
      });
    }

    // Verify the exercise belongs to the user
    const exercise = await prisma.exercise.findFirst({
      where: {
        id: exerciseId,
        userId: req.user!.id,
      },
    });

    if (!exercise) {
      return res.status(404).json({ error: 'Exercise not found' });
    }

    const oneRM = calculate1RM(parseFloat(weight), parseInt(reps));

    const workout = await prisma.workout.create({
      data: {
        userId: req.user!.id,
        exerciseId,
        weight: parseFloat(weight),
        reps: parseInt(reps),
        oneRM,
      },
      include: {
        exercise: true,
      },
    });

    res.status(201).json({ workout });
  } catch (error) {
    console.error('Error creating workout:', error);
    res.status(500).json({ error: 'Failed to create workout' });
  }
});

// GET /api/workouts/today - Get today's workouts
router.get('/today', authenticate, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const workouts = await prisma.workout.findMany({
      where: {
        userId: req.user!.id,
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        exercise: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ workouts });
  } catch (error) {
    console.error("Error fetching today's workouts:", error);
    res.status(500).json({ error: 'Failed to fetch workouts' });
  }
});

// DELETE /api/workouts/:id - Delete workout
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const workout = await prisma.workout.findFirst({
      where: {
        id,
        userId: req.user!.id,
      },
    });

    if (!workout) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    await prisma.workout.delete({
      where: { id },
    });

    res.json({ message: 'Workout deleted successfully' });
  } catch (error) {
    console.error('Error deleting workout:', error);
    res.status(500).json({ error: 'Failed to delete workout' });
  }
});

export { router as workoutRoutes };
