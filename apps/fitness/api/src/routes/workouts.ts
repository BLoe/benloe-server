import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all workout templates for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const workouts = await prisma.workoutTemplate.findMany({
      where: { userId },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { dayOfWeek: 'asc' },
    });

    res.json({ workouts });
  } catch (error) {
    console.error('Error fetching workouts:', error);
    res.status(500).json({ error: 'Failed to fetch workouts' });
  }
});

// Get workout for specific day
router.get('/:dayOfWeek', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const dayOfWeek = parseInt(req.params.dayOfWeek);

    if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      res.status(400).json({ error: 'Invalid day of week (must be 0-6)' });
      return;
    }

    const workout = await prisma.workoutTemplate.findUnique({
      where: {
        userId_dayOfWeek: { userId, dayOfWeek },
      },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ workout });
  } catch (error) {
    console.error('Error fetching workout:', error);
    res.status(500).json({ error: 'Failed to fetch workout' });
  }
});

// Create or update workout for a day
router.put('/:dayOfWeek', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const dayOfWeek = parseInt(req.params.dayOfWeek);
    const { name, description, isActive } = req.body;

    if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      res.status(400).json({ error: 'Invalid day of week (must be 0-6)' });
      return;
    }

    if (!name) {
      res.status(400).json({ error: 'Workout name is required' });
      return;
    }

    const workout = await prisma.workoutTemplate.upsert({
      where: {
        userId_dayOfWeek: { userId, dayOfWeek },
      },
      update: {
        name,
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
      },
      create: {
        userId,
        dayOfWeek,
        name,
        description,
        isActive: isActive ?? true,
      },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ workout });
  } catch (error) {
    console.error('Error updating workout:', error);
    res.status(500).json({ error: 'Failed to update workout' });
  }
});

// Delete workout template
router.delete('/:dayOfWeek', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const dayOfWeek = parseInt(req.params.dayOfWeek);

    await prisma.workoutTemplate.delete({
      where: {
        userId_dayOfWeek: { userId, dayOfWeek },
      },
    });

    res.json({ message: 'Workout deleted' });
  } catch (error) {
    console.error('Error deleting workout:', error);
    res.status(500).json({ error: 'Failed to delete workout' });
  }
});

// Add exercise to workout
router.post('/:dayOfWeek/exercises', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const dayOfWeek = parseInt(req.params.dayOfWeek);
    const { name, sets, reps, duration, notes, exerciseDetailId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Exercise name is required' });
      return;
    }

    // Get or create workout template
    let workout = await prisma.workoutTemplate.findUnique({
      where: { userId_dayOfWeek: { userId, dayOfWeek } },
    });

    if (!workout) {
      res.status(404).json({ error: 'Workout template not found for this day' });
      return;
    }

    // Get max sort order
    const maxSort = await prisma.workoutExercise.aggregate({
      where: { workoutTemplateId: workout.id },
      _max: { sortOrder: true },
    });

    const exercise = await prisma.workoutExercise.create({
      data: {
        workoutTemplateId: workout.id,
        name,
        sets,
        reps,
        duration,
        notes,
        exerciseDetailId,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    res.json({ exercise });
  } catch (error) {
    console.error('Error adding exercise:', error);
    res.status(500).json({ error: 'Failed to add exercise' });
  }
});

// Update exercise in workout
router.put('/exercises/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, sets, reps, duration, notes, sortOrder } = req.body;

    const exercise = await prisma.workoutExercise.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(sets !== undefined && { sets }),
        ...(reps !== undefined && { reps }),
        ...(duration !== undefined && { duration }),
        ...(notes !== undefined && { notes }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    res.json({ exercise });
  } catch (error) {
    console.error('Error updating exercise:', error);
    res.status(500).json({ error: 'Failed to update exercise' });
  }
});

// Delete exercise from workout
router.delete('/exercises/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.workoutExercise.delete({
      where: { id },
    });

    res.json({ message: 'Exercise deleted' });
  } catch (error) {
    console.error('Error deleting exercise:', error);
    res.status(500).json({ error: 'Failed to delete exercise' });
  }
});

export { router as workoutRoutes };
