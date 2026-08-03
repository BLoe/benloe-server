import { describe, it, expect } from 'vitest';
import {
  bestAt,
  buildRoster,
  explainNoFits,
  groupPicks,
  humanList,
  priceOf,
  type RosterRow,
} from '../src/server/routes/ledger.js';
import type { PlayerRow } from '../src/server/data.js';
import type { KtcValue } from '../src/lib/sources/keeptradecut.js';

/* ================================================================== *
 * Building a roster the ledger can reason about
 * ================================================================== */

const player = (id: string, name: string, pos: string, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name,
  pos,
  team: 'BUF',
  age: 25,
  exp: 3,
  status: null,
  bye: 7,
  rank: 50,
  ...extra,
});

const POOL: Record<string, PlayerRow> = {
  qb1: player('qb1', 'First QB', 'QB'),
  rb1: player('rb1', 'First RB', 'RB'),
  rb2: player('rb2', 'Second RB', 'RB'),
  te1: player('te1', 'A Tight End', 'TE'),
};

const POINTS: Record<string, number> = { qb1: 20, rb1: 14, rb2: 9, te1: 0 };
const VALUES: Record<string, { dynasty: number | null; redraft: number | null }> = {
  qb1: { dynasty: 5000, redraft: 3000 },
  rb1: { dynasty: 4000, redraft: 4500 },
};

const build = (raw: RosterRow) =>
  buildRoster(
    raw,
    'The Test Team',
    POOL,
    (id) => POINTS[id] ?? 0,
    (id) => VALUES[id]
  );

describe('buildRoster', () => {
  it('drops taxi and IR players, because neither can fill a lineup slot', () => {
    // The whole ledger rests on "startable beyond what the lineup holds". A
    // taxi rookie counted as surplus produces a proposal nobody can act on;
    // counted as filling a slot he hides a hole that is really there.
    const b = build({ roster_id: 1, players: ['qb1', 'rb1', 'rb2'], taxi: ['rb2'], reserve: ['rb1'] });
    expect(b.input.players.map((p) => p.playerId)).toEqual(['qb1']);
    expect(b.unavailable).toBe(2);
  });

  it('reports how many it dropped so the page can say so rather than imply coverage', () => {
    const b = build({ roster_id: 1, players: ['qb1', 'rb1'], taxi: ['rb1'] });
    expect(b.unavailable).toBe(1);
  });

  it('ignores ids the player index does not know', () => {
    // A player nothing is known about is neither surplus nor a hole — there is
    // no claim to make, so he must not silently become a zero-point body that
    // drags a position into looking thin.
    const b = build({ roster_id: 1, players: ['qb1', 'ghost-id'] });
    expect(b.input.players).toHaveLength(1);
    expect(b.unprojected).toBe(0);
  });

  it('counts players with no projection, since they read as thinner than they are', () => {
    const b = build({ roster_id: 1, players: ['qb1', 'te1'] });
    expect(b.unprojected).toBe(1);
    expect(b.byId.get('te1')!.points).toBe(0);
  });

  it('prices on the dynasty scale and never falls back to redraft', () => {
    // The two scales are not comparable. Falling back from one to the other
    // would put a wrong-by-a-factor price on a trade and look authoritative.
    const b = build({ roster_id: 1, players: ['qb1', 'rb2'] });
    expect(b.byId.get('qb1')!.value).toBe(5000);
    expect(b.byId.get('qb1')!.redraft).toBe(3000);
    expect(b.byId.get('rb2')!.value).toBeNull();
    expect(b.byId.get('rb2')!.redraft).toBeNull();
  });

  it('renders an empty roster without inventing anything', () => {
    const b = build({ roster_id: 9, players: null, taxi: null, reserve: null });
    expect(b.input).toEqual({ rosterId: 9, teamName: 'The Test Team', players: [] });
    expect(b.unavailable).toBe(0);
  });
});

/* ================================================================== *
 * The incumbent
 * ================================================================== */

describe('bestAt', () => {
  const roster = [
    { playerId: 'a', name: 'A', position: 'rb', points: 8, value: null },
    { playerId: 'b', name: 'B', position: 'RB', points: 12, value: null },
    { playerId: 'c', name: 'C', position: 'WR', points: 20, value: null },
  ];

  it('finds the best player at a position, whatever case the feed used', () => {
    // Sleeper and the analysis module disagree about case in places, and a
    // missed match here would tell a reader the other manager starts nobody.
    expect(bestAt(roster, 'RB')!.playerId).toBe('b');
  });

  it('returns null where the roster has nobody there at all', () => {
    expect(bestAt(roster, 'TE')).toBeNull();
    expect(bestAt([], 'RB')).toBeNull();
  });
});

