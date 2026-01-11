import { useState, useEffect } from 'react';
import { Trash2, UserCircle, AlertTriangle, ChevronRight } from 'lucide-react';
import { api } from '../../services/api';
import { LoadingSpinner } from '../LoadingSpinner';

interface PlayerStats {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  imageUrl?: string;
  status?: string;
  percentOwned: number;
  gamesPlayed: number;
}

interface DropCandidate {
  player: PlayerStats;
  score: number;
  reason: string;
  weakCategories: string[];
}

interface DropsPanelProps {
  leagueKey: string;
}

export function DropsPanel({ leagueKey }: DropsPanelProps) {
  const [dropCandidates, setDropCandidates] = useState<DropCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDrops();
  }, [leagueKey]);

  async function loadDrops() {
    try {
      setLoading(true);
      setError(null);

      const data = await api.fantasy.getWaiverDrops(leagueKey) as {
        dropCandidates: DropCandidate[];
      };

      setDropCandidates(data.dropCandidates || []);
    } catch (err: any) {
      console.error('Failed to load drop suggestions:', err);
      setError(err.message || 'Failed to load drop suggestions');
    } finally {
      setLoading(false);
    }
  }

  function getStatusColor(status?: string) {
    if (!status) return '';
    const s = status.toUpperCase();
    if (s === 'INJ' || s === 'O' || s === 'OUT') return 'text-red-400';
    if (s === 'GTD' || s === 'DTD') return 'text-yellow-400';
    return 'text-gray-400';
  }

  return (
    <div className="space-y-4" data-testid="drops-panel">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Trash2 className="w-5 h-5 text-red-400" />
        <h3 className="font-medium text-gray-100">Consider Dropping</h3>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-8" data-testid="drops-loading">
          <LoadingSpinner message="Analyzing roster..." />
        </div>
      ) : error ? (
        <div className="py-8 text-center text-red-400" data-testid="drops-error">
          {error}
        </div>
      ) : dropCandidates.length === 0 ? (
        <div className="py-8 text-center" data-testid="drops-empty">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-gray-500">No obvious drop candidates</p>
          <p className="text-xs text-gray-600 mt-1">Your roster looks solid!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dropCandidates.map((drop, index) => (
            <div
              key={drop.player.playerKey}
              className="bg-court-surface rounded-lg p-3 border-l-2 border-red-500/30"
              data-testid={`drop-candidate-${index}`}
            >
              <div className="flex items-center gap-3">
                {/* Player Image */}
                <div className="flex-shrink-0">
                  {drop.player.imageUrl ? (
                    <img
                      src={drop.player.imageUrl}
                      alt={drop.player.name}
                      className="w-10 h-10 rounded-full object-cover bg-gray-700"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">
                      <UserCircle className="w-6 h-6 text-gray-500" />
                    </div>
                  )}
                </div>

                {/* Player Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-100 truncate">
                      {drop.player.name}
                    </span>
                    {drop.player.status && (
                      <span className={`text-xs ${getStatusColor(drop.player.status)}`}>
                        {drop.player.status}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{drop.player.team}</span>
                    <span>·</span>
                    <span>{drop.player.position}</span>
                    <span>·</span>
                    <span>{drop.player.percentOwned.toFixed(0)}% owned</span>
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div className="mt-2 flex items-center gap-2">
                <ChevronRight className="w-3 h-3 text-gray-600" />
                <span className="text-xs text-gray-400">{drop.reason}</span>
              </div>

              {/* Weak Categories */}
              {drop.weakCategories.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {drop.weakCategories.slice(0, 4).map((cat) => (
                    <span
                      key={cat}
                      className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400"
                    >
                      Weak: {cat}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Info Note */}
      {!loading && !error && dropCandidates.length > 0 && (
        <p className="text-xs text-gray-500 text-center">
          Consider these players when making waiver moves
        </p>
      )}
    </div>
  );
}
