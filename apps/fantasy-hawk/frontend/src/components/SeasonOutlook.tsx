import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { OutlookDashboard } from './outlook/Dashboard';
import { PlayoffOdds } from './outlook/PlayoffOdds';
import { TrendingUp, Trophy, AlertTriangle, Target } from 'lucide-react';

type OutlookTab = 'overview' | 'playoffs';

interface SeasonOutlookProps {
  selectedLeague: string | null;
}

interface StandingsProjection {
  teamKey: string;
  teamName: string;
  currentRank: number;
  projectedRank: number;
  currentWins: number;
  currentLosses: number;
  currentTies: number;
  projectedWins: number;
  projectedLosses: number;
  projectedTies: number;
  winPace: number;
  gamesPlayed: number;
  gamesRemaining: number;
  isCurrentUser: boolean;
  trend: 'improving' | 'stable' | 'declining';
}

interface SeasonInfo {
  currentWeek: number;
  totalWeeks: number;
  playoffStartWeek: number;
  weeksRemaining: number;
  playoffSpots: number;
  teamCount: number;
}

interface UserTeamSummary {
  currentRank: number;
  projectedRank: number;
  projectedWins: number;
  trend: string;
  rankChange: number;
}

interface OutlookStandingsData {
  season: SeasonInfo;
  projections: StandingsProjection[];
  userTeam: UserTeamSummary | null;
  insights: {
    earlySeasonWarning: boolean;
    message: string | null;
  };
}

interface PlayoffOddsTeam {
  teamKey: string;
  teamName: string;
  currentRank: number;
  playoffOdds: number;
  byeOdds: number;
  magicNumber: number | null;
  eliminationNumber: number | null;
  isCurrentUser: boolean;
  clinched: boolean;
  eliminated: boolean;
}

interface UserPlayoffSummary {
  playoffOdds: number;
  byeOdds: number;
  magicNumber: number | null;
  eliminationNumber: number | null;
  clinched: boolean;
  eliminated: boolean;
  currentRank: number;
}

interface RaceStatus {
  clinched: number;
  eliminated: number;
  inTheRace: number;
  tightRaces: number;
}

interface OutlookPlayoffsData {
  season: SeasonInfo;
  playoffOdds: PlayoffOddsTeam[];
  userTeam: UserPlayoffSummary | null;
  raceStatus: RaceStatus;
  insights: {
    earlySeasonWarning: boolean;
    message: string | null;
  };
}

export function SeasonOutlook({ selectedLeague }: SeasonOutlookProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standingsData, setStandingsData] = useState<OutlookStandingsData | null>(null);
  const [playoffsData, setPlayoffsData] = useState<OutlookPlayoffsData | null>(null);
  const [activeTab, setActiveTab] = useState<OutlookTab>('overview');

  useEffect(() => {
    if (selectedLeague) {
      loadOutlookData();
    }
  }, [selectedLeague]);

  async function loadOutlookData() {
    try {
      setLoading(true);
      setError(null);

      const [standings, playoffs] = await Promise.all([
        api.fantasy.getOutlookStandings(selectedLeague!) as Promise<OutlookStandingsData>,
        api.fantasy.getOutlookPlayoffs(selectedLeague!) as Promise<OutlookPlayoffsData>,
      ]);

      setStandingsData(standings);
      setPlayoffsData(playoffs);
    } catch (err: any) {
      console.error('Failed to load outlook data:', err);
      setError(err.message || 'Failed to load season outlook');
    } finally {
      setLoading(false);
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="outlook-no-league">
        <TrendingUp className="w-12 h-12 mx-auto mb-4 text-gray-500" />
        <h3 className="text-lg font-medium text-gray-300 mb-2">No League Selected</h3>
        <p className="text-gray-500">Select a league to view your season outlook</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Loading season outlook..." />;
  }

  if (error) {
    return (
      <div className="card text-center py-12" data-testid="outlook-error">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
        <div className="text-red-400 mb-4">{error}</div>
        <button
          onClick={loadOutlookData}
          className="btn btn-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!standingsData || !playoffsData) {
    return (
      <div className="card text-center py-12" data-testid="outlook-empty">
        <Trophy className="w-12 h-12 mx-auto mb-4 text-gray-500" />
        <h3 className="text-lg font-medium text-gray-300 mb-2">No Data Available</h3>
        <p className="text-gray-500">Season outlook data is not available yet</p>
      </div>
    );
  }

  return (
    <div data-testid="season-outlook-page" className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'overview'
              ? 'bg-hawk-teal text-gray-900'
              : 'bg-court-base text-gray-300 hover:bg-court-surface'
          }`}
          data-testid="outlook-overview-tab"
        >
          <TrendingUp className="w-4 h-4" />
          Overview
        </button>
        <button
          onClick={() => setActiveTab('playoffs')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'playoffs'
              ? 'bg-hawk-orange text-gray-900'
              : 'bg-court-base text-gray-300 hover:bg-court-surface'
          }`}
          data-testid="outlook-playoffs-tab"
        >
          <Target className="w-4 h-4" />
          Playoff Odds
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OutlookDashboard
          standingsData={standingsData}
          playoffsData={playoffsData}
          onRefresh={loadOutlookData}
        />
      )}

      {activeTab === 'playoffs' && (
        <PlayoffOdds
          playoffOdds={playoffsData.playoffOdds}
          userTeam={playoffsData.userTeam}
          raceStatus={playoffsData.raceStatus}
          season={playoffsData.season}
        />
      )}
    </div>
  );
}
