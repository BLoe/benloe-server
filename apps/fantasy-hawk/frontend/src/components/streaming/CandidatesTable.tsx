import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Filter } from 'lucide-react';

interface FreeAgent {
  player_key: string;
  name?: { full?: string };
  editorial_team_abbr?: string;
  display_position?: string;
  eligible_positions?: { position: string }[];
  percent_owned?: { value?: string };
  games_this_week: number;
  game_dates: string[];
}

interface CandidatesTableProps {
  freeAgents: FreeAgent[];
  dateRange: { start: string; end: string };
  selectedTeam?: string | null;
  onPlayerClick?: (player: FreeAgent) => void;
}

type SortField = 'name' | 'team' | 'position' | 'games' | 'owned';
type SortDirection = 'asc' | 'desc';

const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];

function getPlayerName(player: FreeAgent): string {
  return player.name?.full || 'Unknown';
}

function getPlayerPositions(player: FreeAgent): string {
  if (player.display_position) return player.display_position;
  if (player.eligible_positions) {
    return player.eligible_positions.map(p => p.position).join(', ');
  }
  return '-';
}

function matchesPosition(player: FreeAgent, positionFilter: string): boolean {
  if (positionFilter === 'All') return true;

  const positions = player.eligible_positions?.map(p => p.position) || [];
  const displayPos = player.display_position || '';

  // Check direct match
  if (positions.includes(positionFilter) || displayPos.includes(positionFilter)) {
    return true;
  }

  // Handle composite positions
  if (positionFilter === 'G') {
    return positions.some(p => ['PG', 'SG', 'G'].includes(p)) ||
           displayPos.includes('PG') || displayPos.includes('SG') || displayPos.includes('G');
  }
  if (positionFilter === 'F') {
    return positions.some(p => ['SF', 'PF', 'F'].includes(p)) ||
           displayPos.includes('SF') || displayPos.includes('PF') || displayPos.includes('F');
  }

  return false;
}

function getDayDots(gameDates: string[], dateRange: { start: string; end: string }): { date: string; hasGame: boolean }[] {
  const dots: { date: string; hasGame: boolean }[] = [];
  const start = new Date(dateRange.start + 'T12:00:00');
  const end = new Date(dateRange.end + 'T12:00:00');

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    dots.push({
      date: dateStr,
      hasGame: gameDates.includes(dateStr),
    });
    current.setDate(current.getDate() + 1);
  }

  return dots;
}

