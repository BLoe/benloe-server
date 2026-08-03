/**
 * The third-party layer, assembled and cached.
 *
 * Everything here is somebody else's server. The contract this module keeps
 * with the rest of the app is simple: it always returns a usable object, even
 * when every upstream is down. A panel with no data renders an honest empty
 * state; it never takes the page with it.
 *
 * TTLs are set by how often each source actually changes, not by how fresh we
 * would like it to be:
 *   FantasyCalc  6h  — recomputed from trades continuously, but slowly
 *   KTC          6h  — same, and it is a 1.3MB HTML page
 *   nflverse    12h  — published once a week, after the games
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { diskCached } from './cache.js';
import { fetchFantasyCalc, mapFantasyCalc, type FcValue } from '../lib/sources/fantasycalc.js';
import { fetchKeepTradeCut, parseKtcHtml, type KtcValue } from '../lib/sources/keeptradecut.js';
import {
  fetchSnapCounts,
  fetchUsage,
  fetchInjuries,
  parseSnapCounts,
  parseUsage,
  parseInjuries,
  type SnapRow,
  type UsageRow,
  type InjuryRow,
} from '../lib/sources/nflverse.js';
import { buildCrosswalk, joinByName, type Crosswalk, type SleeperPlayerish } from '../lib/sources/join.js';

const HOUR = 60 * 60_000;

export interface MarketOptions {
  cacheDir: string;
  fixtures: boolean;
  fixtureDir: string;
  /** Which season the captured fixtures describe. */
  fixtureSeason: string;
  /** League shape, which changes what a quarterback is worth. */
  numQbs: number;
  numTeams: number;
  ppr: number;
}

export interface Market {
  crosswalk: Crosswalk;
  /** Which NFL season the usage data actually describes. */
  usageSeason: string;
  /** Weekly snap share, by Sleeper id. The leading indicator. */
  snaps: Map<string, SnapRow>;
  /** Weekly targets, share and the points they produced, by Sleeper id. */
  usage: Map<string, UsageRow>;
  /** Latest injury report row per player, by Sleeper id. */
  injuries: Map<string, InjuryRow>;
  /** What actually answered, so the UI can say so rather than imply coverage. */
  health: {
    fantasyCalc: number;
    ktc: number;
    joined: number;
    snaps: number;
    usage: number;
    injuries: number;
    usageSeason: string;
  };
}

/**
 * Which season's usage to read.
 *
 * nflverse publishes a season's file once that season starts. In the preseason
 * — which is most of a dynasty manager's year — the current season's file does
 * not exist yet, and last season's is not a fallback so much as the answer:
 * what a player did last year is exactly the history you are reasoning from.
 * The season actually used is carried through to the UI so a chart never
 * silently claims to be about the wrong year.
 */
export async function resolveUsageSeason(
  season: string,
  probe: (s: string) => Promise<boolean>
): Promise<string> {
  const current = Number(season);
  if (Number.isFinite(current) && (await probe(season))) return season;
  return String(current - 1);
}

const readFixture = async (dir: string, name: string) =>
  JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));

/**
 * Load and join every third-party source.
 *
 * Each source is fetched independently and each failure is swallowed at its own
 * boundary, so a dead KTC costs you tiers and the 7-day trend and nothing else.
 */
export async function loadMarket(
  players: SleeperPlayerish[],
  season: string,
  o: MarketOptions
): Promise<Market> {
  const fc = await source<FcValue[]>(
    o,
    'fantasycalc',
    6 * HOUR,
    () => fetchFantasyCalc({ numQbs: o.numQbs, numTeams: o.numTeams, ppr: o.ppr }),
    async () => mapFantasyCalc(await readFixture(o.fixtureDir, 'fantasycalc')),
    []
  );

  const ktc = await source<KtcValue[]>(
    o,
    'ktc',
    6 * HOUR,
    () => fetchKeepTradeCut(o.numQbs > 1 ? 'superflex' : 'oneQB'),
    async () =>
      parseKtcHtml(
        `<script>${await readFixture(o.fixtureDir, 'ktc-inline')}</script>`,
        o.numQbs > 1 ? 'superflex' : 'oneQB'
      ),
    []
  );

  // Ask once which season has data, then read all three from that season.
  const usageSeason = o.fixtures
    ? o.fixtureSeason
    : await resolveUsageSeason(season, async (s) => {
        try {
          return (await fetchUsage(s)).length > 0;
        } catch {
          return false;
        }
      });

  const snapRows = await source<SnapRow[]>(
    o,
    `snaps-${usageSeason}`,
    12 * HOUR,
    () => fetchSnapCounts(usageSeason),
    async () => parseSnapCounts(await readFixture(o.fixtureDir, 'snap-counts')),
    []
  );

  const usageRows = await source<UsageRow[]>(
    o,
    `usage-${usageSeason}`,
    12 * HOUR,
    () => fetchUsage(usageSeason),
    async () => parseUsage(await readFixture(o.fixtureDir, 'usage')),
    []
  );

  const injuryRows = await source<InjuryRow[]>(
    o,
    `injuries-${usageSeason}`,
    3 * HOUR,
    () => fetchInjuries(usageSeason),
    async () => parseInjuries(await readFixture(o.fixtureDir, 'injuries')),
    []
  );

  const crosswalk = buildCrosswalk(fc, ktc);
  const snaps = joinByName(snapRows, players);
  const usage = joinByName(usageRows, players);

  // Only the most recent report per player matters — an old "Questionable" from
  // week 3 is not a fact about this week.
  const latestInjury = new Map<string, InjuryRow>();
  for (const row of injuryRows) {
    const prev = latestInjury.get(row.key);
    if (!prev || row.week > prev.week) latestInjury.set(row.key, row);
  }
  const injuries = joinByName([...latestInjury.values()], players);

  return {
    crosswalk,
    usageSeason,
    snaps,
    usage,
    injuries,
    health: {
      fantasyCalc: fc.length,
      ktc: ktc.length,
      joined: crosswalk.coverage.joined,
      snaps: snaps.size,
      usage: usage.size,
      injuries: injuries.size,
      usageSeason,
    },
  };
}

/**
 * One source: fixture in fixture mode, disk-cached fetch otherwise, and a
 * fallback value if it fails either way.
 */
async function source<T>(
  o: MarketOptions,
  name: string,
  ttl: number,
  live: () => Promise<T>,
  fixture: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    if (o.fixtures) return await fixture();
    return await diskCached(o.cacheDir, name, ttl, live);
  } catch (err) {
    console.warn(`[market] ${name} unavailable: ${(err as Error).message}`);
    return fallback;
  }
}
