import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapFantasyCalc } from '../src/lib/sources/fantasycalc.js';
import { parseKtcHtml } from '../src/lib/sources/keeptradecut.js';
import {
  parseCsv,
  parseSnapCounts,
  parseUsage,
  parseInjuries,
  normaliseName,
} from '../src/lib/sources/nflverse.js';
import {
  buildCrosswalk,
  buildNameIndex,
  resolveByName,
  joinByName,
  canonicalPosition,
  positionsAgree,
} from '../src/lib/sources/join.js';
import { resolveUsageSeason } from '../src/server/market.js';

const FIX = join(__dirname, '..', 'fixtures');
const read = (n: string) => readFileSync(join(FIX, `${n}.json`), 'utf8');
const json = (n: string) => JSON.parse(read(n));
/** The CSV fixtures are stored as JSON strings so they survive round-tripping. */
const csv = (n: string) => JSON.parse(read(n)) as string;

describe('normaliseName', () => {
  it('makes the punctuation variants agree', () => {
    expect(normaliseName('A.J. Brown')).toBe(normaliseName('AJ Brown'));
    expect(normaliseName("Ja'Marr Chase")).toBe('jamarr chase');
  });

  it('drops generational suffixes', () => {
    expect(normaliseName('Marvin Harrison Jr.')).toBe(normaliseName('Marvin Harrison'));
    expect(normaliseName('Robert Griffin III')).toBe('robert griffin');
  });

  it('survives empty and null-ish input', () => {
    expect(normaliseName('')).toBe('');
    expect(normaliseName(undefined as any)).toBe('');
  });
});

