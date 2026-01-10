interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="card border-l-4 border-hawk-red">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-hawk-red/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-hawk-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-hawk-red mb-1">Error</h3>
          <p className="text-gray-400 text-sm">{message}</p>
          {onRetry && (
            <button onClick={onRetry} className="btn-secondary mt-4 text-sm">
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
