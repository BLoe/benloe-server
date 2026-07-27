export interface Player {
  id: string;
  name: string;
  gender: 'woman' | 'man' | 'nonbinary';
  active: boolean;
  excludedPositions: string[];
  notes: string;
  sortOrder: number;
}

export interface StatDef {
  key: string;
  name: string;
  category: 'offense' | 'defense';
  description: string;
  prompt: string;
}

export interface PositionDef {
  key: string;
  code: string;
  name: string;
  alias?: string;
  zone: 'battery' | 'infield' | 'outfield';
  weights: Record<string, number>;
  x: number;
  y: number;
}

export interface Settings {
  team_name: string;
  innings: number;
  min_women_in_field: number;
  rating_game_passcode: string;
  admin_emails: string;
}

export interface GameSummaryRow {
  id: string;
  playedOn: string;
  opponent: string;
  status: 'draft' | 'published';
  slug: string | null;
  generatedAt: string | null;
}

export interface LineupSummary {
  expectedRuns: number;
  runsByInning: number[];
  meanFit: number;
  inningsPlayed: Record<string, number>;
  fairShare: Record<string, number>;
  positionsPlayed: Record<string, string[]>;
  warnings: string[];
  insights: string[];
  generatedAt: string;
}

export interface GamePayload {
  game: {
    id: string;
    playedOn: string;
    opponent: string;
    firstPitch: string;
    field: string;
    notes: string;
    status: 'draft' | 'published';
    slug: string | null;
    generatedAt: string | null;
  };
  availability: string[];
  battingOrder: string[];
  defense: { inning: number; position_key: string; player_id: string; locked: number }[];
  summary: Partial<LineupSummary>;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? 'That request did not go through.', response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const body = (data: unknown) => ({ body: JSON.stringify(data) });

export const api = {
  me: () => request<{ user: { email: string; name?: string } }>('/me'),
  meta: () => request<{ stats: StatDef[]; positions: PositionDef[]; settings: Settings }>('/meta'),
  updateSettings: (data: Partial<Settings>) =>
    request<{ settings: Settings }>('/settings', { method: 'PATCH', ...body(data) }),

  players: {
    list: () => request<{ players: Player[] }>('/players'),
    create: (data: { name: string; gender: string; excludedPositions?: string[]; notes?: string }) =>
      request<{ player: Player }>('/players', { method: 'POST', ...body(data) }),
    update: (id: string, data: Partial<Player>) =>
      request<{ player: Player }>(`/players/${id}`, { method: 'PATCH', ...body(data) }),
    remove: (id: string) => request<{ ok: true }>(`/players/${id}`, { method: 'DELETE' }),
    reorder: (ids: string[]) => request<{ players: Player[] }>('/players/reorder', { method: 'POST', ...body({ ids }) }),
  },

  ratings: (includeSelf: boolean) =>
    request<{
      ratings: Record<string, Record<string, { rating: number; confidence: number; comparisons: number }>>;
      counts: Record<string, number>;
      fits: { playerId: string; fits: Record<string, number> }[];
      history: { played: Record<string, number>; possible: Record<string, number> };
    }>(`/ratings?includeSelf=${includeSelf}`),

  comparisons: {
    list: (limit = 60) =>
      request<{
        comparisons: {
          id: number;
          stat_key: string;
          created_at: string;
          player_a_name: string;
          player_b_name: string;
          winner_id: string | null;
          rater_name: string | null;
        }[];
      }>(`/comparisons?limit=${limit}`),
    remove: (id: number) => request<{ ok: true }>(`/comparisons/${id}`, { method: 'DELETE' }),
  },

  games: {
    list: () => request<{ games: GameSummaryRow[] }>('/games'),
    create: (data: { playedOn: string; opponent?: string; firstPitch?: string; field?: string }) =>
      request<GamePayload>('/games', { method: 'POST', ...body(data) }),
    get: (id: string) => request<GamePayload>(`/games/${id}`),
    update: (id: string, data: Record<string, string>) =>
      request<GamePayload>(`/games/${id}`, { method: 'PATCH', ...body(data) }),
    remove: (id: string) => request<{ ok: true }>(`/games/${id}`, { method: 'DELETE' }),
    setAvailability: (id: string, playerIds: string[]) =>
      request<GamePayload>(`/games/${id}/availability`, { method: 'PUT', ...body({ playerIds }) }),
    generate: (id: string, keepLocks = true) =>
      request<GamePayload>(`/games/${id}/generate`, { method: 'POST', ...body({ keepLocks }) }),
    saveLineup: (
      id: string,
      data: {
        battingOrder?: string[];
        defense?: { inning: number; positionKey: string; playerId: string; locked?: boolean }[];
      }
    ) => request<GamePayload>(`/games/${id}/lineup`, { method: 'PUT', ...body(data) }),
    publish: (id: string) => request<GamePayload>(`/games/${id}/publish`, { method: 'POST' }),
    unpublish: (id: string) => request<GamePayload>(`/games/${id}/unpublish`, { method: 'POST' }),
  },
};

// ---- Public endpoints -------------------------------------------------------

export interface Matchup {
  stat: StatDef;
  playerA: { id: string; name: string };
  playerB: { id: string; name: string };
  pairKey: string;
}

export interface PublicLineup {
  teamName: string;
  game: { playedOn: string; opponent: string; firstPitch: string; field: string; notes: string };
  battingOrder: { slot: number; playerId: string; name: string }[];
  innings: {
    inning: number;
    positions: {
      key: string;
      code: string;
      name: string;
      alias: string | null;
      zone: string;
      x: number;
      y: number;
      playerId: string | null;
      playerName: string | null;
    }[];
    bench: { id: string; name: string }[];
  }[];
  insights: string[];
}

export const publicApi = {
  team: () => request<{ teamName: string; innings: number; passcodeRequired: boolean }>('/public/team'),
  raters: () => request<{ players: { id: string; name: string }[] }>('/public/raters'),
  checkPasscode: (passcode: string) => request<{ ok: true }>('/public/passcode', { method: 'POST', ...body({ passcode }) }),
  matchup: (seen: string[], passcode: string) =>
    request<Matchup>(`/public/matchup?seen=${encodeURIComponent(seen.join(','))}&passcode=${encodeURIComponent(passcode)}`),
  submit: (data: {
    statKey: string;
    playerA: string;
    playerB: string;
    winnerId: string | null;
    raterId: string | null;
    passcode: string;
  }) => request<{ totalComparisons: number; yourComparisons: number }>('/public/comparison', { method: 'POST', ...body(data) }),
  progress: (raterId: string | null) =>
    request<{ totalComparisons: number; yourComparisons: number; universe: number }>(
      `/public/progress${raterId ? `?raterId=${raterId}` : ''}`
    ),
  lineup: (slug: string) => request<PublicLineup>(`/public/lineup/${slug}`),
};
