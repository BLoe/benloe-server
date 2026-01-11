import { useState, useEffect } from 'react';
import { Outlet, NavLink, useParams, useOutletContext, Navigate } from 'react-router-dom';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

export interface LeagueContextType {
  leagueKey: string;
  standings: any[];
  settings: any;
}

// Tab definitions with route paths
const tabs = [
  { path: 'standings', label: 'Standings' },
  { path: 'categories', label: 'Categories' },
  { path: 'matchup', label: 'Matchup', testId: 'matchup-tab' },
  { path: 'streaming', label: 'Streaming', testId: 'streaming-tab' },
  { path: 'trade', label: 'Trade', testId: 'trade-tab' },
  { path: 'compare', label: 'Compare', testId: 'compare-tab' },
  { path: 'waiver', label: 'Waivers', testId: 'waiver-tab' },
  { path: 'punt', label: 'Punt', testId: 'punt-tab' },
  { path: 'insights', label: 'Insights', testId: 'insights-tab' },
  { path: 'schedule', label: 'Schedule', testId: 'schedule-tab' },
  { path: 'outlook', label: 'Outlook', testId: 'outlook-tab' },
  { path: 'chat', label: 'AI Chat', testId: 'chat-tab' },
  { path: 'debug', label: 'Debug' },
];

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

// Helper to parse settings from response
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

export function LeagueLayout() {
  const { leagueKey } = useParams<{ leagueKey: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [standings, setStandings] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (leagueKey) {
      loadLeagueData(leagueKey);
    }
  }, [leagueKey]);

  async function loadLeagueData(key: string) {
    try {
      setLoading(true);
      setError(null);

      const [standingsData, settingsData] = await Promise.all([
        api.fantasy.getStandings(key),
        api.fantasy.getLeagueSettings(key),
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

  if (!leagueKey) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <LoadingSpinner message="Loading league data..." />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const context: LeagueContextType = {
    leagueKey,
    standings,
    settings,
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 p-1 bg-court-base rounded-lg w-fit">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `tab ${isActive ? 'tab-active' : ''}`
            }
            data-testid={tab.testId}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* Route content */}
      <Outlet context={context} />
    </div>
  );
}

// Hook for child routes to access league context
export function useLeagueContext(): LeagueContextType {
  return useOutletContext<LeagueContextType>();
}
