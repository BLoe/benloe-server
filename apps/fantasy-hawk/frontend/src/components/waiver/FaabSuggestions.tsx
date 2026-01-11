import { useState, useEffect } from 'react';
import { DollarSign, UserCircle, TrendingUp, AlertTriangle } from 'lucide-react';
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

interface FaabSuggestion {
  player: PlayerStats;
  suggestedBid: number;
  bidRangeMin: number;
  bidRangeMax: number;
  percentOfBudget: number;
  competition: 'high' | 'medium' | 'low';
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
}

interface FaabBudget {
  remaining: number;
  total: number;
  leagueAverage: number;
  percentRemaining: number;
}

interface FaabData {
  usesFaab: boolean;
  message?: string;
  suggestions: FaabSuggestion[];
  budget: FaabBudget;
  waiverPriority: number;
  currentWeek: number;
  weeksRemaining: number;
  isPlayoffs: boolean;
}

interface FaabSuggestionsProps {
  leagueKey: string;
}

export function FaabSuggestions({ leagueKey }: FaabSuggestionsProps) {
  const [data, setData] = useState<FaabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFaabData();
  }, [leagueKey]);

  async function loadFaabData() {
    try {
      setLoading(true);
      setError(null);

      const response = await api.fantasy.getWaiverFaab(leagueKey) as FaabData;
      setData(response);
    } catch (err: any) {
      console.error('Failed to load FAAB data:', err);
      setError(err.message || 'Failed to load FAAB suggestions');
    } finally {
      setLoading(false);
    }
  }

  function getCompetitionColor(competition: string) {
    switch (competition) {
      case 'high': return 'text-red-400 bg-red-400/10';
      case 'medium': return 'text-yellow-400 bg-yellow-400/10';
      default: return 'text-green-400 bg-green-400/10';
    }
  }

  function getPriorityIcon(priority: string) {
    switch (priority) {
      case 'high': return '🔥';
      case 'medium': return '⭐';
      default: return '💭';
    }
  }

  if (loading) {
    return (
      <div className="py-8" data-testid="faab-loading">
        <LoadingSpinner message="Loading FAAB data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-400" data-testid="faab-error">
        {error}
      </div>
    );
  }

  if (!data?.usesFaab) {
    return (
      <div className="py-6 text-center" data-testid="faab-not-available">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-600" />
        <p className="text-gray-500">This league doesn't use FAAB</p>
        <p className="text-xs text-gray-600 mt-1">
          FAAB suggestions are only available for leagues with Free Agent Acquisition Budget
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="faab-suggestions">
      {/* Budget Status */}
      <div className="bg-court-surface rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-5 h-5 text-green-400" />
          <h4 className="font-medium text-gray-100">Your FAAB Budget</h4>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-green-400">
              ${data.budget.remaining}
            </div>
            <div className="text-xs text-gray-500">Remaining</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-300">
              ${data.budget.total}
            </div>
            <div className="text-xs text-gray-500">Total Budget</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-400">
              ${data.budget.leagueAverage}
            </div>
            <div className="text-xs text-gray-500">League Avg</div>
          </div>
        </div>

        {/* Budget Bar */}
        <div className="mt-3">
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-400 transition-all duration-300"
              style={{ width: `${data.budget.percentRemaining}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{data.budget.percentRemaining}% remaining</span>
            <span>{data.weeksRemaining} weeks left</span>
          </div>
        </div>
      </div>

      {/* FAAB Suggestions */}
      {data.suggestions.length === 0 ? (
        <div className="py-6 text-center text-gray-500">
          No FAAB suggestions available
        </div>
      ) : (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-300 px-1">
            Suggested Bids
          </h4>

          {data.suggestions.map((suggestion, index) => (
            <div
              key={suggestion.player.playerKey}
              className="bg-court-surface rounded-lg p-3"
              data-testid={`faab-suggestion-${index}`}
            >
              <div className="flex items-center gap-3">
                {/* Priority Icon */}
                <span className="text-lg" title={`${suggestion.priority} priority`}>
                  {getPriorityIcon(suggestion.priority)}
                </span>

                {/* Player Image */}
                <div className="flex-shrink-0">
                  {suggestion.player.imageUrl ? (
                    <img
                      src={suggestion.player.imageUrl}
                      alt={suggestion.player.name}
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
                      {suggestion.player.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{suggestion.player.team}</span>
                    <span>·</span>
                    <span>{suggestion.player.position}</span>
                  </div>
                </div>

                {/* Bid Amount */}
                <div className="text-right">
                  <div className="text-lg font-bold text-green-400">
                    ${suggestion.suggestedBid}
                  </div>
                  <div className="text-xs text-gray-500">
                    ${suggestion.bidRangeMin}-${suggestion.bidRangeMax}
                  </div>
                </div>
              </div>

              {/* Details Row */}
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-gray-400">{suggestion.reasoning}</span>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded ${getCompetitionColor(suggestion.competition)}`}>
                    {suggestion.competition} competition
                  </span>
                  <span className="text-gray-500">
                    {suggestion.percentOfBudget}% of budget
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Season Context */}
      {data.isPlayoffs && (
        <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-400/10 rounded-lg p-3">
          <TrendingUp className="w-4 h-4" />
          <span>Playoff mode: Bid more aggressively for impact players</span>
        </div>
      )}
    </div>
  );
}
