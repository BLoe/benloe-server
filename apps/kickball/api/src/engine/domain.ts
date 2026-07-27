/**
 * Domain constants for the kickball lineup engine.
 *
 * Everything here is pure data with no database or runtime dependency, so the
 * optimizers and the unit tests can import it freely.
 */

export type StatCategory = 'offense' | 'defense';

export interface StatDef {
  key: string;
  name: string;
  category: StatCategory;
  /** Shown on the dashboard to explain what the rating means. */
  description: string;
  /** The question the rating game asks. Reads as "Who is the better ___?" */
  prompt: string;
}

export const STATS: StatDef[] = [
  {
    key: 'bunting',
    name: 'Bunting',
    category: 'offense',
    description: 'Placing a soft kick where the defense is not.',
    prompt: 'Who lays down the better bunt?',
  },
  {
    key: 'power',
    name: 'Power kicking',
    category: 'offense',
    description: 'Driving the ball deep enough to clear the outfield or score runners.',
    prompt: 'Who kicks the ball harder and deeper?',
  },
  {
    key: 'on_base',
    name: 'Getting on base',
    category: 'offense',
    description: 'However it happens — reaching first at a high rate.',
    prompt: 'Who is more likely to reach base?',
  },
  {
    key: 'baserunning',
    name: 'Base running',
    category: 'offense',
    description: 'Speed on the paths, taking the extra base, scoring from second.',
    prompt: 'Who is the better base runner?',
  },
  {
    key: 'offense_iq',
    name: 'Offensive decision making',
    category: 'offense',
    description: 'Reading the defense, knowing when to hold, when to send it.',
    prompt: 'Who makes smarter decisions at the plate and on the bases?',
  },
  {
    key: 'pitching',
    name: 'Pitching',
    category: 'defense',
    description: 'Speed, spin and location that induces weak kicks.',
    prompt: 'Who is the better pitcher?',
  },
  {
    key: 'pop_flies',
    name: 'Catching pop flies',
    category: 'defense',
    description: 'Tracking a ball in the air and squeezing it.',
    prompt: 'Who is more reliable catching a ball in the air?',
  },
  {
    key: 'outfielding',
    name: 'Outfielding',
    category: 'defense',
    description: 'Range in the grass, reading it off the foot, backing up the play.',
    prompt: 'Who covers more ground in the outfield?',
  },
  {
    key: 'infielding',
    name: 'Infield fielding',
    category: 'defense',
    description:
      'Everything in the dirt: grounders handled cleanly, and catching a throw at the bag with a runner bearing down.',
    prompt: 'Who has better hands in the infield?',
  },
  {
    key: 'throwing',
    name: 'Throwing / passing',
    category: 'defense',
    description: 'Arm strength and accuracy getting the ball where it needs to be.',
    prompt: 'Who makes the better throw?',
  },
  {
    key: 'striking',
    name: 'Striking',
    category: 'defense',
    description: 'Charging in from third to smother a bunt and make the play.',
    prompt: 'Who charges a bunt better?',
  },
  {
    key: 'defense_iq',
    name: 'Defensive decision making',
    category: 'defense',
    description: 'Knowing the base to throw to, when to cheat in, when to cover.',
    prompt: 'Who makes smarter decisions in the field?',
  },
];

export const STAT_KEYS = STATS.map((s) => s.key);
export const OFFENSE_KEYS = STATS.filter((s) => s.category === 'offense').map((s) => s.key);
export const DEFENSE_KEYS = STATS.filter((s) => s.category === 'defense').map((s) => s.key);

export function getStat(key: string): StatDef | undefined {
  return STATS.find((s) => s.key === key);
}

export type PositionZone = 'battery' | 'infield' | 'outfield';

export interface PositionDef {
  key: string;
  /** Two or three character code used on the lineup card. */
  code: string;
  name: string;
  /** Alternate name the team actually uses, if any. */
  alias?: string;
  zone: PositionZone;
  /** Weights over defensive stat keys. Always sums to 1. */
  weights: Record<string, number>;
  /** Fractional coordinates on the field diagram, origin at home plate. */
  x: number;
  y: number;
}

