import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { Zap, Calendar, Users, TrendingUp } from 'lucide-react';
import { ScheduleGrid, ScheduleGridSkeleton } from './streaming/ScheduleGrid';

interface StreamingOptimizerProps {
  selectedLeague: string | null;
}

interface ScheduleData {
  week: number;
  weekStart: string;
  weekEnd: string;
  schedule: {
    gamesByDate: Record<string, any[]>;
    gamesPerTeam: Record<string, { total: number; dates: string[] }>;
    dateRange: { start: string; end: string };
  };
  userRoster: any[];
  freeAgents: any[];
}

export function StreamingOptimizer({ selectedLeague }: StreamingOptimizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  useEffect(() => {
    if (selectedLeague) {
      loadStreamingData(selectedLeague);
    }
  }, [selectedLeague]);

  async function loadStreamingData(leagueKey: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fantasy.getStreaming(leagueKey) as ScheduleData;
      setScheduleData(data);
    } catch (err: any) {
      console.error('Failed to load streaming data:', err);
      setError(err.message || 'Failed to load streaming data');
    } finally {
      setLoading(false);
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="streaming-no-league">
        <Zap className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Select a league to view streaming opportunities</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Loading streaming data..." />;
  }

  if (error) {
    return (
      <div className="card text-center py-12" data-testid="streaming-error">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => loadStreamingData(selectedLeague)}
          className="mt-4 px-4 py-2 bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="streaming-page">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-gray-100 flex items-center gap-3">
            <Zap className="w-7 h-7 text-hawk-orange" />
            Streaming Optimizer
          </h2>
          <p className="text-gray-400 mt-1">
            Find the best streaming pickups based on NBA schedule
            {scheduleData && ` - Week ${scheduleData.week}`}
          </p>
        </div>
        {scheduleData && (
          <div className="text-right text-sm text-gray-400">
            <div>{scheduleData.weekStart} - {scheduleData.weekEnd}</div>
          </div>
        )}
      </div>

      {/* Three Panel Layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel: Schedule Grid */}
        <div className="col-span-12 lg:col-span-4">
          <div className="card h-full" data-testid="streaming-schedule-grid-panel">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-hawk-teal" />
              <h3 className="font-semibold text-gray-100">Schedule Grid</h3>
              {selectedTeam && (
                <button
                  onClick={() => setSelectedTeam(null)}
                  className="ml-auto text-xs px-2 py-1 rounded bg-hawk-orange text-white hover:bg-hawk-orange/80"
                >
                  Clear: {selectedTeam}
                </button>
              )}
            </div>
            {loading ? (
              <ScheduleGridSkeleton />
            ) : scheduleData ? (
              <ScheduleGrid
                gamesByDate={scheduleData.schedule.gamesByDate}
                gamesPerTeam={scheduleData.schedule.gamesPerTeam}
                dateRange={scheduleData.schedule.dateRange}
                onTeamClick={setSelectedTeam}
                selectedTeam={selectedTeam}
              />
            ) : (
              <div className="min-h-[300px] flex items-center justify-center border-2 border-dashed border-gray-700 rounded-lg">
                <div className="text-center text-gray-500">
                  <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No schedule data</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Panel: Candidates Table */}
        <div className="col-span-12 lg:col-span-5">
          <div className="card h-full" data-testid="streaming-candidates">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-hawk-orange" />
              <h3 className="font-semibold text-gray-100">Streaming Candidates</h3>
            </div>
            <div className="min-h-[300px] flex items-center justify-center border-2 border-dashed border-gray-700 rounded-lg">
              <div className="text-center text-gray-500">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Candidates Table Component</p>
                <p className="text-xs text-gray-600 mt-1">Task 104</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Recommendations */}
        <div className="col-span-12 lg:col-span-3">
          <div className="card h-full" data-testid="streaming-recommendations">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-hawk-indigo" />
              <h3 className="font-semibold text-gray-100">Recommendations</h3>
            </div>
            <div className="min-h-[300px] flex items-center justify-center border-2 border-dashed border-gray-700 rounded-lg">
              <div className="text-center text-gray-500">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Recommendations Panel</p>
                <p className="text-xs text-gray-600 mt-1">Task 105</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Footer (optional preview of data) */}
      {scheduleData && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card text-center py-4">
            <div className="font-display text-3xl text-hawk-teal">
              {Object.keys(scheduleData.schedule.gamesByDate).length}
            </div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">
              Game Days
            </div>
          </div>
          <div className="card text-center py-4">
            <div className="font-display text-3xl text-hawk-orange">
              {scheduleData.freeAgents.length}
            </div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">
              Free Agents
            </div>
          </div>
          <div className="card text-center py-4">
            <div className="font-display text-3xl text-hawk-indigo">
              {scheduleData.userRoster.length}
            </div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">
              Roster Spots
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
