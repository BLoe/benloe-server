/**
 * Usage against production — the buy-low / sell-high engine.
 *
 * DECISION SERVED: "who should I be trading for, and who should I be selling
 * before the market catches up?"
 *
 * The premise is that fantasy points are a *lagging* measure. A back who takes
 * over a backfield gets the snaps in week 6 and the touchdowns in week 9, and
 * for those three weeks the box score says he is the same player he was. Usage
 * — snap share, target share, air-yards share — moves first, so the gap between
 * how much a player is being *used* and how much he is *producing* is the
 * closest thing to a leading indicator a fantasy manager can get.
 *
 * Both sides are converted to percentile ranks within position before they are
 * compared. Raw numbers cannot be subtracted from each other: a 70% snap share
 * and 14 points are not on the same scale, and a tight end's 18% target share
 * means something completely different from a receiver's. Ranking within
 * position against the players who actually compete for the same lineup slot is
 * the only comparison that means anything.
 */

export interface PlayerUsageInput {
  playerId: string;
  position: string | null;
  /** Weekly snap share, 0-1, oldest first. */
  snaps: Array<{ week: number; offensePct: number }>;
  /** Weekly usage and the points it produced, oldest first. */
  usage: Array<{
    week: number;
    targets: number;
    carries: number;
    targetShare: number | null;
    airYardsShare: number | null;
    points: number;
  }>;
}

export interface DivergenceRow {
  playerId: string;
  position: string;
  /** Mean snap share over the window, 0-1. */
  snapShare: number | null;
  /** Mean target share over the window, 0-1. */
  targetShare: number | null;
  /** Points per game over the window. */
  pointsPerGame: number;
  /**
   * What a player at this usage level typically scores at this position —
   * read off the production distribution at his usage percentile.
   */
  expectedPointsPerGame: number;
  /**
   * expectedPointsPerGame - pointsPerGame. Real points per game, not a
   * percentile: this is what the divergence is actually worth.
   */
  pointsGap: number;
  /** Percentile of this player's usage within his position, 0-1. */
  usageRank: number;
  /** Percentile of his production within his position, 0-1. */
  productionRank: number;
  /**
   * usageRank - productionRank, in percentile points.
   * Positive: used more than he is scoring — the market has not caught up.
   * Negative: scoring more than his usage supports — regression is coming.
   */
  divergence: number;
  /** How many games the window actually covered. Fewer means less trustworthy. */
  games: number;
  verdict: 'buy' | 'sell' | 'fair';
}

/**
 * How many recent games to judge on.
 *
 * Four is a compromise the fantasy world has largely settled on: long enough
 * that one blowout does not define a player, short enough to catch a role that
 * changed a month ago. A whole season would average away exactly the change
 * this function exists to find.
 */
export const WINDOW = 4;

/**
 * How far apart the two ranks must be before it is worth calling a move.
 *
 * 20 percentile points is roughly "two tiers at his position". Below that the
 * signal is inside the noise of a four-game sample and saying anything would be
 * false confidence.
 */
export const DIVERGENCE_THRESHOLD = 0.2;

/** Games needed before a divergence is worth reporting at all. */
export const MIN_GAMES = 2;

/**
 * Positions this method can actually speak about.
 *
 * Quarterbacks are excluded, and the reason is worth stating because the
 * omission looks arbitrary. Snap share is the backbone of the usage score, and
 * every starting quarterback plays essentially every snap — so their usage
 * percentiles collapse into a tie near the top while their production spreads
 * out normally. The method then reads every below-average quarterback as
 * "heavily used but not scoring", which is not a finding, it is an artefact of
 * measuring a variable that does not vary. It put four quarterbacks at the top
 * of the buy list on first run.
 *
 * A quarterback's real usage signal is pass attempts and designed runs relative
 * to his own offence, which is a different measurement; until that exists here,
 * saying nothing is the honest answer.
 */
export const RANKABLE_POSITIONS = new Set(['RB', 'WR', 'TE']);

const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/**
 * Percentile rank of a value within a sorted-ascending list, 0-1.
 *
 * Ties get the midpoint of the tied band rather than the bottom, so ten players
 * who all did exactly nothing all rank at the middle of the nothing-group
 * instead of one of them arbitrarily "beating" the others.
 */
export function percentileRank(value: number, sorted: number[]): number {
  if (sorted.length <= 1) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return (below + equal / 2) / sorted.length;
}

/**
 * Usage score for one player: snap share and target share, blended.
 *
 * Snap share is the base — being on the field is the precondition for
 * everything — and target share is added where it exists because a receiver who
 * plays every snap and is never thrown to is not being used, he is being
 * decorated. A running back with no target share is not penalised for it; the
 * blend simply falls back to snaps.
 */
