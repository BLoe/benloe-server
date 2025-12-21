import { create } from 'zustand';
import { AuthState } from '../types';

interface AuthStore extends AuthState {
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
  redirectToLogin: (returnUrl?: string) => void;
  requireAuth: (action: () => void, message?: string) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const AUTH_URL = import.meta.env.VITE_AUTH_URL || 'http://localhost:3002';

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  loading: true,
  error: null,

  checkAuth: async () => {
    try {
      set({ loading: true, error: null });

      const response = await fetch(`${API_BASE}/auth/me`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        set({ user: data.user, loading: false });
      } else {
        set({ user: null, loading: false });
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      set({ user: null, loading: false, error: 'Authentication check failed' });
    }
  },

  logout: async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      set({ user: null, error: null });
    } catch (error) {
      console.error('Logout failed:', error);
      // Still clear the user state even if the API call fails
      set({ user: null, error: null });
    }
  },

  redirectToLogin: (returnUrl?: string) => {
    const url = returnUrl ? `${AUTH_URL}?redirect=${encodeURIComponent(returnUrl)}` : AUTH_URL;
    window.location.href = url;
  },

  requireAuth: (action: () => void, message?: string) => {
    const { user } = get();
    if (user) {
      action();
    } else {
      // Show auth prompt modal or redirect to login
      if (
        confirm(message || 'This action requires you to sign in. Would you like to sign in now?')
      ) {
        get().redirectToLogin(window.location.href);
      }
    }
  },
}));
