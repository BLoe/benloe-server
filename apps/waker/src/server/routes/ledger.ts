/**
 * THE LEDGER — surplus meets need, turned into named trades.
 *
 * DECISION SERVED: "who should I actually be talking to, and about what?"
 *
 * Every manager knows in the abstract that a third startable quarterback scores
 * nothing all season and is worth real money to somebody starting a waiver-wire
 * one. Almost nobody acts on it, because acting on it means opening eleven other
 * rosters and doing the comparison by hand. This route does the comparison.
 *
 * Two things make the answer trustworthy rather than merely confident:
 *
 *   Replacement level is computed over the WHOLE player pool, free agents
 *   included. Measuring it against rostered players only would put replacement
 *   at the worst player somebody is stashing, which flatters every bench body
 *   into looking like a trade asset.
 *
 *   Both sides' gain is returned, in the same unit, from the same maths. A
 *   proposal that is only good for you is not a trade, it is a message that gets
 *   ignored, and hiding the other manager's side would let this page generate
 *   those all day.
 *
 * The pick table is here because it is the other half of a dynasty trade and
 * FantasyCalc's player feed does not carry picks at all — without it, "for
 * value" is the end of the sentence rather than the start of a negotiation.
 */
import express from 'express';
import {
  loadLeague,
  loadLeagueUsers,
  loadMarketFor,
  loadPlayers,
  loadProjections,
  loadRosters,
  myRoster,
  perWeek,
  teamNames,
  type PlayerRow,
} from '../data.js';
import { replacementLevels } from '../../lib/analysis/replacement.js';
import {
  findTrades,
  standings,
  type LedgerPlayer,
  type PositionStanding,
  type RosterInput,
} from '../../lib/analysis/ledger.js';
import type { KtcValue } from '../../lib/sources/keeptradecut.js';
import { COOKIE_NAME, readCookie, verifySession, type Session } from '../session.js';

/* ------------------------------------------------------------------ *
 * Pure helpers — the reasoning, kept out of the fetching so it is testable
 * ------------------------------------------------------------------ */

/**
 * A ledger player with everything the page needs to price him.
 *
 * `value` is the dynasty number and only ever the dynasty number: FantasyCalc's
 * dynasty and redraft scales are not comparable, and quietly falling back from
 * one to the other would produce trade prices that are wrong by a factor.
 */
export interface PricedPlayer extends LedgerPlayer {
  team: string | null;
  age: number | null;
  /** The same player priced for this season alone. Context, never the price. */
  redraft: number | null;
}

export interface RosterBuild {
  input: RosterInput;
  byId: Map<string, PricedPlayer>;
  /** Rostered players who cannot be started at all: taxi squad and IR. */
  unavailable: number;
  /** Startable-in-principle players with no projection on file. */
  unprojected: number;
}

/** The Sleeper roster fields this module reads. */
export interface RosterRow {
  roster_id: number;
  owner_id?: string | null;
  players?: string[] | null;
  taxi?: string[] | null;
  reserve?: string[] | null;
}

/**
 * One roster, reduced to the players who could actually take the field.
 *
 * Taxi and injured-reserve players are dropped. Both are real assets and both
 * are genuinely tradeable, but neither can fill a lineup slot this week, and the
 * whole ledger is built on "startable beyond what the lineup holds". Counting a
 * taxi rookie as surplus produces proposals nobody can act on; counting him as
 * filling a slot hides a hole that is really there. How many were dropped is
 * returned so the page can say so rather than imply full coverage.
 */
export function buildRoster(
  raw: RosterRow,
  teamName: string,
  players: Record<string, PlayerRow>,
  pointsOf: (playerId: string) => number,
  valueOf: (playerId: string) => { dynasty: number | null; redraft: number | null } | undefined
): RosterBuild {
  const benched = new Set<string>([...(raw.taxi ?? []), ...(raw.reserve ?? [])]);
  const byId = new Map<string, PricedPlayer>();
  let unavailable = 0;
  let unprojected = 0;

  for (const id of raw.players ?? []) {
    const meta = players[id];
    // A player the index does not know is not a judgement call — there is
    // nothing to say about him, so he is neither surplus nor a hole.
    if (!meta) continue;
    if (benched.has(id)) {
      unavailable++;
      continue;
    }

    const points = pointsOf(id);
    if (points <= 0) unprojected++;
    const market = valueOf(id);

    byId.set(id, {
      playerId: id,
      name: meta.name,
      position: meta.pos,
      points,
      value: market?.dynasty ?? null,
      redraft: market?.redraft ?? null,
      team: meta.team,
      age: meta.age,
    });
  }

  return {
    input: { rosterId: raw.roster_id, teamName, players: [...byId.values()] },
    byId,
    unavailable,
    unprojected,
  };
}

