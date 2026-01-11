import { useAuth } from '../hooks/useAuth';

export function ConnectButton() {
  const { isAuthenticated, isConnected, isLoading, login, connect, disconnect } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <div className="w-4 h-4 border-2 border-hawk-orange border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm">Checking...</span>
      </div>
    );
  }

  // Not logged into Artanis - show sign in button
  if (!isAuthenticated) {
    return (
      <button onClick={login} className="btn-primary flex items-center gap-2" data-testid="sign-in">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
          />
        </svg>
        Sign In
      </button>
    );
  }

  // Logged into Artanis and Yahoo connected
  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-hawk-teal">
          <div className="w-2 h-2 rounded-full bg-hawk-teal animate-pulse-live"></div>
          <span className="text-sm font-medium">Yahoo Connected</span>
        </div>
        <button onClick={disconnect} className="btn-ghost text-sm" data-testid="disconnect-yahoo">
          Disconnect
        </button>
      </div>
    );
  }

  // Logged into Artanis but Yahoo not connected
  return (
    <button onClick={connect} className="btn-primary flex items-center gap-2" data-testid="connect-yahoo">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
      Connect Yahoo
    </button>
  );
}
