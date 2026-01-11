import { useState, useEffect, useMemo } from 'react';
import { BarChart3, Table2, TrendingUp } from 'lucide-react';
import { api } from '../../services/api';
import { LoadingSpinner } from '../LoadingSpinner';

interface CategoryRank {
  statId: string;
  name: string;
  displayName: string;
  value: number;
  rank: number;
  totalTeams: number;
  zScore: number;
  percentile: number;
  classification: 'elite' | 'strong' | 'average' | 'weak';
  leagueAvg: number;
  leagueStdDev: number;
}

interface TeamComparison {
  teamKey: string;
  teamName: string;
  isUser: boolean;
  archetype: string;
  categoryRanks: CategoryRank[];
}

interface ComparisonData {
  userTeamKey: string;
  teams: TeamComparison[];
  categories: string[];
}

type ViewMode = 'values' | 'zscores' | 'percentiles';
type SortColumn = 'team' | string;
type SortDirection = 'asc' | 'desc';

interface EnhancedCategoryTableProps {
  leagueKey: string;
}

export function EnhancedCategoryTable({ leagueKey }: EnhancedCategoryTableProps) {
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('values');
  const [sortColumn, setSortColumn] = useState<SortColumn>('team');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    loadComparison();
  }, [leagueKey]);

  async function loadComparison() {
    try {
      setLoading(true);
      setError(null);

      const data = await api.fantasy.getCategoryComparison(leagueKey) as ComparisonData;
      setComparison(data);
    } catch (err: any) {
      console.error('Failed to load category comparison:', err);
      setError(err.message || 'Failed to load category comparison');
    } finally {
      setLoading(false);
    }
  }

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection(column === 'team' ? 'asc' : 'desc');
    }
  }

  function getSortIndicator(column: SortColumn): string {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  }

  function getClassificationColor(classification: string) {
    switch (classification) {
      case 'elite':
        return 'text-green-400 bg-green-400/10';
      case 'strong':
        return 'text-teal-400 bg-teal-400/10';
      case 'average':
        return 'text-yellow-400 bg-yellow-400/10';
      case 'weak':
        return 'text-red-400 bg-red-400/10';
      default:
        return 'text-gray-400 bg-gray-400/10';
    }
  }

  function getCellBgStyle(percentile: number): React.CSSProperties {
    // Scale intensity based on percentile deviation from 50
    const deviation = percentile - 50;
    const maxDeviation = 50;
    const minOpacity = 0.05;
    const maxOpacity = 0.35;
    const scaledIntensity = Math.min(Math.abs(deviation) / maxDeviation, 1);
    const opacity = minOpacity + scaledIntensity * (maxOpacity - minOpacity);

    if (deviation >= 0) {
      // Teal for above average
      return { backgroundColor: `rgba(0, 212, 170, ${opacity})` };
    } else {
      // Red for below average
      return { backgroundColor: `rgba(239, 68, 68, ${opacity})` };
    }
  }

  function formatCellValue(cat: CategoryRank): string {
    switch (viewMode) {
      case 'zscores':
        return `${cat.zScore >= 0 ? '+' : ''}${cat.zScore.toFixed(2)}`;
      case 'percentiles':
        return `${cat.percentile.toFixed(0)}%`;
      default:
        return cat.value.toFixed(1);
    }
  }

  function getCellTextColor(cat: CategoryRank): string {
    if (viewMode === 'zscores') {
      return cat.zScore >= 0 ? 'text-green-400' : 'text-red-400';
    }
    if (viewMode === 'percentiles') {
      if (cat.percentile >= 75) return 'text-green-400';
      if (cat.percentile >= 50) return 'text-teal-400';
      if (cat.percentile >= 25) return 'text-yellow-400';
      return 'text-red-400';
    }
    return 'text-gray-100';
  }

  // Sort teams
  const sortedTeams = useMemo(() => {
    if (!comparison) return [];

    const sorted = [...comparison.teams];

    sorted.sort((a, b) => {
      let cmp = 0;

      if (sortColumn === 'team') {
        cmp = a.teamName.localeCompare(b.teamName);
      } else {
        const aCat = a.categoryRanks.find((c) => c.statId === sortColumn);
        const bCat = b.categoryRanks.find((c) => c.statId === sortColumn);

        if (!aCat || !bCat) return 0;

        switch (viewMode) {
          case 'zscores':
            cmp = aCat.zScore - bCat.zScore;
            break;
          case 'percentiles':
            cmp = aCat.percentile - bCat.percentile;
            break;
          default:
            cmp = aCat.value - bCat.value;
        }
      }

      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [comparison, sortColumn, sortDirection, viewMode]);

  // Get unique categories for header
  const categories = useMemo(() => {
    if (!comparison || comparison.teams.length === 0) return [];
    return comparison.teams[0].categoryRanks;
  }, [comparison]);

  if (loading) {
    return (
      <div className="py-8" data-testid="enhanced-table-loading">
        <LoadingSpinner message="Loading category analysis..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-400" data-testid="enhanced-table-error">
        {error}
      </div>
    );
  }

  if (!comparison || comparison.teams.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="enhanced-table-empty">
        No category data available
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="enhanced-category-table">
      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-hawk-orange" />
          <span className="text-sm text-gray-300">League Category Analysis</span>
        </div>

        <div className="flex gap-1 bg-court-base rounded-lg p-1" data-testid="view-toggle">
          <button
            onClick={() => setViewMode('values')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors ${
              viewMode === 'values'
                ? 'bg-hawk-orange text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            data-testid="view-values"
          >
            <Table2 className="w-3 h-3" />
            Values
          </button>
          <button
            onClick={() => setViewMode('zscores')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors ${
              viewMode === 'zscores'
                ? 'bg-hawk-orange text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            data-testid="view-zscores"
          >
            <BarChart3 className="w-3 h-3" />
            Z-Scores
          </button>
          <button
            onClick={() => setViewMode('percentiles')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors ${
              viewMode === 'percentiles'
                ? 'bg-hawk-orange text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            data-testid="view-percentiles"
          >
            %ile
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th
                className="table-header sticky left-0 bg-court-elevated z-10 cursor-pointer hover:bg-white/10 select-none"
                onClick={() => handleSort('team')}
              >
                Team{getSortIndicator('team')}
              </th>
              {categories.map((cat) => (
                <th
                  key={cat.statId}
                  className="table-header text-center min-w-[80px] cursor-pointer hover:bg-white/10 select-none"
                  onClick={() => handleSort(cat.statId)}
                >
                  {cat.displayName}{getSortIndicator(cat.statId)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sortedTeams.map((team) => (
              <tr
                key={team.teamKey}
                className={`table-row ${team.isUser ? 'bg-hawk-orange/10' : ''}`}
                data-testid={team.isUser ? 'user-team-row' : undefined}
              >
                <td className={`table-cell whitespace-nowrap font-medium sticky left-0 z-10 ${
                  team.isUser ? 'bg-hawk-orange/10 text-hawk-orange' : 'bg-court-elevated text-gray-100'
                }`}>
                  <div className="flex items-center gap-2">
                    <span>{team.teamName}</span>
                    {team.isUser && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-hawk-orange/20 text-hawk-orange">
                        You
                      </span>
                    )}
                  </div>
                  {team.archetype && (
                    <div className="text-xs text-gray-500 mt-0.5">{team.archetype}</div>
                  )}
                </td>
                {team.categoryRanks.map((cat) => (
                  <td
                    key={cat.statId}
                    className="px-3 py-2 text-center"
                    style={getCellBgStyle(cat.percentile)}
                  >
                    <div className={`font-mono font-medium ${getCellTextColor(cat)}`}>
                      {formatCellValue(cat)}
                    </div>
                    {viewMode === 'values' && (
                      <>
                        <div className="text-xs text-gray-500">#{cat.rank}</div>
                        <span
                          className={`text-xs px-1 py-0.5 rounded ${getClassificationColor(cat.classification)}`}
                        >
                          {cat.classification}
                        </span>
                      </>
                    )}
                    {viewMode === 'zscores' && (
                      <div className="text-xs text-gray-500">#{cat.rank}</div>
                    )}
                    {viewMode === 'percentiles' && (
                      <span
                        className={`text-xs px-1 py-0.5 rounded ${getClassificationColor(cat.classification)}`}
                      >
                        {cat.classification}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-400/30"></div>
          <span>Elite</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-teal-400/30"></div>
          <span>Strong</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-yellow-400/30"></div>
          <span>Average</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-400/30"></div>
          <span>Weak</span>
        </div>
      </div>
    </div>
  );
}
