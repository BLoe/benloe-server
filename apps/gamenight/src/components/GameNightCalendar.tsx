import { useState, useCallback, useEffect } from 'react';
import {
  CalendarDaysIcon,
  UsersIcon,
  ClockIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
} from 'date-fns';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { useEventStore } from '../store/eventStore';
import MonthCarousel from './MonthCarousel';
import CreateEventDialog from './CreateEventDialog';
import CalendarExport from './CalendarExport';
import clsx from 'clsx';

export default function GameNightCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isCreateEventDialogOpen, setIsCreateEventDialogOpen] = useState(false);
  const [isCalendarExportOpen, setIsCalendarExportOpen] = useState(false);
  const { withAuth } = useRequireAuth();

  const { events, loading, error, fetchEventsForMonth, joinEvent } = useEventStore();

  // Load events for current month on mount
  useEffect(() => {
    fetchEventsForMonth(currentDate);
  }, [currentDate, fetchEventsForMonth]);

  const handleTodayClick = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const handleMonthChange = useCallback((newDate: Date) => {
    setCurrentDate(newDate);
  }, []);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getEventsForDay = (day: Date) => {
    return events.filter((event) => isSameDay(new Date(event.dateTime), day));
  };

  // Get events organized by date for mobile view
  const getEventsGroupedByDate = () => {
    const grouped: { [key: string]: typeof events } = {};
    const currentMonth = format(currentDate, 'yyyy-MM');

    events
      .filter((event) => format(new Date(event.dateTime), 'yyyy-MM') === currentMonth)
      .forEach((event) => {
        const dateKey = format(new Date(event.dateTime), 'yyyy-MM-dd');
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(event);
      });

    return Object.keys(grouped)
      .sort()
      .map((dateKey) => ({
        date: new Date(dateKey),
        events: grouped[dateKey] || [],
      }));
  };

  const handleScheduleGameNight = () => {
    withAuth(
      () => {
        setIsCreateEventDialogOpen(true);
      },
      {
        message: 'You need to sign in to schedule a game night. Would you like to sign in now?',
      }
    );
  };

  const handleCloseCreateEventDialog = () => {
    setIsCreateEventDialogOpen(false);
    // Refresh events after creation
    fetchEventsForMonth(currentDate);
  };

  const handleJoinEvent = (eventId: string) => {
    withAuth(
      async () => {
        try {
          await joinEvent(eventId);
          // Success handled by store
        } catch (error) {
          console.error('Failed to join event:', error);
        }
      },
      {
        message: 'You need to sign in to join a game night. Would you like to sign in now?',
      }
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 sm:items-center">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Game Night Calendar</h1>
          <p className="text-gray-600 mt-2">Schedule and join board game nights with friends</p>
        </div>
        <div className="ml-4 flex-shrink-0 space-x-3">
          <button
            onClick={() => setIsCalendarExportOpen(true)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
            Export
          </button>
          <button
            onClick={handleScheduleGameNight}
            className="inline-flex items-center px-3 py-2 sm:px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Plan a Game Night
          </button>
        </div>
      </div>

      {/* Month Navigation */}
      <MonthCarousel onMonthChange={handleMonthChange} onTodayClick={handleTodayClick} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {/* Desktop Calendar Grid */}
      <div className="hidden md:block bg-white rounded-lg shadow overflow-hidden">
        <div className="grid grid-cols-7 gap-px bg-gray-200">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div
              key={day}
              className="bg-gray-50 py-2 px-3 text-center text-xs font-semibold text-gray-700"
            >
              {day}
            </div>
          ))}

          {calendarDays.map((day) => {
            const dayEvents = getEventsForDay(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isDayToday = isToday(day);

            return (
              <div
                key={day.toString()}
                className={clsx(
                  'min-h-[100px] bg-white p-2',
                  !isCurrentMonth && 'bg-gray-50 text-gray-400'
                )}
              >
                <div className={clsx('text-sm font-medium mb-1', isDayToday && 'text-indigo-600')}>
                  {format(day, 'd')}
                </div>

                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="mb-1 p-1 bg-indigo-100 rounded text-xs hover:bg-indigo-200 cursor-pointer transition-colors"
                    onClick={() => alert(`Event details for: ${event.title}`)}
                  >
                    <div className="font-medium text-indigo-900 truncate">
                      {event.title || event.game.name}
                    </div>
                    <div className="text-indigo-700">
                      {format(new Date(event.dateTime), 'HH:mm')}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile Card List */}
      <div className="md:hidden space-y-4">
        {getEventsGroupedByDate().map(({ date, events }) => (
          <div key={date.toISOString()} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">{format(date, 'EEEE, MMM d')}</h3>
                {isToday(date) && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                    Today
                  </span>
                )}
              </div>
            </div>
            <div className="divide-y divide-gray-200">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => alert(`Event details for: ${event.title}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-base font-medium text-gray-900 truncate">
                        {event.title || event.game.name}
                      </h4>
                      <div className="mt-2 flex items-center space-x-4 text-sm text-gray-600">
                        <div className="flex items-center">
                          <ClockIcon className="h-4 w-4 mr-1" />
                          {format(new Date(event.dateTime), 'h:mm a')}
                        </div>
                        <div className="flex items-center">
                          <UsersIcon className="h-4 w-4 mr-1" />
                          {event.committedCount || event.commitments.length}/{event.game.maxPlayers}
                        </div>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">Hosted by {event.creatorId}</p>
                    </div>
                    <div className="ml-4 flex flex-col items-end space-y-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJoinEvent(event.id);
                        }}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                      >
                        Join
                      </button>
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                          event.status === 'OPEN' && 'bg-green-100 text-green-800',
                          event.status === 'FULL' && 'bg-red-100 text-red-800'
                        )}
                      >
                        {event.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {getEventsGroupedByDate().length === 0 && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <CalendarDaysIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No events this month</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by planning your first game night.
            </p>
            <div className="mt-6">
              <button
                onClick={handleScheduleGameNight}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Plan a Game Night
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Event Dialog */}
      <CreateEventDialog isOpen={isCreateEventDialogOpen} onClose={handleCloseCreateEventDialog} />

      {/* Calendar Export Dialog */}
      <CalendarExport
        isOpen={isCalendarExportOpen}
        onClose={() => setIsCalendarExportOpen(false)}
      />
    </div>
  );
}
