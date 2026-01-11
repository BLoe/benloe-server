import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { LoadingSpinner } from '../LoadingSpinner';
import { Trophy, Star, TrendingUp, TrendingDown, Users, Calendar } from 'lucide-react';

interface PlayoffAnalysisProps {
  selectedLeague: string;
}

interface PlayoffWeek {
  weekNumber: number;
  startDate: string;
  endDate: string;
  totalGames: number;
}

interface TeamRanking {
  team: string;
  totalGames: number;
  gamesByWeek: Record<number, number>;
  isOnRoster: boolean;
}

interface PlayerPlayoffData {
  name: string;
  team: string;
  playoffGames: number;
}

interface RosterAnalysis {
  totalPlayoffGames: number;
  optimalGames: number;
  percentOfOptimal: number;
  averagePerTeam: number;
  players: PlayerPlayoffData[];
}

interface PlayoffScheduleData {
  season: number;
  playoffWeeks: PlayoffWeek[];
  teamRankings: TeamRanking[];
  rosterTeams: string[];
  rosterAnalysis: RosterAnalysis;
  bestScheduleTeams: string[];
  worstScheduleTeams: string[];
}

export function PlayoffAnalysis({ selectedLeague }: PlayoffAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlayoffScheduleData | null>(null);

  useEffect(() => {
    if (selectedLeague) {
      loadPlayoffData();
    }
  }, [selectedLeague]);

  async function loadPlayoffData() {
    try {
      setLoading(true);
      setError(null);
      const result = await api.fantasy.getPlayoffSchedule(selectedLeague);
      setData(result as PlayoffScheduleData);
    } catch (err: any) {
      console.error('Failed to load playoff data:', err);
      setError(err.message || 'Failed to load playoff analysis');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <LoadingSpinner message="Loading playoff analysis..." />;
  }

  if (error) {
    return (
      <div className="card text-center py-8" data-testid="schedule-playoff-error">
        <div className="text-red-400 mb-4">{error}</div>
        <button onClick={loadPlayoffData} className="btn btn-primary">
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // Get strength rating (1-5 stars)
  const getStrengthRating = (percent: number): number => {
    if (percent >= 95) return 5;
    if (percent >= 85) return 4;
    if (percent >= 75) return 3;
    if (percent >= 60) return 2;
    return 1;
  };

  const strengthRating = getStrengthRating(data.rosterAnalysis.percentOfOptimal);

  return (
    <div className="space-y-6" data-testid="schedule-playoff-analysis">
      {/* Playoff Overview Header */}
      <div className="card bg-gradient-to-r from-hawk-orange/20 to-transparent border border-hawk-orange/30">
        <div className="flex items-center gap-3 mb-4">
          <Trophy className="w-6 h-6 text-hawk-orange" />
          <h3 className="font-semibold text-gray-100 text-lg">Fantasy Playoff Analysis</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.playoffWeeks.map((week, index) => (
            <div
              key={week.weekNumber}
              className="bg-court-base rounded-lg p-3"
              data-testid={`playoff-week-${week.weekNumber}`}
            >
              <div className="flex items-center gap-2 text-hawk-orange mb-1">
                <Star className="w-4 h-4" />
                <span className="font-medium">
                  {index === 0 ? 'Round 1' : index === 1 ? 'Round 2' : 'Championship'}
                </span>
              </div>
              <div className="text-gray-400 text-sm">Week {week.weekNumber}</div>
              <div className="text-gray-300 text-xs mt-1">
                {new Date(week.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' - '}
                {new Date(week.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div className="text-hawk-teal font-bold mt-2">
                {week.totalGames} games
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Roster Strength Analysis */}
      <div className="card" data-testid="schedule-roster-analysis">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-hawk-teal" />
            <h3 className="font-semibold text-gray-100">Your Roster Playoff Strength</h3>
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`w-5 h-5 ${
                  i < strengthRating ? 'text-hawk-orange fill-hawk-orange' : 'text-gray-600'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-court-base rounded-lg p-4">
            <div className="text-gray-400 text-sm">Total Playoff Games</div>
            <div className="text-3xl font-bold text-hawk-teal">
              {data.rosterAnalysis.totalPlayoffGames}
            </div>
          </div>
          <div className="bg-court-base rounded-lg p-4">
            <div className="text-gray-400 text-sm">Optimal Maximum</div>
            <div className="text-3xl font-bold text-gray-300">
              {data.rosterAnalysis.optimalGames}
            </div>
          </div>
          <div className="bg-court-base rounded-lg p-4">
            <div className="text-gray-400 text-sm">Strength Rating</div>
            <div className={`text-3xl font-bold ${
              data.rosterAnalysis.percentOfOptimal >= 80 ? 'text-green-400' :
              data.rosterAnalysis.percentOfOptimal >= 60 ? 'text-yellow-400' :
              'text-red-400'
            }`}>
              {data.rosterAnalysis.percentOfOptimal}%
            </div>
          </div>
          <div className="bg-court-base rounded-lg p-4">
            <div className="text-gray-400 text-sm">League Average</div>
            <div className="text-3xl font-bold text-gray-400">
              {Math.round(data.rosterAnalysis.averagePerTeam)}
            </div>
          </div>
        </div>

        {/* Player Breakdown */}
        <h4 className="text-gray-300 font-medium mb-3">Player Breakdown</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {data.rosterAnalysis.players.map((player, index) => {
            const isGood = player.playoffGames >= 10;
            const isBad = player.playoffGames < 8;
            return (
              <div
                key={index}
                className={`p-3 rounded-lg ${
                  isGood ? 'bg-green-500/10 border border-green-500/30' :
                  isBad ? 'bg-red-500/10 border border-red-500/30' :
                  'bg-court-base'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="truncate">
                    <div className="text-gray-200 font-medium truncate">{player.name}</div>
                    <div className="text-gray-500 text-xs">{player.team}</div>
                  </div>
                  <div className={`text-lg font-bold ${
                    isGood ? 'text-green-400' : isBad ? 'text-red-400' : 'text-gray-300'
                  }`}>
                    {player.playoffGames}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Team Rankings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Best Schedules */}
        <div className="card" data-testid="schedule-best-teams">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <h3 className="font-semibold text-gray-100">Best Playoff Schedules</h3>
          </div>
          <div className="space-y-2">
            {data.teamRankings.slice(0, 8).map((team, index) => (
              <div
                key={team.team}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  team.isOnRoster
                    ? 'bg-hawk-teal/20 border border-hawk-teal/30'
                    : 'bg-court-base'
                }`}
                data-testid={`schedule-playoff-team-${team.team}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-6 text-center">{index + 1}</span>
                  <span className={`font-medium ${team.isOnRoster ? 'text-hawk-teal' : 'text-gray-200'}`}>
                    {team.team}
                  </span>
                  {team.isOnRoster && (
                    <span className="text-xs bg-hawk-teal/30 text-hawk-teal px-2 py-0.5 rounded">
                      On Roster
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {Object.entries(team.gamesByWeek).map(([week, games]) => (
                      <span
                        key={week}
                        className="text-xs bg-court-surface px-1.5 py-0.5 rounded text-gray-400"
                      >
                        {games}
                      </span>
                    ))}
                  </div>
                  <span className="font-bold text-green-400 min-w-[2rem] text-right">
                    {team.totalGames}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Worst Schedules */}
        <div className="card" data-testid="schedule-worst-teams">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-red-400" />
            <h3 className="font-semibold text-gray-100">Worst Playoff Schedules</h3>
          </div>
          <div className="space-y-2">
            {data.teamRankings.slice(-8).reverse().map((team, index) => (
              <div
                key={team.team}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  team.isOnRoster
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-court-base'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-6 text-center">{30 - index}</span>
                  <span className={`font-medium ${team.isOnRoster ? 'text-red-400' : 'text-gray-200'}`}>
                    {team.team}
                  </span>
                  {team.isOnRoster && (
                    <span className="text-xs bg-red-500/30 text-red-400 px-2 py-0.5 rounded">
                      On Roster
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {Object.entries(team.gamesByWeek).map(([week, games]) => (
                      <span
                        key={week}
                        className="text-xs bg-court-surface px-1.5 py-0.5 rounded text-gray-400"
                      >
                        {games}
                      </span>
                    ))}
                  </div>
                  <span className="font-bold text-red-400 min-w-[2rem] text-right">
                    {team.totalGames}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="card bg-court-base/50 border border-white/5">
        <h4 className="text-gray-300 font-medium mb-2">Playoff Strategy Tips</h4>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>
            <span className="text-green-400 mr-2">+</span>
            Target players from {data.bestScheduleTeams.slice(0, 3).join(', ')} for playoff weeks
          </li>
          <li>
            <span className="text-red-400 mr-2">-</span>
            Consider trading players from {data.worstScheduleTeams.slice(0, 3).join(', ')} before playoffs
          </li>
          <li>
            <span className="text-hawk-teal mr-2">*</span>
            Each extra game = ~5% edge in head-to-head matchups
          </li>
        </ul>
      </div>
    </div>
  );
}
