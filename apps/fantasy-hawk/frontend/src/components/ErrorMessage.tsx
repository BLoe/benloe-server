export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="card border-l-4 border-red-500 bg-red-50">
      <div className="flex items-start gap-3">
        <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          <h3 className="font-semibold text-red-900">Error</h3>
          <p className="text-red-700 mt-1">{message}</p>
        </div>
      </div>
    </div>
  );
}
