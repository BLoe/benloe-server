import { MessageCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { openChat } from '@/lib/chat';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

/** An amount with aligned digits. `signed` colours negatives; `cents={false}` rounds to dollars. */
export function Money({ amount, cents, signed, className }: { amount: number | null | undefined; cents?: boolean; signed?: boolean; className?: string }) {
  return <span className={cn('tabular', signed && amount != null && amount < 0 && 'text-destructive', className)}>{money(amount, { cents })}</span>;
}

/**
 * A button that opens the chat with a prepared message: "What can I make
 * tonight?". By default the message is sent at once in a new chat; pass
 * `prefill` to put it in the composer for editing instead.
 */
export function AskKevin({ prompt, prefill = false, children, ...props }: { prompt: string; prefill?: boolean; children?: ReactNode } & Omit<ComponentProps<typeof Button>, 'onClick'>) {
  return (
    <Button variant="outline" {...props} onClick={() => openChat(prefill ? { prefill: prompt } : { send: prompt, newThread: true })}>
      <MessageCircle />
      {children ?? prompt}
    </Button>
  );
}

/** Label/value pairs: details of one record. Label column on desktop, stacked on a phone. */
export function KeyValues({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('divide-y overflow-hidden rounded-xl border bg-card', className)}>
      {items.map((i) => (
        <div key={i.label} className="flex flex-col gap-0.5 px-4 py-2.5 @lg/page:flex-row @lg/page:items-baseline @lg/page:gap-4">
          <dt className="shrink-0 text-sm text-muted-foreground @lg/page:w-40">{i.label}</dt>
          <dd className="min-w-0 flex-1 break-words">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A horizontal meter: spend against a cap, a budget, progress to a goal. */
export function Meter({ value, max, tone = 'primary', className, label }: { value: number; max: number; tone?: 'primary' | 'warning' | 'danger'; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = tone === 'danger' ? 'bg-destructive' : tone === 'warning' ? 'bg-warning' : 'bg-primary';
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-label={label} className={cn('h-2 overflow-hidden rounded-full bg-secondary', className)}>
      <div className={cn('h-full rounded-full', fill)} style={{ width: `${pct}%`, minWidth: value > 0 ? 4 : 0 }} />
    </div>
  );
}

/** Choice chips: a filter over a list, or a small set of options in a form. Scrolls sideways on a phone. */
export function Chips<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="radiogroup" className={cn('-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors lg:h-8',
            o.value === value ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
