import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AskKevin, EmptyState, Field, FormDialog, List, ListRow, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAct } from '@/lib/act';
import { money } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { budgetBar, budgetNote, GROUP_LABELS, monthLabel, parseAmount, percent, STATUS_LABELS } from './logic';
import { CategorySelect, DollarInput, FormError, MonthSwitcher, Panel, Stat, useMoney } from './shared';
import type { BudgetItem, BudgetsView } from './types';

type Editing = { category: string; amount: number | null; label?: string } | null;

export function Budgets() {
  const { today, go, categories } = useMoney();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const view = useView<BudgetsView>('money/budgets', { month });
  const [editing, setEditing] = useState<Editing>(null);
  const thisYear = today.slice(0, 4);
  const budgetable = categories.filter((c) => c.group !== 'income' && c.group !== 'transfers' && c.budget == null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthSwitcher month={month} onChange={setMonth} max={current} thisYear={thisYear} />
        <Button size="sm" disabled={!budgetable.length} onClick={() => setEditing({ category: '', amount: null })}>
          <Plus />
          Add a budget
        </Button>
      </div>
      <ViewState view={view}>
        {(b) => (
          <>
            {b.items.length === 0 ? (
              <EmptyState
                title="No budgets yet"
                body="A budget is one monthly amount for a category. Set one for the categories you want to keep an eye on."
                action={
                  <>
                    <Button onClick={() => setEditing({ category: '', amount: null })}>Add a budget</Button>
                    <AskKevin prompt="Suggest monthly budgets from my last few months of spending." variant="ghost">
                      Ask Kevin to suggest some
                    </AskKevin>
                  </>
                }
              />
            ) : (
              <>
                <Panel>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Budgeted" value={money(b.totals.budget, { cents: false })} />
                    <Stat label="Spent" value={money(b.totals.spent, { cents: false })} sub={percent(b.totals.used)} />
                    <Stat label={b.totals.remaining < 0 ? 'Over' : 'Left'} value={<span className={b.totals.remaining < 0 ? 'text-destructive' : undefined}>{money(Math.abs(b.totals.remaining), { cents: false })}</span>} />
                  </div>
                  <BudgetBarView item={{ monthly_amount: b.totals.budget, spent: b.totals.spent, status: b.totals.spent > b.totals.budget ? 'over' : 'ok' }} elapsed={b.month_elapsed} current={b.is_current_month} label="All budgets" className="mt-4" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {b.is_current_month
                      ? `Day ${b.day_of_month} of ${b.days_in_month}: ${percent(b.month_elapsed)} of the month gone. The tick on each bar marks today.`
                      : `${monthLabel(b.month, { thisYear })} in full.`}
                  </p>
                </Panel>
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {b.items.map((i) => (
                    <li key={i.category}>
                      <button type="button" className="block w-full px-4 py-3 text-left hover:bg-muted active:bg-secondary" onClick={() => setEditing({ category: i.category, amount: i.monthly_amount, label: i.label })}>
                        <span className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{i.label}</span>
                            {i.status !== 'ok' && <Badge variant={i.status === 'over' ? 'danger' : 'warning'}>{STATUS_LABELS[i.status]}</Badge>}
                          </span>
                          <span className="tabular shrink-0">
                            {money(i.spent, { cents: false })}
                            <span className="text-muted-foreground"> of {money(i.monthly_amount, { cents: false })}</span>
                          </span>
                        </span>
                        <BudgetBarView item={i} elapsed={b.month_elapsed} current={b.is_current_month} label={i.label} className="mt-2" />
                        <span className={cn('tabular mt-1.5 block text-sm text-muted-foreground', i.status === 'over' && 'text-destructive')}>{budgetNote(i, b.is_current_month)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div>
                  <Button variant="link" className="h-9 px-0" onClick={() => go('transactions', { month, transfers: 'exclude' })}>
                    See {monthLabel(month, { thisYear })}'s transactions
                  </Button>
                </div>
              </>
            )}
            {b.unbudgeted.length > 0 && (
              <Section title="Spending without a budget" description={`${money(b.unbudgeted.reduce((s, u) => s + u.spent, 0), { cents: false })} in ${monthLabel(b.month, { thisYear })}`}>
                <List>
                  {b.unbudgeted.map((u) => (
                    <ListRow
                      key={u.category}
                      onClick={() => go('transactions', { category: u.category, month, transfers: 'exclude' })}
                      title={u.label}
                      subtitle={GROUP_LABELS[u.group] ?? u.group}
                      meta={money(u.spent, { cents: false })}
                      trailing={
                        u.category !== 'uncategorized' ? (
                          <Button variant="outline" size="sm" onClick={() => setEditing({ category: u.category, amount: null, label: u.label })}>
                            Add a budget
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => go('transactions', { category: 'uncategorized' })}>
                            Categorize
                          </Button>
                        )
                      }
                    />
                  ))}
                </List>
              </Section>
            )}
          </>
        )}
      </ViewState>
      {editing && <BudgetDialog editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The bar: filled to what is spent, a tick where today falls, and when over, a notch where the budget ended. */
function BudgetBarView({ item, elapsed, current, label, className }: { item: Pick<BudgetItem, 'monthly_amount' | 'spent' | 'status'>; elapsed: number; current: boolean; label: string; className?: string }) {
  const bar = budgetBar(item, elapsed, current);
  const fill = bar.tone === 'danger' ? 'bg-destructive' : bar.tone === 'warning' ? 'bg-warning' : 'bg-primary';
  return (
    <span role="meter" aria-label={`${label}: ${money(item.spent, { cents: false })} of ${money(item.monthly_amount, { cents: false })}`} aria-valuemin={0} aria-valuemax={item.monthly_amount} aria-valuenow={Math.min(item.spent, item.monthly_amount)} className={cn('relative block h-3', className)}>
      <span className="absolute inset-x-0 top-0.5 block h-2 overflow-hidden rounded-full bg-secondary">
        <span className={cn('block h-full rounded-full', fill)} style={{ width: `${bar.fillPct}%`, minWidth: item.spent > 0 ? 4 : 0 }} />
      </span>
      {bar.budgetPct != null && <span className="absolute top-0 block h-3 w-0.5 bg-card" style={{ left: `${bar.budgetPct}%` }} />}
      {bar.pacePct != null && <span className="absolute top-0 block h-3 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70" style={{ left: `${bar.pacePct}%` }} />}
    </span>
  );
}

function BudgetDialog({ editing, onClose }: { editing: NonNullable<Editing>; onClose: () => void }) {
  const { categories } = useMoney();
  const isNew = editing.amount == null;
  const [category, setCategory] = useState(editing.category);
  const [amount, setAmount] = useState(editing.amount != null ? String(editing.amount) : '');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();
  const taken = categories.filter((c) => c.budget != null).map((c) => c.name);
  const submit = async () => {
    const n = parseAmount(amount);
    if (!category) return setError('Choose a category.');
    if (n == null || n <= 0) return setError('Enter a monthly amount above zero.');
    const r = await run('money_budget_update', { budgets: [{ category, monthly_amount: n }] }, { success: 'Budget saved' });
    if (r.ok) onClose();
  };
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Add a budget' : `${editing.label ?? editing.category} budget`}
      description="One amount per calendar month, in force every month."
      submitLabel={isNew ? 'Add budget' : 'Save'}
      pending={pending}
      onSubmit={() => void submit()}
      extraAction={
        !isNew && (
          <Button variant="ghost" className="w-full text-destructive lg:w-auto" disabled={pending} onClick={() => void run('money_budget_update', { budgets: [{ category: editing.category, remove: true }] }, { success: 'Budget removed' }).then((r) => r.ok && onClose())}>
            <Trash2 />
            Remove budget
          </Button>
        )
      }
    >
      {isNew && !editing.category && <Field label="Category">{(id) => <CategorySelect id={id} value={category} onChange={setCategory} none="Choose a category" spendingOnly exclude={taken} />}</Field>}
      {isNew && editing.category && <p className="text-sm text-muted-foreground">For {editing.label ?? editing.category}.</p>}
      <Field label="Monthly amount">{(id) => <DollarInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
      <FormError>{error}</FormError>
    </FormDialog>
  );
}
