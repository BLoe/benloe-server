import { Game, Event, User } from '../types';

const API_BASE = '/api';

// API helper function
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Network error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Games API
export const gamesApi = {
  async getAll(params?: {
    query?: string;
    playerCount?: number;
    complexity?: number;
    minPlayers?: number;
    maxPlayers?: number;
  }): Promise<{ games: Game[] }> {
    const searchParams = new URLSearchParams();
    if (params?.query) searchParams.set('query', params.query);
    if (params?.playerCount) searchParams.set('playerCount', params.playerCount.toString());
    if (params?.complexity) searchParams.set('complexity', params.complexity.toString());
    if (params?.minPlayers) searchParams.set('minPlayers', params.minPlayers.toString());
    if (params?.maxPlayers) searchParams.set('maxPlayers', params.maxPlayers.toString());

    const query = searchParams.toString();
    return apiRequest<{ games: Game[] }>(`/games${query ? `?${query}` : ''}`);
  },

  async getById(id: string): Promise<{ game: Game }> {
    return apiRequest<{ game: Game }>(`/games/${id}`);
  },

  async create(gameData: Partial<Game>): Promise<{ game: Game }> {
    return apiRequest<{ game: Game }>('/games', {
      method: 'POST',
      body: JSON.stringify(gameData),
    });
  },

  async update(id: string, gameData: Partial<Game>): Promise<{ game: Game }> {
    return apiRequest<{ game: Game }>(`/games/${id}`, {
      method: 'PUT',
      body: JSON.stringify(gameData),
    });
  },

  async delete(id: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/games/${id}`, {
      method: 'DELETE',
    });
  },
};

// Events API
export const eventsApi = {
  async getAll(params?: {
    start?: string;
    end?: string;
    status?: string;
    gameId?: string;
  }): Promise<{ events: Event[] }> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set('start', params.start);
    if (params?.end) searchParams.set('end', params.end);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.gameId) searchParams.set('gameId', params.gameId);

    const query = searchParams.toString();
    return apiRequest<{ events: Event[] }>(`/events${query ? `?${query}` : ''}`);
  },

  async getById(id: string): Promise<{ event: Event }> {
    return apiRequest<{ event: Event }>(`/events/${id}`);
  },

  async create(eventData: {
    title?: string;
    gameId: string;
    dateTime: string;
    location?: string;
    description?: string;
    commitmentDeadline?: string;
  }): Promise<{ event: Event }> {
    return apiRequest<{ event: Event }>('/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    });
  },

  async update(id: string, eventData: Partial<Event>): Promise<{ event: Event }> {
    return apiRequest<{ event: Event }>(`/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(eventData),
    });
  },

  async joinEvent(id: string, notes?: string): Promise<{ message: string; status: string }> {
    return apiRequest<{ message: string; status: string }>(`/events/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify({ action: 'join', notes }),
    });
  },

  async leaveEvent(id: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/events/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify({ action: 'leave' }),
    });
  },

  async declineEvent(id: string, notes?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/events/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify({ action: 'decline', notes }),
    });
  },

  async cancel(id: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/events/${id}`, {
      method: 'DELETE',
    });
  },
};

// BoardGameGeek API
export const bggApi = {
  async search(query: string): Promise<{
    results: Array<{
      objectid: string;
      name: string;
      yearpublished?: string;
    }>;
  }> {
    return apiRequest<any>(`/games/bgg/search?query=${encodeURIComponent(query)}`);
  },

  async getGameDetails(bggId: string): Promise<{
    game: {
      id: string;
      name: string;
      description: string;
      minPlayers: number;
      maxPlayers: number;
      playingTime: number;
      averageWeight: number;
      thumbnail?: string;
      image?: string;
      yearPublished: number;
    };
  }> {
    return apiRequest<any>(`/games/bgg/${bggId}`);
  },

  async importGame(bggId: string): Promise<{ message: string; game: Game }> {
    return apiRequest<{ message: string; game: Game }>(`/games/bgg/${bggId}/import`, {
      method: 'POST',
    });
  },
};

// Auth API
export const authApi = {
  async getMe(): Promise<{ user: User }> {
    return apiRequest<{ user: User }>('/auth/me');
  },

  async logout(): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/auth/logout', {
      method: 'POST',
    });
  },
};

// Health check
export const healthApi = {
  async check(): Promise<{ status: string; timestamp: string }> {
    return apiRequest<{ status: string; timestamp: string }>('/health');
  },
};
