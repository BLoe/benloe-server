import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { appPath } from '@/lib/links';
import { dismissToast, useToasts } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** Top of the screen on a phone (clear of the tab bar and composer), bottom-left on desktop. */
export function Toaster() {
  const toasts = useToasts();
  const navigate = useNavigate();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:inset-x-auto lg:top-auto lg:bottom-4 lg:left-4 lg:items-start lg:px-0 lg:pt-0" aria-live="polite">
      {toasts.map((t) => {
        const path = appPath(t.link);
        const clickable = path !== null || !!t.onClick;
        const open = () => {
          t.onClick?.();
          if (path !== null) void navigate(path);
          dismissToast(t.id);
        };
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-popover py-2.5 pr-1 pl-3.5 text-popover-foreground shadow-lg animate-[kevin-in_180ms_ease-out]',
              t.kind === 'error' && 'border-destructive/40',
            )}
          >
            {t.kind === 'error' && <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}
            {t.kind === 'success' && <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />}
            <div className={cn('min-w-0 flex-1 py-0.5', clickable && 'cursor-pointer')} onClick={clickable ? open : undefined}>
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-3 text-sm break-words text-muted-foreground">{t.body}</div>}
            </div>
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
