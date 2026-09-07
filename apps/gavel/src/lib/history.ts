/**
 * What this league actually pays.
 *
 * Projections are good at ORDERING players within a position. They are bad at
 * saying what a rank costs, because that is not a property of the players at
 * all — it is a property of twelve specific people and the roster they have to
 * fill. Two years of the Columbus league's own auctions disagree with generic
 * market values in ways that are large, specific and repeated in both years:
 *
 *   - Defences: 9-10 drafted, every one at $1-2. A model priced 32 of them up
 *     to $10, which is ~$45 of money that does not exist.
 *   - Receivers: 80 drafted, top three at $59/$55/$53. This league starts FOUR,
 *     and generic values built for two badly understate them.
 *   - Quarterbacks: $37/$33/$29/$25/$20 down the top five. A pure value-over-
 *     replacement model collapses after QB1, because in a 1-QB league the
 *     replacement quarterback is nearly as good — true on paper, and not how
 *     this room bids.
 *
 * So history sets two things a projection cannot: HOW MANY of each position get
 * drafted, and WHAT EACH RANK COSTS. The model still decides who occupies which
 * rank. That split is the whole idea.
 */
import { POSITIONS, type LeagueConfig, type Position } from './league.js';

export interface PastAuction {
  season: string;
  picks: Array<{ playerId: string; position: string; price: number }>;
}

export interface PriceCurve {
  /** How many of each position this league drafts, averaged over seasons. */
  counts: Record<Position, number>;
  /** Price by within-position rank, index 0 = the most expensive. */
  prices: Record<Position, number[]>;
  seasons: string[];
  /** Total dollars the curve accounts for. Should equal the room's budget. */
  total: number;
}

const isPosition = (v: string): v is Position => (POSITIONS as readonly string[]).includes(v);

/**
 * Resample a price curve to a different length.
 *
 * Seasons rarely draft the same number at a position, and the model's pool will
 * differ again. Linear interpolation over the normalised rank keeps the SHAPE —
 * the cliff after the top few, the long $1 tail — which is the part worth
 * preserving. Nearest-rank sampling would lose the cliff.
 */
export function resample(curve: number[], length: number): number[] {
  if (length <= 0) return [];
  if (curve.length === 0) return new Array(length).fill(0);
  if (curve.length === 1) return new Array(length).fill(curve[0]);

  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const pos = length === 1 ? 0 : (i / (length - 1)) * (curve.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(curve.length - 1, Math.ceil(pos));
    out.push(lo === hi ? curve[lo] : curve[lo] + (curve[hi] - curve[lo]) * (pos - lo));
  }
  return out;
}

/**
 * Average several seasons of auctions into one curve per position.
 *
 * Seasons are averaged on the normalised rank rather than the raw one, and each
 * season is first scaled to the CURRENT budget — a league that changes its
 * budget or its roster size should still be able to use its own history.
 */
export function buildPriceCurve(auctions: PastAuction[], cfg: LeagueConfig): PriceCurve | null {
  const usable = auctions.filter((a) => a.picks.length > 0);
  if (usable.length === 0) return null;

  const room = cfg.teams * cfg.budget;

  // Per season: sorted price list per position, scaled to this league's budget.
  const perSeason = usable.map((auction) => {
    const spent = auction.picks.reduce((sum, p) => sum + p.price, 0);
    // A season is normalised by what was actually spent, not by the nominal
    // budget: managers routinely leave a few dollars unspent, and treating that
    // as real money would shrink every price slightly.
    const scale = spent > 0 ? room / spent : 1;
    const byPos = {} as Record<Position, number[]>;
    for (const pos of POSITIONS) byPos[pos] = [];
    for (const pick of auction.picks) {
      if (isPosition(pick.position)) byPos[pick.position].push(pick.price * scale);
    }
    for (const pos of POSITIONS) byPos[pos].sort((a, b) => b - a);
    return byPos;
  });

  const counts = {} as Record<Position, number>;
  const prices = {} as Record<Position, number[]>;

  for (const pos of POSITIONS) {
    const seasons = perSeason.map((s) => s[pos]).filter((l) => l.length > 0);
    if (seasons.length === 0) {
      counts[pos] = 0;
      prices[pos] = [];
      continue;
    }
    const n = Math.round(seasons.reduce((sum, l) => sum + l.length, 0) / seasons.length);
    counts[pos] = n;
    const resampled = seasons.map((l) => resample(l, n));
    prices[pos] = Array.from({ length: n }, (_, i) =>
      resampled.reduce((sum, l) => sum + l[i], 0) / resampled.length
    );
  }

  const total = POSITIONS.reduce((sum, pos) => sum + prices[pos].reduce((a, b) => a + b, 0), 0);
  return { counts, prices, seasons: usable.map((a) => a.season), total };
}

/**
 * Reconcile the historical draft counts with the roster slots that must be
 * filled this year.
 *
 * History says 192 players went last year; if the league has changed size the
 * counts have to move, and they should move where the flexibility is. Scaling
 * proportionally and then fixing the rounding against the deepest position
 * keeps the shape — the point is that this league drafts nine defences and
 * eighty receivers, not the exact integers.
 */
export function fitCounts(
  counts: Record<Position, number>,
  target: number
): Record<Position, number> {
  const positions = POSITIONS.filter((p) => counts[p] > 0);
  const sum = positions.reduce((s, p) => s + counts[p], 0);
  if (sum === 0) return counts;

  const scaled = {} as Record<Position, number>;
  for (const pos of POSITIONS) scaled[pos] = 0;
  for (const pos of positions) scaled[pos] = Math.max(1, Math.round((counts[pos] / sum) * target));

  // Rounding will not land exactly on the target; push the remainder onto the
  // deepest position, where one more or one fewer player is least significant.
  let drift = target - positions.reduce((s, p) => s + scaled[p], 0);
  const deepest = positions.slice().sort((a, b) => scaled[b] - scaled[a]);
  let i = 0;
  while (drift !== 0 && deepest.length > 0) {
    const pos = deepest[i % deepest.length];
    const next = scaled[pos] + Math.sign(drift);
    if (next >= 1) {
      scaled[pos] = next;
      drift -= Math.sign(drift);
    }
    i += 1;
    if (i > target * 4) break;
  }
  return scaled;
}

/**
 * Turn any set of per-player prices into a curve, so a market source can stand
 * in for a league's own history.
 *
 * The shape is all that is borrowed — how many of each position get taken and
 * what each rank costs. A league with two years of its own auctions on file
 * should never reach for this; a first-season league, or one whose platform
 * Gavel cannot read, otherwise has nothing but the model.
 */
export function curveFromPrices(
  priced: Array<{ position: Position; price: number }>,
  seasons: string[]
): PriceCurve | null {
  const withPrice = priced.filter((p) => p.price > 0);
  if (withPrice.length === 0) return null;

  const counts = {} as Record<Position, number>;
  const prices = {} as Record<Position, number[]>;
  for (const pos of POSITIONS) {
    const list = withPrice
      .filter((p) => p.position === pos)
      .map((p) => p.price)
      .sort((a, b) => b - a);
    counts[pos] = list.length;
    prices[pos] = list;
  }
  const total = withPrice.reduce((sum, p) => sum + p.price, 0);
  return { counts, prices, seasons, total };
}