/* ================================================================== *
 * Pricing the swap
 * ================================================================== */

describe('priceOf', () => {
  it('calls a swap even when the two sides are within a tenth of each other', () => {
    // Trade values are consensus estimates rebuilt from real trades, not
    // prices. Two assets this close are inside the noise, and calling that a
    // rip-off would read precision the source does not have.
    expect(priceOf(1000, 1090).price).toBe('even');
    expect(priceOf(1000, 910).price).toBe('even');
  });

  it('names the direction once the gap is real', () => {
    expect(priceOf(1000, 1400)).toEqual({ price: 'you-gain', gap: 400 });
    expect(priceOf(1000, 600)).toEqual({ price: 'you-pay', gap: -400 });
  });

  it('treats a one-way fit as unpriced rather than as paying up', () => {
    // Nothing is coming back yet, so no price has been set. Reporting it as
    // "you pay" would be an argument against a trade that has not been made.
    expect(priceOf(1746, null)).toEqual({ price: 'unpriced', gap: null });
    expect(priceOf(null, 1200)).toEqual({ price: 'unpriced', gap: null });
  });

  it('refuses to divide by an unpriced or zero-valued player', () => {
    expect(priceOf(0, 500).price).toBe('unpriced');
  });
});

/* ================================================================== *
 * The empty state, which has to be worth reading
 * ================================================================== */

describe('explainNoFits', () => {
  const base = { mySurplus: ['RB'], leagueNeeds: ['TE'], others: 11, dismissed: 0 };

  it('says when there is simply nobody to trade with', () => {
    expect(explainNoFits({ ...base, others: 0 })).toMatch(/nobody to trade with/);
  });

  it('distinguishes "none were worth sending" from "there were none"', () => {
    // These are completely different facts about a roster and the difference is
    // the whole reason dismissed fits are counted rather than discarded.
    const said = explainNoFits({ ...base, dismissed: 2 });
    expect(said).toMatch(/2 fits on paper/);
    expect(said).toMatch(/gains them nothing/);
  });

  it('says when the roster has no surplus at all', () => {
    expect(explainNoFits({ ...base, mySurplus: [] })).toMatch(/Nothing on your roster is spare/);
  });

  it('says when nobody in the league is thin anywhere', () => {
    expect(explainNoFits({ ...base, leagueNeeds: [] })).toMatch(/no other roster is thin/);
  });

  it('otherwise names both sides of the mismatch', () => {
    const said = explainNoFits({ mySurplus: ['QB', 'RB'], leagueNeeds: ['TE'], others: 11, dismissed: 0 });
    expect(said).toMatch(/deep at QB and RB/);
    expect(said).toMatch(/thin at TE/);
  });
});

describe('humanList', () => {
  it('reads as a sentence rather than as an array', () => {
    expect(humanList([])).toBe('');
    expect(humanList(['RB'])).toBe('RB');
    expect(humanList(['RB', 'WR'])).toBe('RB and WR');
    expect(humanList(['QB', 'RB', 'WR'])).toBe('QB, RB and WR');
  });
});

/* ================================================================== *
 * Picks
 * ================================================================== */

const pick = (name: string, value: number, overallRank = 100): KtcValue => ({
  ktcId: 0,
  mflId: null,
  name,
  position: 'PICK',
  team: null,
  age: null,
  experience: null,
  rookie: false,
  isPick: true,
  value,
  overallRank,
  positionalRank: null,
  positionalTier: null,
  trend7Day: 0,
  tradeCount: null,
  liquidity: null,
});

describe('groupPicks', () => {
  it('groups by season, nearest first, best pick first inside each', () => {
    // A 2026 first is a decision this year; a 2029 first is a rumour. Sorting
    // the years the other way buries the ones anyone is actually trading.
    const years = groupPicks([
      pick('2028 Mid 1st', 3000),
      pick('2026 Mid 1st', 5274),
      pick('2026 Early 1st', 6203),
    ]);
    expect(years.map((y) => y.year)).toEqual(['2026', '2028']);
    expect(years[0].picks.map((p) => p.name)).toEqual(['2026 Early 1st', '2026 Mid 1st']);
  });

  it('keeps a pick whose name has no year rather than dropping it', () => {
    // An unparsed name is still a real price. Dropping it would understate what
    // a manager holds, which is the one thing a ledger must not do.
    const years = groupPicks([pick('Rookie 1st', 4000), pick('2026 Early 1st', 6203)]);
    expect(years.map((y) => y.year)).toEqual(['2026', 'Undated']);
    expect(years[1].picks).toHaveLength(1);
  });

  it('returns nothing at all when the source did not answer', () => {
    expect(groupPicks([])).toEqual([]);
  });
});
