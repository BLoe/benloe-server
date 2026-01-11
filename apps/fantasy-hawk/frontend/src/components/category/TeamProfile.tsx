import { useState, useEffect } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { TrendingUp, TrendingDown, Target, Award } from 'lucide-react';
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

interface TeamProfileData {
  teamKey: string;
  teamName: string;
  archetype: string;
  puntCategories: string[];
  categoryRanks: CategoryRank[];
  strengths: CategoryRank[];
  weaknesses: CategoryRank[];
}

interface TeamProfileProps {
  leagueKey: string;
}

export function TeamProfile({ leagueKey }: TeamProfileProps) {
  const [profile, setProfile] = useState<TeamProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
  }, [leagueKey]);

  async function loadProfile() {
    try {
      setLoading(true);
      setError(null);

      const data = await api.fantasy.getCategoryProfile(leagueKey) as TeamProfileData;
      setProfile(data);
    } catch (err: any) {
      console.error('Failed to load team profile:', err);
      setError(err.message || 'Failed to load team profile');
    } finally {
      setLoading(false);
    }
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

  function getPercentileColor(percentile: number) {
    if (percentile >= 75) return '#22c55e'; // green
    if (percentile >= 50) return '#14b8a6'; // teal
    if (percentile >= 25) return '#eab308'; // yellow
    return '#ef4444'; // red
  }

  if (loading) {
    return (
      <div className="py-8" data-testid="profile-loading">
        <LoadingSpinner message="Analyzing your team..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-400" data-testid="profile-error">
        {error}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="profile-empty">
        No profile data available
      </div>
    );
  }

  // Prepare radar chart data - scale percentiles for visualization
  const radarData = profile.categoryRanks.map((cat) => ({
    category: cat.displayName,
    percentile: cat.percentile,
    fullMark: 100,
  }));

  return (
    <div className="space-y-6" data-testid="team-profile">
      {/* Team Identity Card */}
      <div className="bg-court-surface rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-100">{profile.teamName}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Award className="w-4 h-4 text-hawk-orange" />
              <span className="text-hawk-orange font-medium">{profile.archetype}</span>
            </div>
          </div>
          {profile.puntCategories.length > 0 && (
            <div className="text-right">
              <span className="text-xs text-gray-500 block mb-1">Punt Categories</span>
              <div className="flex gap-1 flex-wrap justify-end">
                {profile.puntCategories.map((cat) => (
                  <span
                    key={cat}
                    className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Radar Chart */}
      <div className="bg-court-surface rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-300 mb-4">Category Percentiles</h4>
        <div className="h-[300px]" data-testid="profile-radar-chart">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis
                dataKey="category"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickCount={5}
              />
              <Radar
                name="Percentile"
                dataKey="percentile"
                stroke="#f97316"
                fill="#f97316"
                fillOpacity={0.3}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#f3f4f6' }}
                formatter={(value: number) => [`${value.toFixed(0)}%`, 'Percentile']}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Strengths */}
        <div className="bg-court-surface rounded-lg p-4" data-testid="profile-strengths">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <h4 className="text-sm font-medium text-gray-300">Strengths</h4>
          </div>
          <div className="space-y-2">
            {profile.strengths.length === 0 ? (
              <p className="text-sm text-gray-500">No standout strengths</p>
            ) : (
              profile.strengths.map((cat) => (
                <div
                  key={cat.statId}
                  className="flex items-center justify-between p-2 bg-court-base rounded"
                >
                  <div>
                    <span className="text-sm text-gray-100">{cat.displayName}</span>
                    <span
                      className={`ml-2 text-xs px-2 py-0.5 rounded ${getClassificationColor(cat.classification)}`}
                    >
                      {cat.classification}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-mono text-gray-200">
                      #{cat.rank}/{cat.totalTeams}
                    </span>
                    <span
                      className="ml-2 text-xs"
                      style={{ color: getPercentileColor(cat.percentile) }}
                    >
                      {cat.percentile.toFixed(0)}%ile
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Weaknesses */}
        <div className="bg-court-surface rounded-lg p-4" data-testid="profile-weaknesses">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <h4 className="text-sm font-medium text-gray-300">Weaknesses</h4>
          </div>
          <div className="space-y-2">
            {profile.weaknesses.length === 0 ? (
              <p className="text-sm text-gray-500">No significant weaknesses</p>
            ) : (
              profile.weaknesses.map((cat) => (
                <div
                  key={cat.statId}
                  className="flex items-center justify-between p-2 bg-court-base rounded"
                >
                  <div>
                    <span className="text-sm text-gray-100">{cat.displayName}</span>
                    <span
                      className={`ml-2 text-xs px-2 py-0.5 rounded ${getClassificationColor(cat.classification)}`}
                    >
                      {cat.classification}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-mono text-gray-200">
                      #{cat.rank}/{cat.totalTeams}
                    </span>
                    <span
                      className="ml-2 text-xs"
                      style={{ color: getPercentileColor(cat.percentile) }}
                    >
                      {cat.percentile.toFixed(0)}%ile
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Full Category Breakdown */}
      <div className="bg-court-surface rounded-lg p-4" data-testid="profile-categories">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-hawk-indigo" />
          <h4 className="text-sm font-medium text-gray-300">All Categories</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-3 text-gray-400 font-medium">Category</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Value</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Rank</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Z-Score</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Percentile</th>
                <th className="text-center py-2 px-3 text-gray-400 font-medium">Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {profile.categoryRanks.map((cat) => (
                <tr key={cat.statId} className="hover:bg-white/5">
                  <td className="py-2 px-3 text-gray-100">{cat.displayName}</td>
                  <td className="py-2 px-3 text-center font-mono text-gray-200">
                    {cat.value.toFixed(1)}
                  </td>
                  <td className="py-2 px-3 text-center font-mono text-gray-300">
                    #{cat.rank}/{cat.totalTeams}
                  </td>
                  <td
                    className="py-2 px-3 text-center font-mono"
                    style={{ color: cat.zScore >= 0 ? '#22c55e' : '#ef4444' }}
                  >
                    {cat.zScore >= 0 ? '+' : ''}{cat.zScore.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span
                      className="font-mono"
                      style={{ color: getPercentileColor(cat.percentile) }}
                    >
                      {cat.percentile.toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${getClassificationColor(cat.classification)}`}>
                      {cat.classification}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
