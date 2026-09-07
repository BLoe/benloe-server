/**
 * FantasyCalc — crowd-sourced values derived from real completed trades.
 *
 * This is the market anchor, and it exists for the league Gavel has no history
 * for. A model says what a player is WORTH; it does not say what a room will
 * make you PAY. Where a league's own auctions are on file those are far better
 * evidence, so this is only consulted when they are not.
 *
 * Public JSON, no key, and it carries `sleeperId` directly, which is the join
 * to everything else here. Read once at snapshot time and never during a draft.
 */
import type { Position } from '../lib/league.js';

const BASE = 'https://api.fantasycalc.com/values/current';

export interface MarketValue {
  sleeperId: string;
  name: string;
  position: Position | null;
  /** Value in a redraft league of this shape. Scale is arbitrary; ratios matter. */
  redraftValue: number;
}

export interface MarketOptions {
  numQbs?: number;
  numTeams?: number;
  /** Points per reception. Standard is 0, half-PPR 0.5. */
  ppr?: number;
}

/**
 * FantasyCalc's own leagues are shaped by these three numbers, so asking for
 * the right shape matters: a superflex league values quarterbacks completely
 * differently, and a PPR league values receivers completely differently.
 */
export async function fetchMarketValues(o: MarketOptions = {}): Promise<MarketValue[]> {
  const { numQbs = 1, numTeams = 12, ppr = 0 } = o;
  const url = `${BASE}?isDynasty=false&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let raw: any[];
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`FantasyCalc HTTP ${res.status}`);
    raw = (await res.json()) as any[];
  } finally {
    clearTimeout(timer);
  }

  const out: MarketValue[] = [];
  for (const row of raw ?? []) {
    const p = row?.player;
    const sleeperId = p?.sleeperId != null ? String(p.sleeperId) : null;
    const value = Number(row?.redraftValue ?? row?.value);
    if (!sleeperId || !p?.name || !Number.isFinite(value) || value <= 0) continue;
    out.push({
      sleeperId,
      name: p.name,
      position: (p.position ?? null) as Position | null,
      redraftValue: value,
    });
  }
  return out;
}
