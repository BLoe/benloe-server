import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronDown } from 'lucide-react';
import { api } from '../../services/api';
import { LoadingSpinner } from '../LoadingSpinner';

interface WeeklyDataPoint {
  week: number;
  value: number;
  rank: number;
  leagueAvg: number;
}

interface CategoryTrend {
  statId: string;
  name: string;
  abbr: string;
  weeklyData: WeeklyDataPoint[];
  trend: 'improving' | 'declining' | 'stable';
  rankChange: number;
  latestRank: number;
  latestValue: number;
}

interface TrendsData {
  userTeamKey: string;
  currentWeek: number;
  weeksAnalyzed: number[];
  trends: CategoryTrend[];
  totalTeams: number;
}

interface TrendChartsProps {
  leagueKey: string;
}

// Color palette for multiple lines
const LINE_COLORS = [
  '#f97316', // orange
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#eab308', // yellow
  '#ef4444', // red
  '#6366f1', // indigo
];

export function TrendCharts({ leagueKey }: TrendChartsProps) {
  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [numWeeks, setNumWeeks] = useState<number>(4);
  const [showRanks, setShowRanks] = useState(true);

  useEffect(() => {
    loadTrends();
  }, [leagueKey, numWeeks]);

  async function loadTrends() {
    try {
      setLoading(true);
      setError(null);

      const data = await api.fantasy.getCategoryTrends(leagueKey, numWeeks) as TrendsData;
      setTrendsData(data);
    } catch (err: any) {
      console.error('Failed to load category trends:', err);
      setError(err.message || 'Failed to load category trends');
    } finally {
      setLoading(false);
    }
  }

  function getTrendIcon(trend: string) {
    switch (trend) {
      case 'improving':
        return <TrendingUp className="w-4 h-4 text-green-400" />;
      case 'declining':
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  }

  function getTrendColor(trend: string) {
    switch (trend) {
      case 'improving':
        return 'text-green-400';
      case 'declining':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  }

  // Build chart data based on selection
  const chartData = useMemo(() => {
    if (!trendsData) return [];

    const weeksAnalyzed = trendsData.weeksAnalyzed;

    return weeksAnalyzed.map((week) => {
      const point: Record<string, any> = { week: `Week ${week}` };

      for (const cat of trendsData.trends) {
        if (selectedCategory !== 'all' && cat.statId !== selectedCategory) continue;

        const weekData = cat.weeklyData.find((d) => d.week === week);
        if (weekData) {
          if (showRanks) {
            point[cat.abbr] = weekData.rank;
          } else {
            point[cat.abbr] = weekData.value;
          }
          point[`${cat.abbr}_leagueAvg`] = weekData.leagueAvg;
        }
      }

      return point;
    });
  }, [trendsData, selectedCategory, showRanks]);

  // Get categories to display
  const displayCategories = useMemo(() => {
    if (!trendsData) return [];
    if (selectedCategory === 'all') return trendsData.trends;
    return trendsData.trends.filter((t) => t.statId === selectedCategory);
  }, [trendsData, selectedCategory]);

  if (loading) {
    return (
      <div className="py-8" data-testid="trends-loading">
        <LoadingSpinner message="Analyzing trends..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-400" data-testid="trends-error">
        {error}
      </div>
    );
  }

  if (!trendsData || trendsData.trends.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="trends-empty">
        No trend data available
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="trend-charts">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Category Selector */}
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="select text-sm pr-8 appearance-none"
              data-testid="category-selector"
            >
              <option value="all">All Categories</option>
              {trendsData.trends.map((cat) => (
                <option key={cat.statId} value={cat.statId}>
                  {cat.abbr}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Weeks Selector */}
          <div className="flex gap-1 bg-court-base rounded-lg p-1">
            {[4, 6, 8].map((w) => (
              <button
                key={w}
                onClick={() => setNumWeeks(w)}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  numWeeks === w
                    ? 'bg-hawk-orange text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                data-testid={`weeks-${w}`}
              >
                {w} Weeks
              </button>
            ))}
          </div>
        </div>

        {/* Value/Rank Toggle */}
        <div className="flex gap-1 bg-court-base rounded-lg p-1">
          <button
            onClick={() => setShowRanks(true)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              showRanks
                ? 'bg-hawk-orange text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            data-testid="show-ranks"
          >
            Ranks
          </button>
          <button
            onClick={() => setShowRanks(false)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              !showRanks
                ? 'bg-hawk-orange text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            data-testid="show-values"
          >
            Values
          </button>
        </div>
      </div>

      {/* Main Chart */}
      <div className="bg-court-surface rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-300 mb-4">
          {selectedCategory === 'all' ? 'Category Performance Over Time' : `${displayCategories[0]?.name} Trend`}
        </h4>
        <div className="h-[300px]" data-testid="trend-line-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="week"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                axisLine={{ stroke: '#4b5563' }}
              />
              <YAxis
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                axisLine={{ stroke: '#4b5563' }}
                reversed={showRanks}
                domain={showRanks ? [1, trendsData.totalTeams] : ['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#f3f4f6' }}
              />
              <Legend
                wrapperStyle={{ paddingTop: '10px' }}
              />
              {displayCategories.map((cat, index) => (
                <Line
                  key={cat.statId}
                  type="monotone"
                  dataKey={cat.abbr}
                  name={cat.abbr}
                  stroke={LINE_COLORS[index % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
              {selectedCategory !== 'all' && !showRanks && (
                <Line
                  type="monotone"
                  dataKey={`${displayCategories[0]?.abbr}_leagueAvg`}
                  name="League Avg"
                  stroke="#6b7280"
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trend Summary Cards */}
      <div className="bg-court-surface rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-300 mb-4">Trend Summary</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {trendsData.trends.map((cat) => (
            <div
              key={cat.statId}
              className={`p-3 rounded-lg bg-court-base ${
                selectedCategory === cat.statId ? 'ring-2 ring-hawk-orange' : ''
              } cursor-pointer hover:bg-white/5 transition-colors`}
              onClick={() => setSelectedCategory(selectedCategory === cat.statId ? 'all' : cat.statId)}
              data-testid={`trend-card-${cat.abbr.toLowerCase()}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-100">{cat.abbr}</span>
                {getTrendIcon(cat.trend)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-mono text-gray-200">#{cat.latestRank}</span>
                <span className={`text-xs ${getTrendColor(cat.trend)}`}>
                  {cat.rankChange > 0 ? '+' : ''}{cat.rankChange}
                </span>
              </div>
              <div className={`text-xs mt-1 capitalize ${getTrendColor(cat.trend)}`}>
                {cat.trend}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Improving/Declining Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Improving */}
        <div className="bg-court-surface rounded-lg p-4" data-testid="improving-categories">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <h4 className="text-sm font-medium text-gray-300">Improving Categories</h4>
          </div>
          <div className="space-y-2">
            {trendsData.trends
              .filter((t) => t.trend === 'improving')
              .sort((a, b) => b.rankChange - a.rankChange)
              .map((cat) => (
                <div
                  key={cat.statId}
                  className="flex items-center justify-between p-2 bg-court-base rounded"
                >
                  <span className="text-sm text-gray-100">{cat.abbr}</span>
                  <span className="text-sm text-green-400">
                    +{cat.rankChange} ranks
                  </span>
                </div>
              ))}
            {trendsData.trends.filter((t) => t.trend === 'improving').length === 0 && (
              <p className="text-sm text-gray-500">No improving categories</p>
            )}
          </div>
        </div>

        {/* Declining */}
        <div className="bg-court-surface rounded-lg p-4" data-testid="declining-categories">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <h4 className="text-sm font-medium text-gray-300">Declining Categories</h4>
          </div>
          <div className="space-y-2">
            {trendsData.trends
              .filter((t) => t.trend === 'declining')
              .sort((a, b) => a.rankChange - b.rankChange)
              .map((cat) => (
                <div
                  key={cat.statId}
                  className="flex items-center justify-between p-2 bg-court-base rounded"
                >
                  <span className="text-sm text-gray-100">{cat.abbr}</span>
                  <span className="text-sm text-red-400">
                    {cat.rankChange} ranks
                  </span>
                </div>
              ))}
            {trendsData.trends.filter((t) => t.trend === 'declining').length === 0 && (
              <p className="text-sm text-gray-500">No declining categories</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
