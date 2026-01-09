import { useAuth } from '../hooks/useAuth';

export function ConnectButton() {
  const { isAuthenticated, isConnected, isLoading, login, connect, disconnect } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
        <span>Checking connection...</span>
      </div>
    );
  }

  // Not logged into Artanis - show sign in button
  if (!isAuthenticated) {
    return (
      <button onClick={login} className="btn-primary flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
          />
        </svg>
        Sign in to benloe.com
      </button>
    );
  }

  // Logged into Artanis and Yahoo connected
  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-green-600">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium">Yahoo Connected</span>
        </div>
        <button onClick={disconnect} className="btn-secondary">
          Disconnect
        </button>
      </div>
    );
  }

  // Logged into Artanis but Yahoo not connected
  return (
    <button onClick={connect} className="btn-primary flex items-center gap-2">
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
      Connect Yahoo Account
    </button>
  );
}
