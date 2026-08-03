/**
 * Sleeper's projections, indexed by player.
 *
 * Rotowire-sourced and undocumented, but it is the only predicted-points feed
 * Sleeper exposes. Payloads are 5-9MB of ~9,400 rows, most carrying nothing but
 * an ADP, so this trims to the players with a real projection.
 */
export interface Projection {
  points: number;
  /** Games the projection covers. Sleeper publishes a flat 18 — see below. */
  games: number | null;
}

export function indexProjections(
  raw: any[],
  key: 'pts_ppr' | 'pts_half_ppr' | 'pts_std'
): Record<string, Projection> {
  const out: Record<string, Projection> = {};
  for (const row of raw ?? []) {
    const points = row?.stats?.[key];
    if (points == null || !row.player_id) continue;
    out[String(row.player_id)] = {
      points: Math.round(points * 100) / 100,
      // Sleeper reports `gp` as a flat 18 for every player: the length of the
      // NFL calendar, not a projection of who stays healthy. A player appears
      // in at most 17 of those weeks, so callers cap it there — dividing a
      // season total by 18 prices in a bye the player does not play.
      games: row.stats.gp ?? null,
    };
  }
  return out;
}
