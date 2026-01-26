import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all exercise details for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const exercises = await prisma.exerciseDetail.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });

    // Parse JSON fields
    const exercisesWithParsedJson = exercises.map((e) => ({
      ...e,
      focusPoints: e.focusPoints ? JSON.parse(e.focusPoints) : null,
      equipmentNeeded: e.equipmentNeeded ? JSON.parse(e.equipmentNeeded) : null,
      modifications: e.modifications ? JSON.parse(e.modifications) : null,
    }));

    res.json({ exercises: exercisesWithParsedJson });
  } catch (error) {
    console.error('Error fetching exercises:', error);
    res.status(500).json({ error: 'Failed to fetch exercises' });
  }
});

// Get specific exercise detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const exercise = await prisma.exerciseDetail.findUnique({
      where: { id },
    });

    if (!exercise) {
      res.status(404).json({ error: 'Exercise not found' });
      return;
    }

    const exerciseWithParsedJson = {
      ...exercise,
      focusPoints: exercise.focusPoints ? JSON.parse(exercise.focusPoints) : null,
      equipmentNeeded: exercise.equipmentNeeded ? JSON.parse(exercise.equipmentNeeded) : null,
      modifications: exercise.modifications ? JSON.parse(exercise.modifications) : null,
    };

    res.json({ exercise: exerciseWithParsedJson });
  } catch (error) {
    console.error('Error fetching exercise:', error);
    res.status(500).json({ error: 'Failed to fetch exercise' });
  }
});

// Get exercise by name
router.get('/by-name/:name', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name } = req.params;

    const exercise = await prisma.exerciseDetail.findUnique({
      where: {
        userId_name: { userId, name: decodeURIComponent(name) },
      },
    });

    if (!exercise) {
      res.status(404).json({ error: 'Exercise not found' });
      return;
    }

    const exerciseWithParsedJson = {
      ...exercise,
      focusPoints: exercise.focusPoints ? JSON.parse(exercise.focusPoints) : null,
      equipmentNeeded: exercise.equipmentNeeded ? JSON.parse(exercise.equipmentNeeded) : null,
      modifications: exercise.modifications ? JSON.parse(exercise.modifications) : null,
    };

    res.json({ exercise: exerciseWithParsedJson });
  } catch (error) {
    console.error('Error fetching exercise:', error);
    res.status(500).json({ error: 'Failed to fetch exercise' });
  }
});

// Create exercise detail
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, description, focusPoints, equipmentNeeded, modifications, videoUrl } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Exercise name is required' });
      return;
    }

    const exercise = await prisma.exerciseDetail.create({
      data: {
        userId,
        name,
        description,
        focusPoints: focusPoints ? JSON.stringify(focusPoints) : null,
        equipmentNeeded: equipmentNeeded ? JSON.stringify(equipmentNeeded) : null,
        modifications: modifications ? JSON.stringify(modifications) : null,
        videoUrl,
      },
    });

    res.json({ exercise });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'Exercise with this name already exists' });
      return;
    }
    console.error('Error creating exercise:', error);
    res.status(500).json({ error: 'Failed to create exercise' });
  }
});

// Update exercise detail
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, focusPoints, equipmentNeeded, modifications, videoUrl } = req.body;

    const exercise = await prisma.exerciseDetail.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(focusPoints !== undefined && { focusPoints: JSON.stringify(focusPoints) }),
        ...(equipmentNeeded !== undefined && { equipmentNeeded: JSON.stringify(equipmentNeeded) }),
        ...(modifications !== undefined && { modifications: JSON.stringify(modifications) }),
        ...(videoUrl !== undefined && { videoUrl }),
      },
    });

    res.json({ exercise });
  } catch (error) {
    console.error('Error updating exercise:', error);
    res.status(500).json({ error: 'Failed to update exercise' });
  }
});

// Upsert exercise detail by name (useful for AI tool calls)
router.put('/by-name/:name', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name } = req.params;
    const { description, focusPoints, equipmentNeeded, modifications, videoUrl } = req.body;

    const decodedName = decodeURIComponent(name);

    const exercise = await prisma.exerciseDetail.upsert({
      where: {
        userId_name: { userId, name: decodedName },
      },
      update: {
        ...(description !== undefined && { description }),
        ...(focusPoints !== undefined && { focusPoints: JSON.stringify(focusPoints) }),
        ...(equipmentNeeded !== undefined && { equipmentNeeded: JSON.stringify(equipmentNeeded) }),
        ...(modifications !== undefined && { modifications: JSON.stringify(modifications) }),
        ...(videoUrl !== undefined && { videoUrl }),
      },
      create: {
        userId,
        name: decodedName,
        description,
        focusPoints: focusPoints ? JSON.stringify(focusPoints) : null,
        equipmentNeeded: equipmentNeeded ? JSON.stringify(equipmentNeeded) : null,
        modifications: modifications ? JSON.stringify(modifications) : null,
        videoUrl,
      },
    });

    res.json({ exercise });
  } catch (error) {
    console.error('Error upserting exercise:', error);
    res.status(500).json({ error: 'Failed to upsert exercise' });
  }
});

// Delete exercise detail
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.exerciseDetail.delete({
      where: { id },
    });

    res.json({ message: 'Exercise deleted' });
  } catch (error) {
    console.error('Error deleting exercise:', error);
    res.status(500).json({ error: 'Failed to delete exercise' });
  }
});

export { router as exerciseRoutes };
