import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { LoadingSpinner } from '../LoadingSpinner';
import { TrendingUp, TrendingDown, Minus, Search, Filter } from 'lucide-react';

interface RankedPlayer {
  playerId: string;
  name: string;
  team: string;
  position: string;
  leagueRank: number;
  standardRank: number;
  rankDifference: number;
  categoryScores: Record<string, number>;
  overallScore: number;
}

interface RankingsData {
  players: RankedPlayer[];
  lastUpdated: string;
  leagueCategories: string[];
  leagueName?: string;
}

interface CustomRankingsProps {
  selectedLeague: string;
}

const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C'];

export function CustomRankings({ selectedLeague }: CustomRankingsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RankingsData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState('All');

  useEffect(() => {
    loadRankings();
  }, [selectedLeague]);

  async function loadRankings() {
    try {
      setLoading(true);
      setError(null);
      const response = await api.fantasy.getLeagueInsightsRankings(selectedLeague);
      setData(response as RankingsData);
    } catch (err: any) {
      console.error('Failed to load rankings:', err);
      setError(err.message || 'Failed to load rankings');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <LoadingSpinner message="Calculating league-adjusted rankings..." />;
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-red-400">{error}</p>
        <button
          onClick={loadRankings}
          className="mt-4 px-4 py-2 bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.players.length === 0) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-400">No ranking data available</p>
      </div>
    );
  }

  // Filter players by search and position
  const filteredPlayers = data.players.filter(player => {
    const matchesSearch = searchQuery === '' ||
      player.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      player.team.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPosition = positionFilter === 'All' || player.position === positionFilter;
    return matchesSearch && matchesPosition;
  });

  // Get biggest risers and fallers
  const sortedByDiff = [...data.players].sort((a, b) => b.rankDifference - a.rankDifference);
  const biggestRisers = sortedByDiff.slice(0, 5).filter(p => p.rankDifference > 0);
  const biggestFallers = sortedByDiff.slice(-5).reverse().filter(p => p.rankDifference < 0);

  const getRankDiffIcon = (diff: number) => {
    if (diff > 0) {
      return <TrendingUp className="w-4 h-4 text-green-400" />;
    } else if (diff < 0) {
      return <TrendingDown className="w-4 h-4 text-red-400" />;
    }
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getRankDiffClass = (diff: number) => {
    if (diff >= 5) return 'text-green-400 font-semibold';
    if (diff > 0) return 'text-green-400';
    if (diff <= -5) return 'text-red-400 font-semibold';
    if (diff < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  return (
    <div className="space-y-6" data-testid="custom-rankings">
      {/* Value Shifts Summary */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Biggest Risers */}
        <div className="card" data-testid="league-value-shifts">
          <h4 className="font-semibold text-gray-100 mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            Biggest Risers (vs Standard)
          </h4>
          {biggestRisers.length > 0 ? (
            <div className="space-y-2">
              {biggestRisers.map((player, index) => (
                <div
                  key={player.playerId}
                  className="flex items-center justify-between p-2 bg-green-500/10 rounded-lg"
                  data-testid={`league-value-riser-${index + 1}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm w-4">{index + 1}.</span>
                    <span className="text-gray-100">{player.name}</span>
                    <span className="text-xs text-gray-400">{player.position}</span>
                  </div>
                  <span className="text-green-400 font-semibold">+{player.rankDifference} spots</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No significant risers</p>
          )}
        </div>

        {/* Biggest Fallers */}
        <div className="card">
          <h4 className="font-semibold text-gray-100 mb-3 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-400" />
            Biggest Fallers (vs Standard)
          </h4>
          {biggestFallers.length > 0 ? (
            <div className="space-y-2">
              {biggestFallers.map((player, index) => (
                <div
                  key={player.playerId}
                  className="flex items-center justify-between p-2 bg-red-500/10 rounded-lg"
                  data-testid={`league-value-faller-${index + 1}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm w-4">{index + 1}.</span>
                    <span className="text-gray-100">{player.name}</span>
                    <span className="text-xs text-gray-400">{player.position}</span>
                  </div>
                  <span className="text-red-400 font-semibold">{player.rankDifference} spots</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No significant fallers</p>
          )}
        </div>
      </div>

      {/* Rankings Table */}
      <div className="card" data-testid="league-adjusted-rankings">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <h3 className="font-semibold text-gray-100">League-Adjusted Rankings</h3>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 bg-court-base border border-white/10 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-hawk-teal"
                data-testid="league-rankings-search"
              />
            </div>

            {/* Position Filter */}
            <div className="relative flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="select text-sm"
                data-testid="league-rankings-position-filter"
              >
                {POSITIONS.map(pos => (
                  <option key={pos} value={pos}>{pos}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-400 border-b border-white/10">
                <th className="pb-2 px-2">Rank</th>
                <th className="pb-2 px-2">Player</th>
                <th className="pb-2 px-2">Team</th>
                <th className="pb-2 px-2">Pos</th>
                <th className="pb-2 px-2 text-center">Std Rank</th>
                <th className="pb-2 px-2 text-center">Change</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.slice(0, 50).map((player) => (
                <tr
                  key={player.playerId}
                  className={`border-b border-white/5 hover:bg-white/5 ${
                    Math.abs(player.rankDifference) >= 5 ? 'bg-white/[0.02]' : ''
                  }`}
                  data-testid={`league-rankings-row-${player.playerId}`}
                >
                  <td className="py-3 px-2">
                    <span className="font-semibold text-gray-100">{player.leagueRank}</span>
                  </td>
                  <td className="py-3 px-2">
                    <span className="text-gray-100">{player.name}</span>
                  </td>
                  <td className="py-3 px-2">
                    <span className="text-gray-400">{player.team}</span>
                  </td>
                  <td className="py-3 px-2">
                    <span className="px-2 py-0.5 bg-gray-700/50 rounded text-xs text-gray-300">
                      {player.position}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="text-gray-400">{player.standardRank}</span>
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center justify-center gap-1">
                      {getRankDiffIcon(player.rankDifference)}
                      <span className={getRankDiffClass(player.rankDifference)}>
                        {player.rankDifference > 0 ? '+' : ''}
                        {player.rankDifference !== 0 ? player.rankDifference : '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredPlayers.length > 50 && (
          <p className="text-center text-gray-400 text-sm mt-4">
            Showing top 50 of {filteredPlayers.length} players
          </p>
        )}

        {filteredPlayers.length === 0 && (
          <p className="text-center text-gray-400 py-4">
            No players match your search criteria
          </p>
        )}
      </div>

      {/* Last Updated */}
      <p className="text-center text-xs text-gray-500">
        Rankings last updated: {new Date(data.lastUpdated).toLocaleString()}
      </p>
    </div>
  );
}
