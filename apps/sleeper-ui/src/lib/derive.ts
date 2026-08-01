/**
 * Pure transforms: raw Sleeper payloads -> view models the UI can render directly.
 *
 * Nothing in here does I/O. That is deliberate — every function is testable against
 * the frozen fixtures, which is what makes the screenshots trustworthy.
 */

export interface RawRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    ppts?: number;
    ppts_decimal?: number;
    division?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
  };
}

export interface RawUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  is_owner?: boolean;
  metadata?: { team_name?: string; avatar?: string } | null;
}

export interface RawMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  custom_points: number | null;
  starters: string[] | null;
  starters_points: number[] | null;
  players: string[] | null;
  players_points: Record<string, number> | null;
}

export interface Player {
  id: string;
  name: string;
  pos: string | null;
  team: string | null;
  no?: number | null;
  age?: number | null;
  exp?: number | null;
  status?: string | null;
  bye?: number | null;
  rank?: number | null;
}

export type PlayerIndex = Record<string, Player>;

/** Sleeper splits points into integer + hundredths. Recombine. */
export const pts = (whole?: number | null, decimal?: number | null): number =>
  Math.round(((whole ?? 0) + (decimal ?? 0) / 100) * 100) / 100;

/** A manager's display identity, preferring their custom team name. */
export interface Team {
  rosterId: number;
  ownerId: string | null;
  teamName: string;
  managerName: string;
  avatar: string | null;
}

export function buildTeams(rosters: RawRoster[], users: RawUser[]): Map<number, Team> {
  const byId = new Map(users.map((u) => [u.user_id, u]));
  const out = new Map<number, Team>();
  for (const r of rosters) {
    const u = r.owner_id ? byId.get(r.owner_id) : undefined;
    const managerName = u?.display_name ?? 'Orphan Team';
    out.set(r.roster_id, {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      teamName: u?.metadata?.team_name?.trim() || managerName,
      managerName,
      // A user-uploaded avatar lives in metadata as a full URL; the stock one is an id.
      avatar: u?.metadata?.avatar || (u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null),
    });
  }
  return out;
}

export interface StandingsRow extends Team {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Max points the roster could have scored with a perfect lineup, all season. */
  maxPoints: number;
  /** pointsFor / maxPoints — how well this manager actually set their lineup. */
  efficiency: number;
  division: number | null;
  waiverBudgetUsed: number;
  rank: number;
  winPct: number;
}

