/**
 * Win-now versus future — is this roster built for the year it is having?
 *
 * DECISION SERVED: "should I be buying or selling?" The single most consequential
 * dynasty decision, and the one most often made on vibes.
 *
 * FantasyCalc publishes a dynasty value and a redraft value for the same player.
 * Dynasty value prices every future season; redraft value prices only this one.
 * Their ratio is therefore a clean statement about *when* an asset pays: a
 * 22-year-old who has not broken out yet carries far more dynasty value than
 * redraft value, and a 31-year-old producing right now carries the reverse.
 *
 * Summed across a roster, weighted by value, that ratio says what the roster is
 * *built* for. Set against the record — what the roster is actually *doing* —
 * it produces the only genuinely useful strategic read in dynasty: you are 5-1
 * with a rebuild's roster, or 1-5 with a contender's.
 */

export interface OrientationInput {
  playerId: string;
  dynasty: number | null;
  redraft: number | null;
}

export interface PlayerOrientation {
  playerId: string;
  dynasty: number;
  redraft: number;
  /**
   * -1 (pure future) to +1 (pure win-now).
   *
   * Derived from the share of a player's total value that sits in this season:
   * redraft/(redraft+dynasty), rescaled so 0 is balanced. A player worth the
   * same in both formats sits at 0.
   */
  index: number;
}

export interface RosterOrientation {
  /** Value-weighted mean of the player indices, -1 to +1. */
  index: number;
  /** Total dynasty value on the roster. */
  dynastyValue: number;
  /** Total redraft value on the roster. */
  redraftValue: number;
  players: PlayerOrientation[];
  /** How many rostered players had no market value at all. */
  unpriced: number;
  label: 'win-now' | 'balanced' | 'building';
}

/**
 * A player's own orientation.
 *
 * Both values must be present and positive: a missing one is not "zero future
 * value", it is no information, and treating it as zero would drag the whole
 * roster's index toward whichever side happens to be missing.
 */
export function playerOrientation(p: OrientationInput): PlayerOrientation | null {
  if (!p.dynasty || !p.redraft || p.dynasty <= 0 || p.redraft <= 0) return null;
  const share = p.redraft / (p.redraft + p.dynasty);
  // share is 0.5 when the two agree; the *2-1 puts that at 0.
  return { playerId: p.playerId, dynasty: p.dynasty, redraft: p.redraft, index: share * 2 - 1 };
}

/**
 * Where the boundaries sit.
 *
 * Deliberately wide. Most rosters genuinely are balanced, and an app that
 * labels every team a contender or a rebuild is not telling you anything.
 */
export const WIN_NOW_THRESHOLD = 0.06;
export const BUILDING_THRESHOLD = -0.06;

export function orientationOf(players: OrientationInput[]): RosterOrientation {
  const priced: PlayerOrientation[] = [];
  let unpriced = 0;

  for (const p of players) {
    const o = playerOrientation(p);
    if (o) priced.push(o);
    else unpriced++;
  }

  const dynastyValue = priced.reduce((s, p) => s + p.dynasty, 0);
  const redraftValue = priced.reduce((s, p) => s + p.redraft, 0);

  // Weight by *combined* value, not dynasty value.
  //
  // A roster's orientation should be set by its best assets rather than by its
  // twenty-fifth man, so some weighting is needed. But weighting by dynasty
  // value double-counts: a high dynasty value relative to redraft is precisely
  // what makes a player's index negative, so dynasty-weighting drags every
  // roster toward "building". A test caught this — a roster of three veterans
  // and three equivalent youngsters read as a rebuild when it is plainly
  // balanced. Combined value is neutral about *when* an asset pays and only
  // measures how much asset there is.
  const weightOf = (p: PlayerOrientation) => p.dynasty + p.redraft;
  const weight = priced.reduce((s, p) => s + weightOf(p), 0);
  const index = weight ? priced.reduce((s, p) => s + p.index * weightOf(p), 0) / weight : 0;

  return {
    index,
    dynastyValue,
    redraftValue,
    players: priced.sort((a, b) => b.dynasty - a.dynasty),
    unpriced,
    label: index > WIN_NOW_THRESHOLD ? 'win-now' : index < BUILDING_THRESHOLD ? 'building' : 'balanced',
  };
}

export interface Mismatch {
  /** True when the roster's shape and its record point opposite ways. */
  mismatched: boolean;
  /** What to actually do about it, or null when nothing needs saying. */
  advice: string | null;
}

/**
 * The read that makes the index worth computing.
 *
 * A rebuild that is winning should sell the veterans it does not need; a
 * contender that is losing has already paid for a window that is closing. Both
 * are expensive mistakes and both are invisible without putting these two
 * numbers side by side.
 *
 * `winPct` is over the season so far; below `MIN_GAMES` there is no record to
 * speak of and this stays quiet rather than reading tea leaves from one week.
 */
export const MIN_GAMES_FOR_MISMATCH = 4;

export function readMismatch(
  o: RosterOrientation,
  wins: number,
  losses: number,
  playoffCutPct = 0.5
): Mismatch {
  const games = wins + losses;
  if (games < MIN_GAMES_FOR_MISMATCH) {
    return { mismatched: false, advice: null };
  }
  const winPct = wins / games;

  if (o.label === 'building' && winPct > playoffCutPct + 0.15) {
    return {
      mismatched: true,
      advice:
        'You are winning with a roster built for later. Either buy a piece that makes this season real, or sell the veterans carrying you before their value goes.',
    };
  }
  if (o.label === 'win-now' && winPct < playoffCutPct - 0.15) {
    return {
      mismatched: true,
      advice:
        'You are losing with a roster built for now. This window is the expensive one — sell the win-now pieces while they still price like assets.',
    };
  }
  return { mismatched: false, advice: null };
}
