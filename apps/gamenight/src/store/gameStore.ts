import { create } from 'zustand';
import { Game } from '../types';
import { gamesApi, bggApi } from '../services/api';

interface BGGSearchResult {
  objectid: string;
  name: string;
  yearpublished?: string;
}

interface GameStore {
  games: Game[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  playerCountFilter: number | null;
  complexityFilter: number | null;

  // BGG state
  bggSearchResults: BGGSearchResult[];
  bggLoading: boolean;
  bggError: string | null;

  // Actions
  fetchGames: () => Promise<void>;
  searchGames: (query: string) => Promise<void>;
  setPlayerCountFilter: (count: number | null) => void;
  setComplexityFilter: (complexity: number | null) => void;
  clearFilters: () => void;
  addGame: (game: Game) => void;
  updateGame: (id: string, updates: Partial<Game>) => void;
  removeGame: (id: string) => void;

  // BGG actions
  searchBGG: (query: string) => Promise<void>;
  importFromBGG: (bggId: string) => Promise<Game>;
  clearBGGResults: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  games: [],
  loading: false,
  error: null,
  searchQuery: '',
  playerCountFilter: null,
  complexityFilter: null,

  // BGG initial state
  bggSearchResults: [],
  bggLoading: false,
  bggError: null,

  fetchGames: async () => {
    set({ loading: true, error: null });
    try {
      const { playerCountFilter, complexityFilter, searchQuery } = get();
      const params: any = {};

      if (searchQuery) params.query = searchQuery;
      if (playerCountFilter) params.playerCount = playerCountFilter;
      if (complexityFilter) params.complexity = complexityFilter;

      const { games } = await gamesApi.getAll(params);
      set({ games, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch games',
        loading: false,
      });
    }
  },

  searchGames: async (query: string) => {
    set({ searchQuery: query, loading: true, error: null });
    try {
      const { playerCountFilter, complexityFilter } = get();
      const params: any = { query };

      if (playerCountFilter) params.playerCount = playerCountFilter;
      if (complexityFilter) params.complexity = complexityFilter;

      const { games } = await gamesApi.getAll(params);
      set({ games, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to search games',
        loading: false,
      });
    }
  },

  setPlayerCountFilter: (count: number | null) => {
    set({ playerCountFilter: count });
    get().fetchGames();
  },

  setComplexityFilter: (complexity: number | null) => {
    set({ complexityFilter: complexity });
    get().fetchGames();
  },

  clearFilters: () => {
    set({
      searchQuery: '',
      playerCountFilter: null,
      complexityFilter: null,
    });
    get().fetchGames();
  },

  addGame: (game: Game) => {
    set((state) => ({ games: [...state.games, game] }));
  },

  updateGame: (id: string, updates: Partial<Game>) => {
    set((state) => ({
      games: state.games.map((game) => (game.id === id ? { ...game, ...updates } : game)),
    }));
  },

  removeGame: (id: string) => {
    set((state) => ({
      games: state.games.filter((game) => game.id !== id),
    }));
  },

  // BGG actions
  searchBGG: async (query: string) => {
    set({ bggLoading: true, bggError: null, bggSearchResults: [] });
    try {
      const { results } = await bggApi.search(query);
      set({ bggSearchResults: results, bggLoading: false });
    } catch (error) {
      set({
        bggError: error instanceof Error ? error.message : 'Failed to search BoardGameGeek',
        bggLoading: false,
      });
    }
  },

  importFromBGG: async (bggId: string) => {
    set({ loading: true, error: null });
    try {
      const { game } = await bggApi.importGame(bggId);

      // Add the new game to local state
      set((state) => ({
        games: [...state.games, game],
        loading: false,
      }));

      return game;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to import game from BoardGameGeek',
        loading: false,
      });
      throw error;
    }
  },

  clearBGGResults: () => {
    set({ bggSearchResults: [], bggError: null });
  },
}));
