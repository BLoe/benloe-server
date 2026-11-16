import { Camera, MessageCircle, ShoppingCart, X } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, EmptyState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { openChat } from '@/lib/chat';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { addToList, purchase, shoppingUpdate } from './actions';
import { parseQuickAdd, sortShopping, type PantryOverview, type ShoppingItem } from './logic';
import { AddLine, BigCheck } from './parts';

function Row({ item, onOpen }: { item: ShoppingItem; onOpen: (i: ShoppingItem) => void }) {
  return (
    <li className="flex items-stretch" data-shopping={item.name}>
      <BigCheck checked={item.checked} label={`${item.name} in the cart`} onChange={() => void shoppingUpdate(item.checked ? { uncheck: [item.id] } : { check: [item.id] })} />
      <button type="button" onClick={() => onOpen(item)} className="flex min-h-[60px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pr-1 text-left">
        <span className={cn('text-[17px] leading-snug break-words', item.checked ? 'text-muted-foreground line-through decoration-muted-foreground/50' : 'font-medium')}>
          {item.name}
          {item.amount && <span className="tabular ml-2 text-[15px] font-normal text-muted-foreground">{item.amount}</span>}
        </span>
        {(item.note || item.for_recipe || item.in_pantry) && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {item.note && <span className="break-words">{item.note}</span>}
            {item.for_recipe && <span>for {item.for_recipe}</span>}
            {item.in_pantry && !item.checked && <Badge variant="warning">Already in the pantry</Badge>}
          </span>
        )}
      </button>
      <button type="button" onClick={() => void shoppingUpdate({ remove: [item.id] })} aria-label={`Take ${item.name} off the list`} className="grid w-12 shrink-0 place-items-center text-muted-foreground hover:text-destructive">
        <X className="size-5" />
      </button>
    </li>
  );
}

/**
 * The shopping list, laid out for one hand in a store: add line on top, what
 * is left to buy first, what is in the cart under it, and the "bought" buttons
 * pinned to the bottom of the screen.
 */
export function Shopping({ data, onOpen }: { data: PantryOverview; onOpen: (i: ShoppingItem) => void }) {
  const [confirm, setConfirm] = useState<'all' | 'clear' | null>(null);
  const list = sortShopping(data.shopping_list);
  const toBuy = list.filter((s) => !s.checked);
  const inCart = list.filter((s) => s.checked);
  const add = (text: string) => {
    const item = parseQuickAdd(text);
    if (item) void addToList([item]);
  };

  return (
    <div className="flex flex-col gap-3">
      <AddLine placeholder="Add: “milk”, “2 lb ground beef”" label="Add to the shopping list" onAdd={add} />

      {list.length === 0 && (
        <EmptyState
          icon={ShoppingCart}
          title="The shopping list is empty"
          body="Type what you need above, add things from Out of stock, or put a recipe’s missing ingredients on it from Cooking."
          action={
            <Button variant="outline" onClick={() => openChat({ prefill: 'Add to the shopping list: ' })}>
              <MessageCircle />
              Tell Kevin
            </Button>
          }
        />
      )}

      {toBuy.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-label="To buy">
          {toBuy.map((s) => (
            <Row key={s.id} item={s} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {toBuy.length === 0 && inCart.length > 0 && <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Everything is in the cart.</p>}

      {inCart.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <div className="flex min-h-9 items-center justify-between gap-2 px-1">
            <h3 className="text-sm font-semibold">
              In the cart <span className="tabular font-normal text-muted-foreground">{inCart.length}</span>
            </h3>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirm('clear')}>
              Clear checked
            </Button>
          </div>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-label="In the cart">
            {inCart.map((s) => (
              <Row key={s.id} item={s} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}

      {list.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
          <Button size="lg" className="min-w-0 flex-1" disabled={inCart.length === 0} onClick={() => void purchase('checked')}>
            {inCart.length ? `Bought the ${inCart.length} checked` : 'Bought checked'}
          </Button>
          <Button size="lg" variant="outline" onClick={() => (list.length === inCart.length ? void purchase('all') : setConfirm('all'))}>
            Bought all
          </Button>
        </div>
      )}

      {list.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Camera className="mt-0.5 size-4 shrink-0" />
          Bought things move into the pantry with the list’s amounts. Send Kevin the receipt afterwards and he fills in the rest.
        </p>
      )}

      <ConfirmDialog
        open={confirm === 'all'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Bought all ${plural(list.length, 'item')}?`}
        body={`Everything on the list moves into the pantry, including the ${plural(toBuy.length, 'item')} not checked off.`}
        confirmLabel="Bought all"
        destructive={false}
        onConfirm={() => void purchase('all')}
      />
      <ConfirmDialog
        open={confirm === 'clear'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Take ${plural(inCart.length, 'checked item')} off the list?`}
        body="They are removed without being added to the pantry. If you bought them, use “Bought checked” instead."
        confirmLabel="Clear checked"
        onConfirm={() => void shoppingUpdate({ clear: 'checked' }, 'Cleared')}
      />
    </div>
  );
}
