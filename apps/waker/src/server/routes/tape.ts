/**
 * The Tape — what a player is being *used* like, week by week.
 *
 * DECISION SERVED: "who is about to be better than his box score says, and who
 * is about to be worse?"
 *
 * Points are a lagging measure. A back takes over a backfield in week 6 and
 * scores the touchdowns in week 9, and for those three weeks his line reads the
 * same as the man he replaced. Snap share and target share move first, so the
 * gap between usage and production is the closest thing to a leading indicator
 * this sport offers. `findDivergence` does the ranking; this route's job is to
 * gather the inputs, keep the weekly series intact so the gap can be *seen*
 * rather than asserted, and say plainly which season it is reading.
 *
 * Free agents are included on purpose. The same calculation that says "buy him
 * from his manager" says "claim him off the wire", and splitting those into two
 * screens would be an artefact of ownership rather than of the question.
 */
import express from 'express';
import {
  findDivergence,
  usageTrend,
  type DivergenceRow,
  type PlayerUsageInput,
} from '../../lib/analysis/divergence.js';
import {
  loadLeague,
  loadLeagueUsers,
  loadMarketFor,
  loadPlayers,
  loadProjections,
  loadRosters,
  loadState,
  myRoster,
  perWeek,
  teamNames,
  type PlayerRow,
} from '../data.js';
import { COOKIE_NAME, readCookie, verifySession, type Session } from '../session.js';

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

/**
 * The last week worth reading as usage.
 *
 * Week 18 is excluded everywhere, in season and out. It is the week playoff
 * teams rest their starters, so a player's snap share collapses for a reason
 * that says nothing about his role — reading it produced a list led by starters
 * who had sat out, which is an artefact, not a finding. The clamp also covers
 * the NFL postseason, where `week` keeps counting but no fantasy league is
 * still playing.
 */
export const LAST_USABLE_WEEK = 17;

/** Four recent games in season; see WINDOW in divergence.ts for why four. */
export const IN_SEASON_WINDOW = 4;

export interface TapeWindow {
  throughWeek: number;
  window: number;
  inSeason: boolean;
}

/**
 * Which weeks to judge on, from the NFL state.
 *
 * Out of season — which is most of a dynasty manager's year — the whole season
 * that was played is the answer rather than a fallback: what a player did last
 * year is exactly the history you are reasoning from.
 */
export function usageWindowFor(state: { season_type?: string; week?: number }): TapeWindow {
  const inSeason = state.season_type === 'regular' || state.season_type === 'post';
  const week = state.week ?? 0;
  if (!inSeason || week <= 0) {
    return { throughWeek: LAST_USABLE_WEEK, window: LAST_USABLE_WEEK, inSeason: false };
  }
  return {
    throughWeek: Math.min(LAST_USABLE_WEEK, week),
    window: IN_SEASON_WINDOW,
    inSeason: true,
  };
}

/* ------------------------------------------------------------------ *
 * The payload
 * ------------------------------------------------------------------ */

/** One week of a player's tape. Nulls are honest gaps — a bye, or a game missed. */
export interface TapeWeek {
  week: number;
  /** Share of his offence's snaps, 0-1. */
  snap: number | null;
  /** Share of his team's targets, 0-1. */
  target: number | null;
  points: number | null;
}

export interface TapeRow {
  id: string;
  name: string;
  position: string;
  team: string | null;
  /** Oldest week first, only weeks with something in them. */
  weeks: TapeWeek[];
  divergence: DivergenceRow;
  /**
   * Change in snap share across the window, in share points. Separate from the
   * divergence because a player under-producing on *steady* usage is a
   * regression bet, and one whose usage only just arrived is a breakout — worth
   * much more, and only a trend tells them apart.
   */
  trend: number | null;
  rostered: boolean;
  rosterId: number | null;
  teamName: string | null;
  mine: boolean;
  /** Dynasty trade value, where the market has an opinion. */
  value: number | null;
  /** Seven-day move in that value, from KeepTradeCut. */
  valueTrend: number | null;
  /** Season projection expressed per week, for comparison with what he scores. */
  projected: number | null;
}

/** How many players to send. Enough to be a waiver tool, not the whole league. */
export const TAPE_LIMIT = 250;

