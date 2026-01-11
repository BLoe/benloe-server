import { UserCircle, Trophy, Minus } from 'lucide-react';

interface PlayerStats {
  playerKey: string;
  name: string;
  position?: string;
  team?: string;
  imageUrl?: string;
  status?: string;
  percentOwned?: number;
  gamesPlayed: number;
}

interface StatComparison {
  statId: string;
  name: string;
  displayName: string;
  isNegative: boolean;
  players: Array<{
    playerKey: string;
    value: number;
    average: number;
    isLeader: boolean;
    isTied: boolean;
  }>;
}

interface ComparisonResult {
  players: PlayerStats[];
  comparisons: StatComparison[];
  summary: {
    playerWins: Record<string, number>;
    ties: number;
    totalCategories: number;
  };
}

interface ComparisonTableProps {
  comparison: ComparisonResult;
}

export function ComparisonTable({ comparison }: ComparisonTableProps) {
  const { players, comparisons, summary } = comparison;

  function formatStatValue(value: number, displayName: string): string {
    // Format percentages
    if (displayName.includes('%')) {
      return value.toFixed(3);
    }
    // Format other stats to 1 decimal
    return value.toFixed(1);
  }

  function getStatusColor(status?: string) {
    if (!status) return '';
    const s = status.toUpperCase();
    if (s === 'INJ' || s === 'O' || s === 'OUT') return 'text-red-400';
    if (s === 'GTD' || s === 'DTD') return 'text-yellow-400';
    if (s === 'IL' || s === 'IL+') return 'text-red-500';
    return 'text-gray-400';
  }

  return (
    <div className="space-y-6" data-testid="comparison-table">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {players.map((player) => (
          <div
            key={player.playerKey}
            className="bg-court-surface rounded-lg p-4 text-center"
          >
            {/* Player image */}
            <div className="flex justify-center mb-3">
              {player.imageUrl ? (
                <img
                  src={player.imageUrl}
                  alt={player.name}
                  className="w-16 h-16 rounded-full object-cover bg-gray-700"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
                  <UserCircle className="w-10 h-10 text-gray-500" />
                </div>
              )}
            </div>

            {/* Player name */}
            <p className="font-medium text-gray-100 mb-1">{player.name}</p>
            <p className="text-xs text-gray-400 mb-2">
              {player.team} · {player.position}
              {player.status && (
                <span className={`ml-1 ${getStatusColor(player.status)}`}>
                  ({player.status})
                </span>
              )}
            </p>

            {/* Win count */}
            <div className="flex items-center justify-center gap-2 mt-3">
              <Trophy className="w-4 h-4 text-hawk-orange" />
              <span className="text-lg font-bold text-hawk-orange">
                {summary.playerWins[player.playerKey] || 0}
              </span>
              <span className="text-xs text-gray-500">
                / {summary.totalCategories} cats
              </span>
            </div>

            {/* Games played */}
            <p className="text-xs text-gray-500 mt-2">
              {player.gamesPlayed} games played
            </p>
          </div>
        ))}
      </div>

      {/* Ties indicator */}
      {summary.ties > 0 && (
        <div className="text-center text-sm text-gray-400">
          <Minus className="w-4 h-4 inline-block mr-1" />
          {summary.ties} tied {summary.ties === 1 ? 'category' : 'categories'}
        </div>
      )}

      {/* Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">
                Category
              </th>
              {players.map((player) => (
                <th
                  key={player.playerKey}
                  className="px-4 py-3 text-center text-sm font-medium text-gray-400"
                >
                  {player.name.split(' ').pop()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comp) => (
              <tr
                key={comp.statId}
                className="border-b border-gray-800 hover:bg-court-surface/50 transition-colors"
              >
                {/* Category name */}
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-200">
                    {comp.displayName}
                  </span>
                  {comp.isNegative && (
                    <span className="ml-2 text-xs text-gray-500">(lower is better)</span>
                  )}
                </td>

                {/* Player values */}
                {comp.players.map((playerStat) => {
                  const isWinner = playerStat.isLeader && !playerStat.isTied;
                  const isTied = playerStat.isTied;

                  return (
                    <td
                      key={playerStat.playerKey}
                      className={`px-4 py-3 text-center ${
                        isWinner
                          ? 'bg-green-500/10'
                          : isTied
                          ? 'bg-yellow-500/10'
                          : ''
                      }`}
                      data-testid={`stat-${comp.statId}-${playerStat.playerKey}`}
                    >
                      <div className="flex flex-col items-center">
                        <span
                          className={`font-medium ${
                            isWinner
                              ? 'text-green-400'
                              : isTied
                              ? 'text-yellow-400'
                              : 'text-gray-200'
                          }`}
                        >
                          {formatStatValue(playerStat.average, comp.displayName)}
                        </span>
                        <span className="text-xs text-gray-500">
                          ({formatStatValue(playerStat.value, comp.displayName)} total)
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 justify-center pt-4 border-t border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-500/20 border border-green-500/30" />
          <span>Category Leader</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-yellow-500/20 border border-yellow-500/30" />
          <span>Tied</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Averages shown (totals in parentheses)</span>
        </div>
      </div>
    </div>
  );
}
