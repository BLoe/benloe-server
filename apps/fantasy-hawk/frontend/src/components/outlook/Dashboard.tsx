import { TrendingUp, TrendingDown, Minus, Trophy, Target, Calendar, Users, Star, RefreshCw } from 'lucide-react';

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

interface OutlookDashboardProps {
  standingsData: OutlookStandingsData;
  playoffsData: OutlookPlayoffsData;
  onRefresh: () => void;
}

export function OutlookDashboard({ standingsData, playoffsData, onRefresh }: OutlookDashboardProps) {
  const { season, projections, userTeam, insights } = standingsData;
  const { playoffOdds, raceStatus } = playoffsData;

  // Calculate season progress percentage
  const seasonProgress = ((season.currentWeek - 1) / season.totalWeeks) * 100;

  // Get trend icon and color
  const getTrendDisplay = (trend: string) => {
    switch (trend) {
      case 'improving':
        return { icon: TrendingUp, color: 'text-green-400', label: 'Rising' };
      case 'declining':
        return { icon: TrendingDown, color: 'text-red-400', label: 'Falling' };
      default:
        return { icon: Minus, color: 'text-gray-400', label: 'Stable' };
    }
  };

  const userTrend = userTeam ? getTrendDisplay(userTeam.trend) : null;

  // Find user in projections for additional stats
  const userProjection = projections.find(p => p.isCurrentUser);

  // Find user in playoff odds
  const userOdds = playoffOdds.find(p => p.isCurrentUser);

  return (
    <div className="space-y-6" data-testid="outlook-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold text-gray-100 flex items-center gap-3">
            <TrendingUp className="w-7 h-7 text-hawk-teal" />
            Season Outlook
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Your projected finish based on current pace
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="text-gray-400 hover:text-gray-200 p-2 rounded-lg hover:bg-court-surface transition-colors"
          title="Refresh outlook"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Early Season Warning */}
      {insights.earlySeasonWarning && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-sm text-yellow-300">
          <strong>Early Season Note:</strong> {insights.message || 'Projections have high variance early in the season.'}
        </div>
      )}

      {/* Main Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Current Standing */}
        <div className="card bg-gradient-to-br from-court-base to-court-surface" data-testid="outlook-current-standing">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-400 text-sm">Current Standing</span>
            <Trophy className="w-5 h-5 text-hawk-orange" />
          </div>
          <div className="flex items-end gap-3">
            <span className="text-5xl font-bold text-gray-100">
              #{userTeam?.currentRank || '-'}
            </span>
            <span className="text-gray-400 mb-2">
              of {season.teamCount} teams
            </span>
          </div>
          {userProjection && (
            <div className="mt-3 text-sm text-gray-400">
              Record: {userProjection.currentWins}-{userProjection.currentLosses}
              {userProjection.currentTies > 0 && `-${userProjection.currentTies}`}
            </div>
          )}
        </div>

        {/* Projected Finish */}
        <div className="card bg-gradient-to-br from-hawk-teal/20 to-court-base border border-hawk-teal/30" data-testid="outlook-projected-finish">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-400 text-sm">Projected Finish</span>
            <Target className="w-5 h-5 text-hawk-teal" />
          </div>
          <div className="flex items-end gap-3">
            <span className="text-5xl font-bold text-hawk-teal">
              #{userTeam?.projectedRank || '-'}
            </span>
            {userTeam && userTeam.rankChange !== 0 && (
              <span className={`mb-2 text-sm ${userTeam.rankChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {userTeam.rankChange > 0 ? '+' : ''}{userTeam.rankChange} spots
              </span>
            )}
          </div>
          {userProjection && (
            <div className="mt-3 text-sm text-gray-400">
              On pace for: {userProjection.projectedWins}-{userProjection.projectedLosses} wins
            </div>
          )}
        </div>

        {/* Trend */}
        <div className="card" data-testid="outlook-trend">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-400 text-sm">Trend</span>
            {userTrend && <userTrend.icon className={`w-5 h-5 ${userTrend.color}`} />}
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-3xl font-bold ${userTrend?.color || 'text-gray-400'}`}>
              {userTrend?.label || '-'}
            </span>
          </div>
          {userProjection && (
            <div className="mt-3 text-sm text-gray-400">
              Win pace: {userProjection.winPace.toFixed(1)} per week
            </div>
          )}
        </div>
      </div>

      {/* Season Progress */}
      <div className="card" data-testid="outlook-season-progress">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-400" />
            <span className="text-gray-200 font-medium">Season Progress</span>
          </div>
          <span className="text-gray-400 text-sm">
            Week {season.currentWeek} of {season.totalWeeks}
          </span>
        </div>
        <div className="relative h-4 bg-court-base rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-hawk-teal to-hawk-orange rounded-full transition-all duration-500"
            style={{ width: `${Math.min(seasonProgress, 100)}%` }}
          />
          {/* Playoff start marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-hawk-orange"
            style={{ left: `${((season.playoffStartWeek - 1) / season.totalWeeks) * 100}%` }}
            title="Playoffs start"
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>Start</span>
          <span className="text-hawk-orange">Playoffs (Week {season.playoffStartWeek})</span>
          <span>End</span>
        </div>
        <div className="mt-3 text-sm text-gray-400">
          {season.weeksRemaining} weeks remaining in regular season
        </div>
      </div>

      {/* Playoff Picture */}
      <div className="card" data-testid="outlook-playoff-odds">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-hawk-orange" />
          <span className="text-gray-200 font-medium">Playoff Picture</span>
        </div>

        {/* User's Playoff Status */}
        {userOdds && (
          <div className="mb-6 p-4 rounded-lg bg-gradient-to-r from-hawk-orange/10 to-transparent border border-hawk-orange/20">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-gray-400 text-sm mb-1">Playoff Odds</div>
                <div className={`text-3xl font-bold ${
                  userOdds.playoffOdds >= 70 ? 'text-green-400' :
                  userOdds.playoffOdds >= 40 ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {userOdds.playoffOdds}%
                </div>
              </div>
              {userOdds.byeOdds > 0 && (
                <div>
                  <div className="text-gray-400 text-sm mb-1">Bye Odds</div>
                  <div className="text-2xl font-bold text-hawk-teal">
                    {userOdds.byeOdds}%
                  </div>
                </div>
              )}
              {userOdds.magicNumber !== null && (
                <div>
                  <div className="text-gray-400 text-sm mb-1">Magic Number</div>
                  <div className="text-2xl font-bold text-green-400">
                    {userOdds.magicNumber}
                  </div>
                  <div className="text-xs text-gray-500">wins to clinch</div>
                </div>
              )}
              {userOdds.eliminationNumber !== null && (
                <div>
                  <div className="text-gray-400 text-sm mb-1">Elimination #</div>
                  <div className="text-2xl font-bold text-red-400">
                    {userOdds.eliminationNumber}
                  </div>
                  <div className="text-xs text-gray-500">losses to eliminate</div>
                </div>
              )}
              {userOdds.clinched && (
                <div className="col-span-2">
                  <div className="flex items-center gap-2 text-green-400">
                    <Star className="w-5 h-5 fill-green-400" />
                    <span className="font-bold">CLINCHED PLAYOFFS!</span>
                  </div>
                </div>
              )}
              {userOdds.eliminated && (
                <div className="col-span-2">
                  <div className="flex items-center gap-2 text-red-400">
                    <span className="font-bold">Eliminated from playoff contention</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Race Status Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-court-base rounded-lg p-3 text-center">
            <div className="text-gray-400 text-xs mb-1">Playoff Spots</div>
            <div className="text-xl font-bold text-gray-200">{season.playoffSpots}</div>
          </div>
          <div className="bg-green-500/10 rounded-lg p-3 text-center">
            <div className="text-gray-400 text-xs mb-1">Clinched</div>
            <div className="text-xl font-bold text-green-400">{raceStatus.clinched}</div>
          </div>
          <div className="bg-yellow-500/10 rounded-lg p-3 text-center">
            <div className="text-gray-400 text-xs mb-1">In the Race</div>
            <div className="text-xl font-bold text-yellow-400">{raceStatus.inTheRace}</div>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3 text-center">
            <div className="text-gray-400 text-xs mb-1">Eliminated</div>
            <div className="text-xl font-bold text-red-400">{raceStatus.eliminated}</div>
          </div>
        </div>

        {/* Message */}
        {playoffsData.insights.message && (
          <p className="text-sm text-gray-400">{playoffsData.insights.message}</p>
        )}
      </div>

      {/* League Standings Table */}
      <div className="card" data-testid="outlook-standings-table">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-gray-400" />
          <span className="text-gray-200 font-medium">Projected Standings</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-left py-2 px-3">Team</th>
                <th className="text-center py-2 px-2">Now</th>
                <th className="text-center py-2 px-2">Proj</th>
                <th className="text-center py-2 px-2">Record</th>
                <th className="text-center py-2 px-2">Pace</th>
                <th className="text-center py-2 px-2">Odds</th>
                <th className="text-center py-2 px-2">Trend</th>
              </tr>
            </thead>
            <tbody>
              {projections.slice(0, 12).map((team, index) => {
                const odds = playoffOdds.find(p => p.teamKey === team.teamKey);
                const trend = getTrendDisplay(team.trend);
                const TrendIcon = trend.icon;
                const rankChange = team.currentRank - team.projectedRank;

                return (
                  <tr
                    key={team.teamKey}
                    className={`border-b border-white/5 ${
                      team.isCurrentUser ? 'bg-hawk-teal/10' : ''
                    } ${index < season.playoffSpots ? '' : 'opacity-60'}`}
                    data-testid={`outlook-team-${index}`}
                  >
                    <td className={`py-2 px-3 ${team.isCurrentUser ? 'text-hawk-teal font-medium' : 'text-gray-200'}`}>
                      {team.teamName}
                      {team.isCurrentUser && <span className="ml-2 text-xs">(You)</span>}
                    </td>
                    <td className="text-center py-2 px-2 text-gray-300">
                      #{team.currentRank}
                    </td>
                    <td className="text-center py-2 px-2">
                      <span className={`font-medium ${
                        team.projectedRank <= season.playoffSpots ? 'text-green-400' : 'text-gray-400'
                      }`}>
                        #{team.projectedRank}
                      </span>
                      {rankChange !== 0 && (
                        <span className={`ml-1 text-xs ${rankChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ({rankChange > 0 ? '+' : ''}{rankChange})
                        </span>
                      )}
                    </td>
                    <td className="text-center py-2 px-2 text-gray-400">
                      {team.currentWins}-{team.currentLosses}
                    </td>
                    <td className="text-center py-2 px-2 text-gray-400">
                      {team.winPace.toFixed(1)}/wk
                    </td>
                    <td className="text-center py-2 px-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        odds?.clinched ? 'bg-green-500/20 text-green-400' :
                        odds?.eliminated ? 'bg-red-500/20 text-red-400' :
                        (odds?.playoffOdds || 0) >= 50 ? 'bg-green-500/10 text-green-400' :
                        'bg-red-500/10 text-red-400'
                      }`}>
                        {odds?.clinched ? 'IN' : odds?.eliminated ? 'OUT' : `${odds?.playoffOdds || 0}%`}
                      </span>
                    </td>
                    <td className="text-center py-2 px-2">
                      <TrendIcon className={`w-4 h-4 mx-auto ${trend.color}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
