/**
 * Where we are in the fantasy week.
 *
 * DECISION SERVED: all of them. This is the clock every decision hangs off.
 *
 * A fantasy week is not a countdown, it is a *cycle* with gates in it. Waivers
 * clear early Wednesday. Lineups lock Sunday at one. Games run until Monday
 * night. Then it resets. What you are able to do depends entirely on which
 * stretch of that cycle you are standing in, and almost every fantasy app makes
 * you work that out for yourself.
 *
 * The model here is a tide: agency rises after waivers clear (you have the
 * whole week and a fresh roster), stays high while you can still act, collapses
 * at lock, and is flat at zero while the games decide themselves. Then it
 * floods again. That curve is the app's navigation and its thesis at once.
 */

export type Phase =
  /** Waivers have not run yet. Claims can still be placed and changed. */
  | 'claims'
  /** Waivers cleared, lineups open. The stretch with the most agency. */
  | 'open'
  /** Hours from lock. Anything you meant to do, do now. */
  | 'closing'
  /** Locked. Games are being played and nothing you do matters until they end. */
  | 'live'
  /** Between the last game and the next waiver run. */
  | 'settled'
  /** No games scheduled at all — the long dynasty offseason. */
  | 'offseason';

export interface Gate {
  label: string;
  /** Position in the week, 0-1, for placing it on the curve. */
  at: number;
  /** Milliseconds until it, negative once passed. */
  inMs: number | null;
}

export interface CyclePosition {
  phase: Phase;
  /** Where we are around the cycle, 0-1. Drives the marker on the curve. */
  at: number;
  /** How much you can still change, 0-1. The height of the tide. */
  agency: number;
  /** One line naming the moment. */
  title: string;
  /** The next thing that will stop you doing something, if any. */
  nextGate: Gate | null;
  gates: Gate[];
}

/**
 * The week's gates, in league-local terms.
 *
 * Sleeper runs waivers early Wednesday morning and locks the main slate at
 * Sunday 1pm Eastern. Thursday and Monday games lock individually, which this
 * deliberately does not model: the useful question is "can I still change my
 * lineup", and for eight of nine slots the answer turns on Sunday one o'clock.
 */
const GATES: Array<{ label: string; day: number; hour: number; at: number }> = [
  { label: 'Waivers clear', day: 3, hour: 3, at: 0.0 },
  { label: 'Lineups lock', day: 0, hour: 13, at: 0.55 },
  { label: 'Games end', day: 1, hour: 23, at: 0.85 },
];

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/**
 * Milliseconds from `now` to the next occurrence of a weekday and hour.
 *
 * Everything is computed in US Eastern, because that is what the NFL schedule
 * is denominated in and what every fantasy deadline actually means — a manager
 * in Denver still locks at 11am local, not 1pm.
 */
export function msUntil(now: Date, day: number, hour: number): number {
  const eastern = easternParts(now);
  const currentMs = eastern.day * DAY + eastern.hour * 3_600_000 + eastern.minute * 60_000;
  const targetMs = day * DAY + hour * 3_600_000;
  let delta = targetMs - currentMs;
  if (delta < 0) delta += WEEK;
  return delta;
}

/**
 * Weekday and clock time in US Eastern.
 *
 * Uses Intl rather than a fixed offset so daylight saving is handled — the NFL
 * season crosses the November change, and being an hour wrong about a lock time
 * is exactly the kind of error this app exists to prevent.
 */
