import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { TrendingUp, ArrowRight, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';

interface PlayerInfo {
  player_key: string;
  name: string;
  team: string;
  position: string;
  games_this_week: number;
  game_dates: string[];
  percent_owned?: string;
}

interface Recommendation {
  id: string;
  drop: PlayerInfo;
  add: PlayerInfo;
  gamesGained: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

interface RecommendationsData {
  recommendations: Recommendation[];
  rosterAnalysis: {
    totalPlayers: number;
    lowGamePlayers: number;
    averageGames: string;
  };
  weekStart: string;
  weekEnd: string;
}

interface RecommendationsPanelProps {
  leagueKey: string;
}

function getConfidenceColor(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high': return 'text-hawk-teal bg-hawk-teal/10 border-hawk-teal/30';
    case 'medium': return 'text-hawk-orange bg-hawk-orange/10 border-hawk-orange/30';
    case 'low': return 'text-gray-400 bg-gray-700/50 border-gray-600';
  }
}

function getConfidenceLabel(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high': return 'Strong';
    case 'medium': return 'Good';
    case 'low': return 'Marginal';
  }
}

export function RecommendationsPanel({ leagueKey }: RecommendationsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecommendationsData | null>(null);

  async function loadRecommendations() {
    try {
      setLoading(true);
      setError(null);
      const result = await api.fantasy.getStreamingRecommendations(leagueKey) as RecommendationsData;
      setData(result);
    } catch (err: any) {
      console.error('Failed to load recommendations:', err);
      setError(err.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (leagueKey) {
      loadRecommendations();
    }
  }, [leagueKey]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3" data-testid="recommendations-loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-gray-700 rounded-lg h-24"></div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-6" data-testid="recommendations-error">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={loadRecommendations}
          className="mt-3 text-sm text-hawk-orange hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data || data.recommendations.length === 0) {
    return (
      <div className="text-center py-6" data-testid="recommendations-empty">
        <TrendingUp className="w-8 h-8 text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-400">No streaming moves recommended</p>
        <p className="text-xs text-gray-500 mt-1">Your roster is optimized for this week</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="recommendations-panel">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-400">
          {data.rosterAnalysis.lowGamePlayers} player{data.rosterAnalysis.lowGamePlayers !== 1 ? 's' : ''} with low games
        </div>
        <button
          onClick={loadRecommendations}
          className="p-1.5 rounded hover:bg-court-surface text-gray-400 hover:text-white transition-colors"
          title="Refresh recommendations"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Recommendations */}
      <div className="space-y-3">
        {data.recommendations.map((rec) => (
          <div
            key={rec.id}
            className="bg-court-surface rounded-lg p-3 border border-white/5"
            data-testid={`recommendation-${rec.id}`}
          >
            {/* Confidence badge */}
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${getConfidenceColor(rec.confidence)}`}>
                {getConfidenceLabel(rec.confidence)}
              </span>
              <span className="text-xs font-mono text-hawk-teal">
                +{rec.gamesGained} game{rec.gamesGained > 1 ? 's' : ''}
              </span>
            </div>

            {/* Drop/Add */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 text-center">
                <div className="text-xs text-red-400 uppercase tracking-wider mb-1">Drop</div>
                <div className="text-sm font-medium text-gray-200 truncate">{rec.drop.name}</div>
                <div className="text-xs text-gray-500">{rec.drop.team} · {rec.drop.games_this_week}G</div>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <div className="flex-1 text-center">
                <div className="text-xs text-hawk-teal uppercase tracking-wider mb-1">Add</div>
                <div className="text-sm font-medium text-gray-200 truncate">{rec.add.name}</div>
                <div className="text-xs text-gray-500">{rec.add.team} · {rec.add.games_this_week}G</div>
              </div>
            </div>

            {/* Reasoning */}
            <p className="text-xs text-gray-400 mb-2">{rec.reasoning}</p>

            {/* Action link */}
            <a
              href={`https://basketball.fantasysports.yahoo.com/nba/`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 text-xs text-hawk-orange hover:text-hawk-orange/80 transition-colors"
            >
              Make move on Yahoo <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ))}
      </div>

      {/* Roster summary */}
      <div className="text-center text-xs text-gray-500 pt-2 border-t border-gray-800">
        Avg {data.rosterAnalysis.averageGames} games/player this week
      </div>
    </div>
  );
}

// Loading skeleton export
export function RecommendationsPanelSkeleton() {
  return (
    <div className="animate-pulse space-y-3" data-testid="recommendations-skeleton">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-gray-700 rounded-lg h-24"></div>
      ))}
    </div>
  );
}