/**
 * A week of usage as this route reads it: nflverse's own fields plus the
 * receptions needed to price them in the asking league's scoring.
 */
export type TapeUsageWeek = PlayerUsageInput['usage'][number] & { receptions?: number };

/** The inputs buildTape needs, narrowed so it can be tested without a Market. */
export interface TapeSources {
  players: Record<string, Pick<PlayerRow, 'id' | 'name' | 'pos' | 'team'>>;
  snaps: Map<string, { weeks: Array<{ week: number; offensePct: number }> }>;
  usage: Map<string, { weeks: TapeUsageWeek[] }>;
  /**
   * Points per reception in the asking league. nflverse files standard-scoring
   * fantasy points, which understate a receiver by a third in a PPR league —
   * and this screen's headline figure is points per game, so the unit has to be
   * the manager's own. Receptions are the only difference between the two
   * columns nflverse publishes, so scaling by `rec` is exact rather than an
   * approximation. Nothing else in a scoring setting is reconstructed here.
   */
  pointsPerReception?: number;
  values: Map<string, { dynasty: number | null; trend7Day: number | null }>;
  /** Sleeper id -> the roster holding him. Absent means free agent. */
  ownerOf: Map<string, { rosterId: number; teamName: string; mine: boolean }>;
  projections: Record<string, { points: number; games: number | null }>;
  throughWeek: number;
  window: number;
  limit?: number;
}

