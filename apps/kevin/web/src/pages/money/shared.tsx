// Pieces every Money tab uses: the page's shared data and navigation, the
// grouped category picker, the month switcher, signed amounts and small cards.
import { Check, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { addMonths, groupCategories, monthLabel, signedMoney, type Tab, type TxFilter } from './logic';
import type { AccountDetail, Category, Rule } from './types';

export interface MoneyData {
  /** Today in Ben's time zone, YYYY-MM-DD. */
  today: string;
  categories: Category[];
  groups: string[];
  rules: Rule[];
  /** Transactions with no category, across all time. */
  uncategorizedCount: number;
  /** Every account, closed ones included. */
  accounts: AccountDetail[];
  /** Switch tab; with a filter, open Transactions on it. */
  go: (tab: Tab, filter?: Partial<TxFilter>) => void;
  openImport: () => void;
  openNewAccount: () => void;
}

const Ctx = createContext<MoneyData | null>(null);
export const MoneyProvider = Ctx.Provider;
export function useMoney(): MoneyData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMoney outside the Money page');
  return v;
}

/** A transaction amount: the sign is written out and money in is green. Spending stays in the text colour; a page of red is noise. */
export function Amount({ value, cents, className }: { value: number; cents?: boolean; className?: string }) {
  return <span className={cn('tabular whitespace-nowrap', value > 0 && 'text-primary', className)}>{signedMoney(value, { cents })}</span>;
}

/** A plain card surface. */
export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border bg-card p-4', className)} {...props} />;
}

/** A labelled figure: the label above, the number large, an optional line under it. */
export function Stat({ label, value, sub, className, size = 'md' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; size?: 'md' | 'lg' }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn('tabular mt-0.5 leading-tight font-semibold tracking-tight', size === 'lg' ? 'text-[28px]' : 'text-xl')}>{value}</div>
      {sub && <div className="mt-0.5 text-sm text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Categories as a native select grouped by group: the platform picker is the right one on a phone. */
export function CategorySelect({ value, onChange, none, spendingOnly = false, exclude, extra, ...props }: {
  value: string;
  onChange: (v: string) => void;
  /** Label of the empty choice ("Uncategorized", "All categories"); left out, there is no empty choice. */
  none?: string;
  /** Only categories a budget can be set on. */
  spendingOnly?: boolean;
  exclude?: string[];
  /** Options after the empty choice and before the groups. */
  extra?: { value: string; label: string }[];
} & Omit<ComponentProps<typeof Select>, 'value' | 'onChange'>) {
  const { categories, groups } = useMoney();
  const usable = categories.filter((c) => !exclude?.includes(c.name) && (!spendingOnly || (c.group !== 'income' && c.group !== 'transfers')));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {none !== undefined && <option value="">{none}</option>}
      {extra?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {groupCategories(usable, groups).map((g) => (
        <optgroup key={g.group} label={g.label}>
          {g.categories.map((c) => (
            <option key={c.name} value={c.name}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** Previous month, the month's name, next month. The next button stops at `max`. */
export function MonthSwitcher({ month, onChange, max, thisYear }: { month: string; onChange: (m: string) => void; max: string; thisYear: string }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft />
      </Button>
      <span className="min-w-28 text-center text-sm font-medium">{monthLabel(month, { thisYear })}</span>
      <Button variant="outline" size="icon-sm" aria-label="Next month" disabled={month >= max} onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight />
      </Button>
    </div>
  );
}

/** A dollar field: the $ sits inside, the keyboard is numeric. */
export function DollarInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>
      <Input inputMode="decimal" autoComplete="off" className={cn('tabular pl-7', className)} {...props} />
    </div>
  );
}

/** The "…" button at the end of a row with its menu. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A square checkbox mark (the control itself is the row or label around it). */
export function CheckMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('grid size-5 shrink-0 place-items-center rounded-[5px] border', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card', className)}>
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );
}

/** A checkbox with its label, tall enough to tap. */
export function CheckRow({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center gap-3 lg:min-h-9', disabled && 'cursor-default opacity-50')}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <CheckMark checked={checked} className="peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40" />
      <span className="min-w-0 text-sm">{children}</span>
    </label>
  );
}

/** A reason a form cannot be saved, shown in the form. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
