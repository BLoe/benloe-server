import { Landmark, Plus, Upload } from 'lucide-react';
import { AskKevin, EmptyState, List, ListRow, Meter, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money, plural, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useView } from '@/lib/useView';
import { budgetNote, dayLabel, monthLabel, ordinal, STATUS_LABELS } from './logic';
import { Panel, Stat, useMoney } from './shared';
import type { OverviewView } from './types';

export function Overview() {
  const { go, openImport, openNewAccount, today } = useMoney();
  const view = useView<OverviewView>('money/overview');
  const now = useNow();
  return (
    <ViewState view={view}>
      {(o) => {
        if (o.accounts.length === 0 && o.transaction_count === 0) {
          return (
            <EmptyState
              icon={Landmark}
              title="Start with an account or a bank export"
              body="Add the accounts you have and their balances, or import a CSV downloaded from your bank and the account is made for you."
              action={
                <>
                  <Button onClick={openNewAccount}>
                    <Plus />
                    Add an account
                  </Button>
                  <Button variant="outline" onClick={openImport}>
                    <Upload />
                    Import a CSV
                  </Button>
                  <AskKevin prompt="Help me set up my money: " prefill variant="ghost">
                    or tell Kevin
                  </AskKevin>
                </>
              }
            />
          );
        }
        const thisYear = today.slice(0, 4);
        const nw = o.net_worth;
        const diff = o.this_month.spent - o.last_month.spent_by_same_day;
        const lastName = monthLabel(o.last_month.month, { thisYear });
        const compare =
          o.last_month.spent_by_same_day <= 0 ? null
          : Math.abs(diff) < 1 ? `Level with ${lastName} by the ${ordinal(o.this_month.day_of_month)}`
          : `${money(Math.abs(diff), { cents: false })} ${diff > 0 ? 'more' : 'less'} than ${lastName} by the ${ordinal(o.this_month.day_of_month)} (${money(o.last_month.spent_by_same_day, { cents: false })})`;
        const attention = o.budgets.attention;
        return (
          <div className="flex flex-col gap-7">
            <div className="grid gap-3 @2xl/page:grid-cols-2">
              <Panel>
                <Stat size="lg" label="Net worth" value={money(nw.net_worth, { cents: false })} sub={nw.as_of ? `Balances as of ${dayLabel(nw.as_of, today)}` : 'No balances set yet'} />
                <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
                  <Stat label="Assets" value={money(nw.assets, { cents: false })} />
                  <Stat label="Owed" value={money(nw.liabilities, { cents: false })} />
                </div>
                <Button variant="link" className="mt-2 h-9 px-0" onClick={() => go('accounts')}>
                  Accounts and balances
                </Button>
              </Panel>
              <Panel>
                <Stat size="lg" label={`Spent in ${monthLabel(o.month, { thisYear })}`} value={money(o.this_month.spent, { cents: false })} sub={compare} />
                <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
                  <Stat label="Income" value={money(o.this_month.income, { cents: false })} />
                  <Stat label={`${lastName} in full`} value={money(o.last_month.spent, { cents: false })} />
                </div>
                <Button variant="link" className="mt-2 h-9 px-0" onClick={() => go('spending')}>
                  Where it went
                </Button>
              </Panel>
            </div>

            {(o.uncategorized_count > 0 || attention.length > 0) && (
              <Section title="Needs attention">
                <List>
                  {o.uncategorized_count > 0 && (
                    <ListRow
                      onClick={() => go('transactions', { category: 'uncategorized' })}
                      title={`${plural(o.uncategorized_count, 'transaction')} without a category`}
                      subtitle="They count as spending but belong to no budget."
                      meta="Fix"
                    />
                  )}
                  {attention.map((b) => (
                    <ListRow
                      key={b.category}
                      onClick={() => go('budgets')}
                      title={
                        <span className="flex items-center gap-2">
                          <span className="truncate">{b.label}</span>
                          <Badge variant={b.status === 'over' ? 'danger' : 'warning'}>{STATUS_LABELS[b.status]}</Badge>
                        </span>
                      }
                      subtitle={`${money(b.spent, { cents: false })} of ${money(b.monthly_amount, { cents: false })}, ${budgetNote(b, true)}`}
                    />
                  ))}
                </List>
              </Section>
            )}

            <Section
              title="Top categories this month"
              action={
                o.budgets.totals.budget > 0 ? (
                  <span className="tabular text-sm text-muted-foreground">
                    Budgets: {money(o.budgets.totals.spent, { cents: false })} of {money(o.budgets.totals.budget, { cents: false })}
                  </span>
                ) : undefined
              }
            >
              {o.top_categories.length === 0 ? (
                <EmptyState title="No spending recorded this month" body="Import this month's transactions to see where the money is going." action={<Button variant="outline" onClick={openImport}>Import a CSV</Button>} />
              ) : (
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {o.top_categories.map((c) => (
                    <li key={c.category}>
                      <button type="button" className="block min-h-14 w-full px-4 py-2.5 text-left hover:bg-muted active:bg-secondary" onClick={() => go('transactions', { category: c.category, month: o.month, transfers: 'exclude' })}>
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">{c.label}</span>
                          <span className="tabular shrink-0">
                            {money(c.spent, { cents: false })}
                            {c.budget != null && <span className="text-muted-foreground"> of {money(c.budget, { cents: false })}</span>}
                          </span>
                        </span>
                        {c.budget != null ? (
                          <Meter value={c.spent} max={c.budget} tone={c.spent > c.budget ? 'danger' : c.spent >= c.budget * 0.9 ? 'warning' : 'primary'} className="mt-2 h-1.5" label={`${c.label} against its budget`} />
                        ) : (
                          <span className="mt-0.5 block text-sm text-muted-foreground">{plural(c.count, 'transaction')}, no budget</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Last import">
              {o.last_import ? (
                <List>
                  <ListRow
                    onClick={() => go('imports')}
                    title={<span className="block truncate">{o.last_import.filename}</span>}
                    subtitle={`${o.last_import.account}, ${relativeTime(o.last_import.imported_at, now)}`}
                    meta={`${plural(o.last_import.inserted_count, 'transaction')}`}
                  />
                </List>
              ) : (
                <EmptyState title="Nothing imported yet" body="Download a CSV from your bank's website and import it here." action={<Button variant="outline" onClick={openImport}>Import a CSV</Button>} />
              )}
            </Section>

            <div className="flex flex-wrap gap-2">
              <AskKevin prompt={`Why was ${lastName} spending what it was? Compare it with the months before.`} size="sm">
                Explain {lastName}
              </AskKevin>
              <AskKevin prompt="Can I afford " prefill size="sm">
                Can I afford…
              </AskKevin>
              <AskKevin prompt="What subscriptions am I paying for, and which could I cancel?" size="sm">
                Review subscriptions
              </AskKevin>
            </div>
          </div>
        );
      }}
    </ViewState>
  );
}
