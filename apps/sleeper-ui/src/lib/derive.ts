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

/* ------------------------------------------------------------------ *
 * Projections
 * ------------------------------------------------------------------ */

export interface Projection {
  points: number;
  /** Games the projection covers — 1 for a week, ~18 for a season. */
  games: number | null;
  opponent: string | null;
  /** A few headline stat lines, already filtered to what this player does. */
  lines: Array<{ label: string; value: number }>;
}

/** Which projected-points field matches this league's scoring. */
export function scoringKey(scoring: Record<string, number> | undefined): 'pts_ppr' | 'pts_half_ppr' | 'pts_std' {
  const rec = scoring?.rec ?? 0;
  if (rec >= 0.75) return 'pts_ppr';
  if (rec >= 0.25) return 'pts_half_ppr';
  return 'pts_std';
}

const PROJECTION_LINES: Array<[string, string]> = [
  ['pass_yd', 'Pass yds'],
  ['pass_td', 'Pass TD'],
  ['pass_int', 'Int'],
  ['rush_yd', 'Rush yds'],
  ['rush_td', 'Rush TD'],
  ['rec', 'Rec'],
  ['rec_yd', 'Rec yds'],
  ['rec_td', 'Rec TD'],
];

/**
 * Reduce a projections payload to one entry per player.
 *
 * The raw response is 5–9MB of every player in the league including thousands
 * with nothing but an ADP, so this keeps only entries that actually carry a
 * points projection.
 */
