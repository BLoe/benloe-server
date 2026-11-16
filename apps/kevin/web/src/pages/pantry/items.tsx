import { ArrowDownUp, Ban, Ellipsis, Minus, Pencil, Plus, RotateCcw, Scale, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Chips, EmptyState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { calendarDay, plural } from '@/lib/format';
import { addAmount, addToList, markOut, quickAdd, restock, takeAmount } from './actions';
import { filterItems, formatNumber, groupByLocation, locationLabel, midSentence, parseQuickAdd, sortItems, stepFor, wherePhrase, type ItemSort, type PantryItem, type PantryOverview } from './logic';
import { AddLine, ExpiryChip } from './parts';

export interface ItemHandlers {
  onOpen: (item: PantryItem) => void;
  onUse: (item: PantryItem) => void;
  onRemove: (item: PantryItem) => void;
}

const card = 'divide-y overflow-hidden rounded-xl border bg-card';
const stepButton = 'grid size-11 shrink-0 place-items-center rounded-lg text-foreground hover:bg-secondary active:bg-secondary/70 disabled:opacity-40 lg:size-9';

function ItemMenu({ item, h }: { item: PantryItem; h: ItemHandlers }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={`More for ${item.name}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {item.in_stock ? (
          <>
            <DropdownMenuItem onSelect={() => h.onUse(item)}>
              <Scale />
              {item.quantity == null ? 'Set what’s left…' : 'Used an amount…'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void markOut(item)}>
              <Ban />
              Ran out
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => void restock(item)}>
            <RotateCcw />
            Back in stock
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={item.on_shopping_list} onSelect={() => void addToList([{ name: item.name }])}>
          <ShoppingCart />
          {item.on_shopping_list ? 'On the shopping list' : 'Add to shopping list'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => h.onOpen(item)}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => h.onRemove(item)}>
          <Trash2 />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One thing in the house. The row opens the edit sheet; − and + change the
 * amount in place; everything else (ran out, shopping list, remove) is one
 * tap into the menu.
 */
export function ItemRow({ item, h, showLocation }: { item: PantryItem; h: ItemHandlers; showLocation?: boolean }) {
  const step = stepFor(item);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const unit = item.unit ? ` ${item.unit}` : '';
  return (
    <li className="flex items-stretch" data-item={item.name}>
      <button type="button" onClick={() => h.onOpen(item)} className="flex min-h-[60px] min-w-0 flex-1 flex-col justify-center gap-1 py-2 pr-1 pl-4 text-left hover:bg-muted active:bg-secondary">
        <span className="leading-snug font-medium break-words">{item.name}</span>
        {(item.days_left != null || showLocation || item.amount_note || item.notes || item.on_shopping_list || step == null) && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <ExpiryChip item={item} />
            {step == null && <span>{item.amount || 'Some'}</span>}
            {step != null && item.amount_note && <span>{item.amount_note}</span>}
            {showLocation && <span>{locationLabel(item.location)}</span>}
            {item.on_shopping_list && <Badge variant="outline">On list</Badge>}
            {item.notes && <span className="min-w-0 truncate">{item.notes}</span>}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center pr-1">
        {step != null ? (
          <div className="flex items-center" role="group" aria-label={`${item.name} amount`}>
            <button type="button" disabled={busy} onClick={() => void run(() => takeAmount(item, Math.min(step, item.quantity ?? step)))} aria-label={`Use ${formatNumber(step)}${unit} of ${item.name}`} className={stepButton}>
              <Minus className="size-[18px]" />
            </button>
            <span className="tabular min-w-9 px-0.5 text-center text-[15px] leading-tight font-medium" data-amount>
              {formatNumber(item.quantity ?? 0)}
              {item.unit && <span className="block text-xs font-normal text-muted-foreground">{item.unit}</span>}
            </span>
            <button type="button" disabled={busy} onClick={() => void run(() => addAmount(item, step))} aria-label={`Add ${formatNumber(step)}${unit} of ${item.name}`} className={stepButton}>
              <Plus className="size-[18px]" />
            </button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => h.onUse(item)}>
            Used some
          </Button>
        )}
        <ItemMenu item={item} h={h} />
      </div>
    </li>
  );
}

const SORT_KEY = 'kevin.pantry.sort';
const storedSort = (): ItemSort => {
  try {
    return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'expiry';
  } catch {
    return 'expiry';
  }
};

/** In stock: add line, search, a chip per location with its count, and the items grouped by where they are kept. */
export function InStock({ data, h, onNew }: { data: PantryOverview; h: ItemHandlers; onNew: (name: string) => void }) {
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [sort, setSort] = useState<ItemSort>(storedSort);
  const shown = useMemo(() => filterItems(data.items, { q, location }), [data.items, q, location]);
  const groups = useMemo(() => groupByLocation(shown, sort), [shown, sort]);
  const places = useMemo(() => groupByLocation(data.items, 'name').map((g) => g.location), [data.items]);
  const toggleSort = () => {
    const next: ItemSort = sort === 'expiry' ? 'name' : 'expiry';
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // the choice just does not persist
    }
  };
  const add = (text: string) => {
    const item = parseQuickAdd(text);
    if (item) void quickAdd(item);
  };

  return (
    <div className="flex flex-col gap-3">
      <AddLine placeholder="Add: “eggs 12”, “2 lb chicken”" label="Add an item" onAdd={add} onMore={onNew} />
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the pantry" aria-label="Search the pantry" type="search" className="h-11 w-full rounded-lg border border-input bg-card pr-10 pl-9 outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 lg:h-9 [&::-webkit-search-cancel-button]:hidden" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute top-0 right-0 grid size-11 place-items-center text-muted-foreground lg:size-9">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button variant="outline" onClick={toggleSort} aria-label={`Sorted ${sort === 'expiry' ? 'by expiry' : 'by name'}. Change sorting`} className="shrink-0 px-3">
          <ArrowDownUp />
          {sort === 'expiry' ? 'Expiring first' : 'A to Z'}
        </Button>
      </div>
      {places.length > 1 && (
        <Chips
          value={location}
          onChange={setLocation}
          options={[{ value: '', label: `All ${data.items.length}` }, ...places.map((l) => ({ value: l, label: `${locationLabel(l)} ${data.counts.by_location[l] ?? 0}` }))]}
        />
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          {q ? `Nothing ${wherePhrase(location) || 'in the pantry'} matches “${q}”.` : `Nothing ${wherePhrase(location) || 'here'}.`}
          {q && (
            <button type="button" onClick={() => onNew(q)} className="ml-1 font-medium text-primary underline-offset-2 hover:underline">
              Add {q}
            </button>
          )}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.location} aria-label={locationLabel(g.location)} className="flex flex-col gap-1.5">
            <h3 className="flex items-baseline gap-2 px-1 pt-1 text-sm font-semibold">
              {locationLabel(g.location)}
              <span className="tabular font-normal text-muted-foreground">{g.items.length}</span>
              {g.attention > 0 && <span className="font-normal text-warning">{g.attention} to use soon</span>}
            </h3>
            <ul className={card}>
              {g.items.map((i) => (
                <ItemRow key={i.id} item={i} h={h} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** Use soon: what is past its date or close to it, soonest first, wherever it is kept. */
export function UseSoon({ data, h, onAsk }: { data: PantryOverview; h: ItemHandlers; onAsk: () => void }) {
  if (!data.expiring.length) {
    return <EmptyState title="Nothing needs using up" body={`Nothing in stock is past its date or within ${plural(data.soon_days, 'day')} of it. Items only show here once they have an expiry date.`} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className={card}>
        {sortItems(data.expiring, 'expiry').map((i) => (
          <ItemRow key={i.id} item={i} h={h} showLocation />
        ))}
      </ul>
      <Button variant="outline" className="self-start" onClick={onAsk}>
        What can I cook with these?
      </Button>
    </div>
  );
}

/** Out of stock: what ran out, newest first, each one tap from the shopping list. */
export function OutOfStock({ data, h }: { data: PantryOverview; h: ItemHandlers }) {
  const out = data.out_of_stock;
  if (!out.length) return <EmptyState title="Not out of anything" body="When something runs out it stays here, so you can see what to buy again." />;
  const unlisted = out.filter((i) => !i.on_shopping_list);
  return (
    <div className="flex flex-col gap-3">
      {unlisted.length > 1 && (
        <Button variant="outline" className="self-start" onClick={() => void addToList(unlisted.map((i) => ({ name: i.name })))}>
          <ShoppingCart />
          Add all {unlisted.length} to shopping list
        </Button>
      )}
      <ul className={card}>
        {out.map((i) => (
          <li key={i.id} className="flex items-stretch" data-item={i.name}>
            <button type="button" onClick={() => h.onOpen(i)} className="flex min-h-[60px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pr-1 pl-4 text-left hover:bg-muted active:bg-secondary">
              <span className="leading-snug font-medium break-words">{i.name}</span>
              <span className="text-sm text-muted-foreground">
                {i.ran_out_on ? `Ran out ${midSentence(calendarDay(i.ran_out_on, data.today))}` : 'Out'}
                {` · ${locationLabel(i.location).toLowerCase()}`}
              </span>
            </button>
            <div className="flex shrink-0 items-center pr-1">
              {i.on_shopping_list ? (
                <Badge variant="success" className="mr-1">
                  On list
                </Badge>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void addToList([{ name: i.name }])} aria-label={`Add ${i.name} to shopping list`}>
                  <ShoppingCart />
                  <span className="hidden @md/page:inline">Add to list</span>
                  <span className="@md/page:hidden">List</span>
                </Button>
              )}
              <ItemMenu item={i} h={h} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
