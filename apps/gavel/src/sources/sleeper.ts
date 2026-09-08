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
  previous_league_id?: string | null;
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

/**
 * Bye weeks, derived from the schedule.
 *
 * A team's bye is the week it does not appear in any fixture. The schedule
 * endpoint returns `home` and `away` per game and NOT a `team` field — reading
 * `game.team` returns undefined for every row, which silently produced an empty
 * map and a board where no player had a bye at all. Nothing threw; the data
 * simply was not there.
 */
export async function getByeWeeks(season: string): Promise<Record<string, number>> {
  const schedule = await get<Array<{ week: number; home: string; away: string }>>(
    `/schedule/nfl/regular/${season}`
  ).catch(() => [] as Array<{ week: number; home: string; away: string }>);

  const playing = new Map<number, Set<string>>();
  const teams = new Set<string>();
  let lastWeek = 0;
  for (const game of schedule) {
    if (!game?.home || !game?.away) continue;
    teams.add(game.home);
    teams.add(game.away);
    lastWeek = Math.max(lastWeek, game.week);
    if (!playing.has(game.week)) playing.set(game.week, new Set());
    playing.get(game.week)!.add(game.home);
    playing.get(game.week)!.add(game.away);
  }

  const byes: Record<string, number> = {};
  for (const team of teams) {
    for (let week = 1; week <= lastWeek; week++) {
      const set = playing.get(week);
      // A week with no fixtures at all is missing data, not a league-wide bye.
      if (set && set.size > 0 && !set.has(team)) {
        byes[team] = week;
        break;
      }
    }
  }
  return byes;
}

export interface SleeperDraftPick {
  player_id: string;
  picked_by: string | null;
  metadata: {
    /** Auction price, as a string. Absent in a snake draft. */
    amount?: string;
    position?: string;
    first_name?: string;
    last_name?: string;
  } | null;
}

export const getDraftPicks = (draftId: string) =>
  get<SleeperDraftPick[]>(`/v1/draft/${draftId}/picks`, 30_000);

export interface PastAuction {
  season: string;
  draftId: string;
  picks: Array<{ playerId: string; position: string; price: number }>;
}

/**
 * Every completed auction this league has run, walking `previous_league_id`.
 *
 * This is the best calibration data available anywhere: not what some market
 * thinks a player is worth, but what THESE twelve managers actually paid, in
 * this scoring system, with this roster shape. The Columbus league has two
 * prior years on file and they agree closely with each other and disagree with
 * generic market values in specific, repeatable ways — defences go for $1 and
 * receivers cost more than a 2-WR league would suggest.
 *
 * Best-effort at every step: a season that fails to load is skipped rather than
 * failing the snapshot, because a board with no history is still a board.
 */
export async function getAuctionHistory(leagueId: string, maxSeasons = 4): Promise<PastAuction[]> {
  const out: PastAuction[] = [];
  let id: string | null = leagueId;
  let guard = 0;

  while (id && guard < maxSeasons + 1) {
    guard += 1;
    let league: SleeperLeague;
    try {
      league = await getLeague(id);
    } catch {
      break;
    }

    try {
      const drafts = await getDrafts(id);
      for (const draft of drafts) {
        if (draft.type !== 'auction' || draft.status !== 'complete') continue;
        const picks = await getDraftPicks(draft.draft_id);
        const priced = picks
          .map((p) => ({
            playerId: p.player_id,
            position: p.metadata?.position ?? '',
            price: Number(p.metadata?.amount),
          }))
          .filter((p) => p.playerId && p.position && Number.isFinite(p.price) && p.price > 0);
        if (priced.length > 0) {
          out.push({ season: league.season, draftId: draft.draft_id, picks: priced });
        }
      }
    } catch {
      // One unreadable season must not cost us the others.
    }

    id = (league as any).previous_league_id ?? null;
  }
  return out;
}
