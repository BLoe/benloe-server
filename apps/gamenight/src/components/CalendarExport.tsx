import { useState, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  CalendarDaysIcon,
  ArrowDownTrayIcon,
  ShareIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/authStore';
import clsx from 'clsx';

interface CalendarExportProps {
  isOpen: boolean;
  onClose: () => void;
  eventId?: string; // If provided, exports single event
}

export default function CalendarExport({ isOpen, onClose, eventId }: CalendarExportProps) {
  const { user } = useAuthStore();
  const [subscriptionUrl, setSubscriptionUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generateSubscription = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/subscription', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to generate subscription');
      }

      const data = await response.json();
      setSubscriptionUrl(data.subscriptionUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to generate subscription');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const downloadCalendar = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClose = () => {
    setSubscriptionUrl(null);
    setError(null);
    setCopied(false);
    onClose();
  };

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
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center">
                    <CalendarDaysIcon className="h-6 w-6 text-indigo-600 mr-2" />
                    <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                      Export Calendar
                    </Dialog.Title>
                  </div>
                  <button
                    type="button"
                    className="rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onClick={handleClose}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* One-time Downloads */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-3">One-time Download</h4>
                    <div className="space-y-2">
                      {eventId ? (
                        // Single event export
                        <button
                          onClick={() =>
                            downloadCalendar(
                              `/api/calendar/event/${eventId}.ics`,
                              `event-${eventId}.ics`
                            )
                          }
                          className="w-full flex items-center justify-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                          <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                          Download This Event
                        </button>
                      ) : (
                        <>
                          {/* All Events */}
                          <button
                            onClick={() =>
                              downloadCalendar('/api/calendar/events.ics', 'gamenight-events.ics')
                            }
                            className="w-full flex items-center justify-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                          >
                            <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                            All Public Events
                          </button>

                          {/* User's Events */}
                          {user && (
                            <button
                              onClick={() =>
                                downloadCalendar(
                                  '/api/calendar/my-events.ics',
                                  'my-gamenight-events.ics'
                                )
                              }
                              className="w-full flex items-center justify-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            >
                              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                              My Events Only
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Live Subscription (only for logged-in users and not single event) */}
                  {user && !eventId && (
                    <div className="pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">
                        Live Calendar Subscription
                      </h4>
                      <p className="text-xs text-gray-600 mb-3">
                        Subscribe to automatically get updates when events change
                      </p>

                      {!subscriptionUrl ? (
                        <button
                          onClick={generateSubscription}
                          disabled={loading}
                          className={clsx(
                            'w-full flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500',
                            loading
                              ? 'bg-gray-400 cursor-not-allowed'
                              : 'bg-indigo-600 hover:bg-indigo-700'
                          )}
                        >
                          {loading ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          ) : (
                            <ShareIcon className="h-4 w-4 mr-2" />
                          )}
                          Generate Subscription Link
                        </button>
                      ) : (
                        <div className="space-y-3">
                          <div className="p-3 bg-gray-50 rounded-md">
                            <div className="text-xs font-medium text-gray-700 mb-1">
                              Subscription URL:
                            </div>
                            <div className="text-xs text-gray-600 break-all font-mono bg-white p-2 rounded border">
                              {subscriptionUrl}
                            </div>
                          </div>

                          <button
                            onClick={() => copyToClipboard(subscriptionUrl)}
                            className="w-full flex items-center justify-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                          >
                            <LinkIcon className="h-4 w-4 mr-2" />
                            {copied ? 'Copied!' : 'Copy Link'}
                          </button>

                          <div className="text-xs text-gray-500">
                            <p className="mb-1">
                              <strong>Instructions:</strong>
                            </p>
                            <ul className="list-disc list-inside space-y-1">
                              <li>Copy the URL above</li>
                              <li>
                                In your calendar app, look for "Subscribe to Calendar" or "Add
                                Calendar from URL"
                              </li>
                              <li>Paste the URL to get automatic updates</li>
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error Message */}
                  {error && (
                    <div className="rounded-md bg-red-50 p-4">
                      <div className="text-sm text-red-700">{error}</div>
                    </div>
                  )}

                  {/* Help Text */}
                  <div className="pt-4 border-t border-gray-200">
                    <div className="text-xs text-gray-500">
                      <p className="mb-2">
                        <strong>Supported Calendar Apps:</strong>
                      </p>
                      <p>
                        Google Calendar, Apple Calendar, Outlook, Thunderbird, and any app that
                        supports iCal (.ics) format.
                      </p>
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