/** Best projected player at a position, or null where the roster has none. */
export function bestAt(players: LedgerPlayer[], position: string): LedgerPlayer | null {
  const want = position.toUpperCase();
  let best: LedgerPlayer | null = null;
  for (const p of players) {
    if ((p.position ?? '').toUpperCase() !== want) continue;
    if (!best || p.points > best.points) best = p;
  }
  return best;
}

export type Price = 'unpriced' | 'even' | 'you-pay' | 'you-gain';

/**
 * Whether the market thinks this swap is fair, and by how much.
 *
 * Ten per cent is the band for "even". Trade-value numbers are consensus
 * estimates rebuilt from real trades, not prices, and two assets within a tenth
 * of each other are inside the noise — calling that a rip-off in either
 * direction would be reading precision the source does not have.
 *
 * A one-way fit is not "you pay": there is nothing coming back yet, so the
 * price is simply not set. It reads as unpriced.
 */
export function priceOf(
  giveValue: number | null,
  getValue: number | null
): { price: Price; gap: number | null } {
  if (giveValue == null || getValue == null || giveValue <= 0) {
    return { price: 'unpriced', gap: null };
  }
  const gap = getValue - giveValue;
  if (Math.abs(gap) / giveValue <= 0.1) return { price: 'even', gap };
  return { price: gap > 0 ? 'you-gain' : 'you-pay', gap };
}

/**
 * Why there is nothing to propose.
 *
 * "No results" is a shrug. There are only a handful of reasons this list comes
 * back empty and each one tells the reader something different about their
 * roster, so each one is said out loud.
 */
export function explainNoFits(o: {
  mySurplus: string[];
  leagueNeeds: string[];
  others: number;
  /** Fits that existed but gained the other manager nothing. */
  dismissed: number;
}): string {
  if (o.others === 0) {
    return 'There are no other rosters loaded, so there is nobody to trade with.';
  }
  if (o.dismissed > 0) {
    const n = o.dismissed === 1 ? 'One fit' : `${o.dismissed} fits`;
    return `${n} on paper, none worth sending. Every team thin where you are deep is already starting somebody who projects as well as your spare player does, so the deal gains them nothing and they will not take it.`;
  }
  if (o.mySurplus.length === 0) {
    return 'Nothing on your roster is spare. Every player you have who beats replacement level is already in your lineup or holding a flex, so a trade would cost you a starter.';
  }
  if (o.leagueNeeds.length === 0) {
    return `You are deep at ${humanList(o.mySurplus)}, but no other roster is thin anywhere — every team in the league can already fill every slot above replacement. This is what a settled league looks like in the preseason.`;
  }
  return `You are deep at ${humanList(o.mySurplus)}; the league is thin at ${humanList(
    o.leagueNeeds
  )}. Nobody is thin where you are deep, so there is no straight fit to propose.`;
}

/** "RB", "RB and WR", "QB, RB and WR". */
export function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export interface PickRow {
  name: string;
  value: number;
  overallRank: number;
}

export interface PickYear {
  year: string;
  picks: PickRow[];
}

/**
 * Pick values, grouped by the season they convey.
 *
 * KTC names picks "2027 Early 1st" and similar, so the year is the leading
 * token. Anything that does not start with a year keeps its own bucket rather
 * than being forced into one — a pick this parser does not recognise is still a
 * real price, and dropping it would understate what a manager holds.
 */
export function groupPicks(picks: KtcValue[]): PickYear[] {
  const byYear = new Map<string, PickRow[]>();

  for (const p of picks) {
    const year = /^(\d{4})\b/.exec(p.name)?.[1] ?? 'Undated';
    const row: PickRow = { name: p.name, value: p.value, overallRank: p.overallRank };
    const bucket = byYear.get(year);
    if (bucket) bucket.push(row);
    else byYear.set(year, [row]);
  }

  return [...byYear.entries()]
    .map(([year, rows]) => ({ year, picks: rows.sort((a, b) => b.value - a.value) }))
    // Nearest season first: a 2026 first is a decision this year, a 2029 first
    // is a rumour. "Undated" sorts last because it is a parse failure, not a date.
    .sort((a, b) => (a.year === 'Undated' ? 1 : b.year === 'Undated' ? -1 : Number(a.year) - Number(b.year)));
}

