import { describe, it, expect } from 'vitest';
import {
  buildTape,
  usageWindowFor,
  LAST_USABLE_WEEK,
  type TapeSources,
} from '../src/server/routes/tape.js';
import {
  describeSeries,
  segments,
  sentence,
  trendWord,
  type SparkPoint,
  type TapeRow,
} from '../src/web/Tape.js';

/* ================================================================== *
 * The window
 * ================================================================== */

describe('usageWindowFor', () => {
  it('reads the whole season out of season, because that is the history you have', () => {
    // Most of a dynasty manager's year is spent here. Last season is not a
    // fallback, it is the answer.
    const w = usageWindowFor({ season_type: 'pre', week: 0 });
    expect(w).toEqual({ throughWeek: 17, window: 17, inSeason: false });
  });

  it('never reads week 18, in season or out', () => {
    // Week 18 is when playoff teams rest starters. A snap share that collapses
    // because a man was told to sit is not a fact about his role, and reading
    // it produced a list led by rested starters.
    expect(usageWindowFor({ season_type: 'pre', week: 0 }).throughWeek).toBe(LAST_USABLE_WEEK);
    expect(usageWindowFor({ season_type: 'regular', week: 18 }).throughWeek).toBe(LAST_USABLE_WEEK);
  });

  it('clamps the NFL postseason too, where the week keeps counting and fantasy has stopped', () => {
    const w = usageWindowFor({ season_type: 'post', week: 21 });
    expect(w.throughWeek).toBe(LAST_USABLE_WEEK);
    expect(w.window).toBe(4);
  });

  it('uses a four-game window through the current week in season', () => {
    expect(usageWindowFor({ season_type: 'regular', week: 6 })).toEqual({
      throughWeek: 6,
      window: 4,
      inSeason: true,
    });
  });

  it('treats week zero as out of season even when the state says regular', () => {
    // Sleeper reports this league as in_season in August; the state's week is
    // the honest signal. A four-game window through week 0 covers nothing.
    const w = usageWindowFor({ season_type: 'regular', week: 0 });
    expect(w.inSeason).toBe(false);
    expect(w.window).toBe(LAST_USABLE_WEEK);
  });

  it('survives a state with no fields at all', () => {
    expect(usageWindowFor({}).inSeason).toBe(false);
  });
});

/* ================================================================== *
 * buildTape
 * ================================================================== */

interface Fake {
  id: string;
  snap: number;
  targetShare: number;
  points: number;
  receptions?: number;
  weeks?: number[];
}

/**
 * Six receivers with usage and production perfectly aligned, so any divergence
 * a test sees is one the test put there.
 */
const FIELD: Fake[] = [
  { id: 'lead', snap: 0.95, targetShare: 0.3, points: 3 },
  { id: 'ghost', snap: 0.3, targetShare: 0.05, points: 20 },
  { id: 'c', snap: 0.5, targetShare: 0.12, points: 8 },
  { id: 'd', snap: 0.6, targetShare: 0.15, points: 10 },
  { id: 'e', snap: 0.7, targetShare: 0.2, points: 12 },
  { id: 'f', snap: 0.8, targetShare: 0.25, points: 14 },
];

function sources(field: Fake[], over: Partial<TapeSources> = {}): TapeSources {
  const players: TapeSources['players'] = {};
  const snaps: TapeSources['snaps'] = new Map();
  const usage: TapeSources['usage'] = new Map();

  for (const f of field) {
    const weeks = f.weeks ?? [1, 2, 3, 4];
    players[f.id] = { id: f.id, name: `Player ${f.id}`, pos: 'WR', team: 'NYJ' };
    snaps.set(f.id, { weeks: weeks.map((week) => ({ week, offensePct: f.snap })) });
    usage.set(f.id, {
      weeks: weeks.map((week) => ({
        week,
        targets: 6,
        carries: 0,
        receptions: f.receptions ?? 0,
        targetShare: f.targetShare,
        airYardsShare: null,
        points: f.points,
      })),
    });
  }

  return {
    players,
    snaps,
    usage,
    values: new Map(),
    ownerOf: new Map(),
    projections: {},
    throughWeek: 4,
    window: 4,
    ...over,
  };
}

const byId = (t: ReturnType<typeof buildTape>, id: string) => t.rows.find((r) => r.id === id)!;

