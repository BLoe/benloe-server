import { Router } from 'express';
import { eventService, commitmentService, gameService } from '../services/databaseService';
import { recurringEventService } from '../services/recurring';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/events - List events with filtering
router.get('/', (req, res) => {
  try {
    const startDate = req.query.start ? new Date(req.query.start as string) : new Date();
    const endDate = req.query.end
      ? new Date(req.query.end as string)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const events = eventService.getAll(startDate, endDate);
    res.json({ events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/events/:id - Get single event
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const event = eventService.getById(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// POST /api/events - Create new event (requires auth)
router.post('/', authenticate, (req, res) => {
  try {
    const { title, gameId, dateTime, location, description, commitmentDeadline } = req.body;
    const userId = req.user!.id;

    if (!gameId || !dateTime) {
      return res.status(400).json({ error: 'gameId and dateTime are required' });
    }

    // Validate game exists
    const game = gameService.getById(gameId);
    if (!game) {
      return res.status(400).json({ error: 'Game not found' });
    }

    const event = eventService.create({
      title,
      gameId,
      dateTime: new Date(dateTime).toISOString(),
      location,
      description,
      status: 'OPEN',
      creatorId: userId,
      commitmentDeadline: commitmentDeadline
        ? new Date(commitmentDeadline).toISOString()
        : undefined,
    });

    // Automatically add creator as committed
    if (event) {
      commitmentService.create({
        eventId: event.id,
        userId,
        status: 'COMMITTED',
      });
    }

    res.status(201).json({ event });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PUT /api/events/:id - Update event (requires auth, must be creator)
router.put('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const existingEvent = eventService.getById(id);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (existingEvent.creatorId !== userId) {
      return res.status(403).json({ error: 'Only the event creator can update this event' });
    }

    if (['COMPLETED', 'CANCELLED'].includes(existingEvent.status)) {
      return res.status(400).json({ error: 'Cannot update completed or cancelled events' });
    }

    const { title, dateTime, location, description, commitmentDeadline } = req.body;
    const updateData: Record<string, string | null | undefined> = {};

    if (title !== undefined) updateData.title = title;
    if (dateTime !== undefined) updateData.dateTime = new Date(dateTime).toISOString();
    if (location !== undefined) updateData.location = location;
    if (description !== undefined) updateData.description = description;
    if (commitmentDeadline !== undefined) {
      updateData.commitmentDeadline = commitmentDeadline
        ? new Date(commitmentDeadline).toISOString()
        : null;
    }

    const event = eventService.update(id, updateData);
    res.json({ event });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// POST /api/events/:id/commit - Join/leave event (requires auth)
router.post('/:id/commit', authenticate, (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { action, notes } = req.body;
    const userId = req.user!.id;

    if (!['join', 'leave', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be join, leave, or decline' });
    }

    const event = eventService.getById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status !== 'OPEN') {
      return res.status(400).json({ error: 'Event is not open for new commitments' });
    }

    // Check commitment deadline
    if (event.commitmentDeadline && new Date() > new Date(event.commitmentDeadline)) {
      return res.status(400).json({ error: 'Commitment deadline has passed' });
    }

    const existingCommitment = commitmentService.getUserCommitmentForEvent(eventId, userId);

    if (action === 'join') {
      const committedCount = commitmentService.countCommittedForEvent(eventId);
      const status = committedCount >= event.game.maxPlayers ? 'WAITLISTED' : 'COMMITTED';

      if (existingCommitment) {
        commitmentService.update(existingCommitment.id, {
          status,
          notes,
        });
      } else {
        commitmentService.create({
          eventId,
          userId,
          status,
          notes,
        });
      }

      // Update event status if now full
      if (status === 'COMMITTED' && committedCount + 1 >= event.game.maxPlayers) {
        eventService.update(eventId, { status: 'FULL' });
      }

      res.json({
        message: status === 'COMMITTED' ? 'Successfully joined event' : 'Added to waitlist',
        status,
      });
    } else if (action === 'leave') {
      if (!existingCommitment) {
        return res.status(400).json({ error: 'You are not committed to this event' });
      }

      commitmentService.delete(existingCommitment.id);

      // If user was committed, promote waitlisted user and update status
      if (existingCommitment.status === 'COMMITTED') {
        const waitlistedCommitments = commitmentService
          .getByEventId(eventId)
          .filter((c) => c.status === 'WAITLISTED')
          .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());

        if (waitlistedCommitments.length > 0) {
          commitmentService.update(waitlistedCommitments[0].id, { status: 'COMMITTED' });
        }

        // Update event status
        const newCommittedCount = commitmentService.countCommittedForEvent(eventId);
        const newStatus = newCommittedCount >= event.game.maxPlayers ? 'FULL' : 'OPEN';
        eventService.update(eventId, { status: newStatus });
      }

      res.json({ message: 'Successfully left event' });
    } else if (action === 'decline') {
      if (existingCommitment) {
        commitmentService.update(existingCommitment.id, { status: 'DECLINED', notes });
      } else {
        commitmentService.create({
          eventId,
          userId,
          status: 'DECLINED',
          notes,
        });
      }

      res.json({ message: 'Declined event invitation' });
    }
  } catch (error) {
    console.error('Error processing commitment:', error);
    res.status(500).json({ error: 'Failed to process commitment' });
  }
});

// DELETE /api/events/:id - Cancel event (requires auth, must be creator)
router.delete('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const event = eventService.getById(id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.creatorId !== userId) {
      return res.status(403).json({ error: 'Only the event creator can cancel this event' });
    }

    if (['COMPLETED', 'CANCELLED'].includes(event.status)) {
      return res.status(400).json({ error: 'Event is already completed or cancelled' });
    }

    eventService.update(id, { status: 'CANCELLED' });
    res.json({ message: 'Event cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling event:', error);
    res.status(500).json({ error: 'Failed to cancel event' });
  }
});

// POST /api/events/recurring - Create recurring event (requires auth)
router.post('/recurring', authenticate, async (req, res) => {
  try {
    const { title, gameId, dateTime, location, description, commitmentDeadline, recurring } =
      req.body;
    const userId = req.user!.id;

    if (!gameId || !dateTime || !recurring) {
      return res
        .status(400)
        .json({ error: 'gameId, dateTime, and recurring pattern are required' });
    }

    // Validate recurring pattern
    if (
      !recurring.frequency ||
      !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(recurring.frequency)
    ) {
      return res
        .status(400)
        .json({ error: 'Invalid frequency. Must be DAILY, WEEKLY, MONTHLY, or YEARLY' });
    }

    if (!recurring.interval || recurring.interval < 1 || recurring.interval > 365) {
      return res.status(400).json({ error: 'Invalid interval. Must be between 1 and 365' });
    }

    // Validate game exists
    const game = gameService.getById(gameId);
    if (!game) {
      return res.status(400).json({ error: 'Game not found' });
    }

    const result = await recurringEventService.createRecurringEvent({
      title,
      gameId,
      dateTime: new Date(dateTime).toISOString(),
      location,
      description,
      creatorId: userId,
      commitmentDeadline: commitmentDeadline
        ? new Date(commitmentDeadline).toISOString()
        : undefined,
      recurring: {
        frequency: recurring.frequency,
        interval: recurring.interval,
        endDate: recurring.endDate ? new Date(recurring.endDate).toISOString() : undefined,
        maxOccurrences: recurring.maxOccurrences || 52,
      },
    });

    res.status(201).json({
      mainEvent: result.mainEvent,
      recurringPattern: result.recurringPattern,
      generatedCount: result.generatedEvents.length,
      message: `Created recurring event with ${result.generatedEvents.length + 1} occurrences`,
    });
  } catch (error) {
    console.error('Error creating recurring event:', error);
    res.status(500).json({ error: 'Failed to create recurring event' });
  }
});

// GET /api/events/:id/recurring - Get recurring pattern for event (requires auth)
router.get('/:id/recurring', authenticate, (_req, res) => {
  try {
    // Recurring patterns functionality is not yet implemented
    res.status(501).json({ error: 'Recurring patterns not yet implemented' });
  } catch (error) {
    console.error('Error fetching recurring pattern:', error);
    res.status(500).json({ error: 'Failed to fetch recurring pattern' });
  }
});

// PUT /api/events/:id/recurring - Update recurring event (requires auth, must be creator)
router.put('/:id/recurring', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { updateFuture, ...eventData } = req.body;

    const existingEvent = eventService.getById(id);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (existingEvent.creatorId !== userId) {
      return res.status(403).json({ error: 'Only the event creator can update recurring events' });
    }

    // Check if event has recurring pattern
    if (!recurringEventService.isRecurringEvent(id)) {
      return res.status(400).json({ error: 'Event is not part of a recurring series' });
    }

    const result = await recurringEventService.updateRecurringEvent(id, eventData, updateFuture);
    res.json({
      updatedEvent: result.updatedEvent,
      updatedFutureCount: result.updatedFutureEvents.length,
      message: updateFuture
        ? `Updated event and ${result.updatedFutureEvents.length} future occurrences`
        : 'Updated single event occurrence',
    });
  } catch (error) {
    console.error('Error updating recurring event:', error);
    res.status(500).json({ error: 'Failed to update recurring event' });
  }
});

// DELETE /api/events/:id/recurring - Cancel recurring event (requires auth, must be creator)
router.delete('/:id/recurring', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { cancelFuture } = req.body;

    const existingEvent = eventService.getById(id);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (existingEvent.creatorId !== userId) {
      return res.status(403).json({ error: 'Only the event creator can cancel recurring events' });
    }

    // Check if event has recurring pattern
    if (!recurringEventService.isRecurringEvent(id)) {
      return res.status(400).json({ error: 'Event is not part of a recurring series' });
    }

    const result = await recurringEventService.cancelRecurringEvent(id, cancelFuture);

    res.json({
      cancelledEvent: result.cancelledEvent,
      cancelledFutureCount: result.cancelledFutureEvents.length,
      message: cancelFuture
        ? `Cancelled event and ${result.cancelledFutureEvents.length} future occurrences`
        : 'Cancelled single event occurrence',
    });
  } catch (error) {
    console.error('Error cancelling recurring event:', error);
    res.status(500).json({ error: 'Failed to cancel recurring event' });
  }
});

export { router as eventRoutes };
