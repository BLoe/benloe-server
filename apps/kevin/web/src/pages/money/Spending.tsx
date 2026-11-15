import { useState } from 'react';
import { AskKevin, EmptyState, List, ListRow, Meter, Section, ViewState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { money, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { MonthBars } from './charts';
import { monthLabel, percent } from './logic';
import { MonthSwitcher, Panel, Stat, useMoney } from './shared';
import type { SpendingView } from './types';

export function Spending() {
  const { today, go, openImport } = useMoney();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const view = useView<SpendingView>('money/spending', { month, months: 6 });
  const thisYear = today.slice(0, 4);
  const name = monthLabel(month, { thisYear });
  return (
    <div className="flex flex-col gap-5">
      <MonthSwitcher month={month} onChange={setMonth} max={current} thisYear={thisYear} />
      <ViewState view={view}>
        {(s) => (
          <>
            <Panel>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Spent" value={money(s.total, { cents: false })} />
                <Stat label="Income" value={money(s.income, { cents: false })} />
                <Stat label="Net" value={<span className={s.net < 0 ? 'text-destructive' : undefined}>{money(s.net, { cents: false })}</span>} />
              </div>
              <div className="mt-4 border-t pt-4">
                <MonthBars series={s.series} selected={s.month} onSelect={setMonth} thisYear={thisYear} />
              </div>
            </Panel>

            <Section
              title={`By category in ${name}`}
              action={
                <AskKevin prompt={`Why was ${monthLabel(month)} spending what it was? Compare it with the months before.`} size="sm">
                  Ask why
                </AskKevin>
              }
            >
              {s.by_category.length === 0 ? (
                <EmptyState title={`No spending recorded in ${name}`} body="Import that month's transactions to see where the money went." action={<Button variant="outline" onClick={openImport}>Import a CSV</Button>} />
              ) : (
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {s.by_category.map((c) => (
                    <li key={c.category}>
                      <button type="button" className="block min-h-14 w-full px-4 py-2.5 text-left hover:bg-muted active:bg-secondary" onClick={() => go('transactions', { category: c.category, month, transfers: 'exclude' })}>
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">{c.label}</span>
                          <span className="tabular shrink-0">{money(c.spent, { cents: false })}</span>
                        </span>
                        <span className="mt-1.5 flex items-center gap-3">
                          <Meter value={Math.max(0, c.spent)} max={Math.max(s.by_category[0]!.spent, 1)} className="h-1.5 flex-1" label={`${c.label} share of spending`} />
                          <span className="tabular w-36 shrink-0 text-right text-xs text-muted-foreground">
                            {percent(c.share)} · {plural(c.count, 'charge')}
                            {c.budget != null ? ` · of ${money(c.budget, { cents: false })}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {s.top_merchants.length > 0 && (
              <Section title="Top merchants">
                <List>
                  {s.top_merchants.map((m) => (
                    <ListRow key={m.merchant} onClick={() => go('transactions', { q: m.merchant, month })} title={<span className="block truncate">{m.merchant}</span>} subtitle={plural(m.count, 'charge')} meta={<span className="text-foreground">{money(m.spent, { cents: false })}</span>} />
                  ))}
                </List>
              </Section>
            )}
          </>
        )}
      </ViewState>
    </div>
  );
}