export function buildStandings(
  rosters: RawRoster[],
  users: RawUser[]
): StandingsRow[] {
  const teams = buildTeams(rosters, users);
  const rows = rosters.map((r) => {
    const s = r.settings;
    const pointsFor = pts(s.fpts, s.fpts_decimal);
    const maxPoints = pts(s.ppts, s.ppts_decimal);
    const games = s.wins + s.losses + s.ties;
    return {
      ...teams.get(r.roster_id)!,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      pointsFor,
      pointsAgainst: pts(s.fpts_against, s.fpts_against_decimal),
      maxPoints,
      efficiency: maxPoints > 0 ? pointsFor / maxPoints : 0,
      division: s.division ?? null,
      waiverBudgetUsed: s.waiver_budget_used ?? 0,
      winPct: games > 0 ? (s.wins + s.ties * 0.5) / games : 0,
      rank: 0,
    };
  });

  // Sleeper's tiebreaker is win% then points for.
  rows.sort((a, b) => b.winPct - a.winPct || b.pointsFor - a.pointsFor);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export interface MatchupSide {
  team: Team;
  rosterId: number;
  points: number;
  starters: string[];
  startersPoints: number[];
  playersPoints: Record<string, number>;
}

export interface Matchup {
  matchupId: number;
  week: number;
  home: MatchupSide;
  away: MatchupSide | null;
  margin: number;
  /** Combined score — useful for surfacing the week's shootouts. */
  total: number;
}

export function buildMatchups(
  raw: RawMatchup[],
  teams: Map<number, Team>,
  week: number
): Matchup[] {
  const groups = new Map<number, RawMatchup[]>();
  for (const m of raw) {
    if (m.matchup_id == null) continue; // bye / unscheduled
    const g = groups.get(m.matchup_id) ?? [];
    g.push(m);
    groups.set(m.matchup_id, g);
  }

  const side = (m: RawMatchup): MatchupSide => ({
    team: teams.get(m.roster_id) ?? {
      rosterId: m.roster_id,
      ownerId: null,
      teamName: `Roster ${m.roster_id}`,
      managerName: 'Unknown',
      avatar: null,
    },
    rosterId: m.roster_id,
    points: m.custom_points ?? m.points ?? 0,
    starters: m.starters ?? [],
    startersPoints: m.starters_points ?? [],
    playersPoints: m.players_points ?? {},
  });

  const out: Matchup[] = [];
  for (const [matchupId, members] of groups) {
    // Higher score listed first so the winner reads left-to-right.
    const sorted = [...members].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    const home = side(sorted[0]);
    const away = sorted[1] ? side(sorted[1]) : null;
    out.push({
      matchupId,
      week,
      home,
      away,
      margin: away ? Math.round((home.points - away.points) * 100) / 100 : 0,
      total: Math.round((home.points + (away?.points ?? 0)) * 100) / 100,
    });
  }
  return out.sort((a, b) => a.matchupId - b.matchupId);
}

/**
 * Has this week actually been played?
 *
 * Sleeper publishes the full schedule up front, so an unplayed week comes back
 * as a complete set of matchups with every score at 0. Counting those as ties
 * makes a preseason league read as 0-0-11 with a losing streak — so a week only
 * counts once somebody has scored.
 */
function weekWasPlayed(raw: RawMatchup[]): boolean {
  return raw.some((m) => (m.custom_points ?? m.points ?? 0) > 0);
}

/** Win/loss sequence per roster across the season, for streak + trend sparklines. */
export function buildResultTimeline(
  matchupsByWeek: Record<string | number, RawMatchup[]>,
  playoffWeekStart: number
): Map<number, Array<{ week: number; points: number; opponentPoints: number; result: 'W' | 'L' | 'T' }>> {
  const out = new Map<number, Array<{ week: number; points: number; opponentPoints: number; result: 'W' | 'L' | 'T' }>>();

  const weeks = Object.keys(matchupsByWeek)
    .map(Number)
    .filter((w) => !Number.isNaN(w))
    .sort((a, b) => a - b);

  for (const week of weeks) {
    if (week >= playoffWeekStart) break; // regular season only
    const raw = matchupsByWeek[week] ?? [];
    if (!weekWasPlayed(raw)) continue;
    const groups = new Map<number, RawMatchup[]>();
    for (const m of raw) {
      if (m.matchup_id == null) continue;
      const g = groups.get(m.matchup_id) ?? [];
      g.push(m);
      groups.set(m.matchup_id, g);
    }
    for (const members of groups.values()) {
      if (members.length !== 2) continue;
      const [a, b] = members;
      const ap = a.custom_points ?? a.points ?? 0;
      const bp = b.custom_points ?? b.points ?? 0;
      const push = (r: RawMatchup, mine: number, theirs: number) => {
        const list = out.get(r.roster_id) ?? [];
        list.push({
          week,
          points: mine,
          opponentPoints: theirs,
          result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
        });
        out.set(r.roster_id, list);
      };
      push(a, ap, bp);
      push(b, bp, ap);
    }
  }
  return out;
}

/** Current W/L streak from a result timeline, e.g. "W3" or "L1". */
export function currentStreak(
  results: Array<{ result: 'W' | 'L' | 'T' }>
): string {
  if (!results.length) return '—';
  const last = results[results.length - 1].result;
  let n = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].result !== last) break;
    n++;
  }
  return `${last}${n}`;
}