/**
 * The ten defensive positions.
 *
 * Weights encode which rated skills actually matter at each spot, and they are
 * kickball weights, not baseball ones. Two corrections worth remembering,
 * because both are easy to get wrong by analogy:
 *
 *   - The catcher never catches a pop fly. There is no bat, so nothing pops up
 *     behind the plate. Their job is covering home for force outs and tags and
 *     receiving throws with a runner bearing down, which is why the row below
 *     is hands, decision making and arm, with no pop-fly term at all.
 *   - Bunt coverage is overwhelmingly the striker's, which is the entire point
 *     of the position. The pitcher only takes what is right at them and the
 *     first baseman only rarely, so those carry token striking weight.
 *
 * The roamer covers more ground than the corner outfielders, not less, so their
 * outfielding weight sits above everyone else's.
 */
export const POSITIONS: PositionDef[] = [
  {
    key: 'pitcher',
    code: 'P',
    name: 'Pitcher',
    zone: 'battery',
    // Only fields the bunts hit straight back at them; the striker has the rest.
    weights: { pitching: 0.45, defense_iq: 0.2, infielding: 0.15, throwing: 0.1, striking: 0.1 },
    x: 0.5,
    y: 0.55,
  },
  {
    key: 'catcher',
    code: 'C',
    name: 'Catcher',
    zone: 'battery',
    // Receives the throw, knows the play, makes the next throw. No pop flies,
    // and the bunts belong to the striker.
    weights: { infielding: 0.45, defense_iq: 0.3, throwing: 0.25 },
    x: 0.5,
    y: 0.93,
  },
  {
    key: 'first',
    code: '1B',
    name: 'First base',
    zone: 'infield',
    // Catching the throw is the job, and infielding now covers that.
    weights: { infielding: 0.5, defense_iq: 0.2, throwing: 0.18, striking: 0.07, pop_flies: 0.05 },
    x: 0.74,
    y: 0.58,
  },
  {
    key: 'second',
    code: '2B',
    name: 'Second base',
    zone: 'infield',
    weights: { infielding: 0.4, throwing: 0.25, defense_iq: 0.2, pop_flies: 0.15 },
    x: 0.66,
    y: 0.42,
  },
  {
    key: 'shortstop',
    code: 'SS',
    name: 'Shortstop',
    zone: 'infield',
    weights: { infielding: 0.4, throwing: 0.28, defense_iq: 0.17, pop_flies: 0.15 },
    x: 0.34,
    y: 0.42,
  },
  {
    key: 'third',
    code: '3B',
    name: 'Third base',
    alias: 'Striker',
    zone: 'infield',
    // Bunt coverage is almost entirely this position. That is the point of it.
    weights: { striking: 0.5, infielding: 0.22, throwing: 0.18, defense_iq: 0.1 },
    x: 0.26,
    y: 0.58,
  },
  {
    key: 'left',
    code: 'LF',
    name: 'Left field',
    zone: 'outfield',
    weights: { outfielding: 0.4, pop_flies: 0.3, throwing: 0.2, defense_iq: 0.1 },
    x: 0.13,
    y: 0.2,
  },
  {
    key: 'left_center',
    code: 'LC',
    name: 'Left-center field',
    zone: 'outfield',
    weights: { outfielding: 0.4, pop_flies: 0.3, throwing: 0.2, defense_iq: 0.1 },
    x: 0.37,
    y: 0.11,
  },
  {
    key: 'right_center',
    code: 'RC',
    name: 'Right-center field',
    alias: 'Roamer',
    zone: 'outfield',
    // Covers the most ground of anyone, so outfielding sits above the corners.
    // The token striking is for pressing up on the first-base side against a
    // bunt, which is the one bunt duty that is not the striker's.
    weights: { outfielding: 0.45, defense_iq: 0.25, pop_flies: 0.15, throwing: 0.1, striking: 0.05 },
    x: 0.63,
    y: 0.11,
  },
  {
    key: 'right',
    code: 'RF',
    name: 'Right field',
    zone: 'outfield',
    weights: { outfielding: 0.4, pop_flies: 0.3, throwing: 0.2, defense_iq: 0.1 },
    x: 0.87,
    y: 0.2,
  },
];

export const POSITION_KEYS = POSITIONS.map((p) => p.key);
export const FIELDERS_PER_INNING = POSITIONS.length; // 10

export function getPosition(key: string): PositionDef | undefined {
  return POSITIONS.find((p) => p.key === key);
}

/** Default league settings, overridable from the dashboard. */
export const DEFAULT_SETTINGS = {
  team_name: 'No New Friends',
  innings: 6,
  min_women_in_field: 3,
  /** Neutral starting rating on the 0-100 display scale. */
  default_rating: 50,
};
