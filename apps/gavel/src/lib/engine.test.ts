/**
 * The value engine, tested against the cases that have actually gone wrong.
 *
 * Each test names the mistake it prevents, because several of these were live
 * bugs found by running the engine on the real league rather than by reasoning
 * about it.
 */
import { describe, expect, it } from 'vitest';
import { scoreStats, scoreStatsRounded, perGame, NFL_GAMES } from './scoring.js';
import {
  rosteredPositions,
  slotsPerTeam,
  draftablePlayers,
  totalMoney,
  startingDemand,
  type LeagueConfig,
  type RosterSlots,
} from './league.js';
import { slotsFromRosterPositions } from './seed.js';
import {
  assignTiers,
  effectiveDemand,
  replacementLevels,
  valueBoard,
  type PlayerProjection,
} from './valuation.js';
import { adjustedValue, contenders, deriveState, fillSlots, scarcity, type Pick } from './draft.js';

const SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 4, TE: 1, DEF: 1, K: 0, FLEX: 1, BN: 6, IR: 1 };

const COLUMBUS: LeagueConfig = {
  id: 'columbus',
  name: 'Columbus',
  platform: 'sleeper',
  platformLeagueId: '1',
  season: '2026',
  teams: 12,
  budget: 200,
  minBid: 1,
  slots: SLOTS,
  scoring: {
    pass_yd: 0.04,
    pass_td: 6,
    pass_int: -2,
    rush_yd: 0.1,
    rush_td: 6,
    rec: 0,
    rec_yd: 0.1,
    rec_td: 6,
    fum_lost: -2,
  },
};

/** A synthetic pool deep enough that every position has real replacement level. */
function pool(): PlayerProjection[] {
  const players: PlayerProjection[] = [];
  const shape: Array<[PlayerProjection['position'], number, number, number]> = [
    // position, count, top points, drop per rank
    ['QB', 40, 400, 5],
    ['RB', 90, 270, 2],
    ['WR', 120, 210, 1.2],
    ['TE', 40, 190, 4],
    ['DEF', 32, 130, 1.5],
    ['K', 32, 160, 1],
  ];
  for (const [pos, count, top, drop] of shape) {
    for (let i = 0; i < count; i++) {
      players.push({
        id: `${pos}${i}`,
        name: `${pos} Player ${i}`,
        position: pos,
        team: 'AAA',
        points: top - i * drop,
      });
    }
  }
  return players;
}

describe('scoring', () => {
  it('pays six-point passing touchdowns when the league says six', () => {
    // The bug this prevents: reading Sleeper's pts_std, which is always four.
    const stats = { pass_yd: 3650, pass_td: 27, pass_int: 10, rush_yd: 535, rush_td: 11 };
    const six = scoreStats(stats, COLUMBUS.scoring);
    const four = scoreStats(stats, { ...COLUMBUS.scoring, pass_td: 4 });
    expect(six - four).toBeCloseTo(27 * 2, 5);
  });

  it('ignores scoring rules with no matching projected stat', () => {
    // Defensive scoring is mostly buckets no season projection carries. A single
    // NaN here would void an entire position's values.
    const points = scoreStats({ rush_yd: 100 }, { rush_yd: 0.1, pts_allow_7_13: 4 });
    expect(points).toBeCloseTo(10, 5);
  });

  it('survives a missing or malformed stat line', () => {
    expect(scoreStats(null, COLUMBUS.scoring)).toBe(0);
    expect(scoreStats({ pass_yd: NaN }, { pass_yd: 0.04 })).toBe(0);
  });

  it('never divides a season by more than seventeen games', () => {
    // Sleeper reports gp: 18 for every player — the calendar, not a projection.
    expect(perGame(340, 18)).toBeCloseTo(340 / NFL_GAMES, 5);
  });

  it('rounds to a tenth, since projections do not justify more', () => {
    expect(scoreStatsRounded({ rush_yd: 1234 }, { rush_yd: 0.1 })).toBe(123.4);
  });
});

