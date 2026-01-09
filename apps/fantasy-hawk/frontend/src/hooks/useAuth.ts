import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';

const AUTH_URL = 'https://auth.benloe.com';
const CURRENT_URL = window.location.origin;

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const checkStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const status = await api.oauth.getStatus();
      // If we get a response, we're authenticated with Artanis
      setIsAuthenticated(true);
      setIsConnected(status.connected);
      setRole(status.role || null);
    } catch (err: any) {
      console.error('Auth status check failed:', err);
      // 401 means not authenticated with Artanis
      if (err instanceof ApiError && err.status === 401) {
        setIsAuthenticated(false);
        setIsConnected(false);
        setRole(null);
      } else {
        setError(err.message || 'Failed to check authentication status');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();

    // Check for OAuth callback params
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'success') {
      // Clear URL params
      window.history.replaceState({}, '', window.location.pathname);
      // Refresh status
      checkStatus();
    }
  }, []);

  const login = () => {
    const redirectUrl = encodeURIComponent(CURRENT_URL);
    window.location.href = `${AUTH_URL}/?redirect=${redirectUrl}`;
  };

  const connect = () => {
    api.oauth.connect();
  };

  const disconnect = async () => {
    try {
      await api.oauth.disconnect();
      setIsConnected(false);
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
      throw err;
    }
  };

  return {
    isAuthenticated,
    isConnected,
    isLoading,
    error,
    role,
    login,
    connect,
    disconnect,
    refresh: checkStatus,
  };
}