export function easternParts(d: Date): { day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: Math.max(0, days.indexOf(parts.weekday as string)),
    // Intl can return 24 for midnight in hour12:false.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

export interface CycleInput {
  now: Date;
  /** False in the offseason, when none of the gates mean anything. */
  gamesScheduled: boolean;
  /** For the title: "Week 7", "Preseason". */
  periodLabel: string;
  /** Days until the season opens, when it has not. */
  daysToKickoff?: number | null;
}

export function readCycle(input: CycleInput): CyclePosition {
  const { now, gamesScheduled, periodLabel } = input;

  const gates: Gate[] = GATES.map((g) => ({
    label: g.label,
    at: g.at,
    inMs: gamesScheduled ? msUntil(now, g.day, g.hour) : null,
  }));

  if (!gamesScheduled) {
    // The dynasty offseason is most of the year and it is not a dead zone —
    // it is when trades and rookie picks happen. The tide is simply slack.
    return {
      phase: 'offseason',
      at: 0.5,
      agency: 1,
      title:
        input.daysToKickoff != null
          ? `${periodLabel} · week 1 opens in ${input.daysToKickoff} days`
          : periodLabel,
      nextGate: null,
      gates: gates.map((g) => ({ ...g, inMs: null })),
    };
  }

  const toWaivers = msUntil(now, 3, 3);
  const toLock = msUntil(now, 0, 13);
  const toEnd = msUntil(now, 1, 23);

  // Whichever gate is soonest is the one that governs. Phase follows from it,
  // because "what stops me next" is the same question as "where am I".
  const soonest = Math.min(toWaivers, toLock, toEnd);

  let phase: Phase;
  let at: number;
  let agency: number;

  if (soonest === toWaivers) {
    // Waivers are next, so they have not run: claims are still open.
    phase = 'claims';
    at = 0.93;
    agency = 0.45;
  } else if (soonest === toLock) {
    // Lock is next, so waivers have cleared. Under a day out is the crunch.
    const closing = toLock < DAY;
    phase = closing ? 'closing' : 'open';
    at = closing ? 0.45 : 0.2;
    agency = closing ? 0.75 : 1;
  } else {
    phase = toEnd < 6 * 3_600_000 ? 'settled' : 'live';
    at = phase === 'settled' ? 0.9 : 0.7;
    agency = 0;
  }

  const nextGate =
    gates
      .filter((g) => g.inMs != null)
      .sort((a, b) => (a.inMs ?? 0) - (b.inMs ?? 0))[0] ?? null;

  return { phase, at, agency, title: titleFor(phase, periodLabel), nextGate, gates };
}

function titleFor(phase: Phase, period: string): string {
  switch (phase) {
    case 'claims':
      return `${period} · waivers have not run`;
    case 'open':
      return `${period} · lineups open`;
    case 'closing':
      return `${period} · lineups lock today`;
    case 'live':
      return `${period} · games in progress`;
    case 'settled':
      return `${period} · week settled`;
    default:
      return period;
  }
}

/** What this phase means for what you should be doing. */
export function phaseAdvice(phase: Phase): string {
  switch (phase) {
    case 'claims':
      return 'Claims are still open. Anything you want off the wire has to be in before Wednesday morning.';
    case 'open':
      return 'The whole week is available. This is when trades get answered and lineups get thought about.';
    case 'closing':
      return 'Lock is today. Whatever you were going to change, change it now.';
    case 'live':
      return 'Locked. Nothing you do this afternoon changes the result.';
    case 'settled':
      return 'The week is done. Next waiver run is the next thing that can change your roster.';
    default:
      return 'No games scheduled. This is trade and draft-pick season, which in dynasty is most of the year.';
  }
}

/** A short human duration: "2d 4h", "6h", "40m". */
export function humanDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * The tide curve as an SVG path.
 *
 * A real tide curve, not a sine wave: it floods after waivers clear, holds
 * while the week is open, ebbs sharply into lock, and sits at slack water while
 * the games play. The shape is the argument — the flat stretch on the right is
 * the part of the week where nothing you do matters, and it should look like it.
 */
export function tidePath(width: number, height: number): string {
  const pts: Array<[number, number]> = [
    [0.0, 0.42], // waivers clear
    [0.12, 0.9],
    [0.2, 1.0], // fully open
    [0.38, 0.95],
    [0.5, 0.62],
    [0.55, 0.12], // lock
    [0.62, 0.04],
    [0.85, 0.04], // games
    [0.9, 0.2], // settled
    [1.0, 0.42], // back to the next waiver run
  ];
  const x = (t: number) => t * width;
  const y = (v: number) => height - v * height;

  let d = `M ${x(pts[0][0]).toFixed(1)} ${y(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    // Horizontal control points give the flat-topped, flat-bottomed shape a
    // real tide has, rather than the bouncing look of a smooth spline.
    const mid = (px + cx) / 2;
    d += ` C ${x(mid).toFixed(1)} ${y(py).toFixed(1)}, ${x(mid).toFixed(1)} ${y(cy).toFixed(1)}, ${x(cx).toFixed(1)} ${y(cy).toFixed(1)}`;
  }
  return d;
}
