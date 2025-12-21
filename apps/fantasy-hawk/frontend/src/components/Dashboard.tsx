import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { StandingsChart } from './StandingsChart';
import { CategoryStatsTable } from './CategoryStatsTable';

interface DashboardProps {
  selectedLeague: string | null;
}

type TabType = 'standings' | 'categories';
type TimespanType = 'thisWeek' | 'last3Weeks' | 'season';

export function Dashboard({ selectedLeague }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [standings, setStandings] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [rawSettingsData, setRawSettingsData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabType>('standings');
  const [showDebug, setShowDebug] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dumpStatus, setDumpStatus] = useState<string | null>(null);

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

      console.log('Standings data:', standingsData);
      console.log('Settings data:', settingsData);

      const standingsList = parseStandingsFromResponse(standingsData);
      setStandings(standingsList);

      // Store raw data for debugging
      setRawSettingsData(settingsData);

      const parsedSettings = parseSettingsFromResponse(settingsData);
      console.log('Parsed settings:', parsedSettings);
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

  async function copyToClipboard(data: any) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  async function dumpToServer(type: string, week?: number) {
    if (!selectedLeague) return;
    try {
      setDumpStatus(`Dumping ${type}...`);
      const result = (await api.fantasy.dump(type, selectedLeague, week)) as { file: string };
      setDumpStatus(`Saved to: ${result.file}`);
      setTimeout(() => setDumpStatus(null), 5000);
    } catch (err: any) {
      setDumpStatus(`Error: ${err.message}`);
    }
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
  ];

  const categories = getStatCategories();

  const timespanOptions: { value: TimespanType; label: string }[] = [
    { value: 'thisWeek', label: 'This Week' },
    { value: 'last3Weeks', label: 'Last 3 Weeks' },
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

          {/* Debug Section */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center gap-4 flex-wrap">
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-2"
              >
                <span>{showDebug ? '[-]' : '[+]'}</span>
                Debug: Raw API Response
              </button>

              <button
                onClick={() => dumpToServer('settings')}
                className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded border border-blue-300 transition-colors"
              >
                Dump Settings
              </button>
              <button
                onClick={() => dumpToServer('standings')}
                className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded border border-blue-300 transition-colors"
              >
                Dump Standings
              </button>
              <button
                onClick={() => dumpToServer('scoreboard')}
                className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded border border-blue-300 transition-colors"
              >
                Dump Scoreboard (Current Week)
              </button>

              {dumpStatus && <span className="text-sm text-green-600">{dumpStatus}</span>}
            </div>

            {showDebug && rawSettingsData && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    Raw Settings Response from Yahoo API
                  </span>
                  <button
                    onClick={() => copyToClipboard(rawSettingsData)}
                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
                  >
                    {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                </div>
                <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto">
                  {JSON.stringify(rawSettingsData, null, 2)}
                </pre>
              </div>
            )}

            {showDebug && categoryStatsData && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    Category Stats Data ({timespan})
                  </span>
                  <button
                    onClick={() => copyToClipboard(categoryStatsData)}
                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
                  >
                    {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                </div>
                <pre className="bg-gray-800 text-blue-400 p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto">
                  {JSON.stringify(categoryStatsData, null, 2)}
                </pre>
              </div>
            )}

            {showDebug && !rawSettingsData && (
              <p className="mt-4 text-sm text-gray-500">No raw data available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
