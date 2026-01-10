import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Scoreboard, ScoreboardSkeleton } from './matchup/Scoreboard';
import { CategoryBreakdown } from './matchup/CategoryBreakdown';
import { ProjectionsPanel } from './matchup/ProjectionsPanel';
import { Swords, ChevronDown, ChevronUp, TrendingUp } from 'lucide-react';

interface MatchupCenterProps {
  selectedLeague: string | null;
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
  categories: Array<{
    statId: number;
    name: string;
    displayName: string;
    yourValue: string;
    opponentValue: string;
    winner: 'you' | 'opponent' | 'tie';
    margin: string;
    isPercentage: boolean;
  }>;
  lastUpdated: string;
  isByeWeek?: boolean;
}

export function MatchupCenter({ selectedLeague }: MatchupCenterProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchupData, setMatchupData] = useState<MatchupData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [showDetailedBreakdown, setShowDetailedBreakdown] = useState(false);

  useEffect(() => {
    if (selectedLeague) {
      loadMatchupData(selectedLeague);
    }
  }, [selectedLeague]);

  async function loadMatchupData(leagueKey: string, isRefresh = false) {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const data = await api.fantasy.getMatchupCurrent(leagueKey) as MatchupData;
      setMatchupData(data);
    } catch (err: any) {
      console.error('Failed to load matchup data:', err);
      setError(err.message || 'Failed to load matchup data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  function handleRefresh() {
    if (selectedLeague) {
      loadMatchupData(selectedLeague, true);
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="matchup-no-league">
        <Swords className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Select a league to view your matchup</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6" data-testid="matchup-page">
        {/* Page Header */}
        <div>
          <h2 className="font-display text-2xl text-gray-100 flex items-center gap-3">
            <Swords className="w-7 h-7 text-hawk-orange" />
            Matchup Center
          </h2>
          <p className="text-gray-400 mt-1">
            Head-to-head category breakdown
          </p>
        </div>
        <div className="card">
          <ScoreboardSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card text-center py-12" data-testid="matchup-error">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => loadMatchupData(selectedLeague)}
          className="mt-4 px-4 py-2 bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="matchup-page">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-gray-100 flex items-center gap-3">
            <Swords className="w-7 h-7 text-hawk-orange" />
            Matchup Center
          </h2>
          <p className="text-gray-400 mt-1">
            Head-to-head category breakdown
            {matchupData && ` - Week ${matchupData.week}`}
          </p>
        </div>
      </div>

      {/* Scoreboard */}
      <div className="card">
        {matchupData ? (
          <Scoreboard
            matchup={matchupData}
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
          />
        ) : (
          <div className="text-center py-12 text-gray-400">
            No matchup data available
          </div>
        )}
      </div>

      {/* Two-column layout for analysis panels */}
      {matchupData && selectedLeague && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Detailed Category Breakdown */}
          {matchupData.categories.length > 0 && (
            <div className="card">
              <button
                onClick={() => setShowDetailedBreakdown(!showDetailedBreakdown)}
                className="w-full flex items-center justify-between py-2"
                data-testid="toggle-category-breakdown"
              >
                <h3 className="font-semibold text-gray-100">Detailed Category Analysis</h3>
                {showDetailedBreakdown ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {showDetailedBreakdown && (
                <div className="mt-4">
                  <CategoryBreakdown
                    categories={matchupData.categories}
                    expanded={expandedCategory}
                    onToggle={setExpandedCategory}
                  />
                </div>
              )}
            </div>
          )}

          {/* Projections Panel */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-hawk-orange" />
              <h3 className="font-semibold text-gray-100">Week Projections</h3>
            </div>
            <ProjectionsPanel leagueKey={selectedLeague} />
          </div>
        </div>
      )}
    </div>
  );
}
