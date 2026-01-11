import { useState, useEffect, useRef } from 'react';
import { Search, X, UserCircle, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';

interface Player {
  playerKey: string;
  name: string;
  firstName?: string;
  lastName?: string;
  position: string;
  team: string;
  teamFull?: string;
  imageUrl?: string;
  status?: string;
  percentOwned?: number;
}

interface PlayerSelectorProps {
  leagueKey: string;
  selectedPlayers: Player[];
  onPlayersChange: (players: Player[]) => void;
  maxPlayers?: number;
}

export function PlayerSelector({
  leagueKey,
  selectedPlayers,
  onPlayersChange,
  maxPlayers = 4,
}: PlayerSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Player[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        setActiveSlot(null);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        setIsSearching(true);
        const data = await api.fantasy.searchPlayers(leagueKey, searchQuery) as {
          players: Player[];
          count: number;
        };

        // Filter out already selected players
        const filteredPlayers = data.players.filter(
          (p) => !selectedPlayers.find((sp) => sp.playerKey === p.playerKey)
        );

        setSearchResults(filteredPlayers);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, leagueKey, selectedPlayers]);

  function handleSlotClick(slotIndex: number) {
    setActiveSlot(slotIndex);
    setShowDropdown(true);
    setSearchQuery('');
    setSearchResults([]);
  }

  function handlePlayerSelect(player: Player) {
    if (activeSlot !== null) {
      const newPlayers = [...selectedPlayers];
      newPlayers[activeSlot] = player;
      onPlayersChange(newPlayers);
    } else {
      // Add to next available slot
      if (selectedPlayers.length < maxPlayers) {
        onPlayersChange([...selectedPlayers, player]);
      }
    }
    setShowDropdown(false);
    setActiveSlot(null);
    setSearchQuery('');
    setSearchResults([]);
  }

  function handleRemovePlayer(index: number) {
    const newPlayers = selectedPlayers.filter((_, i) => i !== index);
    onPlayersChange(newPlayers);
  }

  function getStatusColor(status?: string) {
    if (!status) return '';
    const s = status.toUpperCase();
    if (s === 'INJ' || s === 'O' || s === 'OUT') return 'text-red-400';
    if (s === 'GTD' || s === 'DTD') return 'text-yellow-400';
    if (s === 'IL' || s === 'IL+') return 'text-red-500';
    return 'text-gray-400';
  }

  // Create slots array
  const slots = [];
  for (let i = 0; i < maxPlayers; i++) {
    slots.push(selectedPlayers[i] || null);
  }

  return (
    <div className="space-y-4" data-testid="player-selector">
      {/* Player Slots */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {slots.map((player, index) => (
          <div
            key={index}
            className={`relative rounded-lg border-2 border-dashed transition-all ${
              player
                ? 'border-hawk-orange/30 bg-court-surface'
                : 'border-gray-600 hover:border-gray-500 cursor-pointer'
            } ${activeSlot === index ? 'border-hawk-orange ring-2 ring-hawk-orange/30' : ''}`}
            onClick={() => !player && handleSlotClick(index)}
          >
            {player ? (
              <div className="p-4">
                {/* Remove button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePlayer(index);
                  }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-gray-700 hover:bg-red-500/50 text-gray-400 hover:text-white transition-colors"
                  aria-label="Remove player"
                >
                  <X className="w-3 h-3" />
                </button>

                {/* Player image */}
                <div className="flex justify-center mb-3">
                  {player.imageUrl ? (
                    <img
                      src={player.imageUrl}
                      alt={player.name}
                      className="w-16 h-16 rounded-full object-cover bg-gray-700"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
                      <UserCircle className="w-10 h-10 text-gray-500" />
                    </div>
                  )}
                </div>

                {/* Player info */}
                <div className="text-center">
                  <p className="font-medium text-gray-100 text-sm truncate">
                    {player.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {player.team} · {player.position}
                  </p>
                  {player.status && (
                    <p className={`text-xs ${getStatusColor(player.status)}`}>
                      {player.status}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="p-8 text-center cursor-pointer"
                onClick={() => handleSlotClick(index)}
              >
                <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-gray-700/50 flex items-center justify-center">
                  <Search className="w-5 h-5 text-gray-500" />
                </div>
                <p className="text-sm text-gray-500">
                  {index < 2 ? 'Add Player' : 'Optional'}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Search Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="relative z-50 bg-court-surface rounded-lg border border-gray-700 shadow-xl"
        >
          {/* Search Input */}
          <div className="p-3 border-b border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search players by name..."
                className="w-full pl-10 pr-4 py-2 bg-court-base rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-hawk-orange/50"
                autoFocus
                data-testid="player-search-input"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-hawk-orange border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Search Results */}
          <div className="max-h-64 overflow-y-auto">
            {searchQuery.length < 2 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                Type at least 2 characters to search
              </div>
            ) : searchResults.length === 0 && !isSearching ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No players found
              </div>
            ) : (
              searchResults.map((player) => (
                <button
                  key={player.playerKey}
                  onClick={() => handlePlayerSelect(player)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-court-base transition-colors text-left"
                  data-testid={`search-result-${player.playerKey}`}
                >
                  {/* Player image */}
                  {player.imageUrl ? (
                    <img
                      src={player.imageUrl}
                      alt={player.name}
                      className="w-10 h-10 rounded-full object-cover bg-gray-700"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">
                      <UserCircle className="w-6 h-6 text-gray-500" />
                    </div>
                  )}

                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-100 truncate">
                      {player.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {player.team} · {player.position}
                      {player.percentOwned !== undefined && (
                        <span className="ml-2">
                          {player.percentOwned.toFixed(0)}% owned
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Status */}
                  {player.status && (
                    <span className={`text-xs font-medium ${getStatusColor(player.status)}`}>
                      {player.status}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Close button */}
          <div className="p-2 border-t border-gray-700">
            <button
              onClick={() => {
                setShowDropdown(false);
                setActiveSlot(null);
              }}
              className="w-full py-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Minimum players warning */}
      {selectedPlayers.length < 2 && (
        <div className="flex items-center gap-2 text-sm text-yellow-500">
          <AlertCircle className="w-4 h-4" />
          <span>Select at least 2 players to compare</span>
        </div>
      )}
    </div>
  );
}
