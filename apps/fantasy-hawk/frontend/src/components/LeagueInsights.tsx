import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { SettingsBreakdown } from './league/SettingsBreakdown';
import { CustomRankings } from './league/CustomRankings';
import { BarChart3, TrendingUp, Lightbulb, ListOrdered } from 'lucide-react';

interface LeagueInsightsProps {
  selectedLeague: string | null;
}

interface LeagueCategory {
  statId: string;
  name: string;
  displayName: string;
  abbr?: string;
}

interface SettingsInsight {
  type: 'missing' | 'unusual' | 'alternative';
  category: string;
  description: string;
  impact: string;
}

interface LeagueSettingsSummary {
  leagueType: string;
  numTeams: number;
  categories: LeagueCategory[];
  isStandard: boolean;
  insights: SettingsInsight[];
  missingStandard: string[];
  unusualCategories: string[];
}

interface CategoryImportance {
  statId: string;
  name: string;
  displayName: string;
  scarcity: number;
  volatility: number;
  streamability: number;
  importance: 'high' | 'medium' | 'low';
}

interface PositionalValue {
  position: string;
  valueAdjustment: number;
  reason: string;
}

interface LeagueAnalysis {
  categoryImportance: CategoryImportance[];
  positionalValue: PositionalValue[];
  exploitableEdges: string[];
  recommendation: string;
}

interface InsightsData {
  settings: LeagueSettingsSummary;
  analysis: LeagueAnalysis;
  leagueName?: string;
}

export function LeagueInsights({ selectedLeague }: LeagueInsightsProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InsightsData | null>(null);
  const [activeTab, setActiveTab] = useState<'settings' | 'analysis' | 'rankings'>('settings');

  useEffect(() => {
    if (selectedLeague) {
      loadInsights();
    }
  }, [selectedLeague]);

  async function loadInsights() {
    if (!selectedLeague) return;

    try {
      setLoading(true);
      setError(null);

      const [settingsResponse, analysisResponse] = await Promise.all([
        api.fantasy.getLeagueInsightsSettings(selectedLeague),
        api.fantasy.getLeagueInsightsAnalysis(selectedLeague),
      ]) as [{ settings: LeagueSettingsSummary; leagueName?: string }, { settings: LeagueSettingsSummary; analysis: LeagueAnalysis }];

      setData({
        settings: settingsResponse.settings,
        analysis: analysisResponse.analysis,
        leagueName: settingsResponse.leagueName,
      });
    } catch (err: any) {
      console.error('Failed to load league insights:', err);
      setError(err.message || 'Failed to load league insights');
    } finally {
      setLoading(false);
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="insights-no-league">
        <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Select a league to view insights</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Analyzing league settings..." />;
  }

  if (error) {
    return (
      <div className="card text-center py-12" data-testid="insights-error">
        <p className="text-red-400">{error}</p>
        <button
          onClick={loadInsights}
          className="mt-4 px-4 py-2 bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card text-center py-12" data-testid="insights-empty">
        <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">No insights data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="league-insights-page">
      {/* Page Header */}
      <div>
        <h2 className="font-display text-2xl text-gray-100 flex items-center gap-3">
          <BarChart3 className="w-7 h-7 text-hawk-teal" />
          League Insights
        </h2>
        <p className="text-gray-400 mt-1">
          Understand your league's unique settings and how they affect strategy
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-t-lg transition-colors ${
            activeTab === 'settings'
              ? 'bg-court-base text-gray-100 border-b-2 border-hawk-teal'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          League Settings
        </button>
        <button
          onClick={() => setActiveTab('analysis')}
          className={`px-4 py-2 rounded-t-lg transition-colors ${
            activeTab === 'analysis'
              ? 'bg-court-base text-gray-100 border-b-2 border-hawk-teal'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Strategy Analysis
        </button>
        <button
          onClick={() => setActiveTab('rankings')}
          className={`px-4 py-2 rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'rankings'
              ? 'bg-court-base text-gray-100 border-b-2 border-hawk-teal'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          Custom Rankings
        </button>
      </div>

      {/* Settings Tab Content */}
      {activeTab === 'settings' && (
        <SettingsBreakdown settings={data.settings} leagueName={data.leagueName} />
      )}

      {/* Analysis Tab Content */}
      {activeTab === 'analysis' && (
        <div className="space-y-6">
          {/* Recommendation Banner */}
          {data.analysis.recommendation && (
            <div className="card bg-hawk-indigo/10 border border-hawk-indigo/30" data-testid="league-recommendation">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-6 h-6 text-hawk-indigo flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-gray-100 mb-1">Strategy Recommendation</h4>
                  <p className="text-gray-300">{data.analysis.recommendation}</p>
                </div>
              </div>
            </div>
          )}

          {/* Category Importance */}
          <div className="card" data-testid="category-importance">
            <h3 className="font-semibold text-gray-100 mb-4">Category Importance</h3>
            <div className="space-y-3">
              {data.analysis.categoryImportance.map((cat) => (
                <div key={cat.statId} className="flex items-center gap-4">
                  <div className="w-24 text-gray-300">{cat.displayName}</div>
                  <div className="flex-1">
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-hawk-teal rounded-full"
                          style={{ width: `${cat.scarcity}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-20">Scarcity: {cat.scarcity}%</span>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    cat.importance === 'high'
                      ? 'bg-red-500/20 text-red-400'
                      : cat.importance === 'medium'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {cat.importance}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Positional Value */}
          <div className="card" data-testid="positional-value">
            <h3 className="font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-hawk-teal" />
              Positional Value Adjustments
            </h3>
            <div className="grid md:grid-cols-5 gap-4">
              {data.analysis.positionalValue.map((pos) => (
                <div
                  key={pos.position}
                  className={`p-4 rounded-lg text-center ${
                    pos.valueAdjustment > 0
                      ? 'bg-green-500/10 border border-green-500/30'
                      : pos.valueAdjustment < 0
                        ? 'bg-red-500/10 border border-red-500/30'
                        : 'bg-gray-500/10 border border-gray-500/30'
                  }`}
                >
                  <div className="text-2xl font-bold text-gray-100">{pos.position}</div>
                  <div className={`text-lg font-semibold ${
                    pos.valueAdjustment > 0
                      ? 'text-green-400'
                      : pos.valueAdjustment < 0
                        ? 'text-red-400'
                        : 'text-gray-400'
                  }`}>
                    {pos.valueAdjustment > 0 ? '+' : ''}{pos.valueAdjustment}%
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{pos.reason}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Exploitable Edges */}
          {data.analysis.exploitableEdges.length > 0 && (
            <div className="card" data-testid="exploitable-edges">
              <h3 className="font-semibold text-gray-100 mb-4">Exploitable Edges</h3>
              <ul className="space-y-2">
                {data.analysis.exploitableEdges.map((edge, index) => (
                  <li key={index} className="flex items-start gap-2 text-gray-300">
                    <span className="text-hawk-teal mt-1">•</span>
                    {edge}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Rankings Tab Content */}
      {activeTab === 'rankings' && selectedLeague && (
        <CustomRankings selectedLeague={selectedLeague} />
      )}

      {/* Refresh Button */}
      <div className="text-center">
        <button
          onClick={loadInsights}
          className="text-sm text-gray-400 hover:text-gray-200 underline"
        >
          Refresh Insights
        </button>
      </div>
    </div>
  );
}
