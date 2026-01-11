import { Trophy, Target, AlertCircle, CheckCircle, XCircle, TrendingUp, TrendingDown, Users, Zap } from 'lucide-react';

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

interface RaceStatus {
  clinched: number;
  eliminated: number;
  inTheRace: number;
  tightRaces: number;
}

interface SeasonInfo {
  currentWeek: number;
  totalWeeks: number;
  playoffStartWeek: number;
  weeksRemaining: number;
  playoffSpots: number;
  teamCount: number;
}

interface PlayoffOddsProps {
  playoffOdds: PlayoffOddsTeam[];
  userTeam: {
    playoffOdds: number;
    byeOdds: number;
    magicNumber: number | null;
    eliminationNumber: number | null;
    clinched: boolean;
    eliminated: boolean;
    currentRank: number;
  } | null;
  raceStatus: RaceStatus;
  season: SeasonInfo;
}

export function PlayoffOdds({ playoffOdds, userTeam, raceStatus, season }: PlayoffOddsProps) {
  // Get odds gauge color
  const getOddsColor = (odds: number): string => {
    if (odds >= 80) return 'text-green-400';
    if (odds >= 60) return 'text-yellow-400';
    if (odds >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

  const getOddsGradient = (odds: number): string => {
    if (odds >= 80) return 'from-green-500 to-green-400';
    if (odds >= 60) return 'from-yellow-500 to-yellow-400';
    if (odds >= 40) return 'from-orange-500 to-orange-400';
    return 'from-red-500 to-red-400';
  };

  // Sort teams into categories
  const clinchTeams = playoffOdds.filter(t => t.clinched);
  const bubbleTeams = playoffOdds.filter(t => !t.clinched && !t.eliminated && t.playoffOdds >= 20 && t.playoffOdds <= 80);
  const eliminatedTeams = playoffOdds.filter(t => t.eliminated);
  const safeTeams = playoffOdds.filter(t => !t.clinched && !t.eliminated && t.playoffOdds > 80);
  const longShotTeams = playoffOdds.filter(t => !t.clinched && !t.eliminated && t.playoffOdds < 20);

  // Find user's competitors (teams within 2 spots of user)
  const userRank = userTeam?.currentRank || 0;
  const competitors = playoffOdds.filter(
    t => !t.isCurrentUser &&
    Math.abs(t.currentRank - userRank) <= 2 &&
    !t.clinched &&
    !t.eliminated
  );

  // Calculate what-if scenarios
  const avgWinsPerWeek = 5; // Typical category wins per week
  const userCurrentOdds = userTeam?.playoffOdds || 0;

  // Simple projections for winning/losing the week
  const oddsIfWin = Math.min(95, userCurrentOdds + (100 - userCurrentOdds) * 0.15);
  const oddsIfLose = Math.max(5, userCurrentOdds - userCurrentOdds * 0.15);

  return (
    <div className="space-y-6" data-testid="playoff-odds">
      {/* Odds Meter */}
      {userTeam && (
        <div className="card bg-gradient-to-br from-court-base to-court-surface" data-testid="playoff-odds-meter">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-6 h-6 text-hawk-orange" />
            <h3 className="font-semibold text-gray-200 text-lg">Your Playoff Odds</h3>
          </div>

          {/* Clinched/Eliminated Banner */}
          {userTeam.clinched && (
            <div className="mb-6 p-4 bg-green-500/20 border border-green-500/40 rounded-lg flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-green-400" />
              <div>
                <div className="font-bold text-green-400">Playoffs Clinched!</div>
                <div className="text-sm text-green-300">You've secured your spot in the playoffs.</div>
              </div>
            </div>
          )}

          {userTeam.eliminated && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/40 rounded-lg flex items-center gap-3">
              <XCircle className="w-6 h-6 text-red-400" />
              <div>
                <div className="font-bold text-red-400">Eliminated</div>
                <div className="text-sm text-red-300">You've been eliminated from playoff contention.</div>
              </div>
            </div>
          )}

          {/* Main Odds Display */}
          {!userTeam.clinched && !userTeam.eliminated && (
            <div className="text-center mb-6">
              <div className={`text-7xl font-bold mb-2 ${getOddsColor(userTeam.playoffOdds)}`}>
                {userTeam.playoffOdds}%
              </div>
              <div className="text-gray-400">chance to make playoffs</div>

              {/* Visual Gauge */}
              <div className="mt-6 relative h-6 bg-court-surface rounded-full overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 bg-gradient-to-r ${getOddsGradient(userTeam.playoffOdds)} rounded-full transition-all duration-700`}
                  style={{ width: `${userTeam.playoffOdds}%` }}
                />
                {/* Cutoff line at 50% */}
                <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-white/30" />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          )}

          {/* Bye Odds */}
          {userTeam.byeOdds > 0 && !userTeam.eliminated && (
            <div className="bg-hawk-teal/10 border border-hawk-teal/30 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-hawk-teal" />
                  <span className="text-gray-300">First Round Bye Odds</span>
                </div>
                <span className="text-2xl font-bold text-hawk-teal">{userTeam.byeOdds}%</span>
              </div>
            </div>
          )}

          {/* Magic Number / Elimination Number */}
          <div className="grid grid-cols-2 gap-4">
            {userTeam.magicNumber !== null && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4" data-testid="playoff-magic-number">
                <div className="text-gray-400 text-sm mb-1">Magic Number</div>
                <div className="text-4xl font-bold text-green-400">{userTeam.magicNumber}</div>
                <div className="text-xs text-gray-500 mt-1">category wins to clinch</div>
              </div>
            )}
            {userTeam.eliminationNumber !== null && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" data-testid="playoff-elimination-number">
                <div className="text-gray-400 text-sm mb-1">Danger Zone</div>
                <div className="text-4xl font-bold text-red-400">{userTeam.eliminationNumber}</div>
                <div className="text-xs text-gray-500 mt-1">category losses to eliminate</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* What-If Scenarios */}
      {userTeam && !userTeam.clinched && !userTeam.eliminated && (
        <div className="card" data-testid="playoff-what-if">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-hawk-orange" />
            <h3 className="font-semibold text-gray-200">This Week's Stakes</h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-gray-300 text-sm">If you win big...</span>
              </div>
              <div className="text-3xl font-bold text-green-400">{Math.round(oddsIfWin)}%</div>
              <div className="text-xs text-gray-500 mt-1">
                +{Math.round(oddsIfWin - userCurrentOdds)} points
              </div>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <span className="text-gray-300 text-sm">If you lose badly...</span>
              </div>
              <div className="text-3xl font-bold text-red-400">{Math.round(oddsIfLose)}%</div>
              <div className="text-xs text-gray-500 mt-1">
                {Math.round(oddsIfLose - userCurrentOdds)} points
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Playoff Bracket Preview */}
      <div className="card" data-testid="playoff-bracket-preview">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-hawk-orange" />
          <h3 className="font-semibold text-gray-200">Projected Bracket</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* IN */}
          <div>
            <div className="text-sm font-medium text-green-400 mb-2 flex items-center gap-1">
              <CheckCircle className="w-4 h-4" />
              IN ({season.playoffSpots} spots)
            </div>
            <div className="space-y-2">
              {playoffOdds
                .filter(t => t.currentRank <= season.playoffSpots)
                .sort((a, b) => a.currentRank - b.currentRank)
                .map((team, index) => (
                  <div
                    key={team.teamKey}
                    className={`flex items-center justify-between p-2 rounded ${
                      team.isCurrentUser
                        ? 'bg-hawk-teal/20 border border-hawk-teal/30'
                        : team.clinched
                        ? 'bg-green-500/10'
                        : 'bg-court-surface'
                    }`}
                    data-testid={`bracket-in-${index}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-4 text-sm">{team.currentRank}</span>
                      <span className={`text-sm ${team.isCurrentUser ? 'text-hawk-teal font-medium' : 'text-gray-300'}`}>
                        {team.teamName}
                      </span>
                    </div>
                    {team.clinched && (
                      <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                        CLINCHED
                      </span>
                    )}
                    {!team.clinched && (
                      <span className={`text-xs ${getOddsColor(team.playoffOdds)}`}>
                        {team.playoffOdds}%
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* OUT */}
          <div>
            <div className="text-sm font-medium text-red-400 mb-2 flex items-center gap-1">
              <XCircle className="w-4 h-4" />
              OUT
            </div>
            <div className="space-y-2">
              {playoffOdds
                .filter(t => t.currentRank > season.playoffSpots)
                .sort((a, b) => a.currentRank - b.currentRank)
                .slice(0, season.playoffSpots) // Show same number as "in"
                .map((team, index) => (
                  <div
                    key={team.teamKey}
                    className={`flex items-center justify-between p-2 rounded ${
                      team.isCurrentUser
                        ? 'bg-hawk-teal/20 border border-hawk-teal/30'
                        : team.eliminated
                        ? 'bg-red-500/10 opacity-50'
                        : 'bg-court-surface'
                    }`}
                    data-testid={`bracket-out-${index}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-4 text-sm">{team.currentRank}</span>
                      <span className={`text-sm ${team.isCurrentUser ? 'text-hawk-teal font-medium' : 'text-gray-300'}`}>
                        {team.teamName}
                      </span>
                    </div>
                    {team.eliminated && (
                      <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">
                        OUT
                      </span>
                    )}
                    {!team.eliminated && (
                      <span className={`text-xs ${getOddsColor(team.playoffOdds)}`}>
                        {team.playoffOdds}%
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bubble Watch */}
      {bubbleTeams.length > 0 && (
        <div className="card" data-testid="playoff-bubble-watch">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 text-yellow-400" />
            <h3 className="font-semibold text-gray-200">Bubble Watch</h3>
            <span className="text-xs text-gray-500 ml-auto">
              {bubbleTeams.length} teams in the mix
            </span>
          </div>

          <div className="space-y-2">
            {bubbleTeams
              .sort((a, b) => b.playoffOdds - a.playoffOdds)
              .map((team, index) => {
                const isCompetitor = competitors.some(c => c.teamKey === team.teamKey);
                return (
                  <div
                    key={team.teamKey}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      team.isCurrentUser
                        ? 'bg-hawk-teal/20 border border-hawk-teal/30'
                        : isCompetitor
                        ? 'bg-yellow-500/10 border border-yellow-500/20'
                        : 'bg-court-surface'
                    }`}
                    data-testid={`bubble-team-${index}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 w-6 text-center">#{team.currentRank}</span>
                      <span className={`font-medium ${team.isCurrentUser ? 'text-hawk-teal' : 'text-gray-200'}`}>
                        {team.teamName}
                      </span>
                      {team.isCurrentUser && <span className="text-xs text-hawk-teal">(You)</span>}
                      {isCompetitor && <span className="text-xs text-yellow-400">(Competitor)</span>}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-24 h-2 bg-court-base rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${getOddsGradient(team.playoffOdds)}`}
                          style={{ width: `${team.playoffOdds}%` }}
                        />
                      </div>
                      <span className={`font-bold w-12 text-right ${getOddsColor(team.playoffOdds)}`}>
                        {team.playoffOdds}%
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Competition Summary */}
      {competitors.length > 0 && userTeam && !userTeam.clinched && !userTeam.eliminated && (
        <div className="card" data-testid="playoff-competitors">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-gray-400" />
            <h3 className="font-semibold text-gray-200">Your Competition</h3>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Teams you're directly competing with for playoff positioning:
          </p>
          <div className="flex flex-wrap gap-2">
            {competitors.map(team => (
              <div
                key={team.teamKey}
                className="bg-court-surface px-3 py-2 rounded-lg"
              >
                <span className="text-gray-300 text-sm">
                  #{team.currentRank} {team.teamName}
                </span>
                <span className={`ml-2 text-xs ${getOddsColor(team.playoffOdds)}`}>
                  ({team.playoffOdds}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