/* ------------------------------------------------------------------ *
 * The wire shape
 * ------------------------------------------------------------------ */

export interface LedgerStandingRow {
  position: string;
  /** Players here who beat replacement level. */
  startable: number;
  /** Fixed lineup slots at this position. Flex is counted separately. */
  slots: number;
  /** How many are spare once the flex slots have been spent. */
  spare: number;
  starterVor: number;
  needy: boolean;
  /** What a freely available player at this position projects for, per week. */
  replacement: number | null;
  surplus: PricedPlayer[];
}

export interface LedgerMatchRow {
  rosterId: number;
  teamName: string;
  position: string;
  give: PricedPlayer;
  getPosition: string | null;
  get: PricedPlayer | null;
  /** Points per week they gain. Their side of the deal, stated as plainly as yours. */
  theirGain: number;
  yourGain: number;
  /** Who they are starting there now, so their gain can be checked. */
  theirCurrent: { name: string; points: number } | null;
  yourCurrent: { name: string; points: number } | null;
  giveValue: number | null;
  getValue: number | null;
  price: Price;
  valueGap: number | null;
}

export interface LedgerResponse {
  myRosterId: number;
  teamName: string;
  rosterPositions: string[];
  numTeams: number;
  standings: LedgerStandingRow[];
  matches: LedgerMatchRow[];
  picks: PickYear[];
  /** Set only when there are no matches at all. */
  noFitReason: string | null;
  coverage: {
    /** Rostered players on your team the maths could actually use. */
    counted: number;
    unavailable: number;
    unprojected: number;
    /** Your players with a market price. */
    priced: number;
    /** Fits that were found and dropped for gaining the other side nothing. */
    dismissed: number;
    picks: number;
    market: { fantasyCalc: number; ktc: number; joined: number };
  };
}

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

export const ledgerRouter = express.Router();

/**
 * Read the signing secret per request, not at module load.
 *
 * The server calls dotenv after its imports and ES module imports are hoisted,
 * so a module-level const here captures the secret before .env has been read and
 * every request 401s with a perfectly valid cookie.
 */
const sessionSecret = () => process.env.JWT_SECRET || process.env.SESSION_SECRET || '';

const sessionOf = (req: express.Request): Session | null =>
  verifySession(readCookie(req.headers.cookie, COOKIE_NAME), sessionSecret());

ledgerRouter.get('/api/league/:leagueId/ledger', (req, res, next) => {
  const session = sessionOf(req);
  if (!session) {
    return res
      .status(401)
      .json({ error: 'Enter your Sleeper username to continue.', needsIdentity: true });
  }
  handle(req, res, session).catch(next);
});

