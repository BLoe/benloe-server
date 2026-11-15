import { Repeat } from 'lucide-react';
import { AskKevin, EmptyState, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { money, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { dayLabel, daysBetween } from './logic';
import { Panel, Stat, useMoney } from './shared';
import type { RecurringItem, RecurringView } from './types';

/** Charges that repeat about monthly, found in the last six months of transactions. */
export function Recurring() {
  const { today, categories, go } = useMoney();
  const view = useView<RecurringView>('money/recurring');
  const label = (c: string | null) => (c ? (categories.find((x) => x.name === c)?.label ?? c) : 'Uncategorized');

  const row = (i: RecurringItem) => {
    const due = daysBetween(today, i.next_expected);
    return (
      <li key={`${i.merchant}|${i.account}`}>
        <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary" onClick={() => go('transactions', { q: i.merchant })}>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cn('truncate font-medium', !i.active && 'font-normal text-muted-foreground')}>{i.merchant}</span>
              {i.active && due >= 0 && due <= 3 && <Badge variant="warning">{due === 0 ? 'Due today' : `In ${plural(due, 'day')}`}</Badge>}
            </span>
            <span className="mt-0.5 block truncate text-sm text-muted-foreground">
              {label(i.category)} · {i.account}
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {i.active ? `Next around ${dayLabel(i.next_expected, today)}` : `Last charged ${dayLabel(i.last_date, today)}; probably cancelled`}
              {i.active && Math.abs(i.last_amount - i.typical_amount) >= 0.01 ? `, last was ${money(i.last_amount)}` : ''}
            </span>
          </span>
          <span className="tabular shrink-0 text-right">
            <span className={cn('block font-medium', !i.active && 'font-normal text-muted-foreground')}>{money(i.typical_amount)}/mo</span>
            <span className="block text-sm text-muted-foreground">{money(i.annual_cost, { cents: false })}/yr</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <ViewState
      view={view}
      isEmpty={(v) => v.items.length === 0}
      empty={<EmptyState icon={Repeat} title="No recurring charges found" body="Once a few months of transactions are imported, anything that charges about the same amount each month shows up here." />}
    >
      {(v) => {
        const active = v.items.filter((i) => i.active);
        const inactive = v.items.filter((i) => !i.active);
        return (
          <div className="flex flex-col gap-7">
            <Panel>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Each month" value={money(v.monthly_total, { cents: false })} sub={plural(active.length, 'charge')} />
                <Stat label="Each year" value={money(active.reduce((s, i) => s + i.annual_cost, 0), { cents: false })} />
                <Stat label="Subscriptions" value={money(v.subscriptions_monthly_total, { cents: false })} sub="per month" />
              </div>
              <AskKevin prompt="Look at my recurring charges. Which look forgotten or worth cancelling?" size="sm" className="mt-4">
                Which could I cancel?
              </AskKevin>
            </Panel>
            {active.length > 0 && (
              <Section title="Active" description={`Seen since ${dayLabel(v.since, today)}`}>
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">{active.map(row)}</ul>
              </Section>
            )}
            {inactive.length > 0 && (
              <Section title="Stopped" description="No charge in over 45 days past the expected date.">
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">{inactive.map(row)}</ul>
              </Section>
            )}
          </div>
        );
      }}
    </ViewState>
  );
}
