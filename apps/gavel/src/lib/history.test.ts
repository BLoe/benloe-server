/**
 * Calibration against a league's own auctions.
 *
 * Each test names the mistake it prevents. Several of these were live bugs
 * found by running the calibration against the Columbus league's real 2024 and
 * 2025 drafts rather than by reasoning about it.
 */
import { describe, expect, it } from 'vitest';
import { buildPriceCurve, curveFromPrices, fitCounts, resample } from './history.js';
import { valueBoard, type PlayerProjection } from './valuation.js';
import type { LeagueConfig, Position, RosterSlots } from './league.js';

const SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 4, TE: 1, DEF: 1, K: 0, FLEX: 1, BN: 6, IR: 1 };
const CFG: LeagueConfig = {
  id: 'columbus',
  name: 'Columbus',
  platform: 'sleeper',
  platformLeagueId: '1',
  season: '2026',
  teams: 12,
  budget: 200,
  minBid: 1,
  slots: SLOTS,
  scoring: { pass_yd: 0.04, pass_td: 6, rush_yd: 0.1, rush_td: 6, rec: 0, rec_yd: 0.1, rec_td: 6 },
};

/**
 * The Columbus league's REAL 2024 and 2025 auctions, frozen.
 *
 * A synthetic curve was tried first and was actively misleading: an
 * exponential decay is far steeper than any real auction, and calibrating
 * against it made the board MORE top-heavy rather than less, failing a test
 * that the same code passes against live data. Auction price curves have a
 * specific shape and it is not worth guessing at.
 *
 * Regenerate with the draft-picks endpoint if the league adds a season.
 */
import auctions from '../../fixtures/columbus-auctions.json' with { type: 'json' };

function pool(): PlayerProjection[] {
  const players: PlayerProjection[] = [];
  const shape: Array<[Position, number, number, number]> = [
    ['QB', 40, 400, 5],
    ['RB', 90, 270, 2],
    ['WR', 120, 210, 1.2],
    ['TE', 40, 190, 4],
    ['DEF', 32, 130, 1.5],
  ];
  for (const [pos, count, top, drop] of shape) {
    for (let i = 0; i < count; i++) {
      players.push({
        id: `${pos}${i}`,
        name: `${pos} ${i}`,
        position: pos,
        team: null,
        points: top - i * drop,
      });
    }
  }
  return players;
}

describe('resample', () => {
  it('keeps the shape of a curve when its length changes', () => {
    // Nearest-rank sampling loses the cliff after the top few, which is the
    // part of an auction curve worth preserving.
    const stretched = resample([100, 50, 10, 1], 7);
    expect(stretched).toHaveLength(7);
    expect(stretched[0]).toBe(100);
    expect(stretched[6]).toBe(1);
    for (let i = 1; i < stretched.length; i++) {
      expect(stretched[i]).toBeLessThanOrEqual(stretched[i - 1]);
    }
  });

  it('survives degenerate curves', () => {
    expect(resample([], 3)).toEqual([0, 0, 0]);
    expect(resample([7], 3)).toEqual([7, 7, 7]);
    expect(resample([1, 2], 0)).toEqual([]);
  });
});

describe('buildPriceCurve', () => {
  it('averages seasons into one curve per position', () => {
    const curve = buildPriceCurve(auctions, CFG)!;
    expect(curve.seasons).toEqual(['2025', '2024']);
    expect(curve.counts.RB).toBe(64);
    expect(curve.counts.DEF).toBe(10);
    expect(curve.prices.RB[0]).toBeGreaterThan(curve.prices.RB[10]);
  });

  it('normalises a season by what was actually spent', () => {
    // Managers routinely leave money unspent; treating that as real money
    // would shrink every price.
    const curve = buildPriceCurve(auctions, CFG)!;
    expect(curve.total).toBeGreaterThan(2350);
    expect(curve.total).toBeLessThan(2450);
  });

  it('returns null when there is nothing to learn from', () => {
    expect(buildPriceCurve([], CFG)).toBeNull();
    expect(buildPriceCurve([{ season: '2025', picks: [] }], CFG)).toBeNull();
  });
});

