import { create } from 'zustand';
import { api } from '../services/api';
import type { User } from '../services/api';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  logout: () => void;
}

const AUTH_URL = 'https://auth.benloe.com';

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,

  checkAuth: async () => {
    try {
      set({ isLoading: true, error: null });
      const { user } = await api.auth.me();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      // Redirect to auth
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `${AUTH_URL}?redirect=${returnUrl}`;
    }
  },

  logout: () => {
    set({ user: null, isAuthenticated: false });
    window.location.href = `${AUTH_URL}/logout?redirect=${encodeURIComponent(window.location.origin)}`;
  },
}));
