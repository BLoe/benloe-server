import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { useAuth } from './hooks/useAuth';
import { LoadingSpinner } from './components/LoadingSpinner';
import { api } from './services/api';

// Helper to parse Yahoo's complex JSON structure for leagues
function parseLeaguesFromResponse(data: any): any[] {
  try {
    const content = data?.fantasy_content;
    if (!content) return [];

    const users = content.users;
    if (!users || !users['0']) return [];

    const user = users['0'].user;
    if (!Array.isArray(user) || user.length < 2) return [];

    const gamesData = user[1].games;
    if (!gamesData || !gamesData['0']) return [];

    const game = gamesData['0'].game;
    if (!Array.isArray(game) || game.length < 2) return [];

    const leaguesData = game[1].leagues;
    if (!leaguesData) return [];

    const count = leaguesData.count || 0;
    const leagues: any[] = [];

    for (let i = 0; i < count; i++) {
      if (leaguesData[i] && leaguesData[i].league) {
        const leagueArray = leaguesData[i].league;
        if (Array.isArray(leagueArray) && leagueArray.length > 0) {
          leagues.push(leagueArray[0]);
        }
      }
    }

    return leagues;
  } catch (err) {
    console.error('Error parsing leagues:', err);
    return [];
  }
}

function App() {
  const { isAuthenticated, isConnected, isLoading: authLoading } = useAuth();
  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [leaguesLoading, setLeaguesLoading] = useState(false);

  // Load leagues when connected
  useEffect(() => {
    if (isConnected) {
      loadLeagues();
    }
  }, [isConnected]);

  async function loadLeagues() {
    try {
      setLeaguesLoading(true);
      const leaguesData = await api.fantasy.getLeagues('nba');
      const leaguesList = parseLeaguesFromResponse(leaguesData);
      setLeagues(leaguesList);

      if (leaguesList.length > 0 && !selectedLeague) {
        setSelectedLeague(leaguesList[0].league_key);
      }
    } catch (err) {
      console.error('Failed to load leagues:', err);
    } finally {
      setLeaguesLoading(false);
    }
  }

  const isLoading = authLoading || leaguesLoading;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        leagues={leagues}
        selectedLeague={selectedLeague}
        onLeagueChange={setSelectedLeague}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <LoadingSpinner message="Loading Fantasy Hawk..." />
        ) : !isAuthenticated ? (
          <div className="card text-center py-12">
            <div className="text-6xl mb-4">🦅</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Fantasy Hawk</h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Analyze your Yahoo Fantasy Basketball teams, players, and league statistics with
              powerful visualizations.
            </p>
            <div className="text-sm text-gray-500">
              Click "Sign in to benloe.com" above to get started
            </div>
          </div>
        ) : !isConnected ? (
          <div className="card text-center py-12">
            <div className="text-6xl mb-4">🏀</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Connect Your Yahoo Account</h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              You're signed in! Now connect your Yahoo Fantasy Basketball account to start analyzing
              your teams, players, and league statistics.
            </p>
            <div className="text-sm text-gray-500">
              Click "Connect Yahoo Account" above to continue
            </div>
          </div>
        ) : leagues.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-6xl mb-4">🏀</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Leagues Found</h2>
            <p className="text-gray-600">
              You don't appear to be in any Yahoo Fantasy Basketball leagues this season.
            </p>
          </div>
        ) : (
          <Dashboard selectedLeague={selectedLeague} />
        )}
      </main>
    </div>
  );
}

export default App;
