import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { StandingsChart } from './StandingsChart';
import { CategoryStatsTable } from './CategoryStatsTable';
import { StrategyCorner } from './StrategyCorner';
import { DebugPanel } from './DebugPanel';

interface DashboardProps {
  selectedLeague: string | null;
}

type TabType = 'standings' | 'categories' | 'strategy' | 'debug';
type TimespanType = 'thisWeek' | 'last3Weeks' | 'season';

export function Dashboard({ selectedLeague }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [standings, setStandings] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabType>('standings');

  // Category stats state
  const [timespan, setTimespan] = useState<TimespanType>('thisWeek');
  const [categoryStatsData, setCategoryStatsData] = useState<any>(null);
  const [categoryStatsLoading, setCategoryStatsLoading] = useState(false);

  useEffect(() => {
    if (selectedLeague) {
      loadLeagueData(selectedLeague);
    }
  }, [selectedLeague]);

  // Load category stats when tab or timespan changes
  useEffect(() => {
    if (selectedLeague && activeTab === 'categories' && settings) {
      loadCategoryStats(selectedLeague, timespan);
    }
  }, [selectedLeague, activeTab, timespan, settings]);

  async function loadLeagueData(leagueKey: string) {
    try {
      setLoading(true);
      setError(null);

      const [standingsData, settingsData] = await Promise.all([
        api.fantasy.getStandings(leagueKey),
        api.fantasy.getLeagueSettings(leagueKey),
      ]);

      const standingsList = parseStandingsFromResponse(standingsData);
      setStandings(standingsList);

      const parsedSettings = parseSettingsFromResponse(settingsData);
      setSettings(parsedSettings);
    } catch (err: any) {
      console.error('Failed to load league data:', err);
      setError(err.message || 'Failed to load league data');
    } finally {
      setLoading(false);
    }
  }

  async function loadCategoryStats(leagueKey: string, selectedTimespan: TimespanType) {
    try {
      setCategoryStatsLoading(true);
      const data = await api.fantasy.getCategoryStats(leagueKey, selectedTimespan);
      console.log('Category stats data:', data);
      setCategoryStatsData(data);
    } catch (err: any) {
      console.error('Failed to load category stats:', err);
    } finally {
      setCategoryStatsLoading(false);
    }
  }

  // Helper to merge Yahoo's array-of-objects format into single object
  function mergeYahooTeamData(teamArray: any[]): any {
    if (!Array.isArray(teamArray) || teamArray.length === 0) return null;

    const propsArray = teamArray[0];
    if (!Array.isArray(propsArray)) return null;

    const merged: any = {};
    propsArray.forEach((obj: any) => {
      if (obj && typeof obj === 'object') {
        Object.assign(merged, obj);
      }
    });

    if (teamArray.length > 2 && teamArray[2]?.team_standings) {
      merged.team_standings = teamArray[2].team_standings;
    }

    if (teamArray.length > 1 && teamArray[1]?.team_stats) {
      merged.team_stats = teamArray[1].team_stats;
    }

    return merged;
  }

  // Helper to parse standings from response
  function parseStandingsFromResponse(data: any): any[] {
    try {
      const content = data?.fantasy_content;
      if (!content) return [];

      const league = content.league;
      if (!Array.isArray(league) || league.length < 2) return [];

      const standingsData = league[1].standings;
      if (!standingsData) return [];

      const teamsData = standingsData['0'].teams;
      if (!teamsData) return [];

      const count = teamsData.count || 0;
      const standings: any[] = [];

      for (let i = 0; i < count; i++) {
        if (teamsData[i] && teamsData[i].team) {
          const teamArray = teamsData[i].team;
          const merged = mergeYahooTeamData(teamArray);
          if (merged) {
            standings.push(merged);
          }
        }
      }

      return standings;
    } catch (err) {
      console.error('Error parsing standings:', err);
      return [];
    }
  }

  // Helper to parse settings/categories from response
  function parseSettingsFromResponse(data: any): any {
    try {
      const content = data?.fantasy_content;
      if (!content) return null;

      const league = content.league;
      if (!Array.isArray(league) || league.length < 2) return null;

      const settings = league[1].settings;
      if (!settings || !Array.isArray(settings) || settings.length === 0) return null;

      return settings[0];
    } catch (err) {
      console.error('Error parsing settings:', err);
      return null;
    }
  }

  // Extract stat categories from settings
  function getStatCategories(): any[] {
    if (!settings?.stat_categories?.stats) return [];

    const stats = settings.stat_categories.stats;

    // stats is a regular array of { stat: {...} } objects
    return stats.map((s: any) => s.stat).filter((stat: any) => stat);
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-600">Select a league to view data</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Loading league data..." />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'standings', label: 'League Standings' },
    { id: 'categories', label: 'Categories' },
    { id: 'strategy', label: 'Strategy Corner' },
    { id: 'debug', label: 'Debug' },
  ];

  const categories = getStatCategories();

  // Build dynamic timespan labels with week numbers
  const currentWeek = categoryStatsData?.currentWeek;
  const weeksIncluded = categoryStatsData?.weeksIncluded || [];

  const getTimespanLabel = (value: TimespanType): string => {
    switch (value) {
      case 'thisWeek':
        return currentWeek ? `This Week (${currentWeek})` : 'This Week';
      case 'last3Weeks':
        if (weeksIncluded.length > 0 && timespan === 'last3Weeks') {
          const start = Math.min(...weeksIncluded);
          const end = Math.max(...weeksIncluded);
          return `Last 3 Weeks (${start}-${end})`;
        }
        // Estimate based on current week
        if (currentWeek) {
          const start = Math.max(1, currentWeek - 2);
          return `Last 3 Weeks (${start}-${currentWeek})`;
        }
        return 'Last 3 Weeks';
      case 'season':
        return 'Season';
      default:
        return value;
    }
  };

  const timespanOptions: { value: TimespanType; label: string }[] = [
    { value: 'thisWeek', label: getTimespanLabel('thisWeek') },
    { value: 'last3Weeks', label: getTimespanLabel('last3Weeks') },
    { value: 'season', label: 'Season' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'standings' && (
        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 mb-6">League Standings</h2>
          {standings.length > 0 ? (
            <StandingsChart standings={standings} />
          ) : (
            <p className="text-gray-600">No standings data available</p>
          )}
        </div>
      )}

      {activeTab === 'categories' && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Category Stats</h2>
            <select
              value={timespan}
              onChange={(e) => setTimespan(e.target.value as TimespanType)}
              className="text-sm border-gray-300 rounded-md shadow-sm focus:border-primary-500 focus:ring-primary-500 py-2 pl-3 pr-8"
            >
              {timespanOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {categoryStatsLoading ? (
            <LoadingSpinner message="Loading category stats..." />
          ) : categoryStatsData && categories.length > 0 ? (
            <CategoryStatsTable
              categoryStatsData={categoryStatsData}
              categories={categories}
              timespan={timespan}
            />
          ) : (
            <p className="text-gray-600">No category stats available</p>
          )}
        </div>
      )}

      {activeTab === 'strategy' && <StrategyCorner selectedLeague={selectedLeague} />}

      {activeTab === 'debug' && <DebugPanel selectedLeague={selectedLeague} />}
    </div>
  );
}
