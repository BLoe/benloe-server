import { useState } from 'react';

interface DebugPanelProps {
  selectedLeague: string | null;
}

interface FixtureResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  files?: string[];
}

interface ConnectivityResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  latency?: number;
}

const API_BASE = '/api';

// Endpoints to capture for test fixtures
const FIXTURE_ENDPOINTS = [
  { id: 'league', endpoint: (lk: string) => `/league/${lk}`, label: 'League Metadata' },
  { id: 'settings', endpoint: (lk: string) => `/league/${lk}/settings`, label: 'Settings' },
  { id: 'standings', endpoint: (lk: string) => `/league/${lk}/standings`, label: 'Standings' },
  { id: 'scoreboard', endpoint: (lk: string) => `/league/${lk}/scoreboard`, label: 'Scoreboard' },
  { id: 'scoreboard-week1', endpoint: (lk: string) => `/league/${lk}/scoreboard;week=1`, label: 'Scoreboard Week 1' },
  { id: 'teams', endpoint: (lk: string) => `/league/${lk}/teams`, label: 'Teams' },
  { id: 'teams-roster', endpoint: (lk: string) => `/league/${lk}/teams/roster`, label: 'Teams + Rosters' },
  { id: 'teams-stats', endpoint: (lk: string) => `/league/${lk}/teams/stats`, label: 'Teams + Stats' },
  { id: 'players-rostered', endpoint: (lk: string) => `/league/${lk}/players;status=T;count=25`, label: 'Rostered Players' },
  { id: 'players-fa', endpoint: (lk: string) => `/league/${lk}/players;status=FA;count=25`, label: 'Free Agents' },
  { id: 'players-waivers', endpoint: (lk: string) => `/league/${lk}/players;status=W;count=25`, label: 'Waivers' },
  { id: 'transactions', endpoint: (lk: string) => `/league/${lk}/transactions`, label: 'Transactions' },
  { id: 'draftresults', endpoint: (lk: string) => `/league/${lk}/draftresults`, label: 'Draft Results' },
  { id: 'game-nba', endpoint: () => `/game/nba`, label: 'NBA Game Info' },
  { id: 'game-stat-categories', endpoint: () => `/game/nba/stat_categories`, label: 'Stat Categories' },
];

