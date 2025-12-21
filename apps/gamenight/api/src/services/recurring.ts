import { addDays, addWeeks, addMonths, addYears, isBefore, parseISO } from 'date-fns';
import {
  eventService,
  recurringPatternService,
  commitmentService,
  Event,
  RecurringPattern,
  db,
} from './database';

export interface RecurringEventData {
  title?: string;
  gameId: string;
  dateTime: string;
  location?: string;
  description?: string;
  creatorId: string;
  commitmentDeadline?: string;
  recurring: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    endDate?: string;
    maxOccurrences?: number;
  };
}

class RecurringEventService {
  async createRecurringEvent(
    data: RecurringEventData
  ): Promise<{ mainEvent: any; recurringPattern: RecurringPattern; generatedEvents: any[] }> {
    const { recurring, ...eventData } = data;

    // Create the main event (template)
    const mainEvent = eventService.create({
      ...eventData,
      status: 'OPEN',
    });

    if (!mainEvent) {
      throw new Error('Failed to create main event');
    }

    // Create the recurring pattern
    const recurringPattern = recurringPatternService.create({
      eventId: mainEvent.id,
      frequency: recurring.frequency,
      interval: recurring.interval,
      endDate: recurring.endDate,
    });

    // Generate future occurrences
    const generatedEvents = this.generateFutureEvents(
      mainEvent,
      recurringPattern,
      recurring.maxOccurrences || 52
    );

    // Automatically commit the creator to all generated events
    for (const event of [mainEvent, ...generatedEvents]) {
      commitmentService.create({
        eventId: event.id,
        userId: data.creatorId,
        status: 'COMMITTED',
      });
    }

    return { mainEvent, recurringPattern, generatedEvents };
  }

  generateFutureEvents(
    templateEvent: any,
    pattern: RecurringPattern,
    maxOccurrences: number = 52
  ): any[] {
    const events = [];
    let currentDate = parseISO(templateEvent.dateTime);
    const endDate = pattern.endDate ? parseISO(pattern.endDate) : null;
    let occurrenceCount = 0;

    while (occurrenceCount < maxOccurrences) {
      // Calculate next occurrence
      currentDate = this.getNextOccurrence(currentDate, pattern.frequency, pattern.interval);

      // Check if we've exceeded the end date
      if (endDate && !isBefore(currentDate, endDate)) {
        break;
      }

      occurrenceCount++;

      // Create the event
      const newEvent = eventService.create({
        title: templateEvent.title,
        gameId: templateEvent.gameId,
        dateTime: currentDate.toISOString(),
        location: templateEvent.location,
        description: templateEvent.description,
        status: 'OPEN',
        creatorId: templateEvent.creatorId,
        commitmentDeadline: templateEvent.commitmentDeadline,
        parentEventId: templateEvent.id, // Link to the main event
      });

      if (newEvent) {
        events.push(newEvent);
      }
    }

    return events;
  }

  private getNextOccurrence(currentDate: Date, frequency: string, interval: number): Date {
    switch (frequency) {
      case 'DAILY':
        return addDays(currentDate, interval);
      case 'WEEKLY':
        return addWeeks(currentDate, interval);
      case 'MONTHLY':
        return addMonths(currentDate, interval);
      case 'YEARLY':
        return addYears(currentDate, interval);
      default:
        throw new Error(`Unsupported frequency: ${frequency}`);
    }
  }

  async updateRecurringEvent(
    eventId: string,
    updateData: Partial<Event>,
    updateFuture: boolean = false
  ): Promise<{ updatedEvent: any; updatedFutureEvents: any[] }> {
    // Update the main event
    const updatedEvent = eventService.update(eventId, updateData);
    let updatedFutureEvents: any[] = [];

    if (updateFuture) {
      // Find all future events with the same parent
      const futureEvents = this.getFutureEventsByParent(eventId);

      // Update each future event (excluding dateTime to preserve the schedule)
      const updateDataWithoutDateTime = { ...updateData };
      delete updateDataWithoutDateTime.dateTime;

      updatedFutureEvents = futureEvents
        .map((event) => eventService.update(event.id, updateDataWithoutDateTime))
        .filter(Boolean);
    }

    return { updatedEvent, updatedFutureEvents };
  }

  async cancelRecurringEvent(
    eventId: string,
    cancelFuture: boolean = false
  ): Promise<{ cancelledEvent: any; cancelledFutureEvents: any[] }> {
    // Cancel the main event
    const cancelledEvent = eventService.update(eventId, { status: 'CANCELLED' });
    let cancelledFutureEvents: any[] = [];

    if (cancelFuture) {
      // Find and cancel all future events with the same parent
      const futureEvents = this.getFutureEventsByParent(eventId);

      cancelledFutureEvents = futureEvents
        .map((event) => eventService.update(event.id, { status: 'CANCELLED' }))
        .filter(Boolean);
    }

    return { cancelledEvent, cancelledFutureEvents };
  }

  private getFutureEventsByParent(parentEventId: string): any[] {
    // db imported at top
    const now = new Date().toISOString();

    // Find all future events that have this event as their parent
    // or that share the same parent (for series events)
    const futureEvents = db
      .prepare(
        `
      SELECT e.*, g.name as game_name, g.minPlayers, g.maxPlayers, g.imageUrl as game_imageUrl
      FROM events e 
      JOIN games g ON e.gameId = g.id
      WHERE (e.parentEventId = ? OR (e.parentEventId IN (
        SELECT parentEventId FROM events WHERE id = ? AND parentEventId IS NOT NULL
      ))) 
      AND e.dateTime > ? 
      AND e.status != 'CANCELLED'
      ORDER BY e.dateTime ASC
    `
      )
      .all(parentEventId, parentEventId, now);

    return futureEvents.map((row: any) => {
      const event = {
        id: row.id,
        title: row.title,
        gameId: row.gameId,
        dateTime: row.dateTime,
        location: row.location,
        description: row.description,
        status: row.status,
        creatorId: row.creatorId,
        commitmentDeadline: row.commitmentDeadline,
        parentEventId: row.parentEventId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };

      const game = {
        id: row.gameId,
        name: row.game_name,
        minPlayers: row.minPlayers,
        maxPlayers: row.maxPlayers,
        imageUrl: row.game_imageUrl,
      };

      return { ...event, game };
    });
  }

  getRecurringPattern(eventId: string): RecurringPattern | undefined {
    return recurringPatternService.getByEventId(eventId);
  }

  async deleteRecurringPattern(eventId: string): Promise<boolean> {
    return recurringPatternService.deleteByEventId(eventId);
  }

  // Helper method to check if an event is part of a recurring series
  isRecurringEvent(eventId: string): boolean {
    const pattern = recurringPatternService.getByEventId(eventId);
    return !!pattern;
  }

  // Format recurring pattern for display
  formatRecurringPattern(pattern: RecurringPattern): string {
    const { frequency, interval } = pattern;

    if (interval === 1) {
      switch (frequency) {
        case 'DAILY':
          return 'Daily';
        case 'WEEKLY':
          return 'Weekly';
        case 'MONTHLY':
          return 'Monthly';
        case 'YEARLY':
          return 'Yearly';
      }
    } else {
      switch (frequency) {
        case 'DAILY':
          return `Every ${interval} days`;
        case 'WEEKLY':
          return `Every ${interval} weeks`;
        case 'MONTHLY':
          return `Every ${interval} months`;
        case 'YEARLY':
          return `Every ${interval} years`;
      }
    }

    return 'Custom recurring';
  }
}

export const recurringEventService = new RecurringEventService();