export function indexProjections(
  raw: any[],
  key: 'pts_ppr' | 'pts_half_ppr' | 'pts_std'
): Record<string, Projection> {
  const out: Record<string, Projection> = {};
  for (const row of raw ?? []) {
    const stats = row?.stats;
    const points = stats?.[key];
    if (points == null || !row.player_id) continue;

    out[row.player_id] = {
      points: Math.round(points * 100) / 100,
      games: stats.gp ?? null,
      opponent: row.opponent ?? null,
      lines: PROJECTION_LINES.filter(([k]) => (stats[k] ?? 0) > 0).map(([k, label]) => ({
        label,
        value: Math.round((stats[k] as number) * 10) / 10,
      })),
    };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Where the season is
 *
 * "Week 1" is wrong for most of the year. Sleeper's state carries a
 * season_type, and in August it reads `pre` with week 0 — a dynasty league is
 * very much alive then, so the header needs to say what is actually going on
 * rather than counting a week that has not happened.
 * ------------------------------------------------------------------ */

export interface NflState {
  week: number;
  display_week?: number;
  season: string;
  season_type: string;
  league_season?: string;
  previous_season?: string;
  season_start_date?: string;
}

export interface Period {
  /** Full label for the header, e.g. "Preseason" or "Week 5". */
  label: string;
  /** Whether an actual game week is being counted. */
  isGameWeek: boolean;
  /** The week to load matchups for; null when nothing is scheduled. */
  week: number | null;
}

/**
 * Describe the point in the season for a given league.
 *
 * A league from a finished season is always "Final" regardless of what the NFL
 * is doing now — you are looking at history, not this week.
 */
export function describePeriod(
  state: NflState,
  league: { season?: string; status?: string; playoffWeekStart?: number } = {}
): Period {
  const playoffStart = league.playoffWeekStart ?? 15;
  const stateSeason = state.league_season ?? state.season;

  // Viewing a past season, or a league that has finished.
  if (league.season && stateSeason && league.season !== stateSeason) {
    return { label: `${league.season} final`, isGameWeek: false, week: playoffStart + 2 };
  }
  if (league.status === 'complete') {
    return { label: 'Final', isGameWeek: false, week: playoffStart + 2 };
  }

  const week = Number(state.display_week ?? state.week) || 0;

  switch (state.season_type) {
    case 'pre':
      return { label: 'Preseason', isGameWeek: false, week: null };
    case 'off':
      return { label: 'Offseason', isGameWeek: false, week: null };
    case 'post':
      return { label: week > 0 ? `Playoffs · Week ${week}` : 'Playoffs', isGameWeek: week > 0, week: week || null };
    case 'regular':
      if (week <= 0) return { label: 'Preseason', isGameWeek: false, week: null };
      return {
        label: week >= playoffStart ? `Playoffs · Week ${week}` : `Week ${week}`,
        isGameWeek: true,
        week,
      };
    default:
      return week > 0
        ? { label: `Week ${week}`, isGameWeek: true, week }
        : { label: 'Offseason', isGameWeek: false, week: null };
  }
}

/* ------------------------------------------------------------------ *
 * League activity
 *
 * Sleeper's transaction feed is shaped for machines: a `type` that says how a
 * move was made rather than what happened, and adds/drops as maps of player id
 * to roster id. Read literally it produces nonsense like a move labelled "add"
 * that only drops somebody.
 *
 * These transforms turn each transaction into one row per manager, which is how
 * a person actually thinks about it: this team added these players and dropped
 * those, on this date, for this much. A two-team trade becomes two rows — one
 * from each side — so every row answers "what did this manager do".
 * ------------------------------------------------------------------ */

export interface RawTransaction {
  transaction_id: string;
  type: string;
  status: string;
  leg: number;
  created: number;
  roster_ids: number[] | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{ season: string; round: number; owner_id: number; previous_owner_id: number }> | null;
  settings: { waiver_bid?: number } | null;
}

export interface ActivityAsset {
  kind: 'player' | 'pick';
  playerId: string | null;
  name: string;
  pos: string | null;
}

export type ActivityAction = 'Added' | 'Dropped' | 'Added & dropped' | 'Trade' | 'Commissioner';

/** One manager's bid in a waiver contest. */
export interface WaiverBid {
  rosterId: number;
  teamName: string;
  amount: number;
  won: boolean;
  /** Why it did not win, in Sleeper's own words, normalised. */
  outcome: 'Won' | 'Outbid' | 'Roster full' | 'Not enough budget' | 'Failed';
}

export interface ActivityRow {
  /** Unique per row — a trade yields one row per team from one transaction. */
  key: string;
  transactionId: string;
  week: number;
  created: number;
  /** What the manager did, in plain terms. */
  action: ActivityAction;
  /** How it was done: waivers, free agency, a trade. */
  method: 'Waivers' | 'Free agency' | 'Trade' | 'Commissioner';
  rosterId: number;
  teamName: string;
  managerName: string;
  added: ActivityAsset[];
  dropped: ActivityAsset[];
  /** FAAB spent, when this was a waiver claim. */
  faab: number | null;
  /** The other side of a trade. */
  counterparties: Array<{ rosterId: number; teamName: string }>;
  /**
   * Contested waiver targets on this row, one entry per player. A single claim
   * can add more than one player, and each is its own separate contest, so this
   * cannot be a flat list of bids.
   */
  contests: WaiverContest[];
}

export interface WaiverContest {
  playerId: string;
  playerName: string;
  bids: WaiverBid[];
}

/**
 * Turn Sleeper's failure note into a short outcome.
 *
 * The notes are full sentences written for a phone notification; a table column
 * needs two words. Anything unrecognised falls back to a generic label rather
 * than being dropped, so a new note never silently disappears.
 */
function bidOutcome(status: string, note: string | undefined): WaiverBid['outcome'] {
  if (status === 'complete') return 'Won';
  const n = (note ?? '').toLowerCase();
  if (n.includes('claimed by another')) return 'Outbid';
  if (n.includes('too many players')) return 'Roster full';
  if (n.includes('budget') || n.includes('enough money')) return 'Not enough budget';
  return 'Failed';
}

/**
 * Index every waiver claim by the week and player it targeted, so a winning
 * claim can show what it beat.
 *
 * Failed claims are the interesting half: they carry the losing bids, and often
 * a bigger bid than the winner that failed for an unrelated reason like a full
 * roster. Sleeper shows none of this.
 */
function indexWaiverBids(
  transactions: RawTransaction[],
  teams: Map<number, Team>
): Map<string, WaiverBid[]> {
  const byTarget = new Map<string, WaiverBid[]>();

  for (const t of transactions) {
    if (t.type !== 'waiver') continue;
    const amount = t.settings?.waiver_bid ?? 0;
    const note = (t as any).metadata?.notes as string | undefined;

    for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
      const key = `${t.leg}:${playerId}`;
      const list = byTarget.get(key) ?? [];
      list.push({
        rosterId,
        teamName: teams.get(rosterId)?.teamName ?? `Roster ${rosterId}`,
        amount,
        won: t.status === 'complete',
        outcome: bidOutcome(t.status, note),
      });
      byTarget.set(key, list);
    }
  }

  for (const [key, list] of byTarget) {
    // A week can contain more than one waiver run — Sleeper's `leg` is 1 for the
    // whole preseason, so the same player can be won twice weeks apart. `created`
    // is when a claim was submitted, not when it was processed, so the runs
    // cannot be separated by time either. Rather than guess which losing bids
    // belonged to which run, drop the ambiguous cases: 2 of 175 targets in a
    // real season, against 45 that are unambiguous.
    if (list.filter((b) => b.won).length !== 1) {
      byTarget.delete(key);
      continue;
    }
    // Highest first; a winning bid sorts above an equal losing one.
    list.sort((a, b) => b.amount - a.amount || Number(b.won) - Number(a.won));
  }
  return byTarget;
}

function assetForPlayer(id: string, players: PlayerIndex): ActivityAsset {
  const p = players[id];
  return {
    kind: 'player',
    playerId: id,
    name: p?.name ?? (/^[A-Z]{2,3}$/.test(id) ? `${id} Defense` : `Player ${id}`),
    pos: p?.pos ?? (/^[A-Z]{2,3}$/.test(id) ? 'DEF' : null),
  };
}

const pickAsset = (season: string, round: number): ActivityAsset => ({
  kind: 'pick',
  playerId: null,
  name: `${season} round ${round} pick`,
  pos: null,
});

export function buildActivityRows(
  transactions: RawTransaction[],
  teams: Map<number, Team>,
  players: PlayerIndex
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  // Built from the full feed, failed claims included — they are where the
  // losing bids live.
  const bidsByTarget = indexWaiverBids(transactions, teams);

  for (const t of transactions) {
    if (t.status !== 'complete') continue;

    // Which rosters this transaction touched. Trades list several; an add or a
    // drop lists one.
    const rosterIds = new Set<number>(t.roster_ids ?? []);
    for (const rid of Object.values(t.adds ?? {})) rosterIds.add(rid);
    for (const rid of Object.values(t.drops ?? {})) rosterIds.add(rid);
    for (const p of t.draft_picks ?? []) {
      rosterIds.add(p.owner_id);
      rosterIds.add(p.previous_owner_id);
    }
    if (!rosterIds.size) continue;

    const isTrade = t.type === 'trade';
    const faab = t.settings?.waiver_bid ?? null;

    for (const rosterId of rosterIds) {
      const team = teams.get(rosterId);

      const added: ActivityAsset[] = [];
      const dropped: ActivityAsset[] = [];

      for (const [playerId, rid] of Object.entries(t.adds ?? {})) {
        if (rid === rosterId) added.push(assetForPlayer(playerId, players));
      }
      for (const [playerId, rid] of Object.entries(t.drops ?? {})) {
        if (rid === rosterId) dropped.push(assetForPlayer(playerId, players));
      }
      for (const p of t.draft_picks ?? []) {
        if (p.owner_id === rosterId) added.push(pickAsset(p.season, p.round));
        else if (p.previous_owner_id === rosterId) dropped.push(pickAsset(p.season, p.round));
      }

      // A roster listed on a transaction that gained and lost nothing has no
      // story to tell; skip it rather than showing an empty row.
      if (!added.length && !dropped.length) continue;

      const action: ActivityAction = isTrade
        ? 'Trade'
        : t.type === 'commissioner'
          ? 'Commissioner'
          : added.length && dropped.length
            ? 'Added & dropped'
            : added.length
              ? 'Added'
              : 'Dropped';

      const method: ActivityRow['method'] = isTrade
        ? 'Trade'
        : t.type === 'waiver'
          ? 'Waivers'
          : t.type === 'commissioner'
            ? 'Commissioner'
            : 'Free agency';

      rows.push({
        key: `${t.transaction_id}:${rosterId}`,
        transactionId: t.transaction_id,
        week: t.leg,
        created: t.created,
        action,
        method,
        rosterId,
        teamName: team?.teamName ?? `Roster ${rosterId}`,
        managerName: team?.managerName ?? 'Unknown',
        added,
        dropped,
        // Only a waiver claim actually spent FAAB.
        faab: method === 'Waivers' && faab != null && faab > 0 ? faab : null,
        counterparties: isTrade
          ? [...rosterIds]
              .filter((id) => id !== rosterId)
              .map((id) => ({ rosterId: id, teamName: teams.get(id)?.teamName ?? `Roster ${id}` }))
          : [],
        // One contest per added player, and only when somebody else bid too.
        contests:
          method === 'Waivers'
            ? Object.entries(t.adds ?? {})
                .filter(([, rid]) => rid === rosterId)
                .map(([pid]) => ({
                  playerId: pid,
                  playerName: assetForPlayer(pid, players).name,
                  bids: bidsByTarget.get(`${t.leg}:${pid}`) ?? [],
                }))
                .filter((c) => c.bids.length > 1)
            : [],
      });
    }
  }

  return rows.sort((a, b) => b.created - a.created || a.teamName.localeCompare(b.teamName));
}

/* ------------------------------------------------------------------ *
 * League chat
 * ------------------------------------------------------------------ */

export interface RawChatMessage {
  message_id: string;
  text: string | null;
  created: number;
  author_id: string;
  author_display_name: string | null;
  author_avatar: string | null;
  author_is_bot?: boolean;
  attachment?: unknown;
  reactions?: Record<string, unknown> | null;
  pinned?: boolean;
  edited?: number | null;
}

export interface ChatMessage {
  id: string;
  text: string;
  created: number;
  authorId: string;
  /** The manager's team name when they are in this league, else their handle. */
  authorName: string;
  authorAvatar: string | null;
  /** Roster this author manages in the league, when they are in it. */
  rosterId: number | null;
  isBot: boolean;
  isMine: boolean;
  pinned: boolean;
  edited: boolean;
  /** True when this continues the previous message from the same author. */
  continues: boolean;
  /** Set on the first message of a calendar day. */
  dayLabel: string | null;
  reactions: Array<{ emoji: string; count: number }>;
  hasAttachment: boolean;
}

/** Messages from the same author inside this window render as one block. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/**
 * Turn a raw message page into a render-ready feed: oldest first, grouped by
 * author, with day separators and league-aware author names.
 *
 * Sleeper returns messages newest-first; a chat log reads oldest-first.
 */
export function buildChatFeed(
  raw: RawChatMessage[],
  opts: {
    teams?: Map<number, Team>;
    rosters?: RawRoster[];
    myUserId?: string | null;
    now?: number;
  } = {}
): ChatMessage[] {
  // Map author user_id -> their team name in this league.
  const nameByUser = new Map<string, Team>();
  if (opts.teams && opts.rosters) {
    for (const r of opts.rosters) {
      const team = opts.teams.get(r.roster_id);
      if (!team) continue;
      if (r.owner_id) nameByUser.set(r.owner_id, team);
      for (const co of r.co_owners ?? []) nameByUser.set(co, team);
    }
  }

  const ordered = [...raw]
    .filter((m) => m && m.message_id)
    .sort((a, b) => a.created - b.created);

  // Sleeper timestamps are milliseconds; guard against seconds just in case.
  const toMs = (t: number) => (t > 1e12 ? t : t * 1000);

  const out: ChatMessage[] = [];
  let prev: ChatMessage | null = null;
  let prevDay: string | null = null;

  for (const m of ordered) {
    const created = toMs(m.created);
    const day = new Date(created).toDateString();
    const sameAuthor = prev?.authorId === m.author_id;
    const withinWindow = prev ? created - prev.created < GROUPING_WINDOW_MS : false;

    const msg: ChatMessage = {
      id: m.message_id,
      text: m.text ?? '',
      created,
      authorId: m.author_id,
      authorName:
        nameByUser.get(m.author_id)?.teamName ?? m.author_display_name ?? 'Unknown',
      authorAvatar: m.author_avatar
        ? m.author_avatar.startsWith('http')
          ? m.author_avatar
          : `https://sleepercdn.com/avatars/thumbs/${m.author_avatar}`
        : (nameByUser.get(m.author_id)?.avatar ?? null),
      rosterId: nameByUser.get(m.author_id)?.rosterId ?? null,
      isBot: !!m.author_is_bot,
      isMine: !!opts.myUserId && m.author_id === opts.myUserId,
      pinned: !!m.pinned,
      edited: !!m.edited,
      continues: sameAuthor && withinWindow && day === prevDay,
      dayLabel: day === prevDay ? null : dayLabel(created, opts.now ?? Date.now()),
      reactions: summariseReactions(m.reactions),
      hasAttachment: m.attachment != null,
    };

    out.push(msg);
    prev = msg;
    prevDay = day;
  }

  return out;
}

/**
 * Sleeper returns reactions as a map. The shape varies (emoji -> count, or
 * emoji -> list of user ids), so handle both rather than guessing.
 */
function summariseReactions(
  reactions: Record<string, unknown> | null | undefined
): Array<{ emoji: string; count: number }> {
  if (!reactions || typeof reactions !== 'object') return [];
  const out: Array<{ emoji: string; count: number }> = [];
  for (const [emoji, value] of Object.entries(reactions)) {
    let count = 0;
    if (typeof value === 'number') count = value;
    else if (Array.isArray(value)) count = value.length;
    else if (value && typeof value === 'object') count = Object.keys(value).length;
    if (count > 0) out.push({ emoji, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

export function dayLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/* ------------------------------------------------------------------ *
 * A player's history in this league
 *
 * Where they came from and everywhere they have been: drafted here, claimed off
 * waivers for this much, traded there. Sleeper shows none of this on a player.
 * ------------------------------------------------------------------ */

export interface PlayerEvent {
  kind: 'drafted' | 'added' | 'dropped' | 'traded';
  week: number | null;
  created: number;
  /** Team that gained them, when there is one. */
  toRosterId: number | null;
  toTeam: string | null;
  /** Team that lost them, when there is one. */
  fromRosterId: number | null;
  fromTeam: string | null;
  /** FAAB paid, on a winning waiver claim. */
  faab: number | null;
  method: 'Draft' | 'Waivers' | 'Free agency' | 'Trade' | 'Commissioner';
  /** Draft position, e.g. "Round 1, pick 7". */
  detail: string | null;
}

export interface RawDraftPick {
  player_id: string;
  round: number;
  pick_no: number;
  draft_slot: number;
  roster_id: number;
  picked_by: string | null;
  is_keeper: boolean | null;
}

export function buildPlayerHistory(
  playerId: string,
  transactions: RawTransaction[],
  draftPicks: RawDraftPick[],
  teams: Map<number, Team>,
  draftSeason?: string
): PlayerEvent[] {
  const events: PlayerEvent[] = [];
  const teamName = (id: number | null | undefined) =>
    id == null ? null : (teams.get(id)?.teamName ?? `Roster ${id}`);

  for (const pick of draftPicks ?? []) {
    if (pick.player_id !== playerId) continue;
    events.push({
      kind: 'drafted',
      week: null,
      // Drafts predate the season; sort them before any transaction.
      created: 0,
      toRosterId: pick.roster_id,
      toTeam: teamName(pick.roster_id),
      fromRosterId: null,
      fromTeam: null,
      faab: null,
      method: 'Draft',
      detail: `Round ${pick.round}, pick ${pick.pick_no}${draftSeason ? ` · ${draftSeason}` : ''}${pick.is_keeper ? ' · keeper' : ''}`,
    });
  }

  for (const t of transactions ?? []) {
    if (t.status !== 'complete') continue;
    const gained = (t.adds ?? {})[playerId];
    const lost = (t.drops ?? {})[playerId];
    if (gained == null && lost == null) continue;

    const method: PlayerEvent['method'] =
      t.type === 'trade'
        ? 'Trade'
        : t.type === 'waiver'
          ? 'Waivers'
          : t.type === 'commissioner'
            ? 'Commissioner'
            : 'Free agency';

    // A trade moves a player between two rosters in one event rather than
    // reading as an unrelated add and drop.
    const kind: PlayerEvent['kind'] =
      method === 'Trade' ? 'traded' : gained != null ? 'added' : 'dropped';

    events.push({
      kind,
      week: t.leg ?? null,
      created: t.created,
      toRosterId: gained ?? null,
      toTeam: teamName(gained),
      fromRosterId: lost ?? null,
      fromTeam: teamName(lost),
      // The bid bought whoever was added. A player dropped in the same
      // transaction was cut to make room and did not cost anything.
      faab:
        method === 'Waivers' && gained != null && (t.settings?.waiver_bid ?? 0) > 0
          ? t.settings!.waiver_bid!
          : null,
      method,
      detail: null,
    });
  }

  return events.sort((a, b) => a.created - b.created);
}

/* ------------------------------------------------------------------ *
 * Roster by position
 *
 * A dynasty manager thinks in positions, not in lineup slots: "how deep am I at
 * running back" is the question, and the answer is spread across the starting
 * lineup, the flex, the bench and the taxi squad. Grouping by position puts the
 * whole depth chart for each position in one place, with each player carrying
 * where they currently sit.
 * ------------------------------------------------------------------ */

/** Slots that any of several positions can fill. */
const FLEX_SLOTS = new Set(['FLEX', 'SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX', 'IDP_FLEX']);

/* ------------------------------------------------------------------ *
 * Projected season
 *
 * With season-long projections and the published schedule, every matchup has an
 * expected result before a game is played. That is the whole preseason story a
 * dynasty manager wants: am I projected to make the playoffs, and who do I have
 * to beat.
 * ------------------------------------------------------------------ */

export interface ProjectedTeam {
  rosterId: number;
  teamName: string;
  managerName: string;
  avatar: string | null;
  /** Expected points in a single week from the best lineup available. */
  weeklyPoints: number;
  /** Starters chosen by projection, in lineup-slot order. */
  lineup: Array<{ slot: string; player: Player; points: number; perWeek: number }>;
  /** Lineup slots with nobody available to fill them. */
  unfilled: number;
  /** Expected wins across the projected schedule — fractional by design. */
  wins: number;
  losses: number;
  rank: number;
}

export interface ProjectedMatchup {
  week: number;
  home: { rosterId: number; teamName: string; points: number };
  away: { rosterId: number; teamName: string; points: number };
  margin: number;
  /** Probability the favourite wins, given weekly scoring variance. */
  favouriteWinChance: number;
}

/**
 * Weekly scoring is noisy — a lineup projected for 120 routinely puts up 90 or
 * 150. Treating the projection as certainty produces silly 14-0 seasons, so
 * matchups are resolved as probabilities instead.
 *
 * The spread is a heuristic: roughly a quarter of a lineup's expected score,
 * floored so a low-scoring lineup is not treated as predictable. It is not
 * fitted to this league — it exists so the model expresses uncertainty rather
 * than pretending there is none.
 */
/** Games one player can appear in. Sleeper's `gp` counts weeks, including byes. */
const NFL_GAMES = 17;

const WEEKLY_SIGMA = (expected: number) => Math.max(12, expected * 0.25);

/** Normal CDF via a standard error-function approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/** Chance team A outscores team B in one week. */
export function winProbability(expectedA: number, expectedB: number): number {
  const sd = Math.sqrt(WEEKLY_SIGMA(expectedA) ** 2 + WEEKLY_SIGMA(expectedB) ** 2);
  if (sd === 0) return expectedA === expectedB ? 0.5 : expectedA > expectedB ? 1 : 0;
  return normalCdf((expectedA - expectedB) / sd);
}

/** Which positions may fill a given lineup slot. */
function eligibleForSlot(slot: string, pos: string | null): boolean {
  if (!pos) return false;
  if (slot === pos) return true;
  if (slot === 'FLEX' || slot === 'WRRB_FLEX') return ['RB', 'WR', 'TE'].includes(pos);
  if (slot === 'REC_FLEX') return ['WR', 'TE'].includes(pos);
  if (slot === 'SUPER_FLEX') return ['QB', 'RB', 'WR', 'TE'].includes(pos);
  return false;
}

/**
 * Choose the highest-projecting legal lineup for a roster.
 *
 * Dedicated slots are filled before flex slots, so a flex never steals the only
 * tight end — which is both what a manager would do and what keeps a roster
 * stacked at one position from skewing the total.
 */
export function projectLineup(
  roster: RawRoster,
  rosterPositions: string[],
  players: PlayerIndex,
  projections: Record<string, { points: number; games?: number | null }>
): {
  total: number;
  perWeek: number;
  lineup: Array<{ slot: string; player: Player; points: number; perWeek: number }>;
  unfilled: number;
} {
  const pool = (roster.players ?? [])
    // Taxi and injured-reserve players cannot be started.
    .filter((id) => !roster.taxi?.includes(id) && !roster.reserve?.includes(id))
    .map((id) => {
      const proj = projections[id];
      const points = proj?.points ?? 0;
      // Season projections cover a whole year; a weekly one covers one game.
      // Dividing by the games it spans gives a comparable per-week figure.
      //
      // Rotowire publishes `gp` as a flat 18 for every player — the length of
      // the NFL calendar, not a projection of who stays healthy. A player
      // appears in at most 17 of those weeks, so 17 is the honest divisor: the
      // result is what he is worth in a week he actually plays, which is the
      // week a manager is deciding about.
      const games = Math.min(NFL_GAMES, Math.max(1, proj?.games ?? NFL_GAMES));
      return { id, player: players[id], points, perWeek: points / games };
    })
    .filter((p) => p.player)
    .sort((a, b) => b.perWeek - a.perWeek);

  const used = new Set<string>();
  const lineup: Array<{ slot: string; player: Player; points: number; perWeek: number }> = [];
  let unfilled = 0;

  const slots = rosterPositions.filter((p) => p !== 'BN');
  const ordered = [
    ...slots.filter((s) => !FLEX_SLOTS.has(s)),
    ...slots.filter((s) => FLEX_SLOTS.has(s)),
  ];

  for (const slot of ordered) {
    const pick = pool.find((p) => !used.has(p.id) && eligibleForSlot(slot, p.player.pos));
    if (!pick) {
      unfilled++;
      continue;
    }
    used.add(pick.id);
    lineup.push({
      slot,
      player: pick.player,
      points: Math.round(pick.points * 100) / 100,
      perWeek: Math.round(pick.perWeek * 100) / 100,
    });
  }

  const total = lineup.reduce((sum, s) => sum + s.points, 0);
  const perWeek = lineup.reduce((sum, s) => sum + s.perWeek, 0);
  // Re-sort into the league's own lineup order so it reads like a lineup card.
  lineup.sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot));
  return {
    total: Math.round(total * 100) / 100,
    perWeek: Math.round(perWeek * 100) / 100,
    lineup,
    unfilled,
  };
}

/**
 * Project the season: each roster's weekly points, then every scheduled matchup
 * resolved by comparing those two numbers.
 *
 * Deliberately simple — one expected score per team, no variance. It answers
 * "who is better on paper", not "what are my playoff odds"; presenting it as
 * more than that would overstate what a single projection source supports.
 */
export function projectSeason(
  rosters: RawRoster[],
  users: RawUser[],
  rosterPositions: string[],
  players: PlayerIndex,
  projections: Record<string, { points: number; games?: number | null }>,
  schedule: Record<string | number, RawMatchup[]>,
  playoffWeekStart: number
): { teams: ProjectedTeam[]; matchups: ProjectedMatchup[] } {
  const teamsById = buildTeams(rosters, users);
  const byRoster = new Map<number, ProjectedTeam>();

  for (const roster of rosters) {
    const { perWeek, lineup, unfilled } = projectLineup(
      roster,
      rosterPositions,
      players,
      projections
    );
    const team = teamsById.get(roster.roster_id)!;
    byRoster.set(roster.roster_id, {
      rosterId: roster.roster_id,
      teamName: team.teamName,
      managerName: team.managerName,
      avatar: team.avatar,
      weeklyPoints: perWeek,
      lineup,
      unfilled,
      wins: 0,
      losses: 0,
      rank: 0,
    });
  }

  const matchups: ProjectedMatchup[] = [];
  const weeks = Object.keys(schedule)
    .map(Number)
    .filter((w) => !Number.isNaN(w) && w < playoffWeekStart)
    .sort((a, b) => a - b);

  for (const week of weeks) {
    const groups = new Map<number, RawMatchup[]>();
    for (const m of schedule[week] ?? []) {
      if (m.matchup_id == null) continue;
      const g = groups.get(m.matchup_id) ?? [];
      g.push(m);
      groups.set(m.matchup_id, g);
    }

    for (const pair of groups.values()) {
      if (pair.length !== 2) continue;
      const a = byRoster.get(pair[0].roster_id);
      const b = byRoster.get(pair[1].roster_id);
      if (!a || !b) continue;

      // Expected wins, not a coin flip on the higher number — a 3-point edge
      // is nearly even, and the record should say so.
      const pA = winProbability(a.weeklyPoints, b.weeklyPoints);
      a.wins += pA;
      a.losses += 1 - pA;
      b.wins += 1 - pA;
      b.losses += pA;

      const [home, away] = a.weeklyPoints >= b.weeklyPoints ? [a, b] : [b, a];
      matchups.push({
        week,
        home: { rosterId: home.rosterId, teamName: home.teamName, points: home.weeklyPoints },
        away: { rosterId: away.rosterId, teamName: away.teamName, points: away.weeklyPoints },
        margin: Math.round((home.weeklyPoints - away.weeklyPoints) * 100) / 100,
        favouriteWinChance:
          Math.round(winProbability(home.weeklyPoints, away.weeklyPoints) * 1000) / 1000,
      });
    }
  }

  for (const t of byRoster.values()) {
    t.wins = Math.round(t.wins * 10) / 10;
    t.losses = Math.round(t.losses * 10) / 10;
  }

  const teams = [...byRoster.values()].sort(
    (a, b) => b.wins - a.wins || b.weeklyPoints - a.weeklyPoints
  );
  teams.forEach((t, i) => (t.rank = i + 1));

  return { teams, matchups };
}



export interface DepthEntry {
  player: Player;
  /** Where they sit: a real lineup slot, or BN / TAXI / IR. */
  slot: string;
  kind: SlotKind;
  /** Starting, but in a flex slot rather than their own position's. */
  isFlex: boolean;
  points?: number;
}

export interface PositionGroup {
  pos: string;
  entries: DepthEntry[];
  counts: { starting: number; flex: number; bench: number; taxi: number; ir: number };
  /** Lineup slots for this position that nobody is filling. */
  emptySlots: string[];
}

/**
 * Build a depth chart: one group per position, starters first, then bench, then
 * taxi, then injured reserve.
 *
 * Position order follows the league's own lineup so the positions it actually
 * starts lead, and anything else trails in a stable order.
 */
export function buildDepthChart(
  roster: RawRoster,
  rosterPositions: string[],
  players: PlayerIndex,
  pointsByPlayer: Record<string, number> = {}
): PositionGroup[] {
  const slots = buildRosterView(roster, rosterPositions, players, pointsByPlayer);
  const groups = new Map<string, PositionGroup>();

  const groupFor = (pos: string): PositionGroup => {
    let g = groups.get(pos);
    if (!g) {
      g = {
        pos,
        entries: [],
        counts: { starting: 0, flex: 0, bench: 0, taxi: 0, ir: 0 },
        emptySlots: [],
      };
      groups.set(pos, g);
    }
    return g;
  };

  for (const slot of slots) {
    if (!slot.player) {
      // An unfilled starting slot still belongs somewhere — a flex nobody is in
      // is a hole in the lineup, so surface it against its own heading.
      if (slot.kind === 'starter') groupFor(FLEX_SLOTS.has(slot.slot) ? 'FLEX' : slot.slot).emptySlots.push(slot.slot);
      continue;
    }

    const isFlex = slot.kind === 'starter' && FLEX_SLOTS.has(slot.slot);
    // A flex starter belongs with their own position: the point of the group is
    // "here are all my running backs", and a flex RB is still a running back.
    const pos = slot.player.pos ?? (isFlex ? 'FLEX' : slot.slot);
    const g = groupFor(pos);

    g.entries.push({
      player: slot.player,
      slot: slot.slot,
      kind: slot.kind,
      isFlex,
      points: slot.points,
    });

    if (slot.kind === 'starter') {
      g.counts.starting++;
      if (isFlex) g.counts.flex++;
    } else if (slot.kind === 'bench') g.counts.bench++;
    else if (slot.kind === 'taxi') g.counts.taxi++;
    else if (slot.kind === 'ir') g.counts.ir++;
  }

  const rank: Record<SlotKind, number> = { starter: 0, bench: 1, taxi: 2, ir: 3 };
  for (const g of groups.values()) {
    g.entries.sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] ||
        // Within the starters, a dedicated slot outranks a flex.
        Number(a.isFlex) - Number(b.isFlex) ||
        (b.points ?? 0) - (a.points ?? 0) ||
        a.player.name.localeCompare(b.player.name)
    );
  }

  // Positions the league starts, in lineup order, then everything else.
  const leagueOrder = rosterPositions
    .filter((p) => p !== 'BN' && !FLEX_SLOTS.has(p))
    .filter((p, i, arr) => arr.indexOf(p) === i);
  const order = [...leagueOrder, ...POSITION_ORDER];

  return [...groups.values()].sort((a, b) => {
    const ai = order.indexOf(a.pos);
    const bi = order.indexOf(b.pos);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.pos.localeCompare(b.pos);
  });
}

export const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX', 'SUPER_FLEX'];

export function positionRank(pos: string | null): number {
  const i = POSITION_ORDER.indexOf(pos ?? '');
  return i === -1 ? 99 : i;
}
