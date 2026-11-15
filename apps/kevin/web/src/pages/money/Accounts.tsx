import { Plus } from 'lucide-react';
import { useState } from 'react';
import { AskKevin, ConfirmDialog, EmptyState, Field, FieldRow, FormDialog, Section } from '@/components/page';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useAct } from '@/lib/act';
import { money, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { TrendLine } from './charts';
import { ACCOUNT_TYPE_LABELS, dayLabel, isDay, LIABILITY_TYPES, parseAmount, signedMoney } from './logic';
import { DollarInput, FormError, Panel, RowMenu, Stat, useMoney } from './shared';
import type { AccountDetail, NetWorthHistoryView } from './types';

export function Accounts() {
  const { accounts, today, go, openNewAccount, openImport } = useMoney();
  const history = useView<NetWorthHistoryView>('money/net_worth_history', { months: 24 });
  const [editing, setEditing] = useState<AccountDetail | null>(null);
  const [balancing, setBalancing] = useState<AccountDetail | null>(null);
  const [deleting, setDeleting] = useState<AccountDetail | null>(null);
  const { run, pending } = useAct();

  const active = accounts.filter((a) => a.active);
  const assets = active.filter((a) => !a.is_liability);
  const owed = active.filter((a) => a.is_liability);
  const closed = accounts.filter((a) => !a.active);
  const sum = (list: AccountDetail[]) => list.reduce((s, a) => s + (a.balance ?? 0), 0);

  if (!accounts.length) {
    return (
      <EmptyState
        title="No accounts yet"
        body="Add each account you want to track: checking, cards, loans, investments. Importing a CSV can also create the account for you."
        action={
          <>
            <Button onClick={openNewAccount}>
              <Plus />
              Add an account
            </Button>
            <Button variant="outline" onClick={openImport}>
              Import a CSV
            </Button>
            <AskKevin prompt="Add my accounts: " prefill variant="ghost">
              or tell Kevin
            </AskKevin>
          </>
        }
      />
    );
  }

  const row = (a: AccountDetail) => (
    <li key={a.id} className="flex items-stretch">
      <button type="button" className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary" onClick={() => setBalancing(a)}>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium', !a.active && 'font-normal text-muted-foreground')}>{a.name}</span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {[ACCOUNT_TYPE_LABELS[a.type] ?? a.type, a.institution, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="tabular shrink-0 text-right">
          {a.balance == null ? (
            <span className="text-sm text-primary">Set balance</span>
          ) : (
            <>
              <span className={cn('block font-medium', !a.active && 'font-normal text-muted-foreground')}>
                {money(a.balance)}
                {a.is_liability && <span className="font-normal text-muted-foreground"> owed</span>}
              </span>
              <span className="block text-sm text-muted-foreground">as of {dayLabel(a.balance_as_of, today)}</span>
            </>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center pr-2">
        <RowMenu label={`More for ${a.name}`}>
          <DropdownMenuItem onSelect={() => setBalancing(a)}>Set balance</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(a)}>Edit details</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('transactions', { account: String(a.id) })}>
            Transactions{a.transaction_count ? ` (${a.transaction_count.toLocaleString('en-US')})` : ''}
          </DropdownMenuItem>
          {a.holdings_count > 0 && <DropdownMenuItem onSelect={() => go('holdings')}>Holdings ({a.holdings_count})</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={pending} onSelect={() => void run('money_account_update', { accounts: [{ name: a.name, active: !a.active }] }, { success: a.active ? `${a.name} closed` : `${a.name} reopened` })}>
            {a.active ? 'Close account' : 'Reopen account'}
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => setDeleting(a)}>
            Delete…
          </DropdownMenuItem>
        </RowMenu>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-7">
      <Panel>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Net worth" value={money(sum(assets) - sum(owed), { cents: false })} />
          <Stat label="Assets" value={money(sum(assets), { cents: false })} />
          <Stat label="Owed" value={money(sum(owed), { cents: false })} />
        </div>
        {history.data && history.data.points.length >= 2 && (
          <div className="mt-4 border-t pt-4">
            {history.data.change && (
              <p className="tabular mb-3 text-sm text-muted-foreground">
                <span className={cn('font-medium', history.data.change.amount >= 0 ? 'text-primary' : 'text-destructive')}>{signedMoney(history.data.change.amount, { cents: false })}</span> since {dayLabel(history.data.change.from, today)}
              </p>
            )}
            <TrendLine points={history.data.points} today={today} />
          </div>
        )}
        {history.data && history.data.points.length < 2 && active.some((a) => a.balance != null) && (
          <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">The trend appears once balances have been recorded on more than one date. Each time you set a balance it is added to the history.</p>
        )}
      </Panel>

      <Section
        title="Assets"
        action={
          <Button size="sm" onClick={openNewAccount}>
            <Plus />
            Add an account
          </Button>
        }
      >
        {assets.length ? <ul className="divide-y overflow-hidden rounded-xl border bg-card">{assets.map(row)}</ul> : <p className="text-sm text-muted-foreground">No asset accounts.</p>}
      </Section>
      {owed.length > 0 && (
        <Section title="Owed" description="Cards, loans and mortgages. Balances are what you owe.">
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">{owed.map(row)}</ul>
        </Section>
      )}
      {closed.length > 0 && (
        <Section title="Closed" description="Kept for their history; left out of net worth.">
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">{closed.map(row)}</ul>
        </Section>
      )}

      {editing && <AccountDialog account={editing} onClose={() => setEditing(null)} />}
      {balancing && <BalanceDialog account={balancing} onClose={() => setBalancing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        body={
          deleting
            ? `This removes the account${deleting.transaction_count ? `, its ${plural(deleting.transaction_count, 'transaction')}` : ''}${deleting.holdings_count ? `, its ${plural(deleting.holdings_count, 'holding')}` : ''} and its balance history for good. To keep the history and drop it from net worth, close it instead.`
            : ''
        }
        confirmLabel="Delete account"
        onConfirm={() => {
          const a = deleting;
          setDeleting(null);
          if (a) void run('money_account_update', { accounts: [{ name: a.name, delete: true }] }, { success: `${a.name} deleted` });
        }}
      />
    </div>
  );
}

/** Add an account, or edit one's details. */
export function AccountDialog({ account, onClose }: { account: AccountDetail | null; onClose: () => void }) {
  const { accounts, today } = useMoney();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'checking');
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [last4, setLast4] = useState(account?.last4 ?? '');
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();
  const liability = LIABILITY_TYPES.has(type);

  const submit = async () => {
    const n = name.trim();
    if (!n) return setError('Give the account a name.');
    if (accounts.some((a) => a.id !== account?.id && a.name.toLowerCase() === n.toLowerCase())) return setError(`There is already an account named "${n}".`);
    if (last4 && !/^\d{4}$/.test(last4)) return setError('Last four is four digits.');
    const bal = balance.trim() ? parseAmount(balance) : null;
    if (balance.trim() && bal == null) return setError('The balance is not a number.');
    const input = {
      name: account?.name ?? n,
      ...(account && n !== account.name ? { rename_to: n } : {}),
      type,
      institution: institution.trim(),
      ...(last4 ? { last4 } : {}),
      notes: notes.trim(),
      ...(bal != null ? { balance: Math.abs(bal), balance_as_of: today } : {}),
    };
    const r = await run('money_account_update', { accounts: [input] }, { success: account ? 'Saved' : `${n} added` });
    if (r.ok) onClose();
  };

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={account ? 'Edit account' : 'Add an account'} submitLabel={account ? 'Save' : 'Add account'} pending={pending} onSubmit={() => void submit()}>
      <Field label="Name" hint="Your own name for it: Chase checking, Amex Gold, 401k.">
        {(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus={!account} />}
      </Field>
      <FieldRow>
        <Field label="Type" hint={liability ? 'Money you owe.' : undefined}>
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Institution">{(id) => <Input id={id} value={institution} maxLength={80} placeholder="Chase" onChange={(e) => setInstitution(e.target.value)} />}</Field>
      </FieldRow>
      <FieldRow>
        <Field label="Last four digits">{(id) => <Input id={id} value={last4} inputMode="numeric" maxLength={4} className="tabular" onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />}</Field>
        {!account && (
          <Field label={liability ? 'Amount owed today' : 'Balance today'} hint="Optional.">
            {(id) => <DollarInput id={id} value={balance} onChange={(e) => setBalance(e.target.value)} />}
          </Field>
        )}
      </FieldRow>
      <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <FormError>{error}</FormError>
    </FormDialog>
  );
}

function BalanceDialog({ account, onClose }: { account: AccountDetail; onClose: () => void }) {
  const { today } = useMoney();
  const [balance, setBalance] = useState(account.balance != null ? String(account.balance) : '');
  const [asOf, setAsOf] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();
  const older = !!account.balance_as_of && asOf < account.balance_as_of;
  const submit = async () => {
    const n = parseAmount(balance);
    if (n == null) return setError('Enter the balance.');
    if (!isDay(asOf) || asOf > today) return setError('Choose a date up to today.');
    const r = await run('money_account_update', { accounts: [{ name: account.name, balance: account.is_liability ? Math.abs(n) : n, balance_as_of: asOf }] }, { success: older ? 'Added to the history' : 'Balance updated' });
    if (r.ok) onClose();
  };
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${account.name} balance`}
      description={account.balance != null ? `Currently ${money(account.balance)}${account.is_liability ? ' owed' : ''} as of ${dayLabel(account.balance_as_of, today)}.` : 'No balance set yet.'}
      submitLabel="Save balance"
      pending={pending}
      onSubmit={() => void submit()}
    >
      <FieldRow>
        <Field label={account.is_liability ? 'Amount owed' : 'Balance'}>{(id) => <DollarInput id={id} value={balance} onChange={(e) => setBalance(e.target.value)} autoFocus />}</Field>
        <Field label="As of" hint={older ? 'Older than the current balance: this goes into the history only.' : undefined}>
          {(id) => <Input id={id} type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} />}
        </Field>
      </FieldRow>
      {account.holdings_count > 0 && account.holdings_value != null && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void run('money_account_update', { accounts: [{ name: account.name, balance_from_holdings: true }] }, { success: 'Balance set from holdings' }).then((r) => r.ok && onClose())}
        >
          Use the value of its holdings ({money(account.holdings_value)})
        </Button>
      )}
      <FormError>{error}</FormError>
    </FormDialog>
  );
}
