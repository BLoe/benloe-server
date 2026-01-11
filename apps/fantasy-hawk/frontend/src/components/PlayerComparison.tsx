import { useState } from 'react';
import { Scale, RefreshCw, Share2 } from 'lucide-react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { PlayerSelector } from './comparison/PlayerSelector';
import { ComparisonTable } from './comparison/ComparisonTable';

interface Player {
  playerKey: string;
  name: string;
  firstName?: string;
  lastName?: string;
  position: string;
  team: string;
  teamFull?: string;
  imageUrl?: string;
  status?: string;
  percentOwned?: number;
}

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

interface PlayerComparisonProps {
  selectedLeague: string;
}

export function PlayerComparison({ selectedLeague }: PlayerComparisonProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCompare() {
    if (selectedPlayers.length < 2) {
      setError('Please select at least 2 players to compare');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const playerKeys = selectedPlayers.map((p) => p.playerKey);
      const result = await api.fantasy.comparePlayers(selectedLeague, playerKeys) as ComparisonResult;

      setComparison(result);
    } catch (err: any) {
      console.error('Comparison failed:', err);
      setError(err.message || 'Failed to compare players');
      setComparison(null);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setSelectedPlayers([]);
    setComparison(null);
    setError(null);
  }

  function handleShare() {
    // Build shareable URL with player keys
    const playerKeys = selectedPlayers.map((p) => p.playerKey).join(',');
    const url = `${window.location.origin}${window.location.pathname}?compare=${encodeURIComponent(playerKeys)}`;

    // Copy to clipboard
    navigator.clipboard.writeText(url).then(() => {
      alert('Comparison link copied to clipboard!');
    }).catch(() => {
      // Fallback for older browsers
      prompt('Copy this link:', url);
    });
  }

  const canCompare = selectedPlayers.length >= 2;
  const hasComparison = comparison !== null;

  return (
    <div className="space-y-6" data-testid="player-comparison">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-hawk-indigo/20">
              <Scale className="w-5 h-5 text-hawk-indigo" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-gray-100">
                Player Comparison
              </h2>
              <p className="text-sm text-gray-400">
                Compare 2-4 players side-by-side
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {hasComparison && (
              <button
                onClick={handleShare}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                title="Share comparison"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            )}
            {(selectedPlayers.length > 0 || hasComparison) && (
              <button
                onClick={handleClear}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Player Selector */}
        <PlayerSelector
          leagueKey={selectedLeague}
          selectedPlayers={selectedPlayers}
          onPlayersChange={setSelectedPlayers}
          maxPlayers={4}
        />

        {/* Compare Button */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={handleCompare}
            disabled={!canCompare || loading}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
              canCompare
                ? 'bg-hawk-orange text-white hover:bg-hawk-orange/90'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            data-testid="compare-button"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Comparing...
              </>
            ) : (
              <>
                <Scale className="w-4 h-4" />
                Compare Players
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <ErrorMessage message={error} />
      )}

      {/* Loading State */}
      {loading && (
        <div className="card">
          <LoadingSpinner message="Fetching player stats..." />
        </div>
      )}

      {/* Comparison Results */}
      {!loading && comparison && (
        <div className="card">
          <ComparisonTable comparison={comparison} />
        </div>
      )}

      {/* Empty State */}
      {!loading && !comparison && !error && selectedPlayers.length === 0 && (
        <div className="card text-center py-12">
          <Scale className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium text-gray-300 mb-2">
            Select Players to Compare
          </h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Click on the empty slots above and search for players by name.
            Select 2-4 players to see a detailed stat comparison.
          </p>
        </div>
      )}
    </div>
  );
}