describe('buildTape', () => {
  it('ranks by what the gap is worth in points, not by the percentile gap', () => {
    // The cap has to keep the rows worth acting on. A twelfth receiver can be
    // thirty percentile points out of line and be worth a point a game.
    const tape = buildTape(sources(FIELD));
    const gaps = tape.rows.map((r) => Math.abs(r.divergence.pointsGap));
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
    expect(tape.rows.slice(0, 2).map((r) => r.id).sort()).toEqual(['ghost', 'lead']);
  });

  it('calls the heavily used, lightly scoring player a buy and the reverse a sell', () => {
    const tape = buildTape(sources(FIELD));
    expect(byId(tape, 'lead').divergence.verdict).toBe('buy');
    expect(byId(tape, 'lead').divergence.pointsGap).toBeGreaterThan(0);
    expect(byId(tape, 'ghost').divergence.verdict).toBe('sell');
    expect(byId(tape, 'ghost').divergence.pointsGap).toBeLessThan(0);
  });

  it('gives every sparkline the same x domain, so two rows can be compared', () => {
    const tape = buildTape(sources(FIELD, { throughWeek: 9, window: 4 }));
    expect(tape.weekFrom).toBe(1);
    expect(tape.weekTo).toBe(9);
    expect(tape.windowFrom).toBe(6);
  });

  it('never proposes a window that starts before week one', () => {
    const tape = buildTape(sources(FIELD, { throughWeek: 2, window: 4 }));
    expect(tape.windowFrom).toBe(1);
  });

  it('leaves a missed week absent rather than filling it in', () => {
    // A gap in the series is what tells a reader the man did not play. Filling
    // it with a zero would say he played and did nothing, which is a different
    // and false claim.
    const field = FIELD.map((f) =>
      f.id === 'lead' ? { ...f, weeks: [1, 2, 4] } : { ...f, weeks: [1, 2, 3, 4] }
    );
    const weeks = byId(buildTape(sources(field)), 'lead').weeks;
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 4]);
  });

  it('drops weeks after the window ends, so the tape is reproducible', () => {
    // Same inputs and same through-week must always give the same page,
    // otherwise a screenshot depends on when it was taken.
    const field = FIELD.map((f) => ({ ...f, weeks: [1, 2, 3, 4, 5, 6] }));
    const tape = buildTape(sources(field, { throughWeek: 4 }));
    expect(byId(tape, 'lead').weeks.map((w) => w.week)).toEqual([1, 2, 3, 4]);
  });

  it('keeps a snap count for a game with no touches, which is real information', () => {
    const field = FIELD.map((f) => (f.id === 'lead' ? { ...f, weeks: [1, 2, 3] } : f));
    const src = sources(field);
    // He was on the field in week 4 and never got the ball.
    src.snaps.set('lead', { weeks: [1, 2, 3, 4].map((week) => ({ week, offensePct: 0.95 })) });
    const weeks = byId(buildTape(src), 'lead').weeks;
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    expect(weeks[3]).toEqual({ week: 4, snap: 0.95, target: null, points: null });
  });

  it('prices points in the asking league, because a PPR gap is a different number', () => {
    // nflverse files standard scoring. A receiver with six catches a game is
    // six points a game short of what his manager actually collects.
    const field = FIELD.map((f) => ({ ...f, receptions: 5 }));
    const plain = byId(buildTape(sources(field)), 'lead').divergence.pointsPerGame;
    const ppr = byId(
      buildTape(sources(field, { pointsPerReception: 1 })),
      'lead'
    ).divergence.pointsPerGame;
    expect(ppr - plain).toBeCloseTo(5, 5);
  });

  it('carries the league-scored points into the weekly series as well as the average', () => {
    // If the headline says PPR and the week-by-week table says standard, the
    // page contradicts itself.
    const field = FIELD.map((f) => ({ ...f, receptions: 5 }));
    const row = byId(buildTape(sources(field, { pointsPerReception: 0.5 })), 'lead');
    expect(row.weeks[0].points).toBe(row.divergence.pointsPerGame);
  });

  it('says who holds each player, including nobody', () => {
    const src = sources(FIELD);
    src.ownerOf.set('lead', { rosterId: 3, teamName: 'Gem City Crew', mine: true });
    src.ownerOf.set('c', { rosterId: 7, teamName: 'Ryan Football Team', mine: false });
    const tape = buildTape(src);

    expect(byId(tape, 'lead')).toMatchObject({ rostered: true, mine: true, teamName: 'Gem City Crew' });
    expect(byId(tape, 'c')).toMatchObject({ rostered: true, mine: false, rosterId: 7 });
    // Free agents are the point of including them: the same gap that says
    // "trade for him" says "claim him".
    expect(byId(tape, 'ghost')).toMatchObject({ rostered: false, mine: false, teamName: null });
  });

  it('caps the payload and keeps the biggest gaps', () => {
    const tape = buildTape(sources(FIELD, { limit: 2 }));
    expect(tape.rows).toHaveLength(2);
    // considered reports the full field, so the page can say what it is hiding.
    expect(tape.considered).toBe(6);
  });

  it('returns an empty tape rather than throwing when nothing answered', () => {
    const tape = buildTape({
      players: {},
      snaps: new Map(),
      usage: new Map(),
      values: new Map(),
      ownerOf: new Map(),
      projections: {},
      throughWeek: 17,
      window: 17,
    });
    expect(tape.rows).toEqual([]);
    expect(tape.considered).toBe(0);
  });

  it('ignores usage for players Sleeper has never heard of', () => {
    // The nflverse join is by name and it can miss. An unmatched row must not
    // become a nameless entry on the highest-value screen in the app.
    const src = sources(FIELD);
    src.usage.set('stranger', {
      weeks: [1, 2, 3, 4].map((week) => ({
        week,
        targets: 9,
        carries: 0,
        targetShare: 0.4,
        airYardsShare: null,
        points: 1,
      })),
    });
    expect(buildTape(src).rows.some((r) => r.id === 'stranger')).toBe(false);
  });

  it('reports a snap trend when there is one, and null when there are no snaps', () => {
    const src = sources(FIELD);
    src.snaps.set('lead', {
      weeks: [
        { week: 1, offensePct: 0.2 },
        { week: 2, offensePct: 0.3 },
        { week: 3, offensePct: 0.8 },
        { week: 4, offensePct: 0.9 },
      ],
    });
    // The name join can resolve usage without resolving snaps; the row must
    // still render rather than reporting a trend it does not have.
    src.snaps.delete('c');
    const tape = buildTape(src);
    expect(byId(tape, 'lead').trend).toBeCloseTo(0.6, 5);
    expect(byId(tape, 'c').trend).toBeNull();
    expect(byId(tape, 'c').weeks.every((w) => w.snap === null)).toBe(true);
  });
});

