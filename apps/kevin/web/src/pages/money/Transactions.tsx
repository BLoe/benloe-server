import { ListChecks, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AskKevin, Chips, ConfirmDialog, EmptyState, ErrorState, Field, FieldRow, FormDialog, LoadingRows } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAct } from '@/lib/act';
import { plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import {
  activeFilterCount, dayLabel, distinctMerchants, draftOfTx, EMPTY_FILTER, filterFromSearch, isTransferCategory, MAX_RULE_MERCHANTS, MAX_WINDOW, monthLabel, newTxInput, nextPage, PAGE_SIZE,
  recentMonths, searchFor, signedMoney, txQuery, txUpdate, withTransfer, type NewTxDraft, type TxFilter,
} from './logic';
import { Amount, CategorySelect, CheckMark, CheckRow, DollarInput, FormError, useMoney } from './shared';
import type { TransactionsView, Tx } from './types';

export function Transactions() {
  const { accounts, today, openImport } = useMoney();
  const [params, setParams] = useSearchParams();
  const filter = filterFromSearch(params);
  const filterKey = JSON.stringify(filter);

  // The list grows by pages; a changed filter starts again from the top.
  const [paging, setPaging] = useState({ key: filterKey, shown: PAGE_SIZE, offset: 0 });
  const page = paging.key === filterKey ? paging : { key: filterKey, shown: PAGE_SIZE, offset: 0 };
  const view = useView<TransactionsView>('money/transactions', txQuery(filter, page.shown, page.offset));
  // While the next page or a new filter loads, the previous answer stays on screen.
  const last = useRef<TransactionsView | undefined>(undefined);
  if (view.data) last.current = view.data;
  const data = view.data ?? last.current;
  const stale = !view.data && !!data;

  const setFilter = (patch: Partial<TxFilter>) => setParams(searchFor('transactions', { ...filter, ...patch }), { replace: true });

  // The search box types locally and reaches the URL (and the server) after a pause.
  const [q, setQ] = useState(filter.q);
  const urlQ = useRef(filter.q);
  if (urlQ.current !== filter.q) {
    urlQ.current = filter.q;
    if (q.trim() !== filter.q) setQ(filter.q);
  }
  useEffect(() => {
    if (q.trim() === filter.q) return;
    const t = setTimeout(() => setFilter({ q: q.trim() }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const [open, setOpen] = useState<Tx | null>(null);
  const [adding, setAdding] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<'categorize' | 'delete' | null>(null);
  const { run, pending } = useAct();

  const rows = data?.rows ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));
  const more = data ? nextPage(page.shown, page.offset, data.total) : null;
  const grow = () => more && setPaging({ key: filterKey, ...more });

  // Reaching the end of the list loads the next page; the button below does the same by hand.
  const sentinel = useRef<HTMLDivElement>(null);
  const growRef = useRef(grow);
  growRef.current = grow;
  const canAuto = !!more && !stale && page.shown < MAX_WINDOW;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canAuto) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && growRef.current(), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [canAuto, rows.length]);

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const months = recentMonths(today.slice(0, 7), 24);
  if (filter.month && !months.includes(filter.month)) months.push(filter.month);
  const thisYear = today.slice(0, 4);
  const filtered = activeFilterCount(filter) > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant or description" aria-label="Search transactions" enterKeyHint="search" className="pr-9 pl-9" />
          {q && (
            <button type="button" aria-label="Clear search" className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground" onClick={() => setQ('')}>
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button onClick={() => setAdding(true)} aria-label="Add a transaction" className="px-3 @lg/page:px-4">
          <Plus />
          <span className="hidden @lg/page:inline">Add</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 @2xl/page:grid-cols-4">
        <Select aria-label="Account" value={filter.account} onChange={(e) => setFilter({ account: e.target.value })}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name}
              {a.active ? '' : ' (closed)'}
            </option>
          ))}
        </Select>
        <CategorySelect aria-label="Category" value={filter.category} onChange={(category) => setFilter({ category })} none="All categories" extra={[{ value: 'uncategorized', label: 'Uncategorized' }]} />
        <Select aria-label="Month" value={filter.month} onChange={(e) => setFilter({ month: e.target.value })}>
          <option value="">All time</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, { thisYear })}
            </option>
          ))}
        </Select>
        <Select aria-label="Transfers" value={filter.transfers} onChange={(e) => setFilter({ transfers: e.target.value as TxFilter['transfers'] })}>
          <option value="">With transfers</option>
          <option value="exclude">Without transfers</option>
          <option value="only">Transfers only</option>
        </Select>
      </div>

      {filter.batch && (
        <div>
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-sm" onClick={() => setFilter({ batch: '' })}>
            From import #{filter.batch}
            <X className="size-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {data && (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="tabular text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{plural(data.total, 'transaction')}</span>
            {data.total > 0 && (
              <>
                <span className="mx-1.5">·</span>in {signedMoney(data.sum_in, { cents: false })}
                <span className="mx-1.5">·</span>out {signedMoney(data.sum_out, { cents: false })}
                <span className="mx-1.5">·</span>net {signedMoney(data.sum, { cents: false })}
              </>
            )}
          </p>
          <div className="flex items-center gap-1">
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => setParams(searchFor('transactions', EMPTY_FILTER), { replace: true })}>
                Clear filters
              </Button>
            )}
            {data.total > 0 && (
              <Button variant={selecting ? 'secondary' : 'ghost'} size="sm" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
                <ListChecks />
                {selecting ? 'Done' : 'Select'}
              </Button>
            )}
          </div>
        </div>
      )}

      {!data ? (
        view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={6} />
      ) : data.total === 0 ? (
        filtered ? (
          <EmptyState title="Nothing matches" body="No transactions fit these filters." action={<Button variant="outline" onClick={() => setParams(searchFor('transactions', EMPTY_FILTER), { replace: true })}>Clear filters</Button>} />
        ) : (
          <EmptyState
            title="No transactions yet"
            body="Import a CSV from your bank, add one by hand, or tell Kevin what you spent."
            action={
              <>
                <Button onClick={openImport}>Import a CSV</Button>
                <Button variant="outline" onClick={() => setAdding(true)}>
                  Add one by hand
                </Button>
                <AskKevin prompt="I spent " prefill variant="ghost">
                  Tell Kevin
                </AskKevin>
              </>
            }
          />
        )
      ) : (
        <>
          {page.offset > 0 && (
            <Button variant="outline" onClick={() => setPaging({ key: filterKey, shown: MAX_WINDOW, offset: Math.max(0, page.offset - MAX_WINDOW) })}>
              Show the {MAX_WINDOW} before these
            </Button>
          )}
          <ul className={cn('divide-y overflow-hidden rounded-xl border bg-card transition-opacity', stale && 'opacity-60')}>
            {rows.map((t) => (
              <TxRow key={t.id} t={t} today={today} selecting={selecting} selected={selected.has(t.id)} onClick={() => (selecting ? toggle(t.id) : setOpen(t))} />
            ))}
          </ul>
          <div ref={sentinel} />
          {more ? (
            <Button variant="outline" onClick={grow} disabled={stale}>
              {stale ? 'Loading…' : page.shown < MAX_WINDOW ? `Show more (${(data.total - page.offset - rows.length).toLocaleString('en-US')} left)` : `Show the next ${Math.min(MAX_WINDOW, data.total - page.offset - rows.length)}`}
            </Button>
          ) : (
            data.total > PAGE_SIZE && <p className="py-1 text-center text-sm text-muted-foreground">That is all {data.total.toLocaleString('en-US')}.</p>
          )}
        </>
      )}

      {selecting && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-popover p-2 pl-4 shadow-lg">
          <span className="tabular mr-auto text-sm font-medium">{chosen.length} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(chosen.length === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
            {chosen.length === rows.length ? 'None' : 'All shown'}
          </Button>
          <Button size="sm" disabled={!chosen.length || pending} onClick={() => setBulk('categorize')}>
            Categorize
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Delete the selected transactions" disabled={!chosen.length || pending} onClick={() => setBulk('delete')}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      )}

      {open && <TransactionSheet t={open} onClose={() => setOpen(null)} />}
      {adding && <AddTransaction onClose={() => setAdding(false)} defaultAccount={filter.account} />}
      {bulk === 'categorize' && (
        <BulkCategorize
          rows={chosen}
          onClose={(done) => {
            setBulk(null);
            if (done) stopSelecting();
          }}
        />
      )}
      <ConfirmDialog
        open={bulk === 'delete'}
        onOpenChange={(o) => !o && setBulk(null)}
        title={`Delete ${plural(chosen.length, 'transaction')}?`}
        body={`Net ${signedMoney(chosen.reduce((s, r) => s + r.amount, 0))}. They are removed for good; importing the same file again would bring them back.`}
        confirmLabel={`Delete ${chosen.length}`}
        onConfirm={() =>
          void run('money_transactions_update', { delete: { ids: chosen.map((r) => r.id) } }, { success: `Deleted ${plural(chosen.length, 'transaction')}` }).then((r) => {
            setBulk(null);
            if (r.ok) stopSelecting();
          })
        }
      />
    </div>
  );
}