export function DebugPanel({ selectedLeague }: DebugPanelProps) {
  const [fixtureResult, setFixtureResult] = useState<FixtureResult>({ status: 'idle' });
  const [yahooResult, setYahooResult] = useState<ConnectivityResult>({ status: 'idle' });
  const [bdlResult, setBdlResult] = useState<ConnectivityResult>({ status: 'idle' });
  const [progress, setProgress] = useState<string[]>([]);

  async function captureFixtures() {
    if (!selectedLeague) return;

    setFixtureResult({ status: 'loading' });
    setProgress([]);
    const files: string[] = [];

    try {
      for (const ep of FIXTURE_ENDPOINTS) {
        const yahooEndpoint = ep.endpoint(selectedLeague);
        setProgress(prev => [...prev, `Capturing ${ep.label}...`]);

        const response = await fetch(
          `${API_BASE}/fantasy/debug/dump-raw?endpoint=${encodeURIComponent(yahooEndpoint)}`,
          { credentials: 'include' }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(`${ep.label}: ${data.error || 'Failed'}`);
        }

        const data = await response.json();
        files.push(data.file);
        setProgress(prev => [...prev.slice(0, -1), `${ep.label} captured`]);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      setFixtureResult({
        status: 'success',
        message: `Captured ${files.length} fixtures`,
        files,
      });
      setProgress(prev => [...prev, 'All fixtures captured successfully!']);
    } catch (err: any) {
      setFixtureResult({
        status: 'error',
        message: err.message,
      });
      setProgress(prev => [...prev, `Error: ${err.message}`]);
    }
  }

  async function testYahooConnectivity() {
    if (!selectedLeague) return;

    setYahooResult({ status: 'loading' });

    try {
      const start = Date.now();
      const response = await fetch(
        `${API_BASE}/fantasy/leagues/${selectedLeague}/settings`,
        { credentials: 'include' }
      );
      const latency = Date.now() - start;

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Request failed');
      }

      setYahooResult({
        status: 'success',
        message: 'Yahoo API connected',
        latency,
      });
    } catch (err: any) {
      setYahooResult({
        status: 'error',
        message: err.message,
      });
    }
  }

  async function testBdlConnectivity() {
    setBdlResult({ status: 'loading' });

    try {
      const start = Date.now();
      const response = await fetch(`${API_BASE}/fantasy/schedule/status`, {
        credentials: 'include',
      });
      const latency = Date.now() - start;

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Request failed');
      }

      const data = await response.json();
      setBdlResult({
        status: 'success',
        message: data.configured ? 'Ball Don\'t Lie API configured' : 'API key not configured',
        latency,
      });
    } catch (err: any) {
      setBdlResult({
        status: 'error',
        message: err.message,
      });
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
      {/* Test Fixture Capture */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-gray-100">
              Test Fixture Capture
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Capture Yahoo API responses to use as test fixtures for e2e tests.
            </p>
          </div>
          <button
            onClick={captureFixtures}
            disabled={fixtureResult.status === 'loading'}
            className="btn-primary flex items-center gap-2"
          >
            {fixtureResult.status === 'loading' ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Capturing...
              </>
            ) : (
              'Capture All Fixtures'
            )}
          </button>
        </div>

        <div className="text-xs text-gray-400 mb-4 font-mono bg-court-base p-2 rounded border border-white/10">
          League: {selectedLeague}
        </div>

        {progress.length > 0 && (
          <div className="bg-court-base rounded-lg p-3 border border-white/10 max-h-48 overflow-y-auto">
            {progress.map((msg, i) => (
              <div
                key={i}
                className={`text-xs font-mono ${
                  msg.startsWith('Error') ? 'text-hawk-red' :
                  msg.includes('captured') || msg.includes('successfully') ? 'text-hawk-teal' :
                  'text-gray-400'
                }`}
              >
                {msg}
              </div>
            ))}
          </div>
        )}

        {fixtureResult.status === 'success' && fixtureResult.files && (
          <div className="mt-4 text-sm text-hawk-teal bg-hawk-teal/10 p-3 rounded border border-hawk-teal/20">
            <div className="font-medium mb-2">Files saved to /srv/benloe/apps/fantasy-hawk/api-dumps/</div>
            <div className="text-xs text-gray-400">
              Copy these to tests/fantasy-hawk/fixtures/raw/ to update test fixtures.
            </div>
          </div>
        )}

        {fixtureResult.status === 'error' && (
          <div className="mt-4 text-sm text-hawk-red bg-hawk-red/10 p-3 rounded border border-hawk-red/20">
            {fixtureResult.message}
          </div>
        )}
      </div>

      {/* API Connectivity Tests */}
      <div className="card">
        <h2 className="font-display text-xl font-semibold text-gray-100 mb-4">
          API Connectivity
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Yahoo API */}
          <div className="bg-court-base rounded-lg p-4 border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-gray-100">Yahoo Fantasy API</div>
                <div className="text-xs text-gray-500">Tests OAuth token and API access</div>
              </div>
              <button
                onClick={testYahooConnectivity}
                disabled={yahooResult.status === 'loading'}
                className="px-3 py-1.5 text-xs bg-hawk-indigo/20 hover:bg-hawk-indigo/30 text-hawk-indigo rounded border border-hawk-indigo/30 transition-colors disabled:opacity-50"
              >
                {yahooResult.status === 'loading' ? 'Testing...' : 'Test'}
              </button>
            </div>
            {yahooResult.status !== 'idle' && (
              <div className={`text-sm p-2 rounded ${
                yahooResult.status === 'success' ? 'bg-hawk-teal/10 text-hawk-teal border border-hawk-teal/20' :
                yahooResult.status === 'error' ? 'bg-hawk-red/10 text-hawk-red border border-hawk-red/20' :
                'bg-gray-500/10 text-gray-400'
              }`}>
                {yahooResult.message}
                {yahooResult.latency && <span className="ml-2 text-xs opacity-75">({yahooResult.latency}ms)</span>}
              </div>
            )}
          </div>

          {/* Ball Don't Lie API */}
          <div className="bg-court-base rounded-lg p-4 border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-gray-100">Ball Don't Lie API</div>
                <div className="text-xs text-gray-500">NBA schedule data for streaming</div>
              </div>
              <button
                onClick={testBdlConnectivity}
                disabled={bdlResult.status === 'loading'}
                className="px-3 py-1.5 text-xs bg-hawk-teal/20 hover:bg-hawk-teal/30 text-hawk-teal rounded border border-hawk-teal/30 transition-colors disabled:opacity-50"
              >
                {bdlResult.status === 'loading' ? 'Testing...' : 'Test'}
              </button>
            </div>
            {bdlResult.status !== 'idle' && (
              <div className={`text-sm p-2 rounded ${
                bdlResult.status === 'success' ? 'bg-hawk-teal/10 text-hawk-teal border border-hawk-teal/20' :
                bdlResult.status === 'error' ? 'bg-hawk-red/10 text-hawk-red border border-hawk-red/20' :
                'bg-gray-500/10 text-gray-400'
              }`}>
                {bdlResult.message}
                {bdlResult.latency && <span className="ml-2 text-xs opacity-75">({bdlResult.latency}ms)</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info Panel */}
      <div className="card bg-court-base/50">
        <h3 className="font-display font-semibold text-gray-100 mb-2">About Test Fixtures</h3>
        <p className="text-sm text-gray-400">
          Test fixtures allow e2e tests to run without requiring real Yahoo authentication.
          The captured API responses are mocked during Playwright tests, making them
          fast and deterministic.
        </p>
        <div className="mt-3 text-xs text-gray-500 font-mono">
          Fixtures location: tests/fantasy-hawk/fixtures/raw/
        </div>
      </div>
    </div>
  );
}
