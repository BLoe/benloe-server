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

export function DebugPanel({ selectedLeague }: DebugPanelProps) {
  const [results, setResults] = useState<Record<string, DumpResult>>({});
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

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-600">Select a league to access debug tools</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Yahoo API Debug Panel</h2>
            <p className="text-sm text-gray-600 mt-1">
              Dump raw Yahoo API responses to files for analysis. Files are saved to the server.
            </p>
          </div>
          <button
            onClick={dumpAll}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
          >
            Dump All Endpoints
          </button>
        </div>

        <div className="text-xs text-gray-500 mb-4 font-mono bg-gray-50 p-2 rounded">
          League Key: {selectedLeague}
        </div>

        <div className="space-y-2">
          {DUMP_ENDPOINTS.map(ep => {
            const result = results[ep.id];
            const yahooEndpoint = ep.endpoint(selectedLeague);

            return (
              <div key={ep.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{ep.label}</span>
                      {result?.status === 'loading' && (
                        <span className="text-xs text-blue-600">Loading...</span>
                      )}
                      {result?.status === 'success' && (
                        <span className="text-xs text-green-600">Done</span>
                      )}
                      {result?.status === 'error' && (
                        <span className="text-xs text-red-600">Error</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{ep.description}</p>
                    <code className="text-xs text-gray-400 block mt-1 truncate">
                      {yahooEndpoint}
                    </code>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {result?.data && (
                      <>
                        <button
                          onClick={() => setExpandedResult(expandedResult === ep.id ? null : ep.id)}
                          className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
                        >
                          {expandedResult === ep.id ? 'Hide' : 'View'}
                        </button>
                        <button
                          onClick={() => copyToClipboard(ep.id, result.data)}
                          className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
                        >
                          {copied === ep.id ? 'Copied!' : 'Copy'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => dumpEndpoint(ep.id, yahooEndpoint)}
                      disabled={result?.status === 'loading'}
                      className="px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded border border-blue-300 transition-colors disabled:opacity-50"
                    >
                      Dump
                    </button>
                  </div>
                </div>

                {result?.status === 'error' && (
                  <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                    {result.error}
                  </div>
                )}

                {result?.file && (
                  <div className="mt-2 text-xs text-green-600 bg-green-50 p-2 rounded font-mono">
                    Saved: {result.file}
                  </div>
                )}

                {expandedResult === ep.id && result?.data && (
                  <div className="mt-3">
                    <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto">
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
        <h3 className="font-semibold text-gray-900 mb-3">Custom Endpoint</h3>
        <p className="text-sm text-gray-600 mb-4">
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
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
        />
        <button
          onClick={testEndpoint}
          disabled={loading || !endpoint.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Test'}
        </button>
      </div>

      {error && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 p-3 rounded">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3">
          <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
