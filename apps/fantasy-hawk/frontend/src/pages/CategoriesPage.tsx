import { useState, useEffect } from 'react';
import { useLeagueContext } from '../components/LeagueLayout';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { CategoryStatsTable } from '../components/CategoryStatsTable';
import { TeamProfile, EnhancedCategoryTable, TrendCharts } from '../components/category';
import { api } from '../services/api';

type TimespanType = 'thisWeek' | 'last3Weeks' | 'season';
type CategoryViewType = 'raw' | 'profile' | 'enhanced' | 'trends';

export function CategoriesPage() {
  const { leagueKey, settings } = useLeagueContext();

  const [timespan, setTimespan] = useState<TimespanType>('thisWeek');
  const [categoryStatsData, setCategoryStatsData] = useState<any>(null);
  const [categoryStatsLoading, setCategoryStatsLoading] = useState(false);
  const [categoryView, setCategoryView] = useState<CategoryViewType>('raw');

  // Load category stats when timespan changes
  useEffect(() => {
    if (leagueKey && settings) {
      loadCategoryStats(leagueKey, timespan);
    }
  }, [leagueKey, timespan, settings]);

  async function loadCategoryStats(key: string, selectedTimespan: TimespanType) {
    try {
      setCategoryStatsLoading(true);
      const data = await api.fantasy.getCategoryStats(key, selectedTimespan);
      setCategoryStatsData(data);
    } catch (err: any) {
      console.error('Failed to load category stats:', err);
    } finally {
      setCategoryStatsLoading(false);
    }
  }

  // Extract stat categories from settings
  function getStatCategories(): any[] {
    if (!settings?.stat_categories?.stats) return [];
    const stats = settings.stat_categories.stats;
    return stats.map((s: any) => s.stat).filter((stat: any) => stat);
  }

  const categories = getStatCategories();

  // Build dynamic timespan labels with week numbers
  const currentWeek = categoryStatsData?.currentWeek;
  const weeksIncluded = categoryStatsData?.weeksIncluded || [];

  const getTimespanLabel = (value: TimespanType): string => {
    switch (value) {
      case 'thisWeek':
        return currentWeek ? `Week ${currentWeek}` : 'This Week';
      case 'last3Weeks':
        if (weeksIncluded.length > 0 && timespan === 'last3Weeks') {
          const start = Math.min(...weeksIncluded);
          const end = Math.max(...weeksIncluded);
          return `Weeks ${start}-${end}`;
        }
        if (currentWeek) {
          const start = Math.max(1, currentWeek - 2);
          return `Weeks ${start}-${currentWeek}`;
        }
        return 'Last 3 Weeks';
      case 'season':
        return 'Full Season';
      default:
        return value;
    }
  };

  const timespanOptions: { value: TimespanType; label: string }[] = [
    { value: 'thisWeek', label: getTimespanLabel('thisWeek') },
    { value: 'last3Weeks', label: getTimespanLabel('last3Weeks') },
    { value: 'season', label: 'Full Season' },
  ];

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-gray-100">
            Category Analysis
          </h2>
          <div className="flex items-center gap-4">
            {/* View Toggle */}
            <div className="flex gap-1 bg-court-base rounded-lg p-1" data-testid="category-view-toggle">
              <button
                onClick={() => setCategoryView('profile')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  categoryView === 'profile'
                    ? 'bg-hawk-orange text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                data-testid="category-view-profile"
              >
                My Profile
              </button>
              <button
                onClick={() => setCategoryView('enhanced')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  categoryView === 'enhanced'
                    ? 'bg-hawk-orange text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                data-testid="category-view-enhanced"
              >
                League Table
              </button>
              <button
                onClick={() => setCategoryView('trends')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  categoryView === 'trends'
                    ? 'bg-hawk-orange text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                data-testid="category-view-trends"
              >
                Trends
              </button>
              <button
                onClick={() => setCategoryView('raw')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  categoryView === 'raw'
                    ? 'bg-hawk-orange text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                data-testid="category-view-raw"
              >
                Raw Stats
              </button>
            </div>

            {/* Timespan selector - only for raw view */}
            {categoryView === 'raw' && (
              <select
                value={timespan}
                onChange={(e) => setTimespan(e.target.value as TimespanType)}
                className="select text-sm"
              >
                {timespanOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Profile View */}
      {categoryView === 'profile' && (
        <TeamProfile leagueKey={leagueKey} />
      )}

      {/* Enhanced Table View */}
      {categoryView === 'enhanced' && (
        <div className="card">
          <EnhancedCategoryTable leagueKey={leagueKey} />
        </div>
      )}

      {/* Trends View */}
      {categoryView === 'trends' && (
        <TrendCharts leagueKey={leagueKey} />
      )}

      {/* Raw Stats View */}
      {categoryView === 'raw' && (
        <div className="card">
          {categoryStatsLoading ? (
            <LoadingSpinner message="Loading category stats..." />
          ) : categoryStatsData && categories.length > 0 ? (
            <CategoryStatsTable
              categoryStatsData={categoryStatsData}
              categories={categories}
              timespan={timespan}
            />
          ) : (
            <p className="text-gray-400">No category stats available</p>
          )}
        </div>
      )}
    </div>
  );
}