describe('roster shape', () => {
  it('reads a Sleeper roster_positions list', () => {
    const slots = slotsFromRosterPositions([
      'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DEF',
      'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
    ]);
    expect(slots).toMatchObject({ QB: 1, RB: 2, WR: 4, TE: 1, DEF: 1, FLEX: 1, BN: 6, K: 0 });
  });

  it('does not count an unknown slot as bench', () => {
    // Treating IR or TAXI as a draftable slot silently changes the money math.
    const slots = slotsFromRosterPositions(['QB', 'IR', 'TAXI', 'SUPER_FLEX']);
    expect(slotsPerTeam(slots)).toBe(1);
  });

  it('leaves kickers out of a league that starts none', () => {
    expect(rosteredPositions(COLUMBUS)).not.toContain('K');
    expect(rosteredPositions({ ...COLUMBUS, slots: { ...SLOTS, K: 1 } })).toContain('K');
  });

  it('counts sixteen draftable slots and $2,400 in the room', () => {
    expect(slotsPerTeam(SLOTS)).toBe(16);
    expect(draftablePlayers(COLUMBUS)).toBe(192);
    expect(totalMoney(COLUMBUS)).toBe(2400);
  });
});

describe('valuation', () => {
  const values = valueBoard(pool(), COLUMBUS);

  it('clears the room exactly', () => {
    // Prices must sum to the budget or inflation means nothing later.
    const total = values.reduce((sum, v) => sum + v.baseValue, 0);
    expect(total).toBeGreaterThan(2395);
    expect(total).toBeLessThan(2405);
  });

  it('prices exactly as many players as will be drafted', () => {
    expect(values.filter((v) => v.baseValue > 0)).toHaveLength(192);
  });

  it('refuses to price a position the league does not roster', () => {
    // The live bug: kickers took ~$700 of a $2,400 room, because zero demand
    // means zero replacement level and every point counts as surplus.
    expect(values.filter((v) => v.position === 'K' && v.baseValue > 0)).toHaveLength(0);
  });

  it('never prices anyone below the minimum bid', () => {
    for (const v of values.filter((x) => x.baseValue > 0)) {
      expect(v.baseValue).toBeGreaterThanOrEqual(COLUMBUS.minBid);
    }
  });

  it('hands every flex slot to some flex-eligible position', () => {
    const demand = effectiveDemand(pool(), COLUMBUS);
    const base = startingDemand(COLUMBUS);
    const added = { RB: demand.RB - base.RB, WR: demand.WR - base.WR, TE: demand.TE - base.TE };
    expect(added.RB + added.WR + added.TE).toBe(12);
    expect(demand.QB).toBe(base.QB);
    expect(demand.DEF).toBe(base.DEF);
  });

  it('sends flex to whichever position has the best player left over', () => {
    // Not a fixed split. A rule of thumb that always divides flex between backs
    // and receivers would misread replacement level in a league whose roster
    // shape has already exhausted one of them.
    const deepWr: PlayerProjection[] = [];
    for (let i = 0; i < 200; i++) {
      deepWr.push({ id: `WR${i}`, name: `WR ${i}`, position: 'WR', team: null, points: 300 - i });
      deepWr.push({ id: `RB${i}`, name: `RB ${i}`, position: 'RB', team: null, points: 100 - i * 0.4 });
      deepWr.push({ id: `TE${i}`, name: `TE ${i}`, position: 'TE', team: null, points: 50 - i * 0.2 });
    }
    const demand = effectiveDemand(deepWr, COLUMBUS);
    const base = startingDemand(COLUMBUS);
    // Receivers are better than the alternatives at every flex slot here, so
    // they should take all twelve.
    expect(demand.WR - base.WR).toBe(12);
    expect(demand.RB).toBe(base.RB);
  });

  it('sets replacement at the best player without a starting job', () => {
    const levels = replacementLevels(pool(), COLUMBUS);
    const demand = effectiveDemand(pool(), COLUMBUS);
    const qbs = pool().filter((p) => p.position === 'QB').sort((a, b) => b.points - a.points);
    expect(levels.QB).toBe(qbs[demand.QB].points);
  });

  it('groups the top of the board into tiers rather than one player each', () => {
    // The live bug: a gap threshold computed over two hundred backs made the
    // mean gap vanishing, so every elite player got a tier of its own.
    const rbs = values.filter((v) => v.position === 'RB' && v.baseValue > 0);
    const topTier = rbs.filter((v) => v.tier === rbs[0].tier);
    expect(topTier.length).toBeGreaterThan(1);
  });

  it('breaks a tier where the points gap is genuinely large', () => {
    const tiers = assignTiers([
      { id: 'a', name: 'a', position: 'RB', team: null, points: 300 },
      { id: 'b', name: 'b', position: 'RB', team: null, points: 298 },
      { id: 'c', name: 'c', position: 'RB', team: null, points: 200 },
      { id: 'd', name: 'd', position: 'RB', team: null, points: 198 },
    ]);
    expect(tiers[0]).toBe(tiers[1]);
    expect(tiers[2]).toBeGreaterThan(tiers[1]);
    expect(tiers[2]).toBe(tiers[3]);
  });

  it('marks everyone below the drafted pool as the remainder, not a tier', () => {
    // Reporting "621 left" for the bottom group is noise: it is not a tier, it
    // is everyone who will not be drafted.
    const rest = values.filter((v) => v.baseValue === 0);
    expect(rest.length).toBeGreaterThan(0);
    for (const v of rest) expect(v.tier).toBe(0);
    for (const v of values.filter((x) => x.baseValue > 0)) expect(v.tier).toBeGreaterThan(0);
  });

  it('keeps tiers stable whatever the shape of the position curve', () => {
    // A mean-gap threshold is not scale-free: at the top of a position the
    // gaps run several times the average, so nearly every one broke a tier and
    // the best players each landed in a tier of one.
    const steepThenFlat = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      position: 'RB' as const,
      team: null,
      // A sharp elite cliff followed by a long flat tail.
      points: i < 5 ? 300 - i * 18 : 210 - (i - 5) * 1.5,
    }));
    const tiers = assignTiers(steepThenFlat);
    const distinct = new Set(tiers).size;
    expect(distinct).toBeGreaterThan(2);
    expect(distinct).toBeLessThan(12);
    // The flat tail must not fragment into a tier per player.
    expect(tiers[39] - tiers[10]).toBeLessThan(4);
  });

  it('handles an empty pool without throwing', () => {
    expect(valueBoard([], COLUMBUS)).toEqual([]);
    expect(assignTiers([])).toEqual([]);
    expect(assignTiers([{ id: 'a', name: 'a', position: 'RB', team: null, points: 1 }])).toEqual([1]);
  });
});