export interface Tape {
  rows: TapeRow[];
  /** How many players the divergence ranked before the cap. */
  considered: number;
  /** X domain every sparkline shares, so two rows can be compared by shape. */
  weekFrom: number;
  weekTo: number;
  /** First week of the judging window, for marking it on the series. */
  windowFrom: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Assemble the tape.
 *
 * Ranked by |pointsGap| rather than by the percentile divergence, because the
 * cap has to keep the rows that are *worth points*. A twelfth receiver can be
 * thirty percentile points out of line and be worth a point a game; that is a
 * true statement about a player nobody should act on.
 */
export function buildTape(src: TapeSources): Tape {
  const rec = src.pointsPerReception ?? 0;
  const scored = new Map<string, PlayerUsageInput['usage']>();

  const usageInputs: PlayerUsageInput[] = [];
  for (const [id, u] of src.usage) {
    const p = src.players[id];
    if (!p) continue;
    const weeks = rec
      ? u.weeks.map((w) => ({ ...w, points: w.points + rec * (w.receptions ?? 0) }))
      : u.weeks;
    scored.set(id, weeks);
    usageInputs.push({
      playerId: id,
      position: p.pos,
      snaps: src.snaps.get(id)?.weeks ?? [],
      usage: weeks,
    });
  }

  const ranked = findDivergence(usageInputs, src.throughWeek, src.window);
  const limit = src.limit ?? TAPE_LIMIT;

  const rows = [...ranked]
    .sort((a, b) => Math.abs(b.pointsGap) - Math.abs(a.pointsGap))
    .slice(0, limit)
    .map((d) => toRow(d, src, scored.get(d.playerId) ?? []));

  return {
    rows,
    considered: ranked.length,
    // Always from week one, even when nobody in the list played it. A shared
    // domain is the whole reason two sparklines can be compared at a glance,
    // and a per-player domain would silently rescale every row.
    weekFrom: 1,
    weekTo: src.throughWeek,
    windowFrom: Math.max(1, src.throughWeek - src.window + 1),
  };
}

function toRow(
  d: DivergenceRow,
  src: TapeSources,
  usageWeeks: PlayerUsageInput['usage']
): TapeRow {
  const p = src.players[d.playerId];
  const snapWeeks = src.snaps.get(d.playerId)?.weeks ?? [];
  const owner = src.ownerOf.get(d.playerId);
  const value = src.values.get(d.playerId);

  // Merge the two feeds into one weekly row. They mostly agree on which weeks
  // exist, but not always: nflverse files a snap count for a game a player
  // played without touching the ball, and that is real information.
  const byWeek = new Map<number, TapeWeek>();
  const cell = (week: number): TapeWeek => {
    let c = byWeek.get(week);
    if (!c) {
      c = { week, snap: null, target: null, points: null };
      byWeek.set(week, c);
    }
    return c;
  };

  for (const s of snapWeeks) {
    if (s.week < 1 || s.week > src.throughWeek) continue;
    cell(s.week).snap = r3(s.offensePct);
  }
  for (const u of usageWeeks) {
    if (u.week < 1 || u.week > src.throughWeek) continue;
    const c = cell(u.week);
    c.target = u.targetShare == null ? null : r3(u.targetShare);
    c.points = r1(u.points);
  }

  return {
    id: d.playerId,
    name: p?.name ?? d.playerId,
    position: d.position,
    team: p?.team ?? null,
    weeks: [...byWeek.values()].sort((a, b) => a.week - b.week),
    divergence: {
      ...d,
      snapShare: d.snapShare == null ? null : r3(d.snapShare),
      targetShare: d.targetShare == null ? null : r3(d.targetShare),
      pointsPerGame: r1(d.pointsPerGame),
      expectedPointsPerGame: r1(d.expectedPointsPerGame),
      pointsGap: r1(d.pointsGap),
      usageRank: r3(d.usageRank),
      productionRank: r3(d.productionRank),
      divergence: r3(d.divergence),
    },
    trend: (() => {
      const t = usageTrend(snapWeeks, src.throughWeek, src.window);
      return t == null ? null : r3(t);
    })(),
    rostered: !!owner,
    rosterId: owner?.rosterId ?? null,
    teamName: owner?.teamName ?? null,
    mine: owner?.mine ?? false,
    value: value?.dynasty ?? null,
    valueTrend: value?.trend7Day ?? null,
    projected: src.projections[d.playerId] ? r1(perWeek(src.projections[d.playerId])) : null,
  };
}

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

export const tapeRouter = express.Router();

/**
 * Session is read here rather than handed in, so this module can be mounted
 * with a bare `app.use(tapeRouter)`. The secret is read per request: the
 * process loads its .env in the entrypoint, which runs after this module's
 * imports are evaluated, so reading it at module scope would capture undefined.
 */
function sessionOf(req: express.Request): Session | null {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
  return verifySession(readCookie(req.headers.cookie, COOKIE_NAME), secret);
}

tapeRouter.get('/api/league/:leagueId/tape', (req, res, next) => {
  handle(req, res).catch(next);
});

async function handle(req: express.Request, res: express.Response) {
  const session = sessionOf(req);
  if (!session) {
    return res
      .status(401)
      .json({ error: 'Enter your Sleeper username to continue.', needsIdentity: true });
  }

  const { leagueId } = req.params;
  const [league, rosters, users, players, state] = await Promise.all([
    loadLeague(leagueId),
    loadRosters(leagueId),
    loadLeagueUsers(leagueId),
    loadPlayers(),
    loadState(),
  ]);

  const [market, projections] = await Promise.all([
    loadMarketFor(league, players),
    loadProjections(league.season, league.scoring_settings),
  ]);

  const nameOf = teamNames(users);
  const mine = myRoster(rosters, session.userId);

  // Ownership, one lookup per player. A manager needs to know instantly whether
  // a name on this list is his, someone else's, or nobody's — those are three
  // different actions (hold, offer, claim).
  const ownerOf = new Map<string, { rosterId: number; teamName: string; mine: boolean }>();
  for (const r of rosters as any[]) {
    const entry = {
      rosterId: r.roster_id,
      teamName: nameOf.get(r.owner_id) ?? `Roster ${r.roster_id}`,
      mine: r.roster_id === mine?.roster_id,
    };
    for (const id of (r.players ?? []) as string[]) ownerOf.set(id, entry);
  }

  const win = usageWindowFor(state);

  const rec = Number(league.scoring_settings?.rec ?? 0) || 0;

  const tape = buildTape({
    players,
    snaps: market.snaps,
    usage: market.usage,
    values: market.crosswalk.bySleeperId,
    ownerOf,
    projections,
    pointsPerReception: rec,
    throughWeek: win.throughWeek,
    window: win.window,
  });

  res.json({
    ...tape,
    limit: TAPE_LIMIT,
    inSeason: win.inSeason,
    window: win.window,
    /** Which NFL season this usage actually describes. Never implied. */
    usageSeason: market.health.usageSeason,
    leagueSeason: league.season,
    pointsPerReception: rec,
    hasRoster: !!mine,
    coverage: market.health,
  });
}
