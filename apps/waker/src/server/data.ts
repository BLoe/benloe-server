/**
 * Source-aware loaders, shared by every route.
 *
 * Extracted from the server so route modules can be written independently:
 * each feature owns its own file and imports what it needs from here, rather
 * than every route living in one growing index.
 *
 * Every loader answers from fixtures or from the network depending on
 * WAKER_SOURCE, and the callers never need to know which.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../lib/sleeper.js';
import { cached, diskCached, TTL } from './cache.js';
import { loadMarket, type Market } from './market.js';
import { indexProjections } from '../lib/projections.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = join(ROOT, 'fixtures');
export const DIST = join(ROOT, 'dist');
export const CACHE_DIR = process.env.WAKER_CACHE_DIR || join(ROOT, '.cache');

const SOURCE = (process.env.WAKER_SOURCE || 'live') as 'live' | 'fixtures';
/** Which NFL season the captured fixtures describe. See scripts/capture-fixtures. */
export const FIXTURE_SEASON = '2025';

export const useFixtures = () => SOURCE === 'fixtures';
export const sourceName = () => SOURCE;

export const readFixture = async (name: string) =>
  JSON.parse(await readFile(join(FIXTURES, `${name}.json`), 'utf8'));

export async function loadLeague(leagueId: string) {
  if (useFixtures()) return readFixture('league');
  return cached(`league:${leagueId}`, TTL.league, () => S.getLeague(leagueId));
}

export async function loadRosters(leagueId: string) {
  if (useFixtures()) return readFixture('rosters');
  return cached(`rosters:${leagueId}`, TTL.rosters, () => S.getRosters(leagueId));
}

export async function loadLeagueUsers(leagueId: string) {
  if (useFixtures()) return readFixture('users');
  return cached(`users:${leagueId}`, TTL.league, () => S.getLeagueUsers(leagueId));
}

/**
 * Slim player index. The full dump is ~14MB of mostly-inactive players; this
 * keeps the fields any Waker view actually reads.
 */
export interface PlayerRow {
  id: string;
  name: string;
  pos: string | null;
  team: string | null;
  age: number | null;
  exp: number | null;
  status: string | null;
  bye: number | null;
  rank: number | null;
}

let playerMemo: Record<string, PlayerRow> | null = null;

export async function loadPlayers(): Promise<Record<string, PlayerRow>> {
  if (playerMemo) return playerMemo;
  const full: Record<string, any> = useFixtures()
    ? await readFixture('players')
    : await diskCached(CACHE_DIR, 'players-full', TTL.players, () => S.getAllPlayers());

  const slim: Record<string, PlayerRow> = {};
  for (const [id, p] of Object.entries(full)) {
    if (!p.active && !p.team) continue;
    slim[id] = {
      id,
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos: p.position ?? null,
      team: p.team ?? null,
      age: p.age ?? null,
      exp: p.years_exp ?? null,
      status: p.injury_status ?? null,
      bye: p.bye_week ?? null,
      rank: p.search_rank ?? null,
    };
  }
  playerMemo = slim;
  return slim;
}

/** Rotowire season projections, indexed and memoised. */
export const projectionMemo = new Map<string, Record<string, { points: number; games: number | null }>>();

export async function loadProjections(season: string, scoring: Record<string, number> | undefined) {
  const key = `${season}:${scoringKey(scoring)}`;
  const hit = projectionMemo.get(key);
  if (hit) return hit;

  const raw = useFixtures()
    ? await readFixture('projections')
    : await diskCached(CACHE_DIR, `projections-${season}`, 6 * 60 * 60_000, () =>
        S.getProjections(season, null)
      ).catch(() => []);

  const index = indexProjections(raw, scoringKey(scoring));
  projectionMemo.set(key, index);
  return index;
}

/** Which projected-points field matches this league's scoring. */
export function scoringKey(scoring: Record<string, number> | undefined): 'pts_ppr' | 'pts_half_ppr' | 'pts_std' {
  const rec = scoring?.rec ?? 0;
  if (rec >= 0.75) return 'pts_ppr';
  if (rec >= 0.25) return 'pts_half_ppr';
  return 'pts_std';
}

/** The third-party layer for one league, memoised per league shape. */
export const marketMemo = new Map<string, Promise<Market>>();

export async function loadMarketFor(league: any, players: Record<string, PlayerRow>): Promise<Market> {
  const numQbs = (league.roster_positions ?? []).filter(
    (p: string) => p === 'QB' || p === 'SUPER_FLEX'
  ).length;
  const ppr = league.scoring_settings?.rec ?? 0;
  const key = `${league.season}-${numQbs}-${league.total_rosters}-${ppr}`;

  let hit = marketMemo.get(key);
  if (!hit) {
    hit = loadMarket(Object.values(players), league.season, {
      cacheDir: CACHE_DIR,
      fixtures: useFixtures(),
      fixtureDir: FIXTURES,
      fixtureSeason: FIXTURE_SEASON,
      numQbs: Math.max(1, numQbs),
      numTeams: league.total_rosters ?? 12,
      ppr,
    });
    marketMemo.set(key, hit);
  }
  return hit;
}


/** Drop every memo. Used by the cache-flush route. */
export function resetMemos() {
  playerMemo = null;
  projectionMemo.clear();
  marketMemo.clear();
}

export async function loadState() {
  if (useFixtures()) return readFixture('state');
  return cached('state', TTL.state, () => S.getState());
}

/**
 * Whose roster is this, in this league?
 *
 * Co-owners count: a shared team is still your team, and a co-owner opening
 * Waker should see decisions rather than a not-found.
 */
export function myRoster(rosters: any[], userId: string) {
  return rosters.find((r: any) => r.owner_id === userId || r.co_owners?.includes(userId)) ?? null;
}

/** Team names, from the league's user list. */
export function teamNames(users: any[]): Map<string, string> {
  return new Map(
    users.map((u: any) => [u.user_id, u.metadata?.team_name || u.display_name || 'Unnamed'])
  );
}

/** Games one player can appear in. Sleeper's `gp` counts weeks, including byes. */
export const NFL_GAMES = 17;

/** Per-week projection from a season total, capped at a real season's games. */
export function perWeek(proj: { points: number; games: number | null } | undefined): number {
  if (!proj) return 0;
  return proj.points / Math.min(NFL_GAMES, Math.max(1, proj.games ?? NFL_GAMES));
}

export type { Market };