/* ================================================================== *
 * The sparkline's pure parts
 * ================================================================== */

const pts = (...xs: Array<[number, number | null]>): SparkPoint[] =>
  xs.map(([week, value]) => ({ week, value }));

describe('segments', () => {
  it('breaks the line where a week is missing rather than drawing through it', () => {
    // A straight segment across a bye asserts a snap share nobody recorded.
    const runs = segments(pts([1, 0.5], [2, 0.6], [4, 0.7], [5, 0.8]));
    expect(runs.map((r) => r.map((p) => p.week))).toEqual([
      [1, 2],
      [4, 5],
    ]);
  });

  it('breaks on an explicit null the same way', () => {
    const runs = segments(pts([1, 0.5], [2, null], [3, 0.7]));
    expect(runs).toHaveLength(2);
  });

  it('keeps a lone week as its own run, so it is drawn as a dot and not a line', () => {
    expect(segments(pts([7, 0.44]))).toEqual([[{ week: 7, value: 0.44 }]]);
  });

  it('is empty when nothing was observed', () => {
    expect(segments(pts([1, null], [2, null]))).toEqual([]);
    expect(segments([])).toEqual([]);
  });

  it('keeps a genuine zero, which is not the same as an absence', () => {
    // A player active on offence for none of the snaps is a real reading.
    const runs = segments(pts([1, 0], [2, 0]));
    expect(runs).toEqual([[{ week: 1, value: 0 }, { week: 2, value: 0 }]]);
  });
});