export function usageScore(snapShare: number | null, targetShare: number | null): number {
  if (snapShare == null && targetShare == null) return 0;
  if (targetShare == null) return snapShare ?? 0;
  if (snapShare == null) return targetShare;
  // Target share is a much smaller number than snap share by nature (a great
  // one is 0.30, a great snap share is 0.90), so it is scaled to a comparable
  // range before blending rather than being swamped.
  return 0.6 * snapShare + 0.4 * Math.min(1, targetShare / 0.3);
}

/**
 * Rank every player's usage against his production, within position.
 *
 * `throughWeek` bounds the window so this is reproducible: passing the same
 * inputs and the same week always gives the same answer, which is what makes it
 * testable and what keeps a screenshot stable.
 */
export function findDivergence(
  players: PlayerUsageInput[],
  throughWeek: number,
  window = WINDOW
): DivergenceRow[] {
  const from = throughWeek - window + 1;

  // Summarise each player over the window first; ranking needs the whole field.
  const summaries = players.map((p) => {
    const snaps = p.snaps.filter((s) => s.week >= from && s.week <= throughWeek);
    const usage = p.usage.filter((u) => u.week >= from && u.week <= throughWeek);

    const snapShare = snaps.length ? mean(snaps.map((s) => s.offensePct)) : null;
    const withShare = usage.filter((u) => u.targetShare != null);
    const targetShare = withShare.length ? mean(withShare.map((u) => u.targetShare!)) : null;

    // Games are counted from usage rows, which exist for anyone who was active.
    const games = Math.max(snaps.length, usage.length);
    const pointsPerGame = usage.length ? mean(usage.map((u) => u.points)) : 0;

    return {
      playerId: p.playerId,
      position: (p.position ?? '?').toUpperCase(),
      snapShare,
      targetShare,
      pointsPerGame,
      games,
      usage: usageScore(snapShare, targetShare),
    };
  });

  // Rank within position. A tight end's usage is only meaningful against other
  // tight ends, and only against players with enough games to compare.
  const byPosition = new Map<string, typeof summaries>();
  for (const s of summaries) {
    if (s.games < MIN_GAMES) continue;
    if (!RANKABLE_POSITIONS.has(s.position)) continue;
    const bucket = byPosition.get(s.position);
    if (bucket) bucket.push(s);
    else byPosition.set(s.position, [s]);
  }

  const out: DivergenceRow[] = [];

  for (const [position, group] of byPosition) {
    // A position with one or two players gives meaningless percentiles.
    if (group.length < 4) continue;

    const usageSorted = group.map((g) => g.usage).sort((a, b) => a - b);
    const pointsSorted = group.map((g) => g.pointsPerGame).sort((a, b) => a - b);

    for (const g of group) {
      const usageRank = percentileRank(g.usage, usageSorted);
      const productionRank = percentileRank(g.pointsPerGame, pointsSorted);
      const divergence = usageRank - productionRank;

      // Put the divergence back into points. A percentile gap is not something
      // a manager can weigh against anything else in the app; "he is scoring
      // four a game less than his usage says he should" is.
      const expectedPointsPerGame = quantile(pointsSorted, usageRank);

      out.push({
        playerId: g.playerId,
        position,
        snapShare: g.snapShare,
        targetShare: g.targetShare,
        pointsPerGame: g.pointsPerGame,
        expectedPointsPerGame,
        pointsGap: expectedPointsPerGame - g.pointsPerGame,
        usageRank,
        productionRank,
        divergence,
        games: g.games,
        verdict:
          divergence >= DIVERGENCE_THRESHOLD
            ? 'buy'
            : divergence <= -DIVERGENCE_THRESHOLD
              ? 'sell'
              : 'fair',
      });
    }
  }

  // Strongest signal first, in both directions — the biggest sell is as
  // actionable as the biggest buy.
  return out.sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
}

/**
 * The value at a given percentile of a sorted-ascending list, interpolated.
 *
 * Used to answer "what does a player at this usage level normally score",
 * which is what turns a percentile gap back into points.
 */
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Is this player's usage trending up or down inside the window?
 *
 * Separate from divergence on purpose: a player can be under-producing relative
 * to steady usage (a regression candidate) or under-producing because his usage
 * only just arrived (a genuine breakout). The second is worth much more, and
 * only a trend tells them apart.
 *
 * Returns the change in snap share from the first half of the window to the
 * second, in share points.
 */
export function usageTrend(
  snaps: Array<{ week: number; offensePct: number }>,
  throughWeek: number,
  window = WINDOW
): number | null {
  const inWindow = snaps
    .filter((s) => s.week >= throughWeek - window + 1 && s.week <= throughWeek)
    .sort((a, b) => a.week - b.week);
  if (inWindow.length < 2) return null;

  const half = Math.floor(inWindow.length / 2);
  const early = inWindow.slice(0, half);
  const late = inWindow.slice(inWindow.length - half);
  return mean(late.map((s) => s.offensePct)) - mean(early.map((s) => s.offensePct));
}