function TxRow({ t, today, selecting, selected, onClick }: { t: Tx; today: string; selecting: boolean; selected: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} aria-pressed={selecting ? selected : undefined} className={cn('flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary', selected && 'bg-accent/60')}>
        {selecting && <CheckMark checked={selected} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{t.merchant}</span>
            {t.pending && <Badge variant="outline">Pending</Badge>}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span className="shrink-0">{dayLabel(t.date, today)}</span>
            <span aria-hidden>·</span>
            {t.category ? <span className="shrink-0">{t.category_label ?? t.category}</span> : <span className="shrink-0 font-medium text-warning">Uncategorized</span>}
            <span aria-hidden>·</span>
            <span className="truncate">{t.account}</span>
          </span>
        </span>
        <Amount value={t.amount} className={cn('shrink-0 font-medium', t.is_transfer && 'font-normal text-muted-foreground')} />
      </button>
    </li>
  );
}

/** One transaction: recategorize, mark as a transfer, fix the merchant, add a note, make it a rule, delete. */
function TransactionSheet({ t, onClose }: { t: Tx; onClose: () => void }) {
  const { categories, today } = useMoney();
  const [d, setD] = useState(() => draftOfTx(t));
  const [deleting, setDeleting] = useState(false);
  const { run, pending } = useAct();
  const transfer = isTransferCategory(categories, d.category);
  const save = async () => {
    const update = txUpdate(t, d);
    if (!update) return onClose();
    const r = await run('money_transactions_update', { update: [update] }, { success: update.make_rule ? 'Saved, and a rule was added' : 'Saved' });
    if (r.ok) onClose();
  };
  return (
    <>
      <FormDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title="Transaction"
        pending={pending}
        canSubmit={d.merchant.trim().length > 0}
        onSubmit={() => void save()}
        extraAction={
          <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={() => setDeleting(true)}>
            <Trash2 />
            Delete
          </Button>
        }
      >
        <div className="rounded-lg bg-muted px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <Amount value={t.amount} className="text-xl font-semibold" />
            <span className="text-sm text-muted-foreground">{dayLabel(t.date, today)}</span>
          </div>
          <p className="mt-1 text-sm break-words text-muted-foreground">{t.description}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.account}
            {t.pending ? ', pending' : ''}
            {t.categorized_by === 'rule' ? ', categorized by a rule' : t.categorized_by === 'bank' ? ', categorized by the bank' : t.categorized_by === 'manual' ? ', categorized by hand' : ''}
          </p>
        </div>
        <Field label="Category">{(id) => <CategorySelect id={id} value={d.category} onChange={(category) => setD({ ...d, category, makeRule: category ? d.makeRule : false })} none="Uncategorized" />}</Field>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <label htmlFor="tx-transfer" className="min-w-0">
            <span className="block text-sm font-medium">Transfer</span>
            <span className="block text-sm text-muted-foreground">Between your own accounts or a card payment; not spending or income.</span>
          </label>
          <Switch id="tx-transfer" checked={transfer} onCheckedChange={(on) => setD({ ...d, category: withTransfer(categories, d.category, on) })} />
        </div>
        <Field label="Merchant">{(id) => <Input id={id} value={d.merchant} maxLength={80} onChange={(e) => setD({ ...d, merchant: e.target.value })} />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={d.notes} maxLength={1000} onChange={(e) => setD({ ...d, notes: e.target.value })} />}</Field>
        <CheckRow checked={d.makeRule} disabled={!d.category} onChange={(makeRule) => setD({ ...d, makeRule })}>
          Always categorize <span className="font-medium">{t.merchant}</span> this way
        </CheckRow>
      </FormDialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this transaction?"
        body={`${t.merchant}, ${signedMoney(t.amount)} on ${dayLabel(t.date, today)}.`}
        onConfirm={() => void run('money_transactions_update', { delete: { ids: [t.id] } }, { success: 'Deleted' }).then((r) => r.ok && onClose())}
      />
    </>
  );
}

