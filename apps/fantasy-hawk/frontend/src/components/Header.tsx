import { ConnectButton } from './ConnectButton';

interface HeaderProps {
  leagues?: any[];
  selectedLeague?: string | null;
  onLeagueChange?: (leagueKey: string) => void;
}

export function Header({ leagues = [], selectedLeague, onLeagueChange }: HeaderProps) {
  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🦅</div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Fantasy Hawk</h1>
                <p className="text-sm text-gray-600">Yahoo Fantasy Basketball Analytics</p>
              </div>
            </div>

            {leagues.length > 0 && (
              <div className="hidden sm:block border-l border-gray-200 pl-6">
                <label htmlFor="league-select" className="sr-only">
                  Select League
                </label>
                <select
                  id="league-select"
                  value={selectedLeague || ''}
                  onChange={(e) => onLeagueChange?.(e.target.value)}
                  className="text-sm border-gray-300 rounded-md shadow-sm focus:border-primary-500 focus:ring-primary-500 py-1.5 pl-3 pr-8"
                >
                  {leagues.map((league) => (
                    <option key={league.league_key} value={league.league_key}>
                      {league.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <ConnectButton />
        </div>

        {/* Mobile league selector */}
        {leagues.length > 0 && (
          <div className="sm:hidden mt-4">
            <select
              value={selectedLeague || ''}
              onChange={(e) => onLeagueChange?.(e.target.value)}
              className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-primary-500 focus:ring-primary-500 py-2"
            >
              {leagues.map((league) => (
                <option key={league.league_key} value={league.league_key}>
                  {league.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  );
}