describe('live draft state', () => {
  const values = valueBoard(pool(), COLUMBUS);
  const teams = Array.from({ length: 12 }, (_, i) => ({ teamId: `t${i}`, name: `Team ${i}` }));
  const pick = (seq: number, playerId: string, teamId: string, price: number): Pick => ({
    seq, playerId, teamId, price, at: 0,
  });

  it('holds back a dollar for every slot still to fill', () => {
    // A team with $40 and four empty slots can bid $37, not $40. Mistaking one
    // for the other is how people overpay in the endgame.
    const state = deriveState([pick(1, 'RB0', 't0', 160)], teams, values, COLUMBUS);
    const me = state.teams.find((t) => t.teamId === 't0')!;
    expect(me.remaining).toBe(40);
    expect(me.openSlots).toBe(15);
    expect(me.maxBid).toBe(40 - 14);
  });

  it('reports a max bid of zero for a full roster', () => {
    const picks = Array.from({ length: 16 }, (_, i) => pick(i + 1, `WR${i}`, 't0', 1));
    const state = deriveState(picks, teams, values, COLUMBUS);
    const me = state.teams.find((t) => t.teamId === 't0')!;
    expect(me.openSlots).toBe(0);
    expect(me.maxBid).toBe(0);
  });

  it('fills starters, then flex, then bench', () => {
    // Five running backs in a two-RB league: RB filled, flex taken, two benched,
    // and a tight end still needed.
    const byId = new Map(values.map((v) => [v.id, v]));
    const roster = ['RB0', 'RB1', 'RB2', 'RB3', 'RB4'].map((id, i) => pick(i, id, 't0', 1));
    const { needs, flexOpen, benchOpen } = fillSlots(roster, byId, COLUMBUS);
    expect(needs.RB).toBe(0);
    expect(needs.TE).toBe(1);
    expect(flexOpen).toBe(0);
    expect(benchOpen).toBe(SLOTS.BN - 2);
  });

  it('counts keeper salaries and keeper slots against the budget', () => {
    const withKeeper = [{ teamId: 't0', name: 'Team 0', committed: 45, keeperSlots: 2 }, ...teams.slice(1)];
    const state = deriveState([], withKeeper, values, COLUMBUS);
    const me = state.teams.find((t) => t.teamId === 't0')!;
    expect(me.remaining).toBe(155);
    expect(me.openSlots).toBe(14);
  });

  it('reads inflation above one when the room has money left over', () => {
    // Everyone bought cheap: the same value is still out there chasing more money.
    const cheap = Array.from({ length: 12 }, (_, i) => pick(i + 1, `RB${i}`, `t${i}`, 1));
    const state = deriveState(cheap, teams, values, COLUMBUS);
    expect(state.inflation).toBeGreaterThan(1);
    expect(adjustedValue(values[20], state, COLUMBUS)).toBeGreaterThan(values[20].baseValue);
  });

  it('reads inflation below one when the room overspends early', () => {
    const dear = Array.from({ length: 12 }, (_, i) => pick(i + 1, `RB${i}`, `t${i}`, 150));
    const state = deriveState(dear, teams, values, COLUMBUS);
    expect(state.inflation).toBeLessThan(1);
  });

  it('never inflates the minimum bid', () => {
    // A dollar player is a dollar player however hot the room is.
    const cheap = Array.from({ length: 12 }, (_, i) => pick(i + 1, `RB${i}`, `t${i}`, 1));
    const state = deriveState(cheap, teams, values, COLUMBUS);
    const scrub = values.filter((v) => v.baseValue === COLUMBUS.minBid)[0];
    expect(adjustedValue(scrub, state, COLUMBUS)).toBe(COLUMBUS.minBid);
  });

  it('excludes teams that cannot afford a bid from the contenders', () => {
    const broke = [pick(1, 'RB0', 't0', 185)];
    const state = deriveState(broke, teams, values, COLUMBUS);
    const rivals = contenders(state, 50);
    expect(rivals.some((t) => t.teamId === 't0')).toBe(false);
    expect(rivals).toHaveLength(11);
  });

  it('measures supply against remaining demand, not raw counts', () => {
    const state = deriveState([], teams, values, COLUMBUS);
    const te = scarcity(state, values).TE;
    expect(te.demand).toBe(12);
    expect(te.ratio).toBeCloseTo(te.supply / te.demand, 5);
  });

  it('derives an identical board from the same pick log', () => {
    // Reload safety: the log is the only state, so a refresh must reproduce the
    // screen exactly.
    const picks = [pick(1, 'RB0', 't0', 60), pick(2, 'WR0', 't1', 40)];
    const a = deriveState(picks, teams, values, COLUMBUS);
    const b = deriveState(picks, teams, values, COLUMBUS);
    expect(b.moneyLeft).toBe(a.moneyLeft);
    expect(b.inflation).toBe(a.inflation);
    expect([...b.drafted]).toEqual([...a.drafted]);
  });
});
