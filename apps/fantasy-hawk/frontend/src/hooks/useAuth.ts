import { useState, useEffect } from 'react';
import { api } from '../services/api';

export function useAuth() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const status = await api.oauth.getStatus();
      setIsConnected(status.connected);
    } catch (err: any) {
      console.error('Auth status check failed:', err);
      setError(err.message || 'Failed to check authentication status');
      setIsConnected(false);
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
    isConnected,
    isLoading,
    error,
    connect,
    disconnect,
    refresh: checkStatus,
  };
}
