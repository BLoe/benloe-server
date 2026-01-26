import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all milestones
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { includeCompleted } = req.query;

    const where: any = { userId };

    if (includeCompleted === 'false') {
      where.completed = false;
    }

    const milestones = await prisma.milestone.findMany({
      where,
      orderBy: [{ completed: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ milestones });
  } catch (error) {
    console.error('Error fetching milestones:', error);
    res.status(500).json({ error: 'Failed to fetch milestones' });
  }
});

// Create milestone
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { title, description, targetDate } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Milestone title is required' });
      return;
    }

    const milestone = await prisma.milestone.create({
      data: {
        userId,
        title,
        description,
        targetDate: targetDate ? new Date(targetDate) : null,
      },
    });

    res.json({ milestone });
  } catch (error) {
    console.error('Error creating milestone:', error);
    res.status(500).json({ error: 'Failed to create milestone' });
  }
});

// Update milestone
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, targetDate, sortOrder } = req.body;

    const milestone = await prisma.milestone.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    res.json({ milestone });
  } catch (error) {
    console.error('Error updating milestone:', error);
    res.status(500).json({ error: 'Failed to update milestone' });
  }
});

// Mark milestone complete
router.put('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const milestone = await prisma.milestone.update({
      where: { id },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });

    res.json({ milestone });
  } catch (error) {
    console.error('Error completing milestone:', error);
    res.status(500).json({ error: 'Failed to complete milestone' });
  }
});

// Complete milestone by title (for AI tool calls)
router.put('/by-title/:title/complete', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { title } = req.params;

    const milestone = await prisma.milestone.findFirst({
      where: {
        userId,
        title: decodeURIComponent(title),
        completed: false,
      },
    });

    if (!milestone) {
      res.status(404).json({ error: 'Active milestone with this title not found' });
      return;
    }

    const updated = await prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });

    res.json({ milestone: updated });
  } catch (error) {
    console.error('Error completing milestone:', error);
    res.status(500).json({ error: 'Failed to complete milestone' });
  }
});

// Delete milestone
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.milestone.delete({
      where: { id },
    });

    res.json({ message: 'Milestone deleted' });
  } catch (error) {
    console.error('Error deleting milestone:', error);
    res.status(500).json({ error: 'Failed to delete milestone' });
  }
});

export { router as milestoneRoutes };