describe('fitCounts', () => {
  it('scales counts to the roster spots that must be filled', () => {
    const fitted = fitCounts({ QB: 19, RB: 64, WR: 80, TE: 20, DEF: 10, K: 0 } as any, 180);
    const total = Object.values(fitted).reduce((a, b) => a + b, 0);
    expect(total).toBe(180);
    // The shape survives: still far more receivers than defences.
    expect(fitted.WR).toBeGreaterThan(fitted.RB);
    expect(fitted.DEF).toBeLessThan(fitted.QB);
  });

  it('never drops a rostered position to zero', () => {
    const fitted = fitCounts({ QB: 19, RB: 64, WR: 80, TE: 20, DEF: 1, K: 0 } as any, 60);
    expect(fitted.DEF).toBeGreaterThanOrEqual(1);
  });
});

describe('a calibrated board', () => {
  const curve = buildPriceCurve(auctions, CFG)!;
  const players = pool();
  const uncalibrated = valueBoard(players, CFG);
  const calibrated = valueBoard(players, CFG, { curve });

  it('still clears the room exactly', () => {
    const total = calibrated.reduce((sum, v) => sum + v.baseValue, 0);
    expect(total).toBeGreaterThan(2395);
    expect(total).toBeLessThan(2405);
  });

  it('drafts as many of each position as the league actually drafts', () => {
    // The live bug: a model priced 32 defences in a league that has never
    // drafted more than ten, inventing about $45 of market.
    const defs = calibrated.filter((v) => v.position === 'DEF' && v.baseValue > 0).length;
    expect(defs).toBeLessThanOrEqual(12);
    expect(uncalibrated.filter((v) => v.position === 'DEF' && v.baseValue > 0).length).toBeGreaterThan(defs);
  });

  it('pulls the top of the board toward what the room actually pays', () => {
    // Directionally, not downward: against the real player pool the model was
    // too top-heavy ($78 in a room that has never paid more than $65), but a
    // flat pool makes it too FLAT, and calibration has to correct either way.
    // The property is that it moves TOWARD the observed top, from whichever side.
    const observedTop = Math.max(...curve.prices.RB, ...curve.prices.WR);
    const topCal = Math.max(...calibrated.map((v) => v.baseValue));
    const topUncal = Math.max(...uncalibrated.map((v) => v.baseValue));
    expect(Math.abs(topCal - observedTop)).toBeLessThan(Math.abs(topUncal - observedTop));
  });

  it('leaves the model in charge of who occupies each rank', () => {
    // History says what a rank costs, never who fills it. Within a position,
    // price order must still follow projected points.
    const rbs = calibrated.filter((v) => v.position === 'RB' && v.baseValue > 0);
    rbs.sort((a, b) => b.points - a.points);
    for (let i = 1; i < rbs.length; i++) {
      expect(rbs[i].baseValue).toBeLessThanOrEqual(rbs[i - 1].baseValue + 0.05);
    }
  });

  it('does not erase a position the calibration source knows nothing about', () => {
    // FantasyCalc carries no defences — they are never traded — and taking its
    // counts literally priced ZERO defences in a league that starts one.
    const marketish = curveFromPrices(
      calibrated
        .filter((v) => v.baseValue > 0 && v.position !== 'DEF')
        .map((v) => ({ position: v.position, price: v.baseValue })),
      ['market']
    )!;
    expect(marketish.counts.DEF).toBe(0);

    const board = valueBoard(players, CFG, { curve: marketish });
    const defs = board.filter((v) => v.position === 'DEF' && v.baseValue > 0);
    expect(defs.length).toBeGreaterThan(0);
    // And the fallback is roster demand, not the model's own inflated count.
    expect(defs.length).toBeLessThanOrEqual(16);
  });
});
