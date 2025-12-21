import { useState, Fragment } from 'react';
import { Dialog, Transition, Combobox } from '@headlessui/react';
import {
  XMarkIcon,
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { useGameStore } from '../store/gameStore';
import { useEventStore } from '../store/eventStore';
import { Game } from '../types';
import clsx from 'clsx';

interface CreateEventDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialGameId?: string;
}

export default function CreateEventDialog({
  isOpen,
  onClose,
  initialGameId,
}: CreateEventDialogProps) {
  const { games } = useGameStore();
  const { createEvent, loading: eventLoading, error: eventError } = useEventStore();

  const [selectedGame, setSelectedGame] = useState<Game | null>(
    initialGameId ? games.find((g) => g.id === initialGameId) || null : null
  );
  const [gameQuery, setGameQuery] = useState('');
  const [title, setTitle] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [commitmentDeadline, setCommitmentDeadline] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<'WEEKLY' | 'MONTHLY' | 'YEARLY'>(
    'WEEKLY'
  );
  const [recurringInterval, setRecurringInterval] = useState(1);
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredGames =
    gameQuery === ''
      ? games
      : games.filter((game) => game.name.toLowerCase().includes(gameQuery.toLowerCase()));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedGame || !dateTime) {
      return;
    }

    setSubmitting(true);
    try {
      if (isRecurring) {
        // Create recurring event
        const response = await fetch('/api/events/recurring', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            title: title || undefined,
            gameId: selectedGame.id,
            dateTime,
            location: location || undefined,
            description: description || undefined,
            commitmentDeadline: commitmentDeadline || undefined,
            recurring: {
              frequency: recurringFrequency,
              interval: recurringInterval,
              endDate: recurringEndDate || undefined,
              maxOccurrences: 52, // Limit to prevent too many events
            },
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create recurring event');
        }

        const result = await response.json();
        alert(`Created recurring event with ${result.generatedCount + 1} occurrences!`);
      } else {
        // Create single event
        await createEvent({
          ...(title && { title }),
          gameId: selectedGame.id,
          dateTime,
          ...(location && { location }),
          ...(description && { description }),
          ...(commitmentDeadline && { commitmentDeadline }),
        });
      }

      // Reset form and close dialog
      resetForm();
      onClose();
    } catch (error) {
      console.error('Failed to create event:', error);
      alert(error instanceof Error ? error.message : 'Failed to create event');
    }
    setSubmitting(false);
  };

  const resetForm = () => {
    setTitle('');
    setSelectedGame(null);
    setDateTime('');
    setLocation('');
    setDescription('');
    setCommitmentDeadline('');
    setIsRecurring(false);
    setRecurringFrequency('WEEKLY');
    setRecurringInterval(1);
    setRecurringEndDate('');
    setGameQuery('');
  };

  const handleClose = () => {
    if (!submitting) {
      onClose();
    }
  };

  // Set minimum date/time to current time
  const now = new Date();
  const minDateTime = format(now, "yyyy-MM-dd'T'HH:mm");

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-6">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                    Plan a Game Night
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onClick={handleClose}
                    disabled={submitting}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Game Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Game *</label>
                    <Combobox value={selectedGame} onChange={setSelectedGame}>
                      <div className="relative">
                        <Combobox.Input
                          className="w-full h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 pr-10 px-3 text-sm"
                          displayValue={(game: Game | null) => game?.name || ''}
                          onChange={(event) => setGameQuery(event.target.value)}
                          placeholder="Select a game..."
                        />
                        <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3">
                          <UsersIcon className="h-5 w-5 text-gray-400" />
                        </Combobox.Button>
                        <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                          {filteredGames.map((game) => (
                            <Combobox.Option
                              key={game.id}
                              className={({ active }) =>
                                clsx(
                                  'relative cursor-default select-none py-2 pl-3 pr-9',
                                  active ? 'bg-indigo-600 text-white' : 'text-gray-900'
                                )
                              }
                              value={game}
                            >
                              <div className="flex items-center">
                                {game.imageUrl && (
                                  <img
                                    src={game.imageUrl}
                                    alt=""
                                    className="h-8 w-8 rounded object-cover mr-3"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <span className="block font-medium truncate">{game.name}</span>
                                  <span className="block text-sm text-gray-500 truncate">
                                    {game.minPlayers === game.maxPlayers
                                      ? `${game.minPlayers} players`
                                      : `${game.minPlayers}-${game.maxPlayers} players`}
                                    {game.duration && ` • ${game.duration} min`}
                                  </span>
                                </div>
                              </div>
                            </Combobox.Option>
                          ))}
                        </Combobox.Options>
                      </div>
                    </Combobox>
                  </div>

                  {/* Event Title */}
                  <div>
                    <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                      Event Title (optional)
                    </label>
                    <input
                      type="text"
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 px-3 text-sm"
                      placeholder={selectedGame ? `${selectedGame.name} Night` : 'Game Night'}
                    />
                  </div>

                  {/* Date and Time */}
                  <div>
                    <label
                      htmlFor="dateTime"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Date & Time *
                    </label>
                    <div className="relative">
                      <input
                        type="datetime-local"
                        id="dateTime"
                        value={dateTime}
                        onChange={(e) => setDateTime(e.target.value)}
                        min={minDateTime}
                        className="w-full h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 pl-10 pr-3 text-sm"
                        required
                      />
                      <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                  </div>

                  {/* Location */}
                  <div>
                    <label
                      htmlFor="location"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Location (optional)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="w-full h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 pl-10 pr-3 text-sm"
                        placeholder="Where will you play?"
                      />
                      <MapPinIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label
                      htmlFor="description"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Description (optional)
                    </label>
                    <textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 px-3 py-2 text-sm resize-none"
                      placeholder="Add any details about the event..."
                    />
                  </div>

                  {/* Commitment Deadline */}
                  <div>
                    <label
                      htmlFor="commitmentDeadline"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      RSVP Deadline (optional)
                    </label>
                    <div className="relative">
                      <input
                        type="datetime-local"
                        id="commitmentDeadline"
                        value={commitmentDeadline}
                        onChange={(e) => setCommitmentDeadline(e.target.value)}
                        min={minDateTime}
                        max={dateTime}
                        className="w-full h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 pl-10 pr-3 text-sm"
                      />
                      <ClockIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      When should people commit by? Leave empty for no deadline.
                    </p>
                  </div>

                  {/* Recurring Event Options */}
                  <div>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="isRecurring"
                        checked={isRecurring}
                        onChange={(e) => setIsRecurring(e.target.checked)}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                      />
                      <label
                        htmlFor="isRecurring"
                        className="ml-2 block text-sm font-medium text-gray-700"
                      >
                        Make this a recurring event
                      </label>
                    </div>

                    {isRecurring && (
                      <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label
                              htmlFor="recurringFrequency"
                              className="block text-sm font-medium text-gray-700 mb-2"
                            >
                              Frequency
                            </label>
                            <select
                              id="recurringFrequency"
                              value={recurringFrequency}
                              onChange={(e) =>
                                setRecurringFrequency(
                                  e.target.value as 'WEEKLY' | 'MONTHLY' | 'YEARLY'
                                )
                              }
                              className="w-full h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 px-3 text-sm"
                            >
                              <option value="WEEKLY">Weekly</option>
                              <option value="MONTHLY">Monthly</option>
                              <option value="YEARLY">Yearly</option>
                            </select>
                          </div>

                          <div>
                            <label
                              htmlFor="recurringInterval"
                              className="block text-sm font-medium text-gray-700 mb-2"
                            >
                              Every
                            </label>
                            <div className="flex items-center">
                              <input
                                type="number"
                                id="recurringInterval"
                                min="1"
                                max="12"
                                value={recurringInterval}
                                onChange={(e) =>
                                  setRecurringInterval(parseInt(e.target.value) || 1)
                                }
                                className="w-20 h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 px-3 text-sm"
                              />
                              <span className="ml-3 text-sm text-gray-600">
                                {recurringFrequency === 'WEEKLY' &&
                                  (recurringInterval === 1 ? 'week' : 'weeks')}
                                {recurringFrequency === 'MONTHLY' &&
                                  (recurringInterval === 1 ? 'month' : 'months')}
                                {recurringFrequency === 'YEARLY' &&
                                  (recurringInterval === 1 ? 'year' : 'years')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="recurringEndDate"
                            className="block text-sm font-medium text-gray-700 mb-2"
                          >
                            End Date (optional)
                          </label>
                          <input
                            type="date"
                            id="recurringEndDate"
                            value={recurringEndDate}
                            onChange={(e) => setRecurringEndDate(e.target.value)}
                            min={dateTime ? dateTime.split('T')[0] : ''}
                            className="w-full h-11 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 px-3 text-sm"
                          />
                          <p className="text-xs text-gray-500 mt-2">
                            Leave empty to create events for the next year. Maximum 52 occurrences.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {eventError && (
                    <div className="rounded-md bg-red-50 p-4">
                      <div className="text-sm text-red-700">{eventError}</div>
                    </div>
                  )}

                  <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
                    <button
                      type="button"
                      className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
                      onClick={handleClose}
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                      disabled={!selectedGame || !dateTime || submitting || eventLoading}
                    >
                      {submitting
                        ? isRecurring
                          ? 'Creating Recurring Events...'
                          : 'Creating...'
                        : isRecurring
                          ? 'Create Recurring Event'
                          : 'Create Event'}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