describe('trendWord', () => {
  it('will not call a direction off a single game', () => {
    expect(trendWord(pts([3, 0.9]))).toBe('unknown');
    expect(trendWord([])).toBe('unknown');
  });

  it('reads a role that arrived mid-window as rising', () => {
    expect(trendWord(pts([1, 0.2], [2, 0.25], [3, 0.7], [4, 0.8]))).toBe('rising');
  });

  it('reads a role being taken away as falling', () => {
    expect(trendWord(pts([1, 0.8], [2, 0.75], [3, 0.3], [4, 0.2]))).toBe('falling');
  });

  it('calls small wobble steady, because rotation is not a trend', () => {
    expect(trendWord(pts([1, 0.6], [2, 0.63], [3, 0.58], [4, 0.62]))).toBe('steady');
  });

  it('drops the middle game on an odd count, so a one-week spike is not a direction', () => {
    // Five games: the first two against the last two, week three set aside. A
    // single blowout game in the middle must not read as a role change.
    expect(trendWord(pts([1, 0.5], [2, 0.5], [3, 0.95], [4, 0.5], [5, 0.5]))).toBe('steady');
  });
});

describe('describeSeries', () => {
  const pc = (v: number) => `${Math.round(v * 100)}%`;

  it('says there is no data rather than describing an empty chart', () => {
    expect(describeSeries('Snap share', pts([1, null]), pc)).toBe('Snap share: no weekly data on file.');
  });

  it('warns that one game is not a trend', () => {
    // A blind reader cannot see that the chart is a single dot.
    const text = describeSeries('Snap share', pts([6, 0.42]), pc);
    expect(text).toContain('one game only');
    expect(text).toContain('42%');
    expect(text).toContain('One game is not a trend');
  });

  it('gives the count, the ends, the direction and the extremes', () => {
    const text = describeSeries('Snap share', pts([1, 0.2], [2, 0.5], [3, 0.9]), pc);
    expect(text).toContain('3 games, weeks 1 to 3');
    expect(text).toContain('20%');
    expect(text).toContain('90%');
    expect(text).toContain('rising');
    expect(text).toContain('week 3');
  });

  it('counts games played, not weeks spanned, and says how many are missing', () => {
    // Six weeks with three games is a three-game sample. A listener cannot see
    // the breaks in the line, so the gaps have to be said out loud.
    const text = describeSeries('Snap share', pts([1, 0.4], [2, null], [3, null], [4, 0.5], [5, null], [6, 0.6]), pc);
    expect(text).toContain('3 games, weeks 1 to 6');
    expect(text).toContain('3 weeks in that span with no game');
  });

  it('says nothing about gaps when a player played every week', () => {
    const text = describeSeries('Snap share', pts([1, 0.4], [2, 0.5], [3, 0.6]), pc);
    expect(text).not.toContain('no game');
  });
});

/* ================================================================== *
 * The claim, in words
 * ================================================================== */

function row(over: Partial<TapeRow['divergence']> = {}, rest: Partial<TapeRow> = {}): TapeRow {
  return {
    id: 'x',
    name: 'A Player',
    position: 'WR',
    team: 'NYJ',
    weeks: [],
    divergence: {
      snapShare: 0.82,
      targetShare: 0.24,
      pointsPerGame: 6.2,
      expectedPointsPerGame: 13.2,
      pointsGap: 7,
      usageRank: 0.9,
      productionRank: 0.3,
      divergence: 0.6,
      games: 8,
      verdict: 'buy',
      ...over,
    },
    trend: null,
    rostered: false,
    rosterId: null,
    teamName: null,
    mine: false,
    value: null,
    valueTrend: null,
    projected: null,
    ...rest,
  };
}

describe('sentence', () => {
  it('states the gap in points, which is the thing a manager acts on', () => {
    expect(sentence(row())).toContain('6.2 a game — usage like that normally returns 13.2.');
  });

  it('says the usage it is reading from', () => {
    expect(sentence(row())).toContain('82% of snaps, 24% of targets over 8 games');
  });

  it('omits a share it does not have instead of printing a zero', () => {
    // A running back with no target share is not a back with 0% target share.
    const text = sentence(row({ targetShare: null }));
    expect(text).toContain('82% of snaps over 8 games');
    expect(text).not.toContain('targets');
  });

  it('calls out an arriving role, which is worth more than the same gap on steady usage', () => {
    expect(sentence(row({}, { trend: 0.22 }))).toContain('Snaps up 22 points');
    expect(sentence(row({}, { trend: -0.18 }))).toContain('Snaps down 18 points');
  });

  it('stays quiet about a trend inside the noise', () => {
    expect(sentence(row({}, { trend: 0.02 }))).not.toContain('Snaps');
  });

  it('admits when the sample is thin', () => {
    expect(sentence(row({ games: 2 }))).toContain('thin evidence');
    expect(sentence(row({ games: 8 }))).not.toContain('thin evidence');
  });
});
