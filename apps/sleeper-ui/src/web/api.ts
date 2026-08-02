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

export interface Period {
  label: string;
  isGameWeek: boolean;
  week: number | null;
}

export interface LeagueBundle {
  league: LeagueInfo;
  currentWeek: number;
  period: Period;
  myRosterId: number | null;
  standings: StandingsRow[];
}

export interface DepthEntry {
  player: Player;
  slot: string;
  kind: 'starter' | 'bench' | 'ir' | 'taxi';
  isFlex: boolean;
  points?: number;
}

export interface PositionGroup {
  pos: string;
  entries: DepthEntry[];
  counts: { starting: number; flex: number; bench: number; taxi: number; ir: number };
  emptySlots: string[];
}

export interface WaiverBid {
  rosterId: number;
  teamName: string;
  amount: number;
  won: boolean;
  outcome: 'Won' | 'Outbid' | 'Roster full' | 'Not enough budget' | 'Failed';
}

export interface WaiverContest {
  playerId: string;
  playerName: string;
  bids: WaiverBid[];
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
  rosterId: number | null;
  isBot: boolean;
  isMine: boolean;
  pinned: boolean;
  edited: boolean;
  continues: boolean;
  dayLabel: string | null;
  reactions: Array<{ emoji: string; count: number }>;
  hasAttachment: boolean;
}

export interface ActivityAsset {
  kind: 'player' | 'pick';
  playerId: string | null;
  name: string;
  pos: string | null;
}

export interface ActivityRow {
  key: string;
  transactionId: string;
  week: number;
  created: number;
  action: 'Added' | 'Dropped' | 'Added & dropped' | 'Trade' | 'Commissioner';
  method: 'Waivers' | 'Free agency' | 'Trade' | 'Commissioner';
  rosterId: number;
  teamName: string;
  managerName: string;
  added: ActivityAsset[];
  dropped: ActivityAsset[];
  faab: number | null;
  counterparties: Array<{ rosterId: number; teamName: string }>;
  contests: WaiverContest[];
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

/**
 * A projected record is fractional — 9.8-4.2 says more than a rounded 10-4,
 * because the tenth is the part the model is unsure about.
 */
export const projectedRecord = (w: number, l: number) => `${fmt1(w)}-${fmt1(l)}`;

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

/**
 * Two tokens per position: a validated chart-mark colour and a lighter ink for
 * text. A mark sits on the surface as a fill; text has to clear 4.5:1.
 */
const POS_SLOTS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX', 'SUPER_FLEX'] as const;

const slug = (pos: string | null | undefined) => {
  const p = (pos ?? '').toUpperCase();
  if (p === 'SUPER_FLEX') return 'flex';
  return (POS_SLOTS as readonly string[]).includes(p) ? p.toLowerCase() : 'def';
};

export const posColor = (pos: string | null | undefined) => `var(--pos-${slug(pos)})`;
export const posInk = (pos: string | null | undefined) => `var(--pos-${slug(pos)}-ink)`;

/** Player detail, as returned by /api/league/:id/player/:playerId. */
export interface PlayerDetail {
  player: Player & { exp?: number | null; height?: string | null; weight?: string | null };
  owner: { rosterId: number; teamName: string; managerName: string; avatar: string | null } | null;
  onTaxi: boolean;
  onIr: boolean;
  isStarter: boolean;
  weeks: Array<{ week: number; points: number; started: boolean }>;
  totals: { points: number; games: number; average: number; best: number };
  news: Array<{
    title: string | null;
    body: string | null;
    source: string | null;
    published: number | null;
    url: string | null;
  }>;
  outlook: { text: string; source: string | null; season: string } | null;
  history: PlayerEvent[];
  projection: {
    season: Projection | null;
    week: Projection | null;
    weekNumber: number | null;
    scoring: 'pts_ppr' | 'pts_half_ppr' | 'pts_std';
  };
}

export interface Projection {
  points: number;
  games: number | null;
  opponent: string | null;
  lines: Array<{ label: string; value: number }>;
}

export interface PlayerEvent {
  kind: 'drafted' | 'added' | 'dropped' | 'traded';
  week: number | null;
  created: number;
  toRosterId: number | null;
  toTeam: string | null;
  fromRosterId: number | null;
  fromTeam: string | null;
  faab: number | null;
  method: 'Draft' | 'Waivers' | 'Free agency' | 'Trade' | 'Commissioner';
  detail: string | null;
}

/* --- projections ---------------------------------------------------- */

export interface ProjectedTeam {
  rosterId: number;
  teamName: string;
  managerName: string;
  avatar: string | null;
  weeklyPoints: number;
  lineup: Array<{ slot: string; player: Player; points: number; perWeek: number }>;
  unfilled: number;
  wins: number;
  losses: number;
  rank: number;
}

export interface ProjectedMatchup {
  week: number;
  home: { rosterId: number; teamName: string; points: number };
  away: { rosterId: number; teamName: string; points: number };
  margin: number;
  favouriteWinChance: number;
}

export interface SeasonProjection {
  available: boolean;
  season?: string;
  playoffTeams?: number;
  weeksProjected?: number;
  myRosterId?: number | null;
  teams: ProjectedTeam[];
  matchups: ProjectedMatchup[];
}

/** Projection map keyed by player id, as attached to roster and matchup responses. */
export type ProjectionMap = Record<string, Projection>;

/* --- news desk ------------------------------------------------------ */

export interface NewsItem {
  source: string;
  provider: 'sleeper' | 'espn' | 'outlook';
  title: string;
  body: string | null;
  url: string | null;
  published: number | null;
  kind: 'news' | 'outlook';
}

export interface Brief {
  summary: string;
  points: string[];
  watch: string[];
  sources: string[];
  generatedAt: number;
  model: string;
}
