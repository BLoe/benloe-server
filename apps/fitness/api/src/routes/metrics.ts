import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all metric definitions
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const metrics = await prisma.metricDefinition.findMany({
      where: { userId },
      include: {
        values: {
          orderBy: { recordedDate: 'desc' },
          take: 1,
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    // Add latest value to each metric
    const metricsWithLatest = metrics.map((m) => ({
      ...m,
      latestValue: m.values[0] || null,
      values: undefined,
    }));

    res.json({ metrics: metricsWithLatest });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// Create metric definition
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, unit } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Metric name is required' });
      return;
    }

    const metric = await prisma.metricDefinition.create({
      data: {
        userId,
        name,
        unit,
      },
    });

    res.json({ metric });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'Metric with this name already exists' });
      return;
    }
    console.error('Error creating metric:', error);
    res.status(500).json({ error: 'Failed to create metric' });
  }
});

// Update metric definition
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, unit, sortOrder } = req.body;

    const metric = await prisma.metricDefinition.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(unit !== undefined && { unit }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    res.json({ metric });
  } catch (error) {
    console.error('Error updating metric:', error);
    res.status(500).json({ error: 'Failed to update metric' });
  }
});

// Delete metric definition (cascades to values)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.metricDefinition.delete({
      where: { id },
    });

    res.json({ message: 'Metric deleted' });
  } catch (error) {
    console.error('Error deleting metric:', error);
    res.status(500).json({ error: 'Failed to delete metric' });
  }
});

// Get values for a metric
router.get('/:id/values', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit, startDate, endDate } = req.query;

    const where: any = { metricDefinitionId: id };

    if (startDate || endDate) {
      where.recordedDate = {};
      if (startDate) {
        where.recordedDate.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.recordedDate.lte = new Date(endDate as string);
      }
    }

    const values = await prisma.metricValue.findMany({
      where,
      orderBy: { recordedDate: 'desc' },
      take: limit ? parseInt(limit as string) : 100,
    });

    res.json({ values });
  } catch (error) {
    console.error('Error fetching metric values:', error);
    res.status(500).json({ error: 'Failed to fetch metric values' });
  }
});

// Log a metric value
router.post('/:id/values', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { value, recordedDate, notes } = req.body;

    if (value === undefined || value === null) {
      res.status(400).json({ error: 'Value is required' });
      return;
    }

    const date = recordedDate ? new Date(recordedDate) : new Date();

    const metricValue = await prisma.metricValue.create({
      data: {
        metricDefinitionId: id,
        value: parseFloat(value),
        recordedDate: date,
        notes,
      },
    });

    res.json({ value: metricValue });
  } catch (error) {
    console.error('Error logging metric value:', error);
    res.status(500).json({ error: 'Failed to log metric value' });
  }
});

// Log metric by name (creates definition if needed)
router.post('/by-name', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, value, unit, recordedDate, notes } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Metric name is required' });
      return;
    }

    if (value === undefined || value === null) {
      res.status(400).json({ error: 'Value is required' });
      return;
    }

    // Get or create metric definition
    let metric = await prisma.metricDefinition.findUnique({
      where: { userId_name: { userId, name } },
    });

    if (!metric) {
      metric = await prisma.metricDefinition.create({
        data: { userId, name, unit },
      });
    }

    const date = recordedDate ? new Date(recordedDate) : new Date();

    const metricValue = await prisma.metricValue.create({
      data: {
        metricDefinitionId: metric.id,
        value: parseFloat(value),
        recordedDate: date,
        notes,
      },
    });

    res.json({ metric, value: metricValue });
  } catch (error) {
    console.error('Error logging metric:', error);
    res.status(500).json({ error: 'Failed to log metric' });
  }
});

// Delete a metric value
router.delete('/values/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.metricValue.delete({
      where: { id },
    });

    res.json({ message: 'Value deleted' });
  } catch (error) {
    console.error('Error deleting value:', error);
    res.status(500).json({ error: 'Failed to delete value' });
  }
});

export { router as metricRoutes };
