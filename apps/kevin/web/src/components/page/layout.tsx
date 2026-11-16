import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Every page's outer wrapper: the reading width, the gutters (16px on a
 * phone, 32px on desktop) and the vertical rhythm between sections.
 */
export function Page({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto flex w-full flex-col gap-7 px-4 pt-5 pb-10 lg:px-8 lg:pt-8', wide ? 'max-w-5xl' : 'max-w-3xl', className)}>{children}</div>;
}

/** Title, an optional line under it, and the page's main actions on the right (they wrap under the title on a phone). */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight lg:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled block of a page. `action` sits on the title's line (a small button or link). */
export function Section({ title, description, action, children, className }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      {(title || action) && (
        <div className="flex min-h-9 items-center justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold leading-tight">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
