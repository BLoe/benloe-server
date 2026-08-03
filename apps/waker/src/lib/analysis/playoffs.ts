/**
 * Playoff odds, by simulation.
 *
 * DECISION SERVED: "does this week actually matter?" — and its more useful
 * sibling, "which of my remaining games is the one I cannot lose?"
 *
 * A projected record is not odds. Telling someone they will finish 8-6 says
 * nothing about whether that makes the playoffs, because it depends on eleven
 * other teams' records and on the tiebreakers. The only honest way to answer is
 * to play the season out many times with the noise left in, and count.
 *
 * Deliberately seeded and deterministic. An odds number that changes every time
 * you refresh the page is worse than no number, and a screenshot of one cannot
 * be verified. The generator is a small xorshift so the same inputs always give
 * the same answer.
 */

export interface SimTeam {
  rosterId: number;
  /** Expected points in a single week from the best available lineup. */
  weeklyPoints: number;
  /** Games already played. */
  wins: number;
  losses: number;
  /** Points scored so far — the standard first tiebreaker. */
  pointsFor: number;
}

export interface SimGame {
  week: number;
  homeRosterId: number;
  awayRosterId: number;
}

export interface PlayoffOdds {
  rosterId: number;
  /** Share of simulations making the playoff field, 0-1. */
  playoffs: number;
  /** Share finishing first. */
  firstSeed: number;
  /** Share finishing last — the other end that matters in dynasty. */
  lastPlace: number;
  /** Mean final record across simulations. */
  expectedWins: number;
  expectedLosses: number;
}

/** Weekly scoring noise, as a fraction of a lineup's expected score. */
const TEAM_SIGMA_RATIO = 0.25;
const TEAM_SIGMA_FLOOR = 12;

export const teamSigma = (expected: number): number =>
  Math.max(TEAM_SIGMA_FLOOR, expected * TEAM_SIGMA_RATIO);

/** Deterministic PRNG — xorshift32. Same seed, same season, every time. */
export function makeRandom(seed: number): () => number {
  let x = seed || 0x2545f491;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    // >>> 0 keeps it unsigned; the divisor maps it into [0, 1).
    return (x >>> 0) / 0x100000000;
  };
}

