import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { TrendingUp, AlertTriangle, Target, Calendar, ArrowRight, Loader2 } from 'lucide-react';

interface CategoryProjection {
  statId: number;
  name: string;
  abbr: string;
  current: {
    user: number;
    opponent: number;
    status: 'win' | 'loss' | 'tie';
  };
  projected: {
    user: number;
    opponent: number;
    status: 'win' | 'loss' | 'tie';
  };
  isSwing: boolean;
  confidence: 'high' | 'medium' | 'low';
  couldFlip: boolean;
}

interface ProjectionsData {
  week: number;
  weekProgress: {
    daysElapsed: number;
    daysRemaining: number;
    percentComplete: number;
  };
  projectedScore: {
    wins: number;
    losses: number;
    ties: number;
  };
  projectedOutcome: 'win' | 'loss' | 'tie';
  swingCategories: number;
  projections: CategoryProjection[];
  gamesRemaining: {
    totalGamesInWeek: number;
    datesRemaining: string[];
  };
}

interface ProjectionsPanelProps {
  leagueKey: string;
}

export function ProjectionsPanel({ leagueKey }: ProjectionsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProjectionsData | null>(null);

  useEffect(() => {
    loadProjections();
  }, [leagueKey]);

  async function loadProjections() {
    try {
      setLoading(true);
      setError(null);
      const result = await api.fantasy.getMatchupProjections(leagueKey) as ProjectionsData;
      setData(result);
    } catch (err: any) {
      console.error('Failed to load projections:', err);
      setError(err.message || 'Failed to load projections');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" data-testid="projections-loading">
        <Loader2 className="w-6 h-6 text-hawk-orange animate-spin" />
        <span className="ml-2 text-gray-400">Loading projections...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-400" data-testid="projections-error">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-400" data-testid="projections-empty">
        No projection data available
      </div>
    );
  }

  const { weekProgress, projectedScore, projectedOutcome, swingCategories, projections, gamesRemaining } = data;

  const getOutcomeColor = (outcome: 'win' | 'loss' | 'tie') => {
    switch (outcome) {
      case 'win': return 'text-hawk-teal';
      case 'loss': return 'text-red-400';
      case 'tie': return 'text-yellow-400';
    }
  };

  const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-hawk-teal/20 text-hawk-teal">High</span>;
      case 'medium':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400">Medium</span>;
      case 'low':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400">Low</span>;
    }
  };

  // Find key insight
  const swingCats = projections.filter(p => p.isSwing);
  const keyInsight = swingCats.length > 0
    ? `${swingCats.length} swing categor${swingCats.length === 1 ? 'y' : 'ies'}: ${swingCats.map(c => c.abbr).join(', ')}`
    : projectedOutcome === 'win'
    ? 'On track for victory'
    : projectedOutcome === 'loss'
    ? 'Need to make moves to catch up'
    : 'Very close matchup - every game counts';

  return (
    <div className="space-y-6" data-testid="projections-panel">
      {/* Week Progress */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Calendar className="w-4 h-4" />
          <span>Week {data.week}</span>
        </div>
        <div className="text-sm">
          <span className="text-gray-500">{weekProgress.percentComplete}% complete</span>
          <span className="text-gray-600 mx-2">·</span>
          <span className="text-gray-400">{weekProgress.daysRemaining} days left</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-hawk-orange to-hawk-teal transition-all duration-500"
          style={{ width: `${weekProgress.percentComplete}%` }}
        />
      </div>

      {/* Projected Score */}
      <div className="bg-court-lines/30 rounded-xl p-6 text-center">
        <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Projected Final</div>
        <div className={`font-display text-4xl font-bold ${getOutcomeColor(projectedOutcome)}`}>
          {projectedScore.wins}-{projectedScore.losses}
          {projectedScore.ties > 0 && `-${projectedScore.ties}`}
        </div>
        <div className={`text-sm mt-2 ${getOutcomeColor(projectedOutcome)}`}>
          Projected {projectedOutcome === 'win' ? 'WIN' : projectedOutcome === 'loss' ? 'LOSS' : 'TIE'}
        </div>
      </div>

      {/* Key Insight */}
      <div className="flex items-start gap-3 p-4 bg-hawk-orange/10 rounded-lg border border-hawk-orange/20">
        <Target className="w-5 h-5 text-hawk-orange flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-gray-200">Key Insight</div>
          <div className="text-sm text-gray-400 mt-1">{keyInsight}</div>
        </div>
      </div>

      {/* Games Remaining */}
      <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
        <div className="text-sm text-gray-400">Games Remaining This Week</div>
        <div className="font-display text-xl text-hawk-teal">
          {gamesRemaining.datesRemaining.length} days
        </div>
      </div>

      {/* Swing Categories */}
      {swingCategories > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-gray-300">Swing Categories</span>
          </div>
          <div className="space-y-2">
            {projections.filter(p => p.isSwing).map(cat => (
              <div
                key={cat.statId}
                className="flex items-center justify-between p-3 bg-yellow-900/10 rounded-lg border border-yellow-400/20"
              >
                <div>
                  <span className="font-medium text-gray-200">{cat.abbr}</span>
                  <span className="text-gray-500 text-sm ml-2">({cat.name})</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-sm">
                    <span className={getOutcomeColor(cat.current.status)}>
                      {cat.current.user}
                    </span>
                    <span className="text-gray-600 mx-1">vs</span>
                    <span className="text-gray-400">{cat.current.opponent}</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-600" />
                  <div className="text-sm">
                    <span className={getOutcomeColor(cat.projected.status)}>
                      {cat.projected.user}
                    </span>
                    <span className="text-gray-600 mx-1">vs</span>
                    <span className="text-gray-400">{cat.projected.opponent}</span>
                  </div>
                  {getConfidenceBadge(cat.confidence)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Projections Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-hawk-teal" />
          <span className="text-sm font-medium text-gray-300">All Category Projections</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {projections.map(cat => (
            <div
              key={cat.statId}
              className={`p-3 rounded-lg text-center ${
                cat.isSwing
                  ? 'bg-yellow-900/10 border border-yellow-400/20'
                  : cat.projected.status === 'win'
                  ? 'bg-hawk-teal/10 border border-hawk-teal/20'
                  : cat.projected.status === 'loss'
                  ? 'bg-red-900/10 border border-red-400/20'
                  : 'bg-gray-800/50 border border-gray-700'
              }`}
            >
              <div className="text-xs text-gray-500 uppercase tracking-wider">{cat.abbr}</div>
              <div className={`font-display text-lg mt-1 ${getOutcomeColor(cat.projected.status)}`}>
                {cat.projected.status === 'win' ? 'W' : cat.projected.status === 'loss' ? 'L' : 'T'}
              </div>
              {cat.couldFlip && (
                <div className="text-xs text-yellow-400 mt-1">Could flip</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
