import { eventService } from './database';
import { Event } from './database';
import { format } from 'date-fns';
import crypto from 'crypto';
import { db } from './database';

export interface CalendarSubscription {
  id: string;
  userId: string;
  token: string;
  active: boolean;
  createdAt: string;
}

class CalendarService {
  generateICS(events: any[], title: string = 'Game Night Events'): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Game Night//Game Night Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${title}`,
      'X-WR-TIMEZONE:UTC',
      'X-WR-CALDESC:Board game night events and schedules',
    ];

    events.forEach((event) => {
      const eventStart = new Date(event.dateTime);
      const eventEnd = new Date(eventStart.getTime() + (event.game.duration || 120) * 60000); // Default 2 hours

      const formatDate = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      const eventLines = [
        'BEGIN:VEVENT',
        `UID:${event.id}@gamenight.benloe.com`,
        `DTSTART:${formatDate(eventStart)}`,
        `DTEND:${formatDate(eventEnd)}`,
        `DTSTAMP:${timestamp}`,
        `SUMMARY:${this.escapeText(event.title || event.game.name)}`,
        `DESCRIPTION:${this.escapeText(this.generateEventDescription(event))}`,
        `LOCATION:${this.escapeText(event.location || '')}`,
        `STATUS:${this.getEventStatus(event.status)}`,
        `ORGANIZER:CN=${this.escapeText(event.creatorId)}`,
        'END:VEVENT',
      ];

      ics.push(...eventLines);
    });

    ics.push('END:VCALENDAR');

    return ics.join('\r\n');
  }

  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }

  private generateEventDescription(event: {
    game: {
      name: string;
      minPlayers: number;
      maxPlayers: number;
      duration?: number;
      complexity?: number;
    };
    description?: string;
    commitments?: { status: string }[];
    commitmentDeadline?: string;
  }): string {
    let description = `Game: ${event.game.name}`;

    if (event.description) {
      description += `\\n\\nDescription: ${event.description}`;
    }

    description += `\\n\\nPlayers: ${event.game.minPlayers}`;
    if (event.game.maxPlayers !== event.game.minPlayers) {
      description += `-${event.game.maxPlayers}`;
    }

    if (event.game.duration) {
      description += `\\nDuration: ${event.game.duration} minutes`;
    }

    if (event.game.complexity) {
      description += `\\nComplexity: ${event.game.complexity}/5`;
    }

    if (event.commitments && event.commitments.length > 0) {
      const committed = event.commitments.filter((c) => c.status === 'COMMITTED').length;
      description += `\\n\\nCommitted Players: ${committed}/${event.game.maxPlayers}`;
    }

    if (event.commitmentDeadline) {
      const deadline = new Date(event.commitmentDeadline);
      description += `\\nRSVP Deadline: ${deadline.toLocaleString()}`;
    }

    return description;
  }

  private getEventStatus(status: string): string {
    switch (status) {
      case 'OPEN':
        return 'CONFIRMED';
      case 'FULL':
        return 'CONFIRMED';
      case 'CANCELLED':
        return 'CANCELLED';
      case 'COMPLETED':
        return 'CONFIRMED';
      default:
        return 'TENTATIVE';
    }
  }

  generateUserCalendar(userId: string, startDate?: Date, endDate?: Date): string {
    // Get events for the time period (default to next 6 months)
    const start = startDate || new Date();
    const end = endDate || new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000);

    const allEvents = eventService.getAll(start, end);

    // Filter events where user is creator or committed
    const userEvents = allEvents.filter(
      (event) =>
        event.creatorId === userId ||
        event.commitments.some((c) => c.userId === userId && c.status === 'COMMITTED')
    );

    return this.generateICS(userEvents, 'My Game Night Events');
  }

  generateEventCalendar(eventId: string): string {
    const event = eventService.getById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }

    return this.generateICS([event], event.title || event.game.name);
  }

  generateAllEventsCalendar(startDate?: Date, endDate?: Date): string {
    // Get events for the time period (default to next 3 months)
    const start = startDate || new Date();
    const end = endDate || new Date(Date.now() + 3 * 30 * 24 * 60 * 60 * 1000);

    const events = eventService.getAll(start, end);

    // Only include open events
    const openEvents = events.filter((event) => event.status === 'OPEN' || event.status === 'FULL');

    return this.generateICS(openEvents, 'All Game Night Events');
  }

  // Generate a subscription token for a user
  generateSubscriptionToken(userId: string): string {
    // crypto imported at top

    // Create a secure token for calendar subscriptions
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(16).toString('hex');
    const userHash = crypto.createHash('sha256').update(userId).digest('hex').substr(0, 8);
    const token = `${timestamp}-${userHash}-${random}`;

    // Store in database
    this.storeSubscriptionToken(userId, token);

    return token;
  }

  // Validate subscription token against database
  validateSubscriptionToken(token: string): { valid: boolean; userId?: string } {
    try {
      const parts = token.split('-');
      if (parts.length !== 3) {
        return { valid: false };
      }

      // Look up token in database
      const subscription = this.getSubscriptionByToken(token);
      if (!subscription || !subscription.active) {
        return { valid: false };
      }

      return { valid: true, userId: subscription.userId };
    } catch (error) {
      console.error('Error validating subscription token:', error);
      return { valid: false };
    }
  }

  private storeSubscriptionToken(userId: string, token: string): void {
    // db imported at top
    const id = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    // Deactivate any existing tokens for this user
    db.prepare('UPDATE calendar_subscriptions SET active = 0 WHERE userId = ?').run(userId);

    // Insert new token
    db.prepare(
      `
      INSERT INTO calendar_subscriptions (id, userId, token, active, createdAt)
      VALUES (?, ?, ?, 1, ?)
    `
    ).run(id, userId, token, now);
  }

  private getSubscriptionByToken(token: string): { userId: string; active: boolean } | null {
    // db imported at top
    return db
      .prepare('SELECT userId, active FROM calendar_subscriptions WHERE token = ?')
      .get(token) as { userId: string; active: boolean } | null;
  }
}

export const calendarService = new CalendarService();
