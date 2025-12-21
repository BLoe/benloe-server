import { create } from 'zustand';
import { Event } from '../types';
import { eventsApi } from '../services/api';
import { startOfMonth, endOfMonth } from 'date-fns';

interface EventStore {
  events: Event[];
  loading: boolean;
  error: string | null;
  currentMonth: Date;

  // Actions
  fetchEvents: (start?: Date, end?: Date) => Promise<void>;
  fetchEventsForMonth: (date: Date) => Promise<void>;
  setCurrentMonth: (date: Date) => void;
  joinEvent: (eventId: string, notes?: string) => Promise<void>;
  leaveEvent: (eventId: string) => Promise<void>;
  createEvent: (eventData: {
    title?: string;
    gameId: string;
    dateTime: string;
    location?: string;
    description?: string;
    commitmentDeadline?: string;
  }) => Promise<Event>;
  addEvent: (event: Event) => void;
  updateEvent: (id: string, updates: Partial<Event>) => void;
  removeEvent: (id: string) => void;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  loading: false,
  error: null,
  currentMonth: new Date(),

  fetchEvents: async (start?: Date, end?: Date) => {
    set({ loading: true, error: null });
    try {
      const params: any = {};
      if (start) params.start = start.toISOString();
      if (end) params.end = end.toISOString();

      const { events } = await eventsApi.getAll(params);
      set({ events, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch events',
        loading: false,
      });
    }
  },

  fetchEventsForMonth: async (date: Date) => {
    const start = startOfMonth(date);
    const end = endOfMonth(date);
    await get().fetchEvents(start, end);
  },

  setCurrentMonth: (date: Date) => {
    set({ currentMonth: date });
    get().fetchEventsForMonth(date);
  },

  joinEvent: async (eventId: string, notes?: string) => {
    try {
      await eventsApi.joinEvent(eventId, notes);
      // Refresh events to get updated commitment counts
      await get().fetchEvents();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to join event',
      });
      throw error;
    }
  },

  leaveEvent: async (eventId: string) => {
    try {
      await eventsApi.leaveEvent(eventId);
      // Refresh events to get updated commitment counts
      await get().fetchEvents();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to leave event',
      });
      throw error;
    }
  },

  createEvent: async (eventData) => {
    try {
      const { event } = await eventsApi.create(eventData);
      get().addEvent(event);
      return event;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create event',
      });
      throw error;
    }
  },

  addEvent: (event: Event) => {
    set((state) => ({ events: [...state.events, event] }));
  },

  updateEvent: (id: string, updates: Partial<Event>) => {
    set((state) => ({
      events: state.events.map((event) => (event.id === id ? { ...event, ...updates } : event)),
    }));
  },

  removeEvent: (id: string) => {
    set((state) => ({
      events: state.events.filter((event) => event.id !== id),
    }));
  },
}));
