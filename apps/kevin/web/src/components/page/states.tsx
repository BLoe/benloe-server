import { CircleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ViewState as ViewResult } from '@/lib/useView';
import { cn } from '@/lib/utils';

/** Shown where a list would be when there is nothing in it. Say what belongs here and offer the way to add it. */
export function EmptyState({ icon: Icon, title, body, action, className }: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center', className)}>
      {Icon && <Icon className="mb-3 size-7 text-muted-foreground/70" strokeWidth={1.5} />}
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm">
      <CircleAlert className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Placeholder rows while a list loads for the first time. */
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${55 - i * 8}%` }} />
            <Skeleton className="h-3" style={{ width: `${35 - i * 5}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The three states of a `useView` result in one place: skeleton rows on first
 * load, an error with a retry, the empty state, otherwise `children(data)`.
 */
export function ViewState<T>({ view, empty, isEmpty, rows, children }: {
  view: ViewResult<T>;
  /** What to show when `isEmpty(data)` is true. */
  empty?: ReactNode;
  /** Default: an empty array. */
  isEmpty?: (data: T) => boolean;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (view.data === undefined) {
    if (view.error) return <ErrorState message={view.error} onRetry={view.refetch} />;
    return <LoadingRows rows={rows} />;
  }
  const nothing = isEmpty ? isEmpty(view.data) : Array.isArray(view.data) && view.data.length === 0;
  if (nothing && empty !== undefined) return <>{empty}</>;
  return <>{children(view.data)}</>;
}
