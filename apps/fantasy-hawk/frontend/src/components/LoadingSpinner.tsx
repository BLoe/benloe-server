export function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-10 h-10 border-3 border-hawk-orange border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  );
}