export function CandidatesTable({
  freeAgents,
  dateRange,
  selectedTeam,
  onPlayerClick,
}: CandidatesTableProps) {
  const [sortField, setSortField] = useState<SortField>('games');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [positionFilter, setPositionFilter] = useState('All');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const filteredAndSorted = useMemo(() => {
    let result = [...freeAgents];

    // Filter by team if selected
    if (selectedTeam) {
      result = result.filter(p => p.editorial_team_abbr === selectedTeam);
    }

    // Filter by position
    result = result.filter(p => matchesPosition(p, positionFilter));

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = getPlayerName(a).localeCompare(getPlayerName(b));
          break;
        case 'team':
          cmp = (a.editorial_team_abbr || '').localeCompare(b.editorial_team_abbr || '');
          break;
        case 'position':
          cmp = getPlayerPositions(a).localeCompare(getPlayerPositions(b));
          break;
        case 'games':
          cmp = a.games_this_week - b.games_this_week;
          break;
        case 'owned':
          cmp = parseFloat(a.percent_owned?.value || '0') - parseFloat(b.percent_owned?.value || '0');
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [freeAgents, selectedTeam, positionFilter, sortField, sortDirection]);

  const paginatedResults = useMemo(() => {
    const start = page * pageSize;
    return filteredAndSorted.slice(start, start + pageSize);
  }, [filteredAndSorted, page]);

  const totalPages = Math.ceil(filteredAndSorted.length / pageSize);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'games' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ?
      <ChevronUp className="w-4 h-4 inline" /> :
      <ChevronDown className="w-4 h-4 inline" />;
  };

  if (freeAgents.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500" data-testid="candidates-empty">
        <p className="text-sm">No free agents available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="candidates-table">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={positionFilter}
            onChange={(e) => { setPositionFilter(e.target.value); setPage(0); }}
            className="select text-sm"
            data-testid="candidates-position-filter"
          >
            {POSITIONS.map(pos => (
              <option key={pos} value={pos}>{pos}</option>
            ))}
          </select>
        </div>
        <div className="text-sm text-gray-400">
          {filteredAndSorted.length} players
          {selectedTeam && <span className="text-hawk-orange ml-1">({selectedTeam})</span>}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th
                className="text-left py-2 px-2 cursor-pointer hover:text-white text-gray-400"
                onClick={() => toggleSort('name')}
              >
                Player <SortIcon field="name" />
              </th>
              <th
                className="text-left py-2 px-2 cursor-pointer hover:text-white text-gray-400"
                onClick={() => toggleSort('team')}
              >
                Team <SortIcon field="team" />
              </th>
              <th
                className="text-left py-2 px-2 cursor-pointer hover:text-white text-gray-400"
                onClick={() => toggleSort('position')}
              >
                Pos <SortIcon field="position" />
              </th>
              <th
                className="text-center py-2 px-2 cursor-pointer hover:text-white text-gray-400"
                onClick={() => toggleSort('games')}
              >
                Games <SortIcon field="games" />
              </th>
              <th className="text-center py-2 px-2 text-gray-400">Schedule</th>
              <th
                className="text-right py-2 px-2 cursor-pointer hover:text-white text-gray-400"
                onClick={() => toggleSort('owned')}
              >
                %Own <SortIcon field="owned" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paginatedResults.map((player) => {
              const dots = getDayDots(player.game_dates, dateRange);
              const isHighGames = player.games_this_week >= 4;

              return (
                <tr
                  key={player.player_key}
                  className={`hover:bg-white/5 cursor-pointer transition-colors ${
                    isHighGames ? 'bg-hawk-teal/5' : ''
                  }`}
                  onClick={() => onPlayerClick?.(player)}
                  data-testid={`candidate-row-${player.player_key}`}
                >
                  <td className="py-2 px-2 font-medium text-gray-100">
                    {getPlayerName(player)}
                  </td>
                  <td className="py-2 px-2 text-gray-300">
                    {player.editorial_team_abbr || '-'}
                  </td>
                  <td className="py-2 px-2 text-gray-300">
                    {getPlayerPositions(player)}
                  </td>
                  <td className={`py-2 px-2 text-center font-mono ${
                    isHighGames ? 'text-hawk-teal font-semibold' : 'text-gray-300'
                  }`}>
                    {player.games_this_week}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex justify-center gap-1">
                      {dots.map((dot, i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full ${
                            dot.hasGame ? 'bg-hawk-orange' : 'bg-gray-700'
                          }`}
                          title={dot.date}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right text-gray-400 font-mono">
                    {player.percent_owned?.value || '0'}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-800">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-sm rounded bg-court-surface hover:bg-court-surface/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-400">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 text-sm rounded bg-court-surface hover:bg-court-surface/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// Loading skeleton
export function CandidatesTableSkeleton() {
  return (
    <div className="animate-pulse space-y-3" data-testid="candidates-loading">
      <div className="h-8 bg-gray-700 rounded w-32"></div>
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <div className="h-6 bg-gray-700 rounded flex-1"></div>
            <div className="h-6 bg-gray-700 rounded w-12"></div>
            <div className="h-6 bg-gray-700 rounded w-10"></div>
            <div className="h-6 bg-gray-700 rounded w-8"></div>
            <div className="h-6 bg-gray-700 rounded w-24"></div>
            <div className="h-6 bg-gray-700 rounded w-12"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