describe('parseCsv', () => {
  it('reads a plain table', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('a,b\n"one, two",3')).toEqual([{ a: 'one, two', b: '3' }]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([{ a: 'say "hi"' }]);
  });

  it('ignores a trailing newline rather than emitting a blank record', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(1);
  });

  it('drops rows whose width does not match the header', () => {
    // A truncated download must not become a half-populated record.
    expect(parseCsv('a,b,c\n1,2,3\n4,5')).toEqual([{ a: '1', b: '2', c: '3' }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('FantasyCalc', () => {
  const rows = mapFantasyCalc(json('fantasycalc'));

  it('maps the live payload', () => {
    expect(rows.length).toBeGreaterThan(300);
  });

  it('carries both a dynasty and a redraft value — the win-now signal', () => {
    const withBoth = rows.filter((r) => r.value > 0 && r.redraftValue > 0);
    expect(withBoth.length).toBeGreaterThan(150);
  });

  it('carries the sleeper id that makes it the bridge source', () => {
    const withId = rows.filter((r) => r.sleeperId);
    expect(withId.length / rows.length).toBeGreaterThan(0.8);
  });

  it('carries the mfl id that KTC joins through', () => {
    expect(rows.filter((r) => r.mflId).length).toBeGreaterThan(300);
  });

  it('skips rows with no player attached', () => {
    expect(mapFantasyCalc([{ value: 5 }, null, { player: { name: '' } }] as any)).toEqual([]);
  });

  it('survives a null payload', () => {
    expect(mapFantasyCalc(null as any)).toEqual([]);
  });
});

describe('KeepTradeCut', () => {
  const html = `<html><body><script>var playersArray = ${JSON.stringify(
    JSON.parse(json('ktc-inline').replace(/^var\s+playersArray\s*=\s*/, '').replace(/;$/, ''))
  )};</script></body></html>`;
  const rows = parseKtcHtml(html);

  it('pulls the inline dataset out of the page', () => {
    expect(rows.length).toBeGreaterThan(400);
  });

  it('reads the one-QB values by default and superflex on request', () => {
    const sf = parseKtcHtml(html, 'superflex');
    const qb1 = rows.find((r) => r.position === 'QB');
    const qbSf = sf.find((r) => r.name === qb1?.name);
    // Quarterbacks are worth materially more in superflex; that is the point
    // of keeping the two formats apart.
    expect(qbSf!.value).toBeGreaterThan(qb1!.value);
  });

  it('flags draft picks rather than pretending they are players', () => {
    const picks = rows.filter((r) => r.isPick);
    expect(picks.length).toBeGreaterThan(10);
    for (const p of picks) expect(p.position).toBe('PICK');
  });

  it('carries the short trend, tier and liquidity FantasyCalc lacks', () => {
    const players = rows.filter((r) => !r.isPick);
    expect(players.some((r) => r.trend7Day !== 0)).toBe(true);
    expect(players.filter((r) => r.positionalTier != null).length).toBeGreaterThan(100);
    expect(players.filter((r) => r.liquidity != null).length).toBeGreaterThan(100);
  });

  it('returns nothing rather than throwing when the page shape changes', () => {
    expect(parseKtcHtml('<html>no data here</html>')).toEqual([]);
    expect(parseKtcHtml('<script>var playersArray = [not json];</script>')).toEqual([]);
    expect(parseKtcHtml('')).toEqual([]);
  });
});

describe('nflverse snap counts', () => {
  const rows = parseSnapCounts(csv('snap-counts'));

  it('groups weekly rows into one row per player', () => {
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows.slice(0, 20)) expect(r.weeks.length).toBeGreaterThan(0);
  });

  it('orders weeks ascending, so a sparkline reads left to right', () => {
    for (const r of rows.slice(0, 30)) {
      const weeks = r.weeks.map((w) => w.week);
      expect([...weeks].sort((a, b) => a - b)).toEqual(weeks);
    }
  });

  it('keeps offense_pct as a 0-1 share', () => {
    for (const r of rows) {
      for (const w of r.weeks) {
        expect(w.offensePct).toBeGreaterThanOrEqual(0);
        expect(w.offensePct).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps a zero-snap game rather than dropping it', () => {
    // Playing only special teams is real information, and different from absent.
    const parsed = parseSnapCounts(
      'game_type,week,player,position,team,offense_snaps,offense_pct,opponent\n' +
        'REG,1,Test Player,RB,CIN,0,,BAL'
    );
    expect(parsed[0].weeks).toEqual([
      { week: 1, offensePct: 0, offenseSnaps: 0, opponent: 'BAL' },
    ]);
  });

  it('excludes the postseason, which is not part of a fantasy regular season', () => {
    const parsed = parseSnapCounts(
      'game_type,week,player,position,team,offense_snaps,offense_pct,opponent\n' +
        'REG,1,A B,RB,CIN,10,0.5,BAL\nPOST,19,A B,RB,CIN,10,0.9,BAL'
    );
    expect(parsed[0].weeks.map((w) => w.week)).toEqual([1]);
  });
});

describe('nflverse weekly usage', () => {
  const rows = parseUsage(csv('usage'));

  it('reads target share and air-yards share, which describe a role', () => {
    expect(rows.length).toBeGreaterThan(50);
    const weeks = rows.flatMap((r) => r.weeks);
    expect(weeks.filter((w) => w.targetShare != null).length).toBeGreaterThan(50);
    expect(weeks.filter((w) => w.airYardsShare != null).length).toBeGreaterThan(50);
  });

  it('carries usage and outcome together, so divergence is a subtraction', () => {
    const weeks = rows.flatMap((r) => r.weeks);
    expect(weeks.some((w) => w.points > 0)).toBe(true);
    expect(weeks.some((w) => w.targets > 0 || w.carries > 0)).toBe(true);
  });

  it('keeps shares as 0-1 fractions', () => {
    for (const r of rows) {
      for (const w of r.weeks) {
        if (w.targetShare != null) {
          expect(w.targetShare).toBeGreaterThanOrEqual(0);
          expect(w.targetShare).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('orders weeks ascending', () => {
    for (const r of rows.slice(0, 20)) {
      const weeks = r.weeks.map((w) => w.week);
      expect([...weeks].sort((a, b) => a - b)).toEqual(weeks);
    }
  });

  it('excludes the postseason', () => {
    const parsed = parseUsage(
      'season_type,week,player_display_name,position,team,targets,fantasy_points\n' +
        'REG,1,A B,WR,CIN,5,10\nPOST,19,A B,WR,CIN,9,20'
    );
    expect(parsed[0].weeks.map((w) => w.week)).toEqual([1]);
  });
});

describe('nflverse injuries', () => {
  const rows = parseInjuries(csv('injuries'));

  it('reads the official report', () => {
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((r) => r.status)).toBe(true);
  });

  it('keys every row for joining', () => {
    for (const r of rows) expect(r.key).toBe(normaliseName(r.name));
  });
});

describe('positions', () => {
  it('folds the aliases these feeds disagree on', () => {
    expect(canonicalPosition('FB')).toBe('RB');
    expect(canonicalPosition('HB')).toBe('RB');
    expect(canonicalPosition('D/ST')).toBe('DEF');
    expect(positionsAgree('FB', 'RB')).toBe(true);
    expect(positionsAgree('WR', 'TE')).toBe(false);
  });
});

describe('buildCrosswalk', () => {
  const fc = mapFantasyCalc(json('fantasycalc'));
  const ktcRaw = json('ktc-inline') as string;
  const ktc = parseKtcHtml(`<script>${ktcRaw}</script>`);
  const cw = buildCrosswalk(fc, ktc);

  it('joins the two markets through mflId onto sleeper ids', () => {
    expect(cw.coverage.joined).toBeGreaterThan(250);
  });

  it('keeps FantasyCalc as the value scale so numbers stay comparable', () => {
    for (const [id, v] of cw.bySleeperId) {
      const source = fc.find((f) => f.sleeperId === id)!;
      expect(v.dynasty).toBe(source.value);
      expect(v.redraft).toBe(source.redraftValue);
    }
  });

  it('takes the short trend and liquidity from KTC where it has them', () => {
    const merged = [...cw.bySleeperId.values()].filter((v) => v.sources.includes('KeepTradeCut'));
    expect(merged.length).toBeGreaterThan(250);
    expect(merged.some((v) => v.trend7Day !== null)).toBe(true);
    expect(merged.some((v) => v.liquidity !== null)).toBe(true);
  });

  it('records which upstreams contributed, so coverage can be shown honestly', () => {
    for (const v of cw.bySleeperId.values()) {
      expect(v.sources).toContain('FantasyCalc');
    }
  });

  it('keeps draft picks aside, sorted best first', () => {
    expect(cw.picks.length).toBeGreaterThan(10);
    const values = cw.picks.map((p) => p.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('degrades to FantasyCalc alone when KTC returns nothing', () => {
    const only = buildCrosswalk(fc, []);
    expect(only.bySleeperId.size).toBe(cw.bySleeperId.size);
    expect(only.coverage.joined).toBe(0);
    expect(only.picks).toEqual([]);
  });

  it('produces nothing from nothing, without throwing', () => {
    const empty = buildCrosswalk([], []);
    expect(empty.bySleeperId.size).toBe(0);
    expect(empty.coverage).toEqual({ fantasyCalc: 0, ktc: 0, joined: 0 });
  });
});

describe('the name join', () => {
  const players = [
    { id: '1', name: 'Chase Brown', pos: 'RB', team: 'CIN' },
    { id: '2', name: 'A.J. Brown', pos: 'WR', team: 'PHI' },
    { id: '3', name: 'Michael Thomas', pos: 'WR', team: 'NO' },
    { id: '4', name: 'Michael Thomas', pos: 'DB', team: 'HOU' },
  ];

  it('matches across punctuation differences', () => {
    const joined = joinByName([{ key: normaliseName('AJ Brown'), position: 'WR' }], players);
    expect(joined.has('2')).toBe(true);
  });

  it('refuses a shared name when the position does not settle it', () => {
    const joined = joinByName([{ key: 'michael thomas', position: null }], players);
    expect(joined.size).toBe(0);
  });

  it('resolves a shared name when the position does settle it', () => {
    const joined = joinByName([{ key: 'michael thomas', position: 'WR' }], players);
    expect(joined.get('3')).toBeTruthy();
    expect(joined.has('4')).toBe(false);
  });

  it('refuses a unique name whose position contradicts — that means disagreement', () => {
    const joined = joinByName([{ key: 'chase brown', position: 'QB' }], players);
    expect(joined.size).toBe(0);
  });

  it('drops names it has never seen', () => {
    expect(joinByName([{ key: 'nobody at all', position: 'RB' }], players).size).toBe(0);
  });

  it('keeps the first row when a player appears twice after a trade', () => {
    const joined = joinByName(
      [
        { key: 'chase brown', position: 'RB', team: 'CIN' },
        { key: 'chase brown', position: 'RB', team: 'DAL' },
      ],
      players
    );
    expect(joined.get('1')!.team).toBe('CIN');
  });

  it('indexes every player, bucketing collisions', () => {
    const index = buildNameIndex(players);
    expect(index.get('michael thomas')).toEqual(['3', '4']);
    expect(index.get('chase brown')).toEqual(['1']);
  });

  it('returns null rather than guessing, via resolveByName directly', () => {
    const index = buildNameIndex(players);
    const byId = new Map(players.map((p) => [p.id, p]));
    expect(resolveByName({ key: 'michael thomas', position: 'TE' }, index, byId)).toBeNull();
  });
});

describe('the real snap join against this league', () => {
  const snaps = parseSnapCounts(csv('snap-counts'));
  const players = Object.entries(json('players') as Record<string, any>).map(([id, p]) => ({
    id,
    name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
    pos: p.position,
    team: p.team,
  }));

  it('resolves most of the captured snap rows onto sleeper ids', () => {
    const joined = joinByName(snaps, players);
    // The fixture was already filtered to this league's players, so coverage
    // here should be high — a low number means the join has regressed.
    expect(joined.size / snaps.length).toBeGreaterThan(0.75);
  });

  it('never attributes usage to a player at another position', () => {
    const joined = joinByName(snaps, players);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const [id, row] of joined) {
      const player = byId.get(id)!;
      if (row.position && player.pos) {
        expect(positionsAgree(row.position, player.pos)).toBe(true);
      }
    }
  });
});

describe('resolveUsageSeason', () => {
  it('uses the current season once its data is published', async () => {
    expect(await resolveUsageSeason('2025', async () => true)).toBe('2025');
  });

  it('falls back a year in the preseason, when the file does not exist yet', async () => {
    // This is most of a dynasty manager's year: what a player did last season
    // is not a degraded answer, it is the answer.
    expect(await resolveUsageSeason('2026', async () => false)).toBe('2025');
  });

  it('only probes the current season, never walking backwards forever', async () => {
    const asked: string[] = [];
    await resolveUsageSeason('2026', async (s) => {
      asked.push(s);
      return false;
    });
    expect(asked).toEqual(['2026']);
  });

  it('survives a season string that is not a number', async () => {
    const out = await resolveUsageSeason('nonsense', async () => false);
    expect(typeof out).toBe('string');
  });
});
