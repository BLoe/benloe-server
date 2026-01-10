import { RefreshCw } from 'lucide-react';

interface CategoryComparison {
  statId: number;
  name: string;
  displayName: string;
  yourValue: string;
  opponentValue: string;
  winner: 'you' | 'opponent' | 'tie';
  margin: string;
  isPercentage: boolean;
}

interface MatchupData {
  week: number;
  weekStart: string;
  weekEnd: string;
  yourTeam: {
    teamKey: string;
    name: string;
    logoUrl?: string;
    managerName?: string;
  };
  opponentTeam: {
    teamKey: string;
    name: string;
    logoUrl?: string;
    managerName?: string;
  };
  score: {
    wins: number;
    losses: number;
    ties: number;
  };
  categories: CategoryComparison[];
  lastUpdated: string;
  isByeWeek?: boolean;
}

interface ScoreboardProps {
  matchup: MatchupData;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export function Scoreboard({ matchup, onRefresh, isRefreshing }: ScoreboardProps) {
  const { yourTeam, opponentTeam, score, categories, lastUpdated, isByeWeek } = matchup;

  if (isByeWeek) {
    return (
      <div className="card text-center py-12" data-testid="matchup-bye-week">
        <div className="text-gray-400 text-lg">Bye Week</div>
        <div className="text-gray-500 text-sm mt-2">No matchup this week</div>
      </div>
    );
  }

  // Determine overall result styling
  const getScoreColor = () => {
    if (score.wins > score.losses) return 'text-hawk-teal';
    if (score.wins < score.losses) return 'text-red-400';
    return 'text-yellow-400';
  };

  const getCategoryRowClass = (winner: 'you' | 'opponent' | 'tie') => {
    switch (winner) {
      case 'you':
        return 'bg-hawk-teal/10 border-l-2 border-l-hawk-teal';
      case 'opponent':
        return 'bg-red-900/20 border-l-2 border-l-red-400';
      case 'tie':
        return 'bg-yellow-900/20 border-l-2 border-l-yellow-400';
    }
  };

  const formatValue = (value: string, isPercentage: boolean) => {
    if (isPercentage) {
      const num = parseFloat(value);
      return isNaN(num) ? value : `${(num * 100).toFixed(1)}%`;
    }
    return value;
  };

  return (
    <div className="space-y-6" data-testid="matchup-scoreboard">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Week {matchup.week} ({matchup.weekStart} - {matchup.weekEnd})
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
          data-testid="matchup-refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Main Scoreboard */}
      <div className="bg-court-lines/30 rounded-xl p-6">
        {/* Team Names and Score */}
        <div className="flex items-center justify-between mb-6">
          {/* Your Team */}
          <div className="flex items-center gap-3 flex-1">
            {yourTeam.logoUrl ? (
              <img
                src={yourTeam.logoUrl}
                alt={yourTeam.name}
                className="w-12 h-12 rounded-lg object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-hawk-orange/20 flex items-center justify-center">
                <span className="text-hawk-orange font-bold text-lg">
                  {yourTeam.name.charAt(0)}
                </span>
              </div>
            )}
            <div>
              <div className="font-semibold text-gray-100">{yourTeam.name}</div>
              {yourTeam.managerName && (
                <div className="text-xs text-gray-500">{yourTeam.managerName}</div>
              )}
            </div>
          </div>

          {/* Score */}
          <div className="text-center px-6">
            <div className={`font-display text-4xl font-bold ${getScoreColor()}`}>
              {score.wins}-{score.losses}{score.ties > 0 ? `-${score.ties}` : ''}
            </div>
            <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">
              {score.wins > score.losses ? 'Winning' : score.wins < score.losses ? 'Losing' : 'Tied'}
            </div>
          </div>

          {/* Opponent Team */}
          <div className="flex items-center gap-3 flex-1 justify-end">
            <div className="text-right">
              <div className="font-semibold text-gray-100">{opponentTeam.name}</div>
              {opponentTeam.managerName && (
                <div className="text-xs text-gray-500">{opponentTeam.managerName}</div>
              )}
            </div>
            {opponentTeam.logoUrl ? (
              <img
                src={opponentTeam.logoUrl}
                alt={opponentTeam.name}
                className="w-12 h-12 rounded-lg object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-gray-600/20 flex items-center justify-center">
                <span className="text-gray-400 font-bold text-lg">
                  {opponentTeam.name.charAt(0)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="space-y-1">
          {/* Header Row */}
          <div className="grid grid-cols-5 gap-2 text-xs text-gray-500 uppercase tracking-wider px-3 py-2">
            <div className="col-span-1">Category</div>
            <div className="text-right">You</div>
            <div className="text-center">vs</div>
            <div className="text-left">Opp</div>
            <div className="text-right">Margin</div>
          </div>

          {/* Category Rows */}
          {categories.map((cat) => (
            <div
              key={cat.statId}
              className={`grid grid-cols-5 gap-2 px-3 py-2 rounded ${getCategoryRowClass(cat.winner)}`}
            >
              <div className="col-span-1 font-medium text-gray-200">
                {cat.displayName}
              </div>
              <div className={`text-right font-mono ${cat.winner === 'you' ? 'text-hawk-teal font-semibold' : 'text-gray-300'}`}>
                {formatValue(cat.yourValue, cat.isPercentage)}
              </div>
              <div className="text-center text-gray-600">vs</div>
              <div className={`text-left font-mono ${cat.winner === 'opponent' ? 'text-red-400 font-semibold' : 'text-gray-300'}`}>
                {formatValue(cat.opponentValue, cat.isPercentage)}
              </div>
              <div className="text-right text-xs text-gray-500">
                {cat.winner !== 'tie' && cat.margin}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Last Updated */}
      <div className="text-center text-xs text-gray-500">
        Last updated: {new Date(lastUpdated).toLocaleString()}
      </div>
    </div>
  );
}

export function ScoreboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" data-testid="matchup-scoreboard-loading">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 bg-gray-700 rounded" />
        <div className="h-4 w-20 bg-gray-700 rounded" />
      </div>

      {/* Main Scoreboard */}
      <div className="bg-court-lines/30 rounded-xl p-6">
        {/* Team Names and Score */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-700 rounded-lg" />
            <div className="space-y-2">
              <div className="h-4 w-24 bg-gray-700 rounded" />
              <div className="h-3 w-16 bg-gray-700 rounded" />
            </div>
          </div>
          <div className="h-10 w-20 bg-gray-700 rounded" />
          <div className="flex items-center gap-3">
            <div className="space-y-2">
              <div className="h-4 w-24 bg-gray-700 rounded" />
              <div className="h-3 w-16 bg-gray-700 rounded" />
            </div>
            <div className="w-12 h-12 bg-gray-700 rounded-lg" />
          </div>
        </div>

        {/* Category Rows */}
        <div className="space-y-2">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-700/50 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
