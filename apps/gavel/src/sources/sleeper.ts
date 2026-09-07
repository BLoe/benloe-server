/**
 * Sleeper — the only upstream this tool reads, and it reads it ONLY before the
 * draft starts.
 *
 * Everything fetched here gets frozen into a snapshot on disk. At draft time the
 * app serves the snapshot and makes no network call at all, so a Sleeper outage,
 * a DNS hiccup or a rate limit at 8:45pm cannot touch the board. That is the
 * whole reason this file is separate from the server.
 */
const BASE = 'https://api.sleeper.app';

async function get<T>(path: string, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Sleeper ${path} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
  draft_id: string | null;
}

export interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string } | null;
}

export interface SleeperDraft {
  draft_id: string;
  type: string;
  status: string;
  start_time: number | null;
  settings: Record<string, number>;
}

export interface SleeperProjectionRow {
  player_id: string;
  stats: Record<string, number> | null;
  player: {
    first_name: string | null;
    last_name: string | null;
    fantasy_positions: string[] | null;
    team: string | null;
    injury_status: string | null;
    years_exp?: number | null;
  } | null;
}

export const getLeague = (id: string) => get<SleeperLeague>(`/v1/league/${id}`);
export const getUsers = (id: string) => get<SleeperUser[]>(`/v1/league/${id}/users`);
export const getDrafts = (id: string) => get<SleeperDraft[]>(`/v1/league/${id}/drafts`);
export const getState = () =>
  get<{ season: string; week: number; season_type: string }>(`/v1/state/nfl`);

/**
 * Season projections, stat line included.
 *
 * The stat line is the point of the request. Sleeper also returns `pts_std` and
 * friends and this tool never reads them — they assume four-point passing
 * touchdowns, which is wrong for the Columbus league by 40-plus points on every
 * quarterback. See `lib/scoring.ts`.
 */
export async function getProjections(season: string): Promise<SleeperProjectionRow[]> {
  const positions = ['QB', 'RB', 'WR', 'TE', 'DEF', 'K'].map((p) => `position[]=${p}`).join('&');
  return get<SleeperProjectionRow[]>(
    `/projections/nfl/${season}?season_type=regular&${positions}&order_by=adp_std`,
    45_000
  );
}

/** Bye weeks, which Sleeper keeps on the team rather than the projection. */
export async function getByeWeeks(season: string): Promise<Record<string, number>> {
  const schedule = await get<Array<{ week: number; team: string }>>(
    `/schedule/nfl/regular/${season}`
  ).catch(() => [] as Array<{ week: number; team: string }>);

  const playing = new Map<number, Set<string>>();
  const teams = new Set<string>();
  for (const game of schedule) {
    if (!game?.team) continue;
    teams.add(game.team);
    if (!playing.has(game.week)) playing.set(game.week, new Set());
    playing.get(game.week)!.add(game.team);
  }

  const byes: Record<string, number> = {};
  for (const team of teams) {
    for (const [week, set] of [...playing.entries()].sort((a, b) => a[0] - b[0])) {
      if (week >= 4 && week <= 14 && !set.has(team)) {
        byes[team] = week;
        break;
      }
    }
  }
  return byes;
}
