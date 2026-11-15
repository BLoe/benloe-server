import { Plus, Trash2, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { AskKevin, Chips, ConfirmDialog, EmptyState, Field, FieldRow, FormDialog, Section, ViewState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input, Select } from '@/components/ui/input';
import { useAct } from '@/lib/act';
import { money, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { CLASS_COLORS, StackedBar } from './charts';
import { ASSET_CLASS_LABELS, dayLabel, parseAmount, parseQuantity, percent, quantityLabel, signedMoney, signedPercent, tradeInput } from './logic';
import { DollarInput, FormError, Panel, RowMenu, Stat, useMoney } from './shared';
import type { HoldingsView, Position } from './types';

const ACCOUNT_COLORS = ['#2f8f76', '#4f7fb5', '#c0903f', '#9a6fb8', '#c26a57', '#6f7a86', '#8d9a94'];
const gainClass = (g: number | null) => (g == null || g === 0 ? 'text-muted-foreground' : g > 0 ? 'text-primary' : 'text-destructive');

export function Holdings() {
  const { accounts, openNewAccount } = useMoney();
  const view = useView<HoldingsView>('money/holdings');
  const [editing, setEditing] = useState<Position | 'new' | null>(null);
  const [trading, setTrading] = useState<Position | null>(null);
  const [removing, setRemoving] = useState<Position | null>(null);
  const [pricing, setPricing] = useState(false);
  const { run } = useAct();
  const hasAccount = accounts.some((a) => a.active && !a.is_liability);

  return (
    <>
      <ViewState
        view={view}
        isEmpty={(v) => v.positions.length === 0}
        empty={
          <EmptyState
            icon={TrendingUp}
            title="No holdings yet"
            body={hasAccount ? 'Add the positions in your brokerage and retirement accounts. Prices are entered by hand or by Kevin; nothing fetches them.' : 'Holdings live in an account. Add a brokerage or retirement account first.'}
            action={
              <>
                {hasAccount ? (
                  <Button onClick={() => setEditing('new')}>
                    <Plus />
                    Add a position
                  </Button>
                ) : (
                  <Button onClick={openNewAccount}>
                    <Plus />
                    Add an account
                  </Button>
                )}
                <AskKevin prompt="Add my holdings: " prefill variant="ghost">
                  or tell Kevin
                </AskKevin>
              </>
            }
          />
        }
      >
        {(h) => {
          const sorted = [...h.positions].sort((a, b) => b.market_value - a.market_value);
          const unpriced = h.positions.filter((p) => !p.priced).length;
          return (
            <div className="flex flex-col gap-7">
              <Panel>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Market value" value={money(h.totals.market_value, { cents: false })} />
                  <Stat label="Cost" value={money(h.totals.cost_basis, { cents: false })} />
                  <Stat label="Gain" value={<span className={gainClass(h.totals.gain)}>{signedMoney(h.totals.gain, { cents: false })}</span>} sub={signedPercent(h.totals.gain_pct)} />
                </div>
                {unpriced > 0 && <p className="mt-3 text-sm text-warning">{plural(unpriced, 'position')} without a price: counted at cost until one is entered.</p>}
              </Panel>

              <div className="grid gap-7 @2xl/page:grid-cols-2 @2xl/page:gap-4">
                <Section title="By asset class">
                  <Panel>
                    <StackedBar items={h.by_asset_class.map((c) => ({ key: c.asset_class, label: ASSET_CLASS_LABELS[c.asset_class] ?? c.asset_class, share: c.share, value: c.market_value, color: CLASS_COLORS[c.asset_class] ?? CLASS_COLORS.other! }))} />
                  </Panel>
                </Section>
                <Section title="By account">
                  <Panel>
                    <StackedBar items={h.by_account.map((a, i) => ({ key: String(a.account_id), label: a.account, share: a.share, value: a.market_value, color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]! }))} />
                    {h.by_account.some((a) => a.account_balance != null && Math.abs(a.account_balance - a.market_value) >= 1) && (
                      <p className="mt-3 text-sm text-muted-foreground">An account's balance can differ from its holdings' value. Set it from the holdings on the Accounts tab.</p>
                    )}
                  </Panel>
                </Section>
              </div>

              <Section
                title="Positions"
                action={
                  <>
                    <Button variant="outline" size="sm" onClick={() => setPricing(true)}>
                      Update prices
                    </Button>
                    <Button size="sm" onClick={() => setEditing('new')}>
                      <Plus />
                      Add
                    </Button>
                  </>
                }
              >
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {sorted.map((p) => (
                    <li key={p.id} className="flex items-stretch">
                      <button type="button" className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary" onClick={() => setEditing(p)}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="shrink-0 font-medium">{p.symbol}</span>
                            <span className="truncate text-sm text-muted-foreground">{p.name ?? ASSET_CLASS_LABELS[p.asset_class]}</span>
                          </span>
                          <span className="tabular mt-0.5 block truncate text-sm text-muted-foreground">
                            {quantityLabel(p.quantity)} {p.last_price != null ? `at ${money(p.last_price)}` : 'at cost'}
                          </span>
                          <span className="tabular mt-0.5 block truncate text-sm text-muted-foreground">
                            {percent(p.weight, 1)} · {p.account}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-right">
                          <span className="block font-medium">{money(p.market_value, { cents: false })}</span>
                          <span className={cn('block text-sm', gainClass(p.gain))}>{p.gain == null ? 'no gain data' : `${signedMoney(p.gain, { cents: false })} (${signedPercent(p.gain_pct)})`}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center pr-2">
                        <RowMenu label={`More for ${p.symbol}`}>
                          <DropdownMenuItem onSelect={() => setTrading(p)}>Record a buy or sale</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(p)}>Edit position</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setRemoving(p)}>
                            Remove…
                          </DropdownMenuItem>
                        </RowMenu>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
              {pricing && <PricesDialog positions={h.positions} onClose={() => setPricing(false)} />}
            </div>
          );
        }}
      </ViewState>
      {editing && <PositionDialog position={editing === 'new' ? null : editing} classes={view.data?.asset_classes ?? Object.keys(ASSET_CLASS_LABELS)} onClose={() => setEditing(null)} onRemove={(p) => setRemoving(p)} />}
      {trading && <TradeDialog position={trading} onClose={() => setTrading(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.symbol ?? ''} from ${removing?.account ?? ''}?`}
        body="The position and its cost basis are deleted. To record selling it, use “Record a buy or sale” instead."
        confirmLabel="Remove position"
        onConfirm={() => {
          const p = removing;
          setRemoving(null);
          setEditing(null);
          if (p) void run('money_account_update', { holdings: [{ account: p.account_id, symbol: p.symbol, remove: true }] }, { success: `${p.symbol} removed` });
        }}
      />
    </>
  );
}

function PositionDialog({ position, classes, onClose, onRemove }: { position: Position | null; classes: string[]; onClose: () => void; onRemove: (p: Position) => void }) {
  const { accounts } = useMoney();
  const usable = accounts.filter((a) => a.active && !a.is_liability);
  const investing = usable.filter((a) => ['brokerage', 'retirement', 'hsa'].includes(a.type));
  const [account, setAccount] = useState(position ? String(position.account_id) : investing.length === 1 ? String(investing[0]!.id) : '');
  const [symbol, setSymbol] = useState(position?.symbol ?? '');
  const [name, setName] = useState(position?.name ?? '');
  const [cls, setCls] = useState(position?.asset_class ?? 'us_stock');
  const [quantity, setQuantity] = useState(position ? String(position.quantity) : '');
  const [price, setPrice] = useState(position?.last_price != null ? String(position.last_price) : '');
  const [cost, setCost] = useState(position?.cost_basis != null ? String(position.cost_basis) : '');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();

  const submit = async () => {
    if (!account) return setError('Choose the account that holds it.');
    const sym = symbol.trim().toUpperCase();
    if (!sym) return setError('Enter the ticker symbol.');
    const q = parseQuantity(quantity);
    if (q == null || q <= 0) return setError('Enter how many shares are held.');
    const p = price.trim() ? parseQuantity(price) : null;
    if (price.trim() && p == null) return setError('The price is not a number.');
    const c = cost.trim() ? parseAmount(cost) : null;
    if (cost.trim() && (c == null || c < 0)) return setError('The cost is not a number.');
    const input: Record<string, unknown> = { account: Number(account), symbol: sym, asset_class: cls, quantity: q };
    if (name.trim()) input.name = name.trim();
    // An unchanged price is not sent, so the date it was last true is kept.
    if (p != null && p !== position?.last_price) input.price = p;
    if (c != null && c !== position?.cost_basis) input.cost_basis = c;
    const r = await run('money_account_update', { holdings: [input] }, { success: position ? 'Saved' : `${sym} added` });
    if (r.ok) onClose();
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={position ? `${position.symbol} in ${position.account}` : 'Add a position'}
      submitLabel={position ? 'Save' : 'Add position'}
      pending={pending}
      onSubmit={() => void submit()}
      extraAction={
        position && (
          <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={() => onRemove(position)}>
            <Trash2 />
            Remove
          </Button>
        )
      }
    >
      {!position && (
        <FieldRow>
          <Field label="Account">
            {(id) => (
              <Select id={id} value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">Choose…</option>
                {usable.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Symbol" hint="CASH for uninvested cash: shares in dollars, price 1.">
            {(id) => <Input id={id} value={symbol} maxLength={20} autoCapitalize="characters" autoCorrect="off" placeholder="VTI" onChange={(e) => setSymbol(e.target.value.toUpperCase())} />}
          </Field>
        </FieldRow>
      )}
      <FieldRow>
        <Field label="Name">{(id) => <Input id={id} value={name} maxLength={120} placeholder="Vanguard Total Stock Market" onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Asset class">
          {(id) => (
            <Select id={id} value={cls} onChange={(e) => setCls(e.target.value)}>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {ASSET_CLASS_LABELS[c] ?? c}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Shares held">{(id) => <Input id={id} value={quantity} inputMode="decimal" className="tabular" onChange={(e) => setQuantity(e.target.value)} />}</Field>
        <Field label="Price per share">{(id) => <DollarInput id={id} value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
      </FieldRow>
      <Field label="Total cost" hint={position ? 'What the whole position cost, not per share.' : 'What the whole position cost. Left empty, shares times price is used.'}>
        {(id) => <DollarInput id={id} value={cost} onChange={(e) => setCost(e.target.value)} />}
      </Field>
      <FormError>{error}</FormError>
    </FormDialog>
  );
}

function TradeDialog({ position, onClose }: { position: Position; onClose: () => void }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState(position.last_price != null ? String(position.last_price) : '');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();
  const n = parseQuantity(shares);
  const p = parseQuantity(price);
  const submit = async () => {
    const t = tradeInput(position.account_id, position.symbol, side, shares, price, position.quantity);
    if ('error' in t) return setError(t.error);
    const r = await run('money_account_update', { holdings: [t.input] }, { success: side === 'buy' ? `Bought ${shares} ${position.symbol}` : `Sold ${shares} ${position.symbol}` });
    if (r.ok) onClose();
  };
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${position.symbol} in ${position.account}`}
      description={`${quantityLabel(position.quantity)} held. A buy adds to the cost basis; a sale reduces it in proportion.`}
      submitLabel={side === 'buy' ? 'Record buy' : 'Record sale'}
      pending={pending}
      onSubmit={() => void submit()}
    >
      <Chips value={side} onChange={setSide} options={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]} className="mx-0 px-0" />
      <FieldRow>
        <Field label="Shares">{(id) => <Input id={id} value={shares} inputMode="decimal" className="tabular" onChange={(e) => setShares(e.target.value)} autoFocus />}</Field>
        <Field label="Price per share">{(id) => <DollarInput id={id} value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
      </FieldRow>
      {n != null && p != null && n > 0 && (
        <p className="tabular text-sm text-muted-foreground">
          {side === 'buy' ? 'Costs' : 'Proceeds'} {money(n * p)}
          {side === 'sell' && n >= position.quantity - 1e-9 ? '. This sells the whole position, which removes it.' : ''}
        </p>
      )}
      <FormError>{error}</FormError>
    </FormDialog>
  );
}

/** One price per symbol; a symbol held in several accounts is updated in all of them. */
function PricesDialog({ positions, onClose }: { positions: Position[]; onClose: () => void }) {
  const { today } = useMoney();
  const symbols = [...new Map(positions.filter((p) => p.symbol !== 'CASH').map((p) => [p.symbol, p])).values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(symbols.map((p) => [p.symbol, p.last_price != null ? String(p.last_price) : ''])));
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();
  const submit = async () => {
    const changed: { symbol: string; price: number }[] = [];
    for (const s of symbols) {
      const text = prices[s.symbol]?.trim() ?? '';
      if (!text) continue;
      const n = parseQuantity(text);
      if (n == null) return setError(`The price for ${s.symbol} is not a number.`);
      if (n !== s.last_price) changed.push({ symbol: s.symbol, price: n });
    }
    if (!changed.length) return onClose();
    const r = await run('money_account_update', { holdings: changed }, { success: `${plural(changed.length, 'price')} updated` });
    if (r.ok) onClose();
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Update prices" description="Per share, as of today. Only the ones you change are saved." submitLabel="Save prices" pending={pending} onSubmit={() => void submit()}>
      {symbols.length === 0 && <p className="text-sm text-muted-foreground">Only cash is held; there is nothing to price.</p>}
      {symbols.map((s) => (
        <div key={s.symbol} className="flex items-center gap-3">
          <label htmlFor={`price-${s.symbol}`} className="min-w-0 flex-1">
            <span className="block font-medium">{s.symbol}</span>
            <span className="block truncate text-sm text-muted-foreground">{s.price_as_of ? `Priced ${dayLabel(s.price_as_of, today)}` : 'No price yet'}</span>
          </label>
          <div className="w-36 shrink-0">
            <DollarInput id={`price-${s.symbol}`} value={prices[s.symbol] ?? ''} onChange={(e) => setPrices({ ...prices, [s.symbol]: e.target.value })} />
          </div>
        </div>
      ))}
      <FormError>{error}</FormError>
    </FormDialog>
  );
}