async function handle(req: express.Request, res: express.Response, session: Session) {
  const { leagueId } = req.params;

  const [league, rosters, users, players] = await Promise.all([
    loadLeague(leagueId),
    loadRosters(leagueId),
    loadLeagueUsers(leagueId),
    loadPlayers(),
  ]);

  const mine = myRoster(rosters, session.userId);
  if (!mine) {
    return res.status(404).json({ error: 'You do not have a roster in this league.' });
  }

  const [market, projections] = await Promise.all([
    loadMarketFor(league, players),
    loadProjections(league.season, league.scoring_settings),
  ]);

  const rosterPositions: string[] = league.roster_positions ?? [];
  const numTeams: number = league.total_rosters ?? rosters.length ?? 12;
  const nameOf = teamNames(users);

  const pointsOf = (id: string) => perWeek(projections[id]);
  const valueOf = (id: string) => market.crosswalk.bySleeperId.get(id);

  /**
   * Replacement level over the whole pool, free agents included.
   *
   * This is the number that decides whether a fourth receiver is surplus or a
   * bench body, so it has to be measured against what anyone could pick up for
   * nothing — not against the worst player somebody happens to be rostering.
   */
  const levels = replacementLevels(
    Object.values(players).map((p) => ({ playerId: p.id, position: p.pos, points: pointsOf(p.id) })),
    rosterPositions,
    numTeams
  );

  const builds = new Map<number, RosterBuild>();
  for (const r of rosters as RosterRow[]) {
    builds.set(
      r.roster_id,
      buildRoster(r, nameOf.get(r.owner_id ?? '') ?? `Roster ${r.roster_id}`, players, pointsOf, valueOf)
    );
  }

  const myBuild = builds.get(mine.roster_id)!;
  const others = [...builds.entries()]
    .filter(([rosterId]) => rosterId !== mine.roster_id)
    .map(([, build]) => build);

  const myStandings = standings(myBuild.input, rosterPositions, levels);
  const matches = findTrades(
    myBuild.input,
    others.map((o) => o.input),
    rosterPositions,
    levels
  );

  const standingRows: LedgerStandingRow[] = myStandings.map((row: PositionStanding) => ({
    position: row.position,
    startable: row.startable,
    slots: row.slots,
    spare: row.depth,
    starterVor: round(row.starterVor),
    needy: row.needy,
    replacement: roundOrNull(levels.byPosition.get(row.position) ?? null),
    surplus: row.surplus.map((p) => priced(myBuild, p)),
  }));

  const allMatches: LedgerMatchRow[] = matches.map((m) => {
    const theirBuild = builds.get(m.rosterId)!;
    const { price, gap } = priceOf(m.giveValue, m.getValue);
    return {
      rosterId: m.rosterId,
      teamName: m.teamName,
      position: m.position,
      give: priced(myBuild, m.give),
      getPosition: m.getPosition,
      get: m.get ? priced(theirBuild, m.get) : null,
      theirGain: round(m.theirGain),
      yourGain: round(m.yourGain),
      theirCurrent: incumbent(theirBuild.input.players, m.position),
      yourCurrent: m.getPosition ? incumbent(myBuild.input.players, m.getPosition) : null,
      giveValue: m.giveValue,
      getValue: m.getValue,
      price,
      valueGap: gap,
    };
  });

  /**
   * A fit that gains the other manager nothing is not a trade.
   *
   * `findTrades` reports every surplus-meets-need pairing, and some of those
   * pair a barely-startable spare player against a hole the other roster is
   * already filling to the same standard. Their gain rounds to zero, they will
   * not take it, and leaving it on the page teaches the reader to distrust the
   * rest of the list. How many were dropped is carried through, because "none
   * of them were worth sending" is a different answer from "there were none".
   */
  const matchRows = allMatches.filter((m) => m.theirGain > 0);
  const dismissed = allMatches.length - matchRows.length;

  const leagueNeeds = new Set<string>();
  for (const other of others) {
    for (const row of standings(other.input, rosterPositions, levels)) {
      if (row.needy) leagueNeeds.add(row.position);
    }
  }

  const response: LedgerResponse = {
    myRosterId: mine.roster_id,
    teamName: myBuild.input.teamName,
    rosterPositions,
    numTeams,
    standings: standingRows,
    matches: matchRows,
    picks: groupPicks(market.crosswalk.picks),
    noFitReason: matchRows.length
      ? null
      : explainNoFits({
          mySurplus: myStandings.filter((s) => s.surplus.length).map((s) => s.position),
          leagueNeeds: [...leagueNeeds].sort(),
          others: others.length,
          dismissed,
        }),
    coverage: {
      counted: myBuild.input.players.length,
      unavailable: myBuild.unavailable,
      unprojected: myBuild.unprojected,
      priced: myBuild.input.players.filter((p) => p.value != null).length,
      dismissed,
      picks: market.crosswalk.picks.length,
      market: {
        fantasyCalc: market.health.fantasyCalc,
        ktc: market.health.ktc,
        joined: market.health.joined,
      },
    },
  };

  res.json(response);
}

/**
 * Recover the priced player behind a ledger player.
 *
 * `findTrades` works in the analysis module's own vocabulary, which carries the
 * points and the price and nothing else. The page wants the team and the age
 * too, so the richer record is looked up rather than cast onto — a cast here
 * would be a lie the day the analysis module starts constructing its own.
 */
function priced(build: RosterBuild, p: LedgerPlayer): PricedPlayer {
  const rich = build.byId.get(p.playerId);
  // Points are rounded on the way out, never on the way in: the surplus maths
  // compares projections to a replacement level and rounding first would move
  // players across that line.
  return rich
    ? { ...rich, points: round(rich.points) }
    : { ...p, points: round(p.points), team: null, age: null, redraft: null };
}

function incumbent(players: LedgerPlayer[], position: string): { name: string; points: number } | null {
  const best = bestAt(players, position);
  return best ? { name: best.name, points: round(best.points) } : null;
}

/** One decimal is all a per-week projection can honestly carry. */
const round = (n: number): number => Math.round(n * 10) / 10;
const roundOrNull = (n: number | null): number | null => (n == null ? null : round(n));
