import { useEffect, useState } from 'react';

export interface Team {
  rosterId: number;
  ownerId: string | null;
  teamName: string;
  managerName: string;
  avatar: string | null;
}

export interface GameResult {
  week: number;
  points: number;
  opponentPoints: number;
  result: 'W' | 'L' | 'T';
}

export interface StandingsRow extends Team {
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  maxPoints: number;
  efficiency: number;
  division: number | null;
  waiverBudgetUsed: number;
  winPct: number;
  streak: string;
  results: GameResult[];
  allPlay: { wins: number; losses: number; ties: number; pct: number };
}

export interface LeagueInfo {
  leagueId: string;
  name: string;
  season: string;
  status: string;
  avatar: string | null;
  totalRosters: number;
  rosterPositions: string[];
  playoffWeekStart: number;
  playoffTeams: number;
  waiverBudget: number;
  tradeDeadline: number | null;
  divisions: number;
}

export interface LeagueBundle {
  league: LeagueInfo;
  currentWeek: number;
  myRosterId: number | null;
  standings: StandingsRow[];
}

export interface Me {
  user: { userId: string; username: string; displayName: string; avatar: string | null };
  state: { week: number; season: string; season_type: string; display_week: number };
  leagues: Array<{
    leagueId: string;
    name: string;
    season: string;
    status: string;
    totalRosters: number;
    avatar: string | null;
  }>;
}

export interface Player {
  id: string;
  name: string;
  pos: string | null;
  team: string | null;
  no?: number | null;
  age?: number | null;
  status?: string | null;
  bye?: number | null;
}

export interface RosterSlot {
  slot: string;
  kind: 'starter' | 'bench' | 'ir' | 'taxi';
  player: Player | null;
  points?: number;
}

export interface MatchupSide {
  team: Team;
  rosterId: number;
  points: number;
  starters: string[];
  startersPoints: number[];
  lineup: RosterSlot[];
}

export interface Matchup {
  matchupId: number;
  week: number;
  home: MatchupSide;
  away: MatchupSide | null;
  margin: number;
  total: number;
}

export interface ChatMessage {
  id: string;
  text: string;
  created: number;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  isBot: boolean;
  isMine: boolean;
  pinned: boolean;
  edited: boolean;
  continues: boolean;
  dayLabel: string | null;
  reactions: Array<{ emoji: string; count: number }>;
  hasAttachment: boolean;
}

export interface Transaction {
  id: string;
  type: string;
  week: number;
  created: number;
  teams: string[];
  adds: Array<{ player: string; pos: string | null; to: string | null }>;
  drops: Array<{ player: string; pos: string | null; from: string | null }>;
  bid: number | null;
  picks: Array<{ season: string; round: number; from: string | null; to: string | null }>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Minimal fetch hook. Refetches whenever the path changes. */
export function useApi<T>(path: string | null): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: !!path });

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    get<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((err) => live && setState({ data: null, error: err.message, loading: false }));
    return () => {
      live = false;
    };
  }, [path]);

  return state;
}

/* --- formatting ----------------------------------------------------- */

export const fmt1 = (n: number) => n.toFixed(1);
export const fmt2 = (n: number) => n.toFixed(2);
export const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export const record = (w: number, l: number, t: number) => (t ? `${w}-${l}-${t}` : `${w}-${l}`);

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const POS_COLOR: Record<string, string> = {
  QB: 'var(--pos-qb)',
  RB: 'var(--pos-rb)',
  WR: 'var(--pos-wr)',
  TE: 'var(--pos-te)',
  K: 'var(--pos-k)',
  DEF: 'var(--pos-def)',
  FLEX: 'var(--pos-flex)',
  SUPER_FLEX: 'var(--pos-flex)',
};

export const posColor = (pos: string | null | undefined) =>
  POS_COLOR[pos ?? ''] ?? 'var(--pos-def)';
