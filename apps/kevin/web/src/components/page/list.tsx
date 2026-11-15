import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/** The container for rows: one bordered surface with hairlines between rows. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('divide-y overflow-hidden rounded-xl border bg-card', className)}>{children}</ul>;
}

export interface ListRowProps {
  title: ReactNode;
  /** Second line, muted. Wraps to two lines at most unless `wrap` is set. */
  subtitle?: ReactNode;
  /** Right-aligned short value: an amount, a date, a count. */
  meta?: ReactNode;
  /** Icon or thumbnail before the text. */
  leading?: ReactNode;
  /** Controls after the text: a switch, a menu button. Clicks here do not trigger the row. */
  trailing?: ReactNode;
  /** Makes the whole row a link … */
  to?: string;
  /** … or a button. A chevron is shown for either unless `trailing` is given. */
  onClick?: () => void;
  /** Dim the row (done, disabled, read). */
  muted?: boolean;
  /** Let the subtitle run as long as it needs. */
  wrap?: boolean;
  className?: string;
}

/** One row of a List. At least 56px tall so it is easy to hit with a thumb. */
export function ListRow({ title, subtitle, meta, leading, trailing, to, onClick, muted, wrap, className }: ListRowProps) {
  const interactive = !!to || !!onClick;
  const body = (
    <>
      {leading && <span className="grid shrink-0 place-items-center text-muted-foreground [&_svg]:size-5">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn('block font-medium leading-snug', muted && 'font-normal text-muted-foreground')}>{title}</span>
        {subtitle && <span className={cn('mt-0.5 block text-sm text-muted-foreground', !wrap && 'line-clamp-2')}>{subtitle}</span>}
      </span>
      {meta && <span className="tabular shrink-0 text-right text-sm text-muted-foreground">{meta}</span>}
      {interactive && !trailing && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />}
    </>
  );
  const main = 'flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left';
  return (
    <li className={cn('flex items-stretch', className)}>
      {to ? (
        <Link to={to} className={cn(main, 'hover:bg-muted active:bg-secondary')}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(main, 'hover:bg-muted active:bg-secondary')}>
          {body}
        </button>
      ) : (
        <div className={main}>{body}</div>
      )}
      {trailing && <div className="flex shrink-0 items-center gap-1 pr-2.5">{trailing}</div>}
    </li>
  );
}
