import { Router } from 'express';
import { calendarService } from '../services/calendar';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/calendar/events.ics - Export all public events
router.get('/events.ics', (req, res) => {
  try {
    const { start, end } = req.query;

    const startDate = start ? new Date(start as string) : undefined;
    const endDate = end ? new Date(end as string) : undefined;

    const icsContent = calendarService.generateAllEventsCalendar(startDate, endDate);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gamenight-events.ics"');
    res.send(icsContent);
  } catch (error) {
    console.error('Error generating events calendar:', error);
    res.status(500).json({ error: 'Failed to generate calendar' });
  }
});

// GET /api/calendar/my-events.ics - Export user's events (requires auth)
router.get('/my-events.ics', authenticate, (req, res) => {
  try {
    const userId = req.user!.id;
    const { start, end } = req.query;

    const startDate = start ? new Date(start as string) : undefined;
    const endDate = end ? new Date(end as string) : undefined;

    const icsContent = calendarService.generateUserCalendar(userId, startDate, endDate);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-gamenight-events.ics"');
    res.send(icsContent);
  } catch (error) {
    console.error('Error generating user calendar:', error);
    res.status(500).json({ error: 'Failed to generate calendar' });
  }
});

// GET /api/calendar/event/:id.ics - Export single event
router.get('/event/:id.ics', (req, res) => {
  try {
    const { id } = req.params;

    const icsContent = calendarService.generateEventCalendar(id);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gamenight-event-${id}.ics"`);
    res.send(icsContent);
  } catch (error) {
    console.error('Error generating event calendar:', error);
    if (error instanceof Error && error.message === 'Event not found') {
      res.status(404).json({ error: 'Event not found' });
    } else {
      res.status(500).json({ error: 'Failed to generate calendar' });
    }
  }
});

// POST /api/calendar/subscription - Generate calendar subscription token (requires auth)
router.post('/subscription', authenticate, (req, res) => {
  try {
    const userId = req.user!.id;

    const token = calendarService.generateSubscriptionToken(userId);

    // In a real app, you'd save this to the calendar_subscriptions table
    const subscriptionUrl = `${req.protocol}://${req.get('host')}/api/calendar/subscription/${token}.ics`;

    res.json({
      token,
      subscriptionUrl,
      instructions: 'Add this URL to your calendar app to subscribe to your game night events',
    });
  } catch (error) {
    console.error('Error creating calendar subscription:', error);
    res.status(500).json({ error: 'Failed to create calendar subscription' });
  }
});

// GET /api/calendar/subscription/:token.ics - Calendar subscription feed
router.get('/subscription/:token.ics', (req, res) => {
  try {
    const { token } = req.params;

    const validation = calendarService.validateSubscriptionToken(token);
    if (!validation.valid) {
      return res.status(404).json({ error: 'Invalid subscription token' });
    }

    // For demo purposes, we'll use a placeholder user ID
    // In a real app, you'd get the userId from the validated token
    const userId = validation.userId || 'demo-user';

    const icsContent = calendarService.generateUserCalendar(userId);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(icsContent);
  } catch (error) {
    console.error('Error serving calendar subscription:', error);
    res.status(500).json({ error: 'Failed to serve calendar subscription' });
  }
});

export { router as calendarRoutes };