function BulkCategorize({ rows, onClose }: { rows: Tx[]; onClose: (done: boolean) => void }) {
  const [category, setCategory] = useState('');
  const [makeRule, setMakeRule] = useState(false);
  const { run, pending } = useAct();
  const merchants = distinctMerchants(rows);
  const ruleOk = merchants.length <= MAX_RULE_MERCHANTS;
  const submit = async () => {
    const rule = makeRule && ruleOk && category !== '-';
    const r = await run(
      'money_transactions_update',
      { update: [{ ids: rows.map((x) => x.id), set: { category: category === '-' ? null : category }, ...(rule ? { make_rule: true } : {}) }] },
      { success: `Recategorized ${plural(rows.length, 'transaction')}` },
    );
    if (r.ok) onClose(true);
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose(false)} title={`Categorize ${plural(rows.length, 'transaction')}`} submitLabel="Apply" pending={pending} canSubmit={!!category} onSubmit={() => void submit()}>
      <Field label="Category">{(id) => <CategorySelect id={id} value={category} onChange={setCategory} none="Choose a category" extra={[{ value: '-', label: 'Uncategorized (clear)' }]} />}</Field>
      <CheckRow checked={makeRule && ruleOk && category !== '-'} disabled={!ruleOk || !category || category === '-'} onChange={setMakeRule}>
        {ruleOk ? `Always categorize ${merchants.length === 1 ? 'this merchant' : `these ${merchants.length} merchants`} this way` : `Too many different merchants (${merchants.length}) to make rules from`}
      </CheckRow>
    </FormDialog>
  );
}

