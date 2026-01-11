import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';

interface WeekData {
  weekNumber: number;
  startDate: string;
  endDate: string;
  gameCount: number;
  gamesPerTeam: Record<string, number>;
}

interface CalendarViewProps {
  weeks: WeekData[];
  teams: Array<{ abbreviation: string; name: string }>;
  playoffWeeks: number[];
  selectedWeek: number | null;
  onWeekSelect: (week: number | null) => void;
  viewType: 'season' | 'roster';
  rosterTeams?: string[];
}

export function CalendarView({
  weeks,
  teams,
  playoffWeeks,
  selectedWeek,
  onWeekSelect,
  viewType,
  rosterTeams = [],
}: CalendarViewProps) {
  const [startIndex, setStartIndex] = useState(0);
  const weeksToShow = 8; // Show 8 weeks at a time

  // Get visible weeks
  const visibleWeeks = useMemo(() => {
    return weeks.slice(startIndex, startIndex + weeksToShow);
  }, [weeks, startIndex]);

  // Get teams to display (roster teams first if in roster view)
  const displayTeams = useMemo(() => {
    if (viewType === 'roster' && rosterTeams.length > 0) {
      return rosterTeams;
    }
    return teams.map(t => t.abbreviation);
  }, [teams, viewType, rosterTeams]);

  // Find current week
  const currentWeek = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    return weeks.find(w => w.startDate <= todayStr && w.endDate >= todayStr)?.weekNumber;
  }, [weeks]);

  // Calculate game density for color coding
  const getGameColor = (games: number, max: number = 4) => {
    if (games === 0) return 'bg-gray-700';
    const intensity = Math.min(games / max, 1);
    if (intensity < 0.5) return 'bg-blue-600/50';
    if (intensity < 0.75) return 'bg-yellow-500/50';
    return 'bg-hawk-orange/50';
  };

  const canGoPrev = startIndex > 0;
  const canGoNext = startIndex + weeksToShow < weeks.length;

  const handlePrev = () => {
    setStartIndex(Math.max(0, startIndex - weeksToShow));
  };

  const handleNext = () => {
    setStartIndex(Math.min(weeks.length - weeksToShow, startIndex + weeksToShow));
  };

  // Find selected week data
  const selectedWeekData = selectedWeek
    ? weeks.find(w => w.weekNumber === selectedWeek)
    : null;

  return (
    <div className="space-y-4">
      {/* Schedule Heatmap */}
      <div className="card overflow-hidden" data-testid="schedule-heatmap">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-100">
            {viewType === 'season' ? 'Season Schedule Heatmap' : 'Your Roster Schedule'}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrev}
              disabled={!canGoPrev}
              className={`p-1 rounded ${
                canGoPrev
                  ? 'text-gray-300 hover:bg-court-surface'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-gray-400">
              Weeks {visibleWeeks[0]?.weekNumber || 0} - {visibleWeeks[visibleWeeks.length - 1]?.weekNumber || 0}
            </span>
            <button
              onClick={handleNext}
              disabled={!canGoNext}
              className={`p-1 rounded ${
                canGoNext
                  ? 'text-gray-300 hover:bg-court-surface'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-gray-700"></span>
            0 games
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-blue-600/50"></span>
            1-2 games
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-yellow-500/50"></span>
            3 games
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-hawk-orange/50"></span>
            4+ games
          </span>
          <span className="flex items-center gap-1 ml-4">
            <Star className="w-3 h-3 text-hawk-orange" />
            Playoffs
          </span>
        </div>

        {/* Heatmap Grid */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 text-gray-400 font-medium w-16">Team</th>
                {visibleWeeks.map(week => (
                  <th
                    key={week.weekNumber}
                    className={`py-2 px-1 text-center cursor-pointer hover:bg-court-surface transition-colors ${
                      week.weekNumber === currentWeek
                        ? 'bg-hawk-teal/20 text-hawk-teal'
                        : playoffWeeks.includes(week.weekNumber)
                        ? 'bg-hawk-orange/10 text-hawk-orange'
                        : 'text-gray-400'
                    } ${selectedWeek === week.weekNumber ? 'ring-2 ring-hawk-teal' : ''}`}
                    onClick={() => onWeekSelect(selectedWeek === week.weekNumber ? null : week.weekNumber)}
                    data-testid={`schedule-week-${week.weekNumber}`}
                  >
                    <div className="flex flex-col items-center">
                      <span className="font-medium">Wk{week.weekNumber}</span>
                      {playoffWeeks.includes(week.weekNumber) && (
                        <Star className="w-3 h-3 mt-0.5" />
                      )}
                    </div>
                  </th>
                ))}
                <th className="py-2 px-2 text-center text-gray-400 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {displayTeams.slice(0, 15).map(teamAbbr => {
                const totalGames = visibleWeeks.reduce(
                  (sum, week) => sum + (week.gamesPerTeam[teamAbbr] || 0),
                  0
                );
                const isRosterTeam = rosterTeams.includes(teamAbbr);

                return (
                  <tr
                    key={teamAbbr}
                    className={`border-t border-white/5 ${
                      isRosterTeam ? 'bg-hawk-teal/5' : ''
                    }`}
                    data-testid={`schedule-heatmap-row-${teamAbbr}`}
                  >
                    <td className={`py-2 px-2 font-medium ${
                      isRosterTeam ? 'text-hawk-teal' : 'text-gray-300'
                    }`}>
                      {teamAbbr}
                    </td>
                    {visibleWeeks.map(week => {
                      const games = week.gamesPerTeam[teamAbbr] || 0;
                      return (
                        <td
                          key={week.weekNumber}
                          className="py-2 px-1 text-center"
                          data-testid={`schedule-heatmap-cell-${teamAbbr}-${week.weekNumber}`}
                        >
                          <span
                            className={`inline-block w-8 h-8 leading-8 rounded ${getGameColor(games)} text-gray-100 font-medium`}
                          >
                            {games}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 text-center font-bold text-gray-200">
                      {totalGames}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {displayTeams.length > 15 && (
          <div className="text-center text-sm text-gray-500 mt-2">
            Showing top 15 teams. {displayTeams.length - 15} more available.
          </div>
        )}
      </div>

      {/* Week Detail View */}
      {selectedWeekData && (
        <div className="card" data-testid="schedule-weekly-view">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-100">
              Week {selectedWeekData.weekNumber} Details
              {playoffWeeks.includes(selectedWeekData.weekNumber) && (
                <span className="ml-2 text-hawk-orange">(Playoffs)</span>
              )}
            </h3>
            <button
              onClick={() => onWeekSelect(null)}
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-court-base rounded-lg p-3">
              <div className="text-gray-400 text-sm">Date Range</div>
              <div className="text-gray-100 font-medium">
                {new Date(selectedWeekData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' - '}
                {new Date(selectedWeekData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
            <div className="bg-court-base rounded-lg p-3">
              <div className="text-gray-400 text-sm">Total Games</div>
              <div className="text-hawk-teal font-bold text-xl">
                {selectedWeekData.gameCount}
              </div>
            </div>
            <div className="bg-court-base rounded-lg p-3">
              <div className="text-gray-400 text-sm">Avg Per Team</div>
              <div className="text-gray-100 font-medium">
                {(selectedWeekData.gameCount / 30).toFixed(1)}
              </div>
            </div>
            {viewType === 'roster' && rosterTeams.length > 0 && (
              <div className="bg-court-base rounded-lg p-3">
                <div className="text-gray-400 text-sm">Your Team Games</div>
                <div className="text-hawk-teal font-bold text-xl">
                  {rosterTeams.reduce(
                    (sum, team) => sum + (selectedWeekData.gamesPerTeam[team] || 0),
                    0
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Team breakdown for selected week */}
          <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
            {Object.entries(selectedWeekData.gamesPerTeam)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([team, games]) => {
                const isRosterTeam = rosterTeams.includes(team);
                return (
                  <div
                    key={team}
                    className={`text-center p-2 rounded ${
                      isRosterTeam
                        ? 'bg-hawk-teal/20 border border-hawk-teal/30'
                        : 'bg-court-base'
                    }`}
                  >
                    <div className={`font-medium text-sm ${isRosterTeam ? 'text-hawk-teal' : 'text-gray-300'}`}>
                      {team}
                    </div>
                    <div className={`text-lg font-bold ${
                      games >= 4 ? 'text-hawk-orange' : games >= 3 ? 'text-yellow-400' : 'text-gray-400'
                    }`}>
                      {games}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Weekly Overview Cards */}
      <div className="card" data-testid="schedule-calendar">
        <h3 className="font-semibold text-gray-100 mb-4">Weekly Overview</h3>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {visibleWeeks.map(week => {
            const isCurrentWeek = week.weekNumber === currentWeek;
            const isPlayoff = playoffWeeks.includes(week.weekNumber);
            const isSelected = week.weekNumber === selectedWeek;

            // For roster view, calculate total roster games
            const rosterGames = viewType === 'roster'
              ? rosterTeams.reduce((sum, team) => sum + (week.gamesPerTeam[team] || 0), 0)
              : week.gameCount;

            return (
              <button
                key={week.weekNumber}
                onClick={() => onWeekSelect(isSelected ? null : week.weekNumber)}
                className={`p-3 rounded-lg text-center transition-all ${
                  isSelected
                    ? 'ring-2 ring-hawk-teal bg-hawk-teal/20'
                    : isCurrentWeek
                    ? 'bg-hawk-teal/10 border border-hawk-teal/30'
                    : isPlayoff
                    ? 'bg-hawk-orange/10 border border-hawk-orange/30'
                    : 'bg-court-base hover:bg-court-surface'
                }`}
              >
                <div className={`text-xs font-medium ${
                  isCurrentWeek ? 'text-hawk-teal' : isPlayoff ? 'text-hawk-orange' : 'text-gray-400'
                }`}>
                  Week {week.weekNumber}
                </div>
                <div className={`text-xl font-bold mt-1 ${
                  isCurrentWeek ? 'text-hawk-teal' : 'text-gray-100'
                }`}>
                  {rosterGames}
                </div>
                <div className="text-xs text-gray-500">games</div>
                {isPlayoff && (
                  <Star className="w-3 h-3 text-hawk-orange mx-auto mt-1" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
