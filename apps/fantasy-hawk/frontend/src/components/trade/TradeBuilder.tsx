import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { LoadingSpinner } from '../LoadingSpinner';
import { ArrowRightLeft, X, Plus, UserCircle } from 'lucide-react';

interface Player {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  imageUrl?: string;
  stats: Record<string, number>;
}

interface Team {
  teamKey: string;
  name: string;
  logoUrl?: string;
  isOwnedByCurrentLogin: boolean;
  managerName?: string;
}

interface TradeBuilderProps {
  leagueKey: string;
  onAnalyze: (playersToGive: Player[], playersToReceive: Player[]) => void;
  isAnalyzing: boolean;
}

export function TradeBuilder({ leagueKey, onAnalyze, isAnalyzing }: TradeBuilderProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<Team | null>(null);
  const [myRoster, setMyRoster] = useState<Player[]>([]);
  const [partnerRoster, setPartnerRoster] = useState<Player[]>([]);
  const [playersToGive, setPlayersToGive] = useState<Player[]>([]);
  const [playersToReceive, setPlayersToReceive] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load teams on mount
  useEffect(() => {
    loadTeams();
  }, [leagueKey]);

  // Load partner roster when selected
  useEffect(() => {
    if (selectedPartner) {
      loadPartnerRoster(selectedPartner.teamKey);
    } else {
      setPartnerRoster([]);
    }
  }, [selectedPartner]);

  async function loadTeams() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fantasy.getLeagueTeams(leagueKey) as { teams: Team[] };
      setTeams(data.teams || []);

      // Find my team and load roster
      const myTeam = data.teams?.find(t => t.isOwnedByCurrentLogin);
      if (myTeam) {
        const rosterData = await api.fantasy.getTeamRoster(leagueKey, myTeam.teamKey) as { roster: Player[] };
        setMyRoster(rosterData.roster || []);
      }
    } catch (err: any) {
      console.error('Failed to load teams:', err);
      setError(err.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }

  async function loadPartnerRoster(teamKey: string) {
    try {
      setRosterLoading(true);
      const data = await api.fantasy.getTeamRoster(leagueKey, teamKey) as { roster: Player[] };
      setPartnerRoster(data.roster || []);
    } catch (err: any) {
      console.error('Failed to load roster:', err);
    } finally {
      setRosterLoading(false);
    }
  }

  function addToGive(player: Player) {
    if (!playersToGive.find(p => p.playerKey === player.playerKey)) {
      setPlayersToGive([...playersToGive, player]);
    }
  }

  function removeFromGive(playerKey: string) {
    setPlayersToGive(playersToGive.filter(p => p.playerKey !== playerKey));
  }

  function addToReceive(player: Player) {
    if (!playersToReceive.find(p => p.playerKey === player.playerKey)) {
      setPlayersToReceive([...playersToReceive, player]);
    }
  }

  function removeFromReceive(playerKey: string) {
    setPlayersToReceive(playersToReceive.filter(p => p.playerKey !== playerKey));
  }

  function clearTrade() {
    setPlayersToGive([]);
    setPlayersToReceive([]);
  }

  function handleAnalyze() {
    onAnalyze(playersToGive, playersToReceive);
  }

  const isValidTrade = playersToGive.length > 0 && playersToReceive.length > 0;
  const otherTeams = teams.filter(t => !t.isOwnedByCurrentLogin);
  const availableMyPlayers = myRoster.filter(p => !playersToGive.find(g => g.playerKey === p.playerKey));
  const availablePartnerPlayers = partnerRoster.filter(p => !playersToReceive.find(r => r.playerKey === p.playerKey));

  if (loading) {
    return <LoadingSpinner message="Loading teams..." />;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-400">{error}</p>
        <button
          onClick={loadTeams}
          className="mt-4 px-4 py-2 bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="trade-builder">
      {/* Trade Partner Selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm text-gray-400">Trade Partner:</label>
        <select
          value={selectedPartner?.teamKey || ''}
          onChange={(e) => {
            const team = otherTeams.find(t => t.teamKey === e.target.value);
            setSelectedPartner(team || null);
            setPlayersToReceive([]);
          }}
          className="select flex-1 max-w-md"
          data-testid="trade-partner-select"
        >
          <option value="">Select a team...</option>
          {otherTeams.map(team => (
            <option key={team.teamKey} value={team.teamKey}>
              {team.name} {team.managerName ? `(${team.managerName})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Trade Block Display */}
      {(playersToGive.length > 0 || playersToReceive.length > 0) && (
        <div className="bg-court-base rounded-lg p-4 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-100">Trade Block</h3>
            <button
              onClick={clearTrade}
              className="text-sm text-gray-400 hover:text-gray-200 flex items-center gap-1"
              data-testid="trade-reset-button"
            >
              <X className="w-4 h-4" />
              Clear
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* You Give */}
            <div data-testid="trade-builder-give-panel">
              <p className="text-sm text-red-400 mb-2">You Give:</p>
              <div className="space-y-2">
                {playersToGive.map(player => (
                  <div
                    key={player.playerKey}
                    className="flex items-center justify-between bg-red-900/20 rounded px-3 py-2 border border-red-800/30"
                    data-testid={`trade-player-give-${player.playerKey}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-200">{player.name}</span>
                      <span className="text-xs text-gray-500">{player.position} • {player.team}</span>
                    </div>
                    <button
                      onClick={() => removeFromGive(player.playerKey)}
                      className="text-red-400 hover:text-red-300"
                      data-testid={`trade-player-remove-${player.playerKey}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {/* You Receive */}
            <div data-testid="trade-builder-receive-panel">
              <p className="text-sm text-green-400 mb-2">You Receive:</p>
              <div className="space-y-2">
                {playersToReceive.map(player => (
                  <div
                    key={player.playerKey}
                    className="flex items-center justify-between bg-green-900/20 rounded px-3 py-2 border border-green-800/30"
                    data-testid={`trade-player-receive-${player.playerKey}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-200">{player.name}</span>
                      <span className="text-xs text-gray-500">{player.position} • {player.team}</span>
                    </div>
                    <button
                      onClick={() => removeFromReceive(player.playerKey)}
                      className="text-green-400 hover:text-green-300"
                      data-testid={`trade-player-remove-${player.playerKey}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analyze Button */}
      <div className="flex justify-center">
        <button
          onClick={handleAnalyze}
          disabled={!isValidTrade || isAnalyzing}
          className={`px-6 py-3 rounded-lg font-semibold flex items-center gap-2 transition-all ${
            isValidTrade && !isAnalyzing
              ? 'bg-hawk-orange text-white hover:bg-hawk-orange/90'
              : 'bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          data-testid="analyze-trade-btn"
        >
          {isAnalyzing ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
              Analyzing...
            </>
          ) : (
            <>
              <ArrowRightLeft className="w-5 h-5" />
              Analyze Trade
            </>
          )}
        </button>
      </div>

      {/* Player Selection Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Roster */}
        <div className="card">
          <h3 className="font-semibold text-gray-100 mb-4">Your Roster</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {availableMyPlayers.length > 0 ? (
              availableMyPlayers.map(player => (
                <button
                  key={player.playerKey}
                  onClick={() => addToGive(player)}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-court-base hover:bg-court-base/70 transition-colors border border-white/5"
                  data-testid={`roster-player-${player.playerKey}`}
                >
                  <div className="flex items-center gap-3">
                    {player.imageUrl ? (
                      <img src={player.imageUrl} alt={player.name} className="w-8 h-8 rounded-full" />
                    ) : (
                      <UserCircle className="w-8 h-8 text-gray-600" />
                    )}
                    <div className="text-left">
                      <p className="text-gray-200">{player.name}</p>
                      <p className="text-xs text-gray-500">{player.position} • {player.team}</p>
                    </div>
                  </div>
                  <Plus className="w-5 h-5 text-gray-400" data-testid="trade-builder-add-give" />
                </button>
              ))
            ) : (
              <p className="text-gray-500 text-center py-4">
                {myRoster.length === 0 ? 'Loading roster...' : 'All players selected for trade'}
              </p>
            )}
          </div>
        </div>

        {/* Partner Roster */}
        <div className="card">
          <h3 className="font-semibold text-gray-100 mb-4">
            {selectedPartner ? `${selectedPartner.name}'s Roster` : 'Trade Partner Roster'}
          </h3>
          {!selectedPartner ? (
            <p className="text-gray-500 text-center py-8">
              Select a trade partner to view their roster
            </p>
          ) : rosterLoading ? (
            <LoadingSpinner message="Loading roster..." />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {availablePartnerPlayers.length > 0 ? (
                availablePartnerPlayers.map(player => (
                  <button
                    key={player.playerKey}
                    onClick={() => addToReceive(player)}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-court-base hover:bg-court-base/70 transition-colors border border-white/5"
                    data-testid={`partner-player-${player.playerKey}`}
                  >
                    <div className="flex items-center gap-3">
                      {player.imageUrl ? (
                        <img src={player.imageUrl} alt={player.name} className="w-8 h-8 rounded-full" />
                      ) : (
                        <UserCircle className="w-8 h-8 text-gray-600" />
                      )}
                      <div className="text-left">
                        <p className="text-gray-200">{player.name}</p>
                        <p className="text-xs text-gray-500">{player.position} • {player.team}</p>
                      </div>
                    </div>
                    <Plus className="w-5 h-5 text-gray-400" data-testid="trade-builder-add-receive" />
                  </button>
                ))
              ) : (
                <p className="text-gray-500 text-center py-4">
                  {partnerRoster.length === 0 ? 'No roster data' : 'All players selected for trade'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