/**
 * "All-play" record: what each team's record would be if they played every other
 * team every week. Strips schedule luck out of the standings — the single most
 * useful thing a dynasty league can look at and Sleeper never shows it.
 */
export function buildAllPlay(
  matchupsByWeek: Record<string | number, RawMatchup[]>,
  playoffWeekStart: number
): Map<number, { wins: number; losses: number; ties: number; pct: number }> {
  const rec = new Map<number, { wins: number; losses: number; ties: number; pct: number }>();
  const weeks = Object.keys(matchupsByWeek)
    .map(Number)
    .filter((w) => !Number.isNaN(w) && w < playoffWeekStart)
    .sort((a, b) => a - b);

  for (const week of weeks) {
    const raw = matchupsByWeek[week] ?? [];
    if (!weekWasPlayed(raw)) continue;
    const scores = raw
      .filter((m) => m.matchup_id != null)
      .map((m) => ({ rosterId: m.roster_id, points: m.custom_points ?? m.points ?? 0 }));
    if (scores.length < 2) continue;

    for (const me of scores) {
      const r = rec.get(me.rosterId) ?? { wins: 0, losses: 0, ties: 0, pct: 0 };
      for (const other of scores) {
        if (other.rosterId === me.rosterId) continue;
        if (me.points > other.points) r.wins++;
        else if (me.points < other.points) r.losses++;
        else r.ties++;
      }
      rec.set(me.rosterId, r);
    }
  }
  for (const r of rec.values()) {
    const g = r.wins + r.losses + r.ties;
    r.pct = g > 0 ? (r.wins + r.ties * 0.5) / g : 0;
  }
  return rec;
}

export type SlotKind = 'starter' | 'bench' | 'ir' | 'taxi';

export interface RosterSlot {
  slot: string;
  kind: SlotKind;
  player: Player | null;
  points?: number;
}

/**
 * Lay a roster out against the league's configured lineup slots, then bucket the
 * remainder into bench / IR / taxi. `rosterPositions` includes BN entries, which
 * we drop — bench is derived from leftovers so it stays correct when rosters are
 * over- or under-filled.
 */
export function buildRosterView(
  roster: RawRoster,
  rosterPositions: string[],
  players: PlayerIndex,
  pointsByPlayer: Record<string, number> = {}
): RosterSlot[] {
  const startingSlots = rosterPositions.filter((p) => p !== 'BN');
  const starters = roster.starters ?? [];
  const out: RosterSlot[] = [];

  startingSlots.forEach((slot, i) => {
    const id = starters[i];
    out.push({
      slot,
      kind: 'starter',
      player: id && id !== '0' ? (players[id] ?? unknownPlayer(id)) : null,
      points: id ? pointsByPlayer[id] : undefined,
    });
  });

  const used = new Set(starters.filter((id) => id && id !== '0'));
  const reserve = new Set(roster.reserve ?? []);
  const taxi = new Set(roster.taxi ?? []);

  for (const id of roster.players ?? []) {
    if (used.has(id)) continue;
    const kind: SlotKind = reserve.has(id) ? 'ir' : taxi.has(id) ? 'taxi' : 'bench';
    out.push({
      slot: kind === 'ir' ? 'IR' : kind === 'taxi' ? 'TAXI' : 'BN',
      kind,
      player: players[id] ?? unknownPlayer(id),
      points: pointsByPlayer[id],
    });
  }

  return out;
}

function unknownPlayer(id: string): Player {
  // Team defenses are keyed by team abbreviation rather than a numeric id.
  if (/^[A-Z]{2,3}$/.test(id)) {
    return { id, name: `${id} Defense`, pos: 'DEF', team: id };
  }
  return { id, name: `Player ${id}`, pos: null, team: null };
}

export const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX', 'SUPER_FLEX'];

export function positionRank(pos: string | null): number {
  const i = POSITION_ORDER.indexOf(pos ?? '');
  return i === -1 ? 99 : i;
}
