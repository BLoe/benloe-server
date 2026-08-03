/**
 * Getting four vocabularies onto one player.
 *
 * Sleeper keys on its own ids. FantasyCalc publishes `sleeperId` *and* `mflId`,
 * which makes it the bridge. KeepTradeCut publishes only `mflid`, so it joins
 * through FantasyCalc. nflverse publishes none of them, so it joins on a
 * normalised name plus a position check.
 *
 *     KTC --mflId--> FantasyCalc --sleeperId--> Sleeper
 *     nflverse --normalised name + position--> Sleeper
 *
 * The name path is the fragile one and it is deliberately conservative: a wrong
 * match silently attributes one player's usage to another, which is worse than
 * no match at all. So it requires the position to agree when both sides state
 * one, and it refuses ambiguous names rather than guessing between them.
 */
import type { FcValue } from './fantasycalc.js';
import type { KtcValue } from './keeptradecut.js';
import { normaliseName } from './nflverse.js';

export interface MarketValue {
  /** Trade value in this league's shape. Arbitrary scale; ratios only. */
  dynasty: number | null;
  /** The same player in a redraft league. The gap is the win-now signal. */
  redraft: number | null;
  overallRank: number | null;
  positionRank: number | null;
  tier: number | null;
  /** 30-day movement from FantasyCalc. */
  trend30Day: number | null;
  /** 7-day movement from KTC — short enough to catch a news cycle. */
  trend7Day: number | null;
  /** How readily this asset actually trades. Low means hard to move. */
  liquidity: number | null;
  tradeCount: number | null;
  /** Which upstreams contributed, so the UI can be honest about coverage. */
  sources: string[];
}

export interface Crosswalk {
  /** sleeperId -> merged market value. */
  bySleeperId: Map<string, MarketValue>;
  /** Draft picks, which have no Sleeper id. Keyed by KTC's own name. */
  picks: KtcValue[];
  /** Coverage, for the health endpoint and for honest empty states. */
  coverage: { fantasyCalc: number; ktc: number; joined: number };
}

/**
 * Merge the two value markets onto Sleeper ids.
 *
 * Where both markets have an opinion, FantasyCalc supplies the value scale
 * (because it also gives the redraft number, and mixing scales would make the
 * two incomparable) and KTC supplies the short trend, tiers and liquidity.
 */
export function buildCrosswalk(fc: FcValue[], ktc: KtcValue[]): Crosswalk {
  const bySleeperId = new Map<string, MarketValue>();
  const mflToSleeper = new Map<string, string>();

  for (const row of fc) {
    if (!row.sleeperId) continue;
    if (row.mflId) mflToSleeper.set(row.mflId, row.sleeperId);
    bySleeperId.set(row.sleeperId, {
      dynasty: row.value,
      redraft: row.redraftValue,
      overallRank: row.overallRank || null,
      positionRank: row.positionRank || null,
      tier: row.tier,
      trend30Day: row.trend30Day,
      trend7Day: null,
      liquidity: null,
      tradeCount: null,
      sources: ['FantasyCalc'],
    });
  }

  let joined = 0;
  const picks: KtcValue[] = [];

  for (const row of ktc) {
    if (row.isPick) {
      picks.push(row);
      continue;
    }
    const sleeperId = row.mflId ? mflToSleeper.get(row.mflId) : undefined;
    if (!sleeperId) continue;

    const existing = bySleeperId.get(sleeperId);
    if (existing) {
      existing.trend7Day = row.trend7Day;
      existing.liquidity = row.liquidity;
      existing.tradeCount = row.tradeCount;
      // KTC's tier is positional and is the one managers actually say out loud.
      existing.tier = row.positionalTier ?? existing.tier;
      existing.sources.push('KeepTradeCut');
      joined++;
    }
  }

  // Picks sort high-to-low so "your best pick" is simply the first one.
  picks.sort((a, b) => b.value - a.value);

  return {
    bySleeperId,
    picks,
    coverage: { fantasyCalc: fc.length, ktc: ktc.length, joined },
  };
}

/* ------------------------------------------------------------------ *
 * The name join, for nflverse
 * ------------------------------------------------------------------ */

export interface NameJoinable {
  key: string;
  position?: string | null;
  team?: string | null;
}

export interface SleeperPlayerish {
  id: string;
  name: string;
  pos?: string | null;
  team?: string | null;
}

/**
 * Map normalised names onto Sleeper ids, refusing anything ambiguous.
 *
 * Two players sharing a normalised name (Michael Thomas the receiver and
 * Michael Thomas the safety, or a father and son) are dropped from the index
 * unless a position tells them apart. Attributing one man's snap share to
 * another is a silent, confident lie; showing nothing is merely a gap.
 */
export function buildNameIndex(players: SleeperPlayerish[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const p of players) {
    if (!p.name) continue;
    const key = normaliseName(p.name);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(p.id);
    else index.set(key, [p.id]);
  }
  return index;
}

/**
 * Resolve one nflverse row to a Sleeper id.
 *
 * Returns null when the name is unknown, or when it is shared and the position
 * does not settle it.
 */
export function resolveByName(
  row: NameJoinable,
  index: Map<string, string[]>,
  players: Map<string, SleeperPlayerish>
): string | null {
  const candidates = index.get(row.key);
  if (!candidates?.length) return null;

  if (candidates.length === 1) {
    const only = players.get(candidates[0]);
    // Even a unique name must not contradict its position — that pattern means
    // the two feeds disagree about who this is.
    if (row.position && only?.pos && !positionsAgree(row.position, only.pos)) return null;
    return candidates[0];
  }

  const byPosition = candidates.filter((id) => {
    const p = players.get(id);
    return row.position && p?.pos ? positionsAgree(row.position, p.pos) : false;
  });
  return byPosition.length === 1 ? byPosition[0] : null;
}

/**
 * Positions across these feeds are mostly but not exactly the same vocabulary:
 * nflverse says FB where Sleeper says RB, and HB/TE-slot variants appear.
 */
const POSITION_ALIASES: Record<string, string> = {
  FB: 'RB',
  HB: 'RB',
  WR1: 'WR',
  WR2: 'WR',
  WR3: 'WR',
  PK: 'K',
  DST: 'DEF',
  'D/ST': 'DEF',
};

export function canonicalPosition(pos: string): string {
  const up = pos.toUpperCase().trim();
  return POSITION_ALIASES[up] ?? up;
}

export function positionsAgree(a: string, b: string): boolean {
  return canonicalPosition(a) === canonicalPosition(b);
}

/** Attach nflverse rows to Sleeper ids, dropping whatever cannot be resolved. */
export function joinByName<T extends NameJoinable>(
  rows: T[],
  players: SleeperPlayerish[]
): Map<string, T> {
  const index = buildNameIndex(players);
  const byId = new Map(players.map((p) => [p.id, p]));
  const out = new Map<string, T>();

  for (const row of rows) {
    const id = resolveByName(row, index, byId);
    // First writer wins: nflverse can list a player twice after a mid-season
    // trade, and the earlier row is the one with the fuller history.
    if (id && !out.has(id)) out.set(id, row);
  }
  return out;
}
