import { Calendar } from 'lucide-react';

interface GameData {
  id: number;
  date: string;
  home_team: { abbreviation: string };
  visitor_team: { abbreviation: string };
}

interface ScheduleGridProps {
  gamesByDate: Record<string, GameData[]>;
  gamesPerTeam: Record<string, { total: number; dates: string[] }>;
  dateRange: { start: string; end: string };
  onTeamClick?: (teamAbbr: string) => void;
  selectedTeam?: string | null;
}

interface DayData {
  date: string;
  dayName: string;
  dayNum: string;
  month: string;
  teams: string[];
  gameCount: number;
}

function formatDayHeader(dateStr: string): { dayName: string; dayNum: string; month: string } {
  const date = new Date(dateStr + 'T12:00:00');
  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum = date.getDate().toString();
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return { dayName, dayNum, month };
}

function getTeamsPlayingOnDate(games: GameData[]): string[] {
  const teams = new Set<string>();
  for (const game of games) {
    teams.add(game.home_team.abbreviation);
    teams.add(game.visitor_team.abbreviation);
  }
  return Array.from(teams).sort();
}

function getGameDensityClass(gameCount: number): string {
  if (gameCount === 0) return 'bg-court-base';
  if (gameCount <= 4) return 'bg-court-elevated';
  if (gameCount <= 8) return 'bg-court-surface';
  return 'bg-hawk-teal/20 border-hawk-teal/30';
}

function getGameCountBadgeClass(gameCount: number): string {
  if (gameCount === 0) return 'text-gray-600';
  if (gameCount <= 4) return 'text-gray-400';
  if (gameCount <= 8) return 'text-hawk-orange';
  return 'text-hawk-teal font-semibold';
}

export function ScheduleGrid({
  gamesByDate,
  gamesPerTeam: _gamesPerTeam,
  dateRange,
  onTeamClick,
  selectedTeam,
}: ScheduleGridProps) {
  // gamesPerTeam is available for future use (e.g., showing total games per team)
  void _gamesPerTeam;
  // Generate array of days in the date range
  const days: DayData[] = [];
  const startDate = new Date(dateRange.start + 'T12:00:00');
  const endDate = new Date(dateRange.end + 'T12:00:00');

  const current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const games = gamesByDate[dateStr] || [];
    const teams = getTeamsPlayingOnDate(games);
    const { dayName, dayNum, month } = formatDayHeader(dateStr);

    days.push({
      date: dateStr,
      dayName,
      dayNum,
      month,
      teams,
      gameCount: games.length,
    });

    current.setDate(current.getDate() + 1);
  }

  if (days.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500" data-testid="schedule-grid-empty">
        <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No schedule data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="schedule-grid">
      {/* Grid of days */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <div
            key={day.date}
            className={`rounded-lg p-2 border transition-colors ${getGameDensityClass(day.gameCount)}`}
          >
            {/* Day header */}
            <div className="text-center mb-2">
              <div className="text-xs text-gray-500">{day.dayName}</div>
              <div className="font-semibold text-gray-200">{day.dayNum}</div>
              <div className="text-xs text-gray-500">{day.month}</div>
            </div>

            {/* Game count badge */}
            <div className={`text-center text-xs mb-2 ${getGameCountBadgeClass(day.gameCount)}`}>
              {day.gameCount} {day.gameCount === 1 ? 'game' : 'games'}
            </div>

            {/* Team abbreviations */}
            <div className="flex flex-wrap gap-1 justify-center">
              {day.teams.slice(0, 10).map((team) => (
                <button
                  key={team}
                  onClick={() => onTeamClick?.(team)}
                  className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                    selectedTeam === team
                      ? 'bg-hawk-orange text-white'
                      : 'bg-court-base hover:bg-court-surface text-gray-300 hover:text-white'
                  }`}
                  data-testid={`schedule-team-${team}`}
                >
                  {team}
                </button>
              ))}
              {day.teams.length > 10 && (
                <span className="text-xs text-gray-500">+{day.teams.length - 10}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-800">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-court-elevated"></div>
          <span>Light (0-4)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-court-surface"></div>
          <span>Medium (5-8)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-hawk-teal/20 border border-hawk-teal/30"></div>
          <span>Heavy (9+)</span>
        </div>
      </div>
    </div>
  );
}

// Loading skeleton
export function ScheduleGridSkeleton() {
  return (
    <div className="animate-pulse" data-testid="schedule-grid-loading">
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-court-surface rounded-lg p-2 h-32">
            <div className="h-4 bg-gray-700 rounded w-12 mx-auto mb-2"></div>
            <div className="h-6 bg-gray-700 rounded w-8 mx-auto mb-2"></div>
            <div className="h-3 bg-gray-700 rounded w-16 mx-auto mb-3"></div>
            <div className="flex flex-wrap gap-1 justify-center">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-4 w-8 bg-gray-700 rounded"></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
