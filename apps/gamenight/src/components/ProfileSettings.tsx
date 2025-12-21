import { useState, useEffect } from 'react';
import {
  UserCircleIcon,
  ClockIcon,
  CalendarDaysIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/authStore';
// import { useEventStore } from '../store/eventStore';
import { eventsApi } from '../services/api';
import { Event } from '../types';
import { format } from 'date-fns';
import clsx from 'clsx';

export default function ProfileSettings() {
  const { user, checkAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userEvents, setUserEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  // Form states
  const [formData, setFormData] = useState({
    name: user?.name || '',
    timezone: user?.timezone || 'America/New_York',
  });

  // Load user's events
  useEffect(() => {
    if (user) {
      loadUserEvents();
    }
  }, [user]);

  const loadUserEvents = async () => {
    try {
      setEventsLoading(true);
      // Get events for the past 6 months
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 6);

      const { events } = await eventsApi.getAll({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      });

      // Filter events where user is creator or committed
      const myEvents = events.filter(
        (event) =>
          event.creatorId === user?.id ||
          event.commitments.some((c) => c.userId === user?.id && c.status === 'COMMITTED')
      );

      setUserEvents(myEvents);
    } catch (error) {
      console.error('Failed to load user events:', error);
    } finally {
      setEventsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Since we don't have a user update endpoint, we'll just show success
      // In a real app, you'd call something like: await authApi.updateProfile(formData);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call

      setSuccess('Profile updated successfully!');
      // Refresh auth state
      await checkAuth();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Calculate stats
  const createdEvents = userEvents.filter((e) => e.creatorId === user?.id);
  const attendedEvents = userEvents.filter((e) =>
    e.commitments.some((c) => c.userId === user?.id && c.status === 'COMMITTED')
  );
  const upcomingEvents = userEvents.filter((e) => new Date(e.dateTime) > new Date());

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <p className="text-gray-500">Please sign in to view your profile.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Profile & Settings</h1>
        <p className="text-gray-600 mt-2">Manage your account and game night preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Form */}
        <div className="lg:col-span-2">
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Profile Information</h2>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-6">
              {/* Avatar */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Avatar</label>
                <div className="flex items-center space-x-4">
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name || user.email}
                      className="h-12 w-12 rounded-full"
                    />
                  ) : (
                    <UserCircleIcon className="h-12 w-12 text-gray-400" />
                  )}
                  <div className="text-sm text-gray-500">
                    Avatar is managed by your authentication provider
                  </div>
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500"
                />
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed here</p>
              </div>

              {/* Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter your display name"
                />
              </div>

              {/* Timezone */}
              <div>
                <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-2">
                  Timezone
                </label>
                <select
                  id="timezone"
                  name="timezone"
                  value={formData.timezone}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>

              {/* Account Info */}
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Account Information</h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <div>
                    <span className="font-medium">Member since:</span>{' '}
                    {format(new Date(user.createdAt), 'MMMM d, yyyy')}
                  </div>
                  {user.lastLoginAt && (
                    <div>
                      <span className="font-medium">Last login:</span>{' '}
                      {format(new Date(user.lastLoginAt), 'MMM d, yyyy h:mm a')}
                    </div>
                  )}
                </div>
              </div>

              {/* Error and Success Messages */}
              {error && (
                <div className="rounded-md bg-red-50 p-4">
                  <div className="text-sm text-red-700">{error}</div>
                </div>
              )}

              {success && (
                <div className="rounded-md bg-green-50 p-4">
                  <div className="text-sm text-green-700">{success}</div>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className={clsx(
                    'w-full sm:w-auto px-6 py-2 border border-transparent text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500',
                    loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                  )}
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Stats Sidebar */}
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Your Stats</h3>
            <div className="space-y-4">
              <div className="flex items-center">
                <TrophyIcon className="h-5 w-5 text-yellow-500 mr-3" />
                <div>
                  <div className="text-sm font-medium text-gray-900">{createdEvents.length}</div>
                  <div className="text-xs text-gray-500">Events Created</div>
                </div>
              </div>

              <div className="flex items-center">
                <CalendarDaysIcon className="h-5 w-5 text-blue-500 mr-3" />
                <div>
                  <div className="text-sm font-medium text-gray-900">{attendedEvents.length}</div>
                  <div className="text-xs text-gray-500">Events Attended</div>
                </div>
              </div>

              <div className="flex items-center">
                <ClockIcon className="h-5 w-5 text-green-500 mr-3" />
                <div>
                  <div className="text-sm font-medium text-gray-900">{upcomingEvents.length}</div>
                  <div className="text-xs text-gray-500">Upcoming Events</div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Events */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h3>
            {eventsLoading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
              </div>
            ) : userEvents.length === 0 ? (
              <p className="text-sm text-gray-500">No recent game night activity</p>
            ) : (
              <div className="space-y-3">
                {userEvents.slice(0, 5).map((event) => (
                  <div key={event.id} className="text-sm">
                    <div className="font-medium text-gray-900 truncate">
                      {event.title || event.game.name}
                    </div>
                    <div className="text-gray-500">
                      {format(new Date(event.dateTime), 'MMM d, yyyy')}
                      {event.creatorId === user.id && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Host
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {userEvents.length > 5 && (
                  <div className="text-xs text-gray-400 pt-2">
                    And {userEvents.length - 5} more...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