/** Box-Muller, so a uniform generator can produce normal scores. */
function normal(rand: () => number): number {
  // u must be non-zero for the log; the generator can return exactly 0.
  const u = rand() || Number.EPSILON;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SimOptions {
  playoffTeams: number;
  /** How many seasons to play out. */
  runs?: number;
  seed?: number;
}

/**
 * Play the rest of the season out `runs` times and count the outcomes.
 *
 * Ties are broken on points for, which is what Sleeper does by default. That is
 * an assumption about league settings and it is worth knowing about: a league
 * using head-to-head or division tiebreakers will differ at the margin, though
 * almost never at the top or bottom of the field.
 */
export function simulateSeason(
  teams: SimTeam[],
  remaining: SimGame[],
  o: SimOptions
): PlayoffOdds[] {
  const runs = o.runs ?? 2000;
  const rand = makeRandom(o.seed ?? 20260803);

  const tally = new Map<number, { playoffs: number; first: number; last: number; wins: number }>();
  for (const t of teams) tally.set(t.rosterId, { playoffs: 0, first: 0, last: 0, wins: 0 });

  const byId = new Map(teams.map((t) => [t.rosterId, t]));

  for (let run = 0; run < runs; run++) {
    const wins = new Map<number, number>();
    const points = new Map<number, number>();
    for (const t of teams) {
      wins.set(t.rosterId, t.wins);
      points.set(t.rosterId, t.pointsFor);
    }

    for (const game of remaining) {
      const home = byId.get(game.homeRosterId);
      const away = byId.get(game.awayRosterId);
      if (!home || !away) continue;

      const hs = home.weeklyPoints + normal(rand) * teamSigma(home.weeklyPoints);
      const as = away.weeklyPoints + normal(rand) * teamSigma(away.weeklyPoints);

      points.set(home.rosterId, points.get(home.rosterId)! + hs);
      points.set(away.rosterId, points.get(away.rosterId)! + as);
      // An exact tie is possible in principle and vanishingly rare with
      // continuous scores; the home side takes it rather than special-casing.
      if (hs >= as) wins.set(home.rosterId, wins.get(home.rosterId)! + 1);
      else wins.set(away.rosterId, wins.get(away.rosterId)! + 1);
    }

    const table = teams
      .map((t) => ({ id: t.rosterId, w: wins.get(t.rosterId)!, pf: points.get(t.rosterId)! }))
      .sort((a, b) => b.w - a.w || b.pf - a.pf);

    for (let i = 0; i < table.length; i++) {
      const row = tally.get(table[i].id)!;
      if (i < o.playoffTeams) row.playoffs++;
      if (i === 0) row.first++;
      if (i === table.length - 1) row.last++;
      row.wins += table[i].w;
    }
  }

  const totalGames =
    (teams[0]?.wins ?? 0) +
    (teams[0]?.losses ?? 0) +
    remaining.filter((g) => g.homeRosterId === teams[0]?.rosterId || g.awayRosterId === teams[0]?.rosterId)
      .length;

  return teams
    .map((t) => {
      const row = tally.get(t.rosterId)!;
      const expectedWins = row.wins / runs;
      return {
        rosterId: t.rosterId,
        playoffs: row.playoffs / runs,
        firstSeed: row.first / runs,
        lastPlace: row.last / runs,
        expectedWins,
        expectedLosses: Math.max(0, totalGames - expectedWins),
      };
    })
    .sort((a, b) => b.playoffs - a.playoffs);
}

export interface GameLeverage {
  week: number;
  opponentRosterId: number;
  /** Playoff odds if this game is won. */
  ifWon: number;
  /** Playoff odds if it is lost. */
  ifLost: number;
  /** ifWon - ifLost. How much this single game is actually worth. */
  swing: number;
}

/**
 * How much each remaining game moves the needle.
 *
 * This is the part a standings table can never tell you: two games against
 * identical opponents can be worth wildly different amounts depending on where
 * they fall in the schedule and who else is fighting for the same spot.
 *
 * Computed by CONDITIONING, not by forcing. The season is played out once, and
 * every run is filed under which of your games it happened to win; the odds for
 * "if you win week 7" are simply the share of the runs that won week 7 and also
 * made the playoffs. That is the definition of a conditional probability, so it
 * is unbiased by construction — and it does every game in one pass rather than
 * two simulations per game.
 *
 * The earlier version forced a result by handing out a win and re-simulating.
 * That was wrong twice over, and the second error was hidden by the first.
 * Awarding a win without the points left both teams a whole game of points-for
 * behind everyone else, and points-for is the tiebreaker, so the forced runs
 * quietly lost every tie — biasing the absolute odds down by three to five
 * points of probability against the table printed directly above them. Crediting
 * the expected points instead over-corrected, because the *other* six teams'
 * games that week were still being simulated with real variance while these two
 * got a flat average. Conditioning has neither problem.
 */
export function gameLeverage(
  rosterId: number,
  teams: SimTeam[],
  remaining: SimGame[],
  o: SimOptions
): GameLeverage[] {
  const mine = remaining.filter((g) => g.homeRosterId === rosterId || g.awayRosterId === rosterId);
  if (!mine.length) return [];

  const runs = o.runs ?? 4000;
  const rand = makeRandom(o.seed ?? 20260803);
  const byId = new Map(teams.map((t) => [t.rosterId, t]));

  // Per game: how many runs won it, and how many of those also made the field.
  const won = mine.map(() => 0);
  const wonAndIn = mine.map(() => 0);
  const lostAndIn = mine.map(() => 0);

  for (let run = 0; run < runs; run++) {
    const wins = new Map<number, number>();
    const points = new Map<number, number>();
    for (const t of teams) {
      wins.set(t.rosterId, t.wins);
      points.set(t.rosterId, t.pointsFor);
    }

    const wonThisRun: boolean[] = mine.map(() => false);

    for (const game of remaining) {
      const home = byId.get(game.homeRosterId);
      const away = byId.get(game.awayRosterId);
      if (!home || !away) continue;

      const hs = home.weeklyPoints + normal(rand) * teamSigma(home.weeklyPoints);
      const as = away.weeklyPoints + normal(rand) * teamSigma(away.weeklyPoints);
      points.set(home.rosterId, points.get(home.rosterId)! + hs);
      points.set(away.rosterId, points.get(away.rosterId)! + as);

      const homeWon = hs >= as;
      if (homeWon) wins.set(home.rosterId, wins.get(home.rosterId)! + 1);
      else wins.set(away.rosterId, wins.get(away.rosterId)! + 1);

      const index = mine.indexOf(game);
      if (index >= 0) {
        wonThisRun[index] = game.homeRosterId === rosterId ? homeWon : !homeWon;
      }
    }

    const table = teams
      .map((t) => ({ id: t.rosterId, w: wins.get(t.rosterId)!, pf: points.get(t.rosterId)! }))
      .sort((a, b) => b.w - a.w || b.pf - a.pf);
    const madeIt = table.findIndex((r) => r.id === rosterId) < o.playoffTeams;

    for (let i = 0; i < mine.length; i++) {
      if (wonThisRun[i]) {
        won[i]++;
        if (madeIt) wonAndIn[i]++;
      } else if (madeIt) {
        lostAndIn[i]++;
      }
    }
  }

  return mine.map((game, i) => {
    const lost = runs - won[i];
    // A game the simulation never lost (or never won) has no conditional odds
    // on that side; reporting 0 there would read as "certain to miss" when it
    // actually means "no evidence". The unconditional share is the honest
    // stand-in, which makes the swing zero rather than fabricated.
    const unconditional = (wonAndIn[i] + lostAndIn[i]) / runs;
    const ifWon = won[i] ? wonAndIn[i] / won[i] : unconditional;
    const ifLost = lost ? lostAndIn[i] / lost : unconditional;

    return {
      week: game.week,
      opponentRosterId: game.homeRosterId === rosterId ? game.awayRosterId : game.homeRosterId,
      ifWon,
      ifLost,
      swing: ifWon - ifLost,
    };
  }).sort((a, b) => a.week - b.week);
}
