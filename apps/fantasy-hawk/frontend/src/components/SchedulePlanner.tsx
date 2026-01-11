import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { CalendarView } from './schedule/CalendarView';
import { Calendar, Users, TrendingUp } from 'lucide-react';

interface SchedulePlannerProps {
  selectedLeague: string | null;
}

interface WeekData {
  weekNumber: number;
  startDate: string;
  endDate: string;
  gameCount: number;
  gamesPerTeam: Record<string, number>;
}

interface SeasonSchedule {
  season: number;
  weeks: WeekData[];
  teams: Array<{ abbreviation: string; name: string }>;
  playoffWeeks: number[];
  allStarBreak?: { start: string; end: string };
  totalWeeks: number;
}

interface RosterSchedule {
  season: number;
  rosterTeams: string[];
  players: Array<{ name: string; team: string }>;
  weeks: Array<{
    weekNumber: number;
    startDate: string;
    endDate: string;
    totalGames: number;
    gamesByTeam: Record<string, number>;
  }>;
  playoffWeeks: number[];
  playoffGamesTotal: number;
  playerPlayoffGames: Record<string, number>;
}

type ViewType = 'season' | 'roster';

export function SchedulePlanner({ selectedLeague }: SchedulePlannerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewType, setViewType] = useState<ViewType>('season');
  const [seasonSchedule, setSeasonSchedule] = useState<SeasonSchedule | null>(null);
  const [rosterSchedule, setRosterSchedule] = useState<RosterSchedule | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  useEffect(() => {
    if (selectedLeague) {
      loadScheduleData();
    }
  }, [selectedLeague, viewType]);

  async function loadScheduleData() {
    try {
      setLoading(true);
      setError(null);

      if (viewType === 'season') {
        const data = await api.fantasy.getSeasonSchedule();
        setSeasonSchedule(data as SeasonSchedule);
      } else {
        const data = await api.fantasy.getRosterSchedule(selectedLeague!);
        setRosterSchedule(data as RosterSchedule);
      }
    } catch (err: any) {
      console.error('Failed to load schedule:', err);
      setError(err.message || 'Failed to load schedule data');
    } finally {
      setLoading(false);
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="schedule-no-league">
        <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-500" />
        <h3 className="text-lg font-medium text-gray-300 mb-2">No League Selected</h3>
        <p className="text-gray-500">Select a league to view schedule data</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Loading schedule data..." />;
  }

  if (error) {
    return (
      <div className="card text-center py-12" data-testid="schedule-error">
        <div className="text-red-400 mb-4">{error}</div>
        <button
          onClick={loadScheduleData}
          className="btn btn-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  const currentSchedule = viewType === 'season' ? seasonSchedule : rosterSchedule;
  if (!currentSchedule) {
    return (
      <div className="card text-center py-12" data-testid="schedule-empty">
        <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-500" />
        <h3 className="text-lg font-medium text-gray-300 mb-2">No Schedule Data</h3>
        <p className="text-gray-500">Schedule data is not available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="schedule-planner-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold text-gray-100 flex items-center gap-3">
            <Calendar className="w-7 h-7 text-hawk-teal" />
            Schedule Planner
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Plan ahead with full-season NBA schedule data
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setViewType('season')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              viewType === 'season'
                ? 'bg-hawk-teal text-gray-900'
                : 'bg-court-base text-gray-300 hover:bg-court-surface'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            League-Wide
          </button>
          <button
            onClick={() => setViewType('roster')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              viewType === 'roster'
                ? 'bg-hawk-teal text-gray-900'
                : 'bg-court-base text-gray-300 hover:bg-court-surface'
            }`}
          >
            <Users className="w-4 h-4" />
            My Roster
          </button>
        </div>
      </div>

      {/* Season Info */}
      <div className="card bg-court-base/50">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-gray-400">Season:</span>
            <span className="text-gray-100 ml-2 font-medium">
              {currentSchedule.season}-{currentSchedule.season + 1}
            </span>
          </div>
          {seasonSchedule && (
            <>
              <div>
                <span className="text-gray-400">Total Weeks:</span>
                <span className="text-gray-100 ml-2 font-medium">
                  {seasonSchedule.totalWeeks}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Playoff Weeks:</span>
                <span className="text-hawk-orange ml-2 font-medium">
                  {seasonSchedule.playoffWeeks.join(', ')}
                </span>
              </div>
            </>
          )}
          {viewType === 'roster' && rosterSchedule && (
            <div>
              <span className="text-gray-400">Playoff Games:</span>
              <span className="text-hawk-teal ml-2 font-medium">
                {rosterSchedule.playoffGamesTotal}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Calendar View */}
      <CalendarView
        weeks={viewType === 'season'
          ? seasonSchedule?.weeks || []
          : rosterSchedule?.weeks.map(w => ({
              weekNumber: w.weekNumber,
              startDate: w.startDate,
              endDate: w.endDate,
              gameCount: w.totalGames,
              gamesPerTeam: w.gamesByTeam,
            })) || []
        }
        teams={seasonSchedule?.teams || []}
        playoffWeeks={currentSchedule.playoffWeeks}
        selectedWeek={selectedWeek}
        onWeekSelect={setSelectedWeek}
        viewType={viewType}
        rosterTeams={rosterSchedule?.rosterTeams}
      />

      {/* Roster Playoff Analysis (only in roster view) */}
      {viewType === 'roster' && rosterSchedule && (
        <div className="card" data-testid="schedule-roster-strength">
          <h3 className="font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-hawk-teal" />
            Playoff Games by Player
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {rosterSchedule.players
              .sort((a, b) =>
                (rosterSchedule.playerPlayoffGames[b.name] || 0) -
                (rosterSchedule.playerPlayoffGames[a.name] || 0)
              )
              .map((player, index) => {
                const games = rosterSchedule.playerPlayoffGames[player.name] || 0;
                const isLow = games < 9; // Typically 3 weeks * 3 games = 9 minimum expected
                return (
                  <div
                    key={index}
                    className={`p-3 rounded-lg ${
                      isLow ? 'bg-red-500/10 border border-red-500/30' : 'bg-court-base'
                    }`}
                    data-testid={`schedule-roster-player-${index}`}
                  >
                    <div className="font-medium text-gray-200 truncate">
                      {player.name}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-500">{player.team}</span>
                      <span className={`font-bold ${isLow ? 'text-red-400' : 'text-hawk-teal'}`}>
                        {games} games
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Refresh Button */}
      <div className="text-center">
        <button
          onClick={loadScheduleData}
          className="text-sm text-gray-400 hover:text-gray-200 underline"
        >
          Refresh Schedule
        </button>
      </div>
    </div>
  );
}
