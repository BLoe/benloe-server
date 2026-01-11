import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { useAuth } from './hooks/useAuth';
import { LoadingSpinner } from './components/LoadingSpinner';
import { api } from './services/api';
import { LearningModeProvider } from './contexts/LearningModeContext';

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
  const { isAuthenticated, isConnected, isLoading: authLoading, role } = useAuth();
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
    <LearningModeProvider>
    <div className="min-h-screen bg-court-deep">
      <Header
        leagues={leagues}
        selectedLeague={selectedLeague}
        onLeagueChange={setSelectedLeague}
      />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <LoadingSpinner message="Loading Fantasy Hawk..." />
        ) : !isAuthenticated ? (
          <div className="card text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-hawk-orange/20 flex items-center justify-center">
              <span className="text-5xl">🦅</span>
            </div>
            <h2 className="font-display text-3xl font-semibold text-gray-100 mb-3">
              Welcome to Fantasy Hawk
            </h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Analyze your Yahoo Fantasy Basketball teams with powerful visualizations
              and AI-powered insights.
            </p>
            <div className="text-sm text-gray-500">
              Click <span className="text-hawk-orange">"Sign In"</span> above to get started
            </div>
          </div>
        ) : !isConnected ? (
          <div className="card text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-hawk-indigo/20 flex items-center justify-center">
              <span className="text-5xl">🏀</span>
            </div>
            <h2 className="font-display text-3xl font-semibold text-gray-100 mb-3">
              Connect Your Yahoo Account
            </h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              You're signed in! Now connect your Yahoo Fantasy account to start
              analyzing your teams and leagues.
            </p>
            <div className="text-sm text-gray-500">
              Click <span className="text-hawk-orange">"Connect Yahoo"</span> above to continue
            </div>
          </div>
        ) : leagues.length === 0 ? (
          <div className="card text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-court-surface flex items-center justify-center">
              <span className="text-5xl">🏀</span>
            </div>
            <h2 className="font-display text-2xl font-semibold text-gray-100 mb-3">
              No Leagues Found
            </h2>
            <p className="text-gray-400">
              You don't appear to be in any Yahoo Fantasy Basketball leagues this season.
            </p>
          </div>
        ) : (
          <Dashboard selectedLeague={selectedLeague} userRole={role} />
        )}
      </main>
    </div>
    </LearningModeProvider>
  );
}

export default App;
