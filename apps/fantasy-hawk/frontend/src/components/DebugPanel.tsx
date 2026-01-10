import { useState } from 'react';

interface DebugPanelProps {
  selectedLeague: string | null;
}

interface DumpResult {
  endpoint: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  file?: string;
  error?: string;
  data?: any;
}

const API_BASE = '/api';

// All relevant NBA Fantasy Basketball endpoints
const DUMP_ENDPOINTS = [
  {
    id: 'league',
    label: 'League Metadata',
    description: 'Basic league info (name, season, current week)',
    endpoint: (leagueKey: string) => `/league/${leagueKey}`,
  },
  {
    id: 'settings',
    label: 'League Settings',
    description: 'Stat categories, roster positions, scoring type, playoff config',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/settings`,
  },
  {
    id: 'standings',
    label: 'League Standings',
    description: 'All teams with W/L records, ranks, season stat totals',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/standings`,
  },
  {
    id: 'scoreboard',
    label: 'Scoreboard (Current Week)',
    description: 'This week\'s matchups with category comparisons',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/scoreboard`,
  },
  {
    id: 'scoreboard_week1',
    label: 'Scoreboard (Week 1)',
    description: 'Week 1 matchups for historical comparison',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/scoreboard;week=1`,
  },
  {
    id: 'teams',
    label: 'League Teams',
    description: 'All teams in the league with metadata',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/teams`,
  },
  {
    id: 'teams_roster',
    label: 'Teams with Rosters',
    description: 'All teams with their current rosters',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/teams/roster`,
  },
  {
    id: 'teams_stats',
    label: 'Teams with Stats',
    description: 'All teams with season statistics',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/teams/stats`,
  },
  {
    id: 'players_taken',
    label: 'Rostered Players',
    description: 'Players on rosters (first 25)',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/players;status=T;count=25`,
  },
  {
    id: 'players_fa',
    label: 'Free Agents',
    description: 'Available free agents (first 25)',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/players;status=FA;count=25`,
  },
  {
    id: 'players_waivers',
    label: 'Waiver Wire',
    description: 'Players on waivers (first 25)',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/players;status=W;count=25`,
  },
  {
    id: 'transactions',
    label: 'Recent Transactions',
    description: 'Recent adds, drops, and trades',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/transactions`,
  },
  {
    id: 'draftresults',
    label: 'Draft Results',
    description: 'Complete draft history',
    endpoint: (leagueKey: string) => `/league/${leagueKey}/draftresults`,
  },
  {
    id: 'game_nba',
    label: 'NBA Game Metadata',
    description: 'Current NBA season info and stat categories',
    endpoint: () => `/game/nba`,
  },
  {
    id: 'game_stat_categories',
    label: 'NBA Stat Categories',
    description: 'All available stat categories for NBA',
    endpoint: () => `/game/nba/stat_categories`,
  },
];

// Schedule endpoints (Ball Don't Lie API)
const SCHEDULE_ENDPOINTS = [
  {
    id: 'schedule_status',
    label: 'Schedule API Status',
    description: 'Check if NBA schedule API is configured',
    directEndpoint: '/api/fantasy/schedule/status',
  },
  {
    id: 'league_schedule',
    label: 'This Week\'s NBA Schedule',
    description: 'Games for current fantasy week with team game counts',
    directEndpoint: (leagueKey: string) => `/api/fantasy/leagues/${leagueKey}/schedule`,
  },
  {
    id: 'streaming_analysis',
    label: 'Streaming Analysis',
    description: 'Your roster + free agents with games this week',
    directEndpoint: (leagueKey: string) => `/api/fantasy/leagues/${leagueKey}/streaming`,
  },
];

export function DebugPanel({ selectedLeague }: DebugPanelProps) {
  const [results, setResults] = useState<Record<string, DumpResult>>({});
  const [scheduleResults, setScheduleResults] = useState<Record<string, DumpResult>>({});
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function dumpEndpoint(id: string, yahooEndpoint: string) {
    setResults(prev => ({
      ...prev,
      [id]: { endpoint: yahooEndpoint, status: 'loading' },
    }));

    try {
      const response = await fetch(
        `${API_BASE}/fantasy/debug/dump-raw?endpoint=${encodeURIComponent(yahooEndpoint)}`,
        { credentials: 'include' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      setResults(prev => ({
        ...prev,
        [id]: {
          endpoint: yahooEndpoint,
          status: 'success',
          file: data.file,
          data: data.data,
        },
      }));
    } catch (err: any) {
      setResults(prev => ({
        ...prev,
        [id]: {
          endpoint: yahooEndpoint,
          status: 'error',
          error: err.message,
        },
      }));
    }
  }

  async function dumpAll() {
    if (!selectedLeague) return;

    for (const ep of DUMP_ENDPOINTS) {
      const yahooEndpoint = ep.endpoint(selectedLeague);
      await dumpEndpoint(ep.id, yahooEndpoint);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  async function copyToClipboard(id: string, data: any) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  async function testScheduleEndpoint(id: string, endpoint: string) {
    setScheduleResults(prev => ({
      ...prev,
      [id]: { endpoint, status: 'loading' },
    }));

    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      setScheduleResults(prev => ({
        ...prev,
        [id]: { endpoint, status: 'success', data },
      }));
    } catch (err: any) {
      setScheduleResults(prev => ({
        ...prev,
        [id]: { endpoint, status: 'error', error: err.message },
      }));
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-400">Select a league to access debug tools</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-gray-100">Yahoo API Debug Panel</h2>
            <p className="text-sm text-gray-400 mt-1">
              Dump raw Yahoo API responses to files for analysis. Files are saved to the server.
            </p>
          </div>
          <button
            onClick={dumpAll}
            className="btn-primary"
          >
            Dump All Endpoints
          </button>
        </div>

        <div className="text-xs text-gray-400 mb-4 font-mono bg-court-base p-2 rounded border border-white/10">
          League Key: {selectedLeague}
        </div>

        <div className="space-y-2">
          {DUMP_ENDPOINTS.map(ep => {
            const result = results[ep.id];
            const yahooEndpoint = ep.endpoint(selectedLeague);

            return (
              <div key={ep.id} className="border border-white/10 rounded-lg p-3 bg-court-base">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-100">{ep.label}</span>
                      {result?.status === 'loading' && (
                        <span className="text-xs text-hawk-indigo">Loading...</span>
                      )}
                      {result?.status === 'success' && (
                        <span className="text-xs text-hawk-teal">Done</span>
                      )}
                      {result?.status === 'error' && (
                        <span className="text-xs text-hawk-red">Error</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{ep.description}</p>
                    <code className="text-xs text-gray-500 block mt-1 truncate">
                      {yahooEndpoint}
                    </code>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {result?.data && (
                      <>
                        <button
                          onClick={() => setExpandedResult(expandedResult === ep.id ? null : ep.id)}
                          className="btn-secondary text-xs py-1 px-2"
                        >
                          {expandedResult === ep.id ? 'Hide' : 'View'}
                        </button>
                        <button
                          onClick={() => copyToClipboard(ep.id, result.data)}
                          className="btn-secondary text-xs py-1 px-2"
                        >
                          {copied === ep.id ? 'Copied!' : 'Copy'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => dumpEndpoint(ep.id, yahooEndpoint)}
                      disabled={result?.status === 'loading'}
                      className="px-3 py-1 text-xs bg-hawk-indigo/20 hover:bg-hawk-indigo/30 text-hawk-indigo rounded border border-hawk-indigo/30 transition-colors disabled:opacity-50"
                    >
                      Dump
                    </button>
                  </div>
                </div>

                {result?.status === 'error' && (
                  <div className="mt-2 text-xs text-hawk-red bg-hawk-red/10 p-2 rounded border border-hawk-red/20">
                    {result.error}
                  </div>
                )}

                {result?.file && (
                  <div className="mt-2 text-xs text-hawk-teal bg-hawk-teal/10 p-2 rounded font-mono border border-hawk-teal/20">
                    Saved: {result.file}
                  </div>
                )}

                {expandedResult === ep.id && result?.data && (
                  <div className="mt-3">
                    <pre className="bg-court-deep text-hawk-teal p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto border border-white/10">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* NBA Schedule Section */}
      <div className="card">
        <div className="mb-4">
          <h2 className="font-display text-xl font-semibold text-gray-100">NBA Schedule (Ball Don't Lie API)</h2>
          <p className="text-sm text-gray-400 mt-1">
            Real NBA game schedule data for streaming analysis.
          </p>
        </div>

        <div className="space-y-2">
          {SCHEDULE_ENDPOINTS.map(ep => {
            const result = scheduleResults[ep.id];
            const endpoint = typeof ep.directEndpoint === 'function'
              ? ep.directEndpoint(selectedLeague)
              : ep.directEndpoint;

            return (
              <div key={ep.id} className="border border-white/10 rounded-lg p-3 bg-court-base">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-100">{ep.label}</span>
                      {result?.status === 'loading' && (
                        <span className="text-xs text-hawk-indigo">Loading...</span>
                      )}
                      {result?.status === 'success' && (
                        <span className="text-xs text-hawk-teal">Done</span>
                      )}
                      {result?.status === 'error' && (
                        <span className="text-xs text-hawk-red">Error</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{ep.description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {result?.data && (
                      <>
                        <button
                          onClick={() => setExpandedResult(expandedResult === ep.id ? null : ep.id)}
                          className="btn-secondary text-xs py-1 px-2"
                        >
                          {expandedResult === ep.id ? 'Hide' : 'View'}
                        </button>
                        <button
                          onClick={() => copyToClipboard(ep.id, result.data)}
                          className="btn-secondary text-xs py-1 px-2"
                        >
                          {copied === ep.id ? 'Copied!' : 'Copy'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => testScheduleEndpoint(ep.id, endpoint)}
                      disabled={result?.status === 'loading'}
                      className="px-3 py-1 text-xs bg-hawk-teal/20 hover:bg-hawk-teal/30 text-hawk-teal rounded border border-hawk-teal/30 transition-colors disabled:opacity-50"
                    >
                      Test
                    </button>
                  </div>
                </div>

                {result?.status === 'error' && (
                  <div className="mt-2 text-xs text-hawk-red bg-hawk-red/10 p-2 rounded border border-hawk-red/20">
                    {result.error}
                  </div>
                )}

                {expandedResult === ep.id && result?.data && (
                  <div className="mt-3">
                    <pre className="bg-court-deep text-hawk-teal p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto border border-white/10">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 className="font-display font-semibold text-gray-100 mb-3">Custom Endpoint</h3>
        <p className="text-sm text-gray-400 mb-4">
          Test any Yahoo Fantasy API endpoint. Use the proxy to fetch raw data.
        </p>
        <CustomEndpointTester />
      </div>
    </div>
  );
}

function CustomEndpointTester() {
  const [endpoint, setEndpoint] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function testEndpoint() {
    if (!endpoint.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(
        `${API_BASE}/fantasy/proxy?endpoint=${encodeURIComponent(endpoint)}`,
        { credentials: 'include' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={endpoint}
          onChange={e => setEndpoint(e.target.value)}
          placeholder="/league/428.l.12345/standings"
          className="input flex-1 font-mono text-sm"
        />
        <button
          onClick={testEndpoint}
          disabled={loading || !endpoint.trim()}
          className="btn-primary"
        >
          {loading ? 'Loading...' : 'Test'}
        </button>
      </div>

      {error && (
        <div className="mt-3 text-sm text-hawk-red bg-hawk-red/10 p-3 rounded border border-hawk-red/20">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3">
          <pre className="bg-court-deep text-hawk-teal p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto border border-white/10">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
