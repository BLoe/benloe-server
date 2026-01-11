import { useState, useEffect } from 'react';
import { TrendingUp, UserCircle, Calendar, Sparkles, ChevronRight } from 'lucide-react';
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

interface Recommendation {
  player: PlayerStats;
  score: number;
  reason: string;
  fillsNeeds: string[];
  gamesThisWeek: number;
  trend: 'rising' | 'falling' | 'stable';
  priority: 'high' | 'medium' | 'low';
}

interface RecommendationsPanelProps {
  leagueKey: string;
}

export function RecommendationsPanel({ leagueKey }: RecommendationsPanelProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState<string>('All');

  const positions = ['All', 'PG', 'SG', 'SF', 'PF', 'C'];

  useEffect(() => {
    loadRecommendations();
  }, [leagueKey, positionFilter]);

  async function loadRecommendations() {
    try {
      setLoading(true);
      setError(null);

      const position = positionFilter !== 'All' ? positionFilter : undefined;
      const data = await api.fantasy.getWaiverRecommendations(leagueKey, position) as {
        recommendations: Recommendation[];
      };

      setRecommendations(data.recommendations || []);
    } catch (err: any) {
      console.error('Failed to load recommendations:', err);
      setError(err.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }

  function getPriorityColor(priority: string) {
    switch (priority) {
      case 'high': return 'text-green-400 bg-green-400/10';
      case 'medium': return 'text-yellow-400 bg-yellow-400/10';
      default: return 'text-gray-400 bg-gray-400/10';
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
    <div className="space-y-4" data-testid="recommendations-panel">
      {/* Header with Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-hawk-orange" />
          <h3 className="font-medium text-gray-100">Top Pickups</h3>
        </div>

        {/* Position Filter */}
        <div className="flex gap-1">
          {positions.map((pos) => (
            <button
              key={pos}
              onClick={() => setPositionFilter(pos)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                positionFilter === pos
                  ? 'bg-hawk-orange text-white'
                  : 'bg-court-surface text-gray-400 hover:text-gray-200'
              }`}
              data-testid={`position-filter-${pos.toLowerCase()}`}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-8" data-testid="recommendations-loading">
          <LoadingSpinner message="Finding recommendations..." />
        </div>
      ) : error ? (
        <div className="py-8 text-center text-red-400" data-testid="recommendations-error">
          {error}
        </div>
      ) : recommendations.length === 0 ? (
        <div className="py-8 text-center text-gray-500" data-testid="recommendations-empty">
          No recommendations available for this position
        </div>
      ) : (
        <div className="space-y-2">
          {recommendations.map((rec, index) => (
            <div
              key={rec.player.playerKey}
              className="bg-court-surface rounded-lg p-3 hover:bg-court-surface/80 transition-colors"
              data-testid={`recommendation-${index}`}
            >
              <div className="flex items-center gap-3">
                {/* Rank */}
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-court-base flex items-center justify-center">
                  <span className="text-xs font-medium text-gray-400">{index + 1}</span>
                </div>

                {/* Player Image */}
                <div className="flex-shrink-0">
                  {rec.player.imageUrl ? (
                    <img
                      src={rec.player.imageUrl}
                      alt={rec.player.name}
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
                      {rec.player.name}
                    </span>
                    {rec.player.status && (
                      <span className={`text-xs ${getStatusColor(rec.player.status)}`}>
                        {rec.player.status}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded ${getPriorityColor(rec.priority)}`}>
                      {rec.priority}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{rec.player.team}</span>
                    <span>·</span>
                    <span>{rec.player.position}</span>
                    <span>·</span>
                    <span>{rec.player.percentOwned.toFixed(0)}% owned</span>
                  </div>
                </div>

                {/* Games This Week */}
                {rec.gamesThisWeek > 0 && (
                  <div className="flex-shrink-0 flex items-center gap-1 text-sm">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-300">{rec.gamesThisWeek}</span>
                  </div>
                )}

                {/* Trend */}
                {rec.trend === 'rising' && (
                  <TrendingUp className="w-4 h-4 text-green-400 flex-shrink-0" />
                )}
              </div>

              {/* Reason */}
              <div className="mt-2 pl-9 flex items-center gap-2">
                <ChevronRight className="w-3 h-3 text-gray-600" />
                <span className="text-xs text-gray-400">{rec.reason}</span>
              </div>

              {/* Fills Needs Tags */}
              {rec.fillsNeeds.length > 0 && (
                <div className="mt-2 pl-9 flex flex-wrap gap-1">
                  {rec.fillsNeeds.slice(0, 4).map((need) => (
                    <span
                      key={need}
                      className="text-xs px-2 py-0.5 rounded bg-hawk-indigo/20 text-hawk-indigo"
                    >
                      {need}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
