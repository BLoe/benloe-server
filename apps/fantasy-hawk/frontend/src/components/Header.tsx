import { ConnectButton } from './ConnectButton';

interface HeaderProps {
  leagues?: any[];
  selectedLeague?: string | null;
  onLeagueChange?: (leagueKey: string) => void;
}

export function Header({ leagues = [], selectedLeague, onLeagueChange }: HeaderProps) {
  return (
    <header className="bg-court-base border-b border-white/10">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-hawk-orange/20 flex items-center justify-center">
                <span className="text-2xl">🦅</span>
              </div>
              <div>
                <h1 className="font-display text-xl font-semibold text-gray-100 tracking-tight">
                  Fantasy Hawk
                </h1>
                <p className="text-xs text-gray-500">Yahoo Fantasy Basketball</p>
              </div>
            </div>

            {/* League Selector - Desktop */}
            {leagues.length > 0 && (
              <div className="hidden sm:flex items-center gap-3 border-l border-white/10 pl-6">
                <span className="text-xs text-gray-500 uppercase tracking-wider">League</span>
                <select
                  id="league-select"
                  value={selectedLeague || ''}
                  onChange={(e) => onLeagueChange?.(e.target.value)}
                  className="select text-sm py-1.5"
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
              className="select w-full text-sm py-2"
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
