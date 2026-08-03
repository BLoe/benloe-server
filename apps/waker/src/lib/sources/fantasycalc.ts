/**
 * FantasyCalc — crowd-sourced trade values from real completed trades.
 *
 * The reason this source matters more than a ranking list: it publishes a
 * **dynasty value and a redraft value for the same player**. The gap between
 * them is the only clean signal available for "does this asset score now or
 * later", which is the question a dynasty manager is actually asking.
 *
 * Public JSON, no key, and it carries `sleeperId` directly — which also makes
 * it the bridge that gets KeepTradeCut's `mflid` onto Sleeper ids.
 */
import { fetchJson } from './http.js';

const BASE = 'https://api.fantasycalc.com/values/current';

export interface FcValue {
  sleeperId: string | null;
  mflId: string | null;
  espnId: string | null;
  name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  /** Value in this format. Scale is arbitrary; only ratios mean anything. */
  value: number;
  overallRank: number;
  positionRank: number;
  /** Value in a redraft league of the same shape. */
  redraftValue: number;
  /** 30-day movement in value. Positive means the market is buying. */
  trend30Day: number;
  tier: number | null;
  adp: number | null;
  /** Share of leagues where this player is rostered, 0-100. */
  rosterPercent: number | null;
}

export interface FcOptions {
  /** A superflex league values quarterbacks completely differently. */
  numQbs?: number;
  numTeams?: number;
  /** Points per reception. Ben's league is standard scoring, so 0. */
  ppr?: number;
}

/** The query that identifies one league shape. Also the cache key. */
export function fcKey(o: FcOptions = {}): string {
  const { numQbs = 1, numTeams = 12, ppr = 0 } = o;
  return `fantasycalc-${numQbs}qb-${numTeams}tm-${ppr}ppr`;
}

function url(o: FcOptions, dynasty: boolean): string {
  const { numQbs = 1, numTeams = 12, ppr = 0 } = o;
  return `${BASE}?isDynasty=${dynasty}&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`;
}

/**
 * One request returns both numbers — the dynasty response carries `redraftValue`
 * alongside `value`, so there is no need to fetch the redraft endpoint too.
 */
export async function fetchFantasyCalc(o: FcOptions = {}): Promise<FcValue[]> {
  const raw = await fetchJson<any[]>(url(o, true), 20_000);
  return mapFantasyCalc(raw);
}

export function mapFantasyCalc(raw: any[]): FcValue[] {
  const out: FcValue[] = [];
  for (const row of raw ?? []) {
    const p = row?.player;
    if (!p?.name) continue;
    out.push({
      sleeperId: p.sleeperId ? String(p.sleeperId) : null,
      mflId: p.mflId ? String(p.mflId) : null,
      espnId: p.espnId ? String(p.espnId) : null,
      name: p.name,
      position: p.position ?? null,
      team: p.maybeTeam ?? null,
      age: p.maybeAge ?? null,
      value: row.value ?? 0,
      overallRank: row.overallRank ?? 0,
      positionRank: row.positionRank ?? 0,
      redraftValue: row.redraftValue ?? 0,
      trend30Day: row.trend30Day ?? 0,
      tier: row.maybeTier ?? null,
      adp: row.maybeAdp ?? null,
      rosterPercent: row.maybeRosterPercent ?? null,
    });
  }
  return out;
}