function AddTransaction({ onClose, defaultAccount }: { onClose: () => void; defaultAccount: string }) {
  const { accounts, today, openNewAccount } = useMoney();
  const open = accounts.filter((a) => a.active);
  const [d, setD] = useState<NewTxDraft>({ account: open.some((a) => String(a.id) === defaultAccount) ? defaultAccount : open.length === 1 ? String(open[0]!.id) : '', date: today, direction: 'out', amount: '', description: '', category: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();
  const submit = async () => {
    const r = newTxInput(d);
    if ('error' in r) return setError(r.error);
    setError(null);
    const res = await run('money_transactions_update', { add: [r.input] }, { success: 'Added' });
    if (res.ok) onClose();
  };
  if (!open.length) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title="Add an account first"
        body="A transaction belongs to an account. Add one (a Cash account works for cash spending), then come back."
        confirmLabel="Add an account"
        destructive={false}
        onConfirm={() => {
          onClose();
          openNewAccount();
        }}
      />
    );
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Add a transaction" submitLabel="Add" pending={pending} onSubmit={() => void submit()}>
      <Chips value={d.direction} onChange={(direction) => setD({ ...d, direction })} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} className="mx-0 px-0" />
      <FieldRow>
        <Field label="Amount">{(id) => <DollarInput id={id} value={d.amount} placeholder="0.00" onChange={(e) => setD({ ...d, amount: e.target.value })} autoFocus />}</Field>
        <Field label="Date">{(id) => <Input id={id} type="date" value={d.date} max={today} onChange={(e) => setD({ ...d, date: e.target.value })} />}</Field>
      </FieldRow>
      <Field label="What it was">{(id) => <Input id={id} value={d.description} maxLength={300} placeholder="Farmers market" onChange={(e) => setD({ ...d, description: e.target.value })} />}</Field>
      <FieldRow>
        <Field label="Account">
          {(id) => (
            <Select id={id} value={d.account} onChange={(e) => setD({ ...d, account: e.target.value })}>
              <option value="">Choose…</option>
              {open.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Category">{(id) => <CategorySelect id={id} value={d.category} onChange={(category) => setD({ ...d, category })} none="Let the rules choose" />}</Field>
      </FieldRow>
      <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={d.notes} maxLength={1000} onChange={(e) => setD({ ...d, notes: e.target.value })} />}</Field>
      <FormError>{error}</FormError>
    </FormDialog>
  );
}
