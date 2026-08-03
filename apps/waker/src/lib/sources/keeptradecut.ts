/**
 * KeepTradeCut — the other trade-value market, and the more opinionated one.
 *
 * KTC has no API. The rankings page ships the whole dataset inline as
 * `var playersArray = [...]` before any JavaScript runs, so a single GET plus a
 * regex gets all 500 entries. That is a documented-by-observation shape, not a
 * contract: if the variable name or the surrounding syntax changes, the parse
 * returns nothing and every panel that uses it degrades. It never throws its
 * way onto a page.
 *
 * What it adds over FantasyCalc:
 *   - a 7-day trend, which is short enough to catch a news cycle
 *   - positional tiers, which is how managers actually talk about players
 *   - liquidity and trade counts — how *tradeable* an asset is, not just what
 *     it is worth. A high-value illiquid player is a different problem.
 *   - draft pick values, which FantasyCalc's player feed does not carry
 */
import { fetchText } from './http.js';

const RANKINGS_URL = 'https://keeptradecut.com/dynasty-rankings';

export interface KtcValue {
  /** KTC's own id. Not portable — use `mflId` to join. */
  ktcId: number;
  mflId: string | null;
  name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  experience: number | null;
  rookie: boolean;
  /** True when this row is a draft pick rather than a player. */
  isPick: boolean;
  value: number;
  overallRank: number;
  positionalRank: number | null;
  positionalTier: number | null;
  /** Value movement over 7 days. Short enough to reflect a news cycle. */
  trend7Day: number;
  /** How often this player actually changes hands. Low means hard to move. */
  tradeCount: number | null;
  liquidity: number | null;
}

/**
 * Pull the inline dataset out of the rankings page.
 *
 * Exported separately from the fetch so it can be tested against a captured
 * fixture — this is the part most likely to break, and it should break loudly
 * in a test rather than quietly in production.
 */
export function parseKtcHtml(html: string, format: 'oneQB' | 'superflex' = 'oneQB'): KtcValue[] {
  const match = html.match(/var\s+playersArray\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];

  let raw: any[];
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const key = format === 'superflex' ? 'superflexValues' : 'oneQBValues';
  const out: KtcValue[] = [];

  for (const p of raw) {
    const v = p?.[key];
    if (!v || !p.playerName) continue;

    // Picks come through the same array with a position of 'RDP' and a name
    // like "2027 Early 1st". They are genuinely useful for trade maths, so they
    // are kept and flagged rather than filtered out.
    const isPick = p.position === 'RDP' || /^\d{4}\s/.test(p.playerName);

    out.push({
      ktcId: p.playerID,
      mflId: p.mflid ? String(p.mflid) : null,
      name: p.playerName,
      position: isPick ? 'PICK' : (p.position ?? null),
      team: p.team ?? null,
      age: typeof p.age === 'number' ? p.age : null,
      experience: typeof p.seasonsExperience === 'number' ? p.seasonsExperience : null,
      rookie: !!p.rookie,
      isPick,
      value: v.value ?? 0,
      overallRank: v.rank ?? 0,
      positionalRank: v.positionalRank ?? null,
      positionalTier: v.positionalTier ?? null,
      trend7Day: v.overall7DayTrend ?? 0,
      tradeCount: v.tradeCount ?? null,
      liquidity: v.stdLiquidity ?? null,
    });
  }
  return out;
}

export async function fetchKeepTradeCut(
  format: 'oneQB' | 'superflex' = 'oneQB'
): Promise<KtcValue[]> {
  return parseKtcHtml(await fetchText(RANKINGS_URL, 25_000), format);
}
