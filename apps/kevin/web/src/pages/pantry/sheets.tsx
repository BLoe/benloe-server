import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Field, FormDialog } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { changeItem, markOut, shoppingUpdate, takeAmount } from './actions';
import { addDays, CATEGORIES, draftOfItem, itemChange, LOCATIONS, locationLabel, parseQuantity, shoppingSave, wherePhrase, type ItemDraft, type PantryItem, type ShoppingDraft, type ShoppingItem } from './logic';

const UNIT_HINTS = ['lb', 'oz', 'cup', 'gallon', 'quart', 'can', 'bag', 'box', 'bunch', 'dozen', 'jar', 'bottle', 'pack', 'loaf', 'stick'];

function UnitInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Input id={id} value={value} list="pantry-units" maxLength={30} autoCapitalize="none" placeholder="lb, can, bag…" onChange={(e) => onChange(e.target.value)} />
      <datalist id="pantry-units">
        {UNIT_HINTS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </>
  );
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;

/** Add an item with every field, or edit one. Saving an edit sends only what changed. */
export function ItemSheet({ item, preset, today, onClose, onRemove }: { item: PantryItem | null; preset?: Partial<ItemDraft>; today: string; onClose: () => void; onRemove: (item: PantryItem) => void }) {
  const [d, setD] = useState(() => draftOfItem(item, preset));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ItemDraft>) => setD((x) => ({ ...x, ...patch }));
  const out = !!item && !item.in_stock;

  const save = async () => {
    const r = itemChange(item, d);
    if ('error' in r) return setError(r.error);
    setError(null);
    if (!r.change) return onClose();
    setSaving(true);
    const done = await changeItem(r.change);
    setSaving(false);
    if (done) onClose();
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? `Edit ${item.name}` : 'Add to the pantry'}
      description={out ? 'This ran out. Give it an amount to put it back in stock.' : undefined}
      submitLabel={item ? 'Save' : 'Add item'}
      pending={saving}
      canSubmit={d.name.trim().length > 0}
      onSubmit={() => void save()}
      extraAction={
        item && (
          <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={() => onRemove(item)}>
            <Trash2 />
            Remove
          </Button>
        )
      }
    >
      <Field label="Name">{(id) => <Input id={id} value={d.name} maxLength={120} autoFocus={!item && !d.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount">{(id) => <Input id={id} value={d.quantity} inputMode="decimal" placeholder={out ? '0' : '2'} className="tabular" autoFocus={!item && !!d.name} onChange={(e) => set({ quantity: e.target.value })} />}</Field>
        <Field label="Unit">{(id) => <UnitInput id={id} value={d.unit} onChange={(unit) => set({ unit })} />}</Field>
      </div>
      <Field label="Amount in words" hint="When a number doesn’t fit: “half a bag”, “almost empty”.">
        {(id) => <Input id={id} value={d.amount_note} maxLength={80} onChange={(e) => set({ amount_note: e.target.value })} />}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Kept in">
          {(id) => (
            <Select id={id} value={d.location} onChange={(e) => set({ location: e.target.value })}>
              {!item && <option value="">Pick for me</option>}
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {locationLabel(l)}
                </option>
              ))}
              {d.location && !(LOCATIONS as readonly string[]).includes(d.location) && <option value={d.location}>{locationLabel(d.location)}</option>}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={d.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">None</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {locationLabel(c)}
                </option>
              ))}
              {d.category && !(CATEGORIES as readonly string[]).includes(d.category) && <option value={d.category}>{locationLabel(d.category)}</option>}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Expires">
        {(id) => (
          <div className="flex flex-col gap-2">
            <Input id={id} type="date" value={d.expires_on} onChange={(e) => set({ expires_on: e.target.value })} />
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['3 days', 3],
                  ['1 week', 7],
                  ['2 weeks', 14],
                  ['1 month', 30],
                ] as const
              ).map(([label, n]) => (
                <button key={n} type="button" onClick={() => set({ expires_on: addDays(today, n) })} className="h-9 rounded-full border bg-card px-3 text-sm text-muted-foreground hover:text-foreground lg:h-8">
                  {label}
                </button>
              ))}
              {d.expires_on && (
                <button type="button" onClick={() => set({ expires_on: '' })} className="h-9 rounded-full border bg-card px-3 text-sm text-muted-foreground hover:text-foreground lg:h-8">
                  No date
                </button>
              )}
            </div>
          </div>
        )}
      </Field>
      <Field label="Notes">{(id) => <Textarea id={id} value={d.notes} rows={2} maxLength={300} placeholder="Brand, “opened”, “for Saturday”" onChange={(e) => set({ notes: e.target.value })} />}</Field>
      <ErrorLine error={error} />
    </FormDialog>
  );
}

/**
 * "Used some". With a number on record it asks how much was used and
 * subtracts it; without one it asks what is left. Either way "all gone" is
 * one tap.
 */
export function UseSheet({ item, onClose }: { item: PantryItem; onClose: () => void }) {
  const numeric = item.quantity != null;
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(item.unit ?? '');
  const [words, setWords] = useState(numeric ? '' : (item.amount_note ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = qty.trim() ? parseQuantity(qty) : null;
    if (qty.trim() && (n == null || n < 0)) return setError('The amount should be a number, like 2 or 1/2.');
    setError(null);
    let done: unknown;
    setSaving(true);
    if (numeric) {
      if (n == null || n === 0) {
        setSaving(false);
        return setError('Say how much you used.');
      }
      done = await takeAmount(item, n, unit.trim() || undefined);
    } else {
      if (n == null && !words.trim()) {
        setSaving(false);
        return setError('Say what’s left, as a number or in words.');
      }
      done = await changeItem({ id: item.id, op: 'set', ...(n != null ? { quantity: n } : {}), unit: unit.trim() || null, amount_note: words.trim() || null });
    }
    setSaving(false);
    if (done) onClose();
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={numeric ? `Used some ${item.name}` : `How much ${item.name} is left?`}
      description={`On record: ${[item.amount || 'some', wherePhrase(item.location)].filter(Boolean).join(', ')}.`}
      submitLabel={numeric ? 'Take it off' : 'Save'}
      pending={saving}
      onSubmit={() => void save()}
      extraAction={
        <Button
          variant="outline"
          className="w-full lg:w-auto"
          onClick={() => {
            void markOut(item);
            onClose();
          }}
        >
          It’s all gone
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label={numeric ? 'Used' : 'Left'}>{(id) => <Input id={id} value={qty} inputMode="decimal" autoFocus className="tabular" placeholder={numeric ? '1' : '2'} onChange={(e) => setQty(e.target.value)} />}</Field>
        <Field label="Unit">{(id) => <UnitInput id={id} value={unit} onChange={setUnit} />}</Field>
      </div>
      {!numeric && (
        <Field label="Or in words" hint="“About half”, “enough for one more”.">
          {(id) => <Input id={id} value={words} maxLength={80} onChange={(e) => setWords(e.target.value)} />}
        </Field>
      )}
      {numeric && item.unit && <p className="text-sm text-muted-foreground">Pounds and ounces, cups and spoons, dozens and singles convert. Anything else, set what’s left by editing the item.</p>}
      <ErrorLine error={error} />
    </FormDialog>
  );
}

/** Edit one shopping-list row: what, how much, and which kind. */
export function ShoppingSheet({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const [d, setD] = useState<ShoppingDraft>({ name: item.name, quantity: item.quantity == null ? '' : String(item.quantity), unit: item.unit ?? '', note: item.note ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ShoppingDraft>) => setD((x) => ({ ...x, ...patch }));

  const save = async () => {
    const r = shoppingSave(item, d);
    if ('error' in r) return setError(r.error);
    setError(null);
    setSaving(true);
    let ok = true;
    for (const call of r.calls) ok = ok && !!(await shoppingUpdate(call));
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit shopping item"
      description={item.for_recipe ? `For ${item.for_recipe}.` : undefined}
      pending={saving}
      canSubmit={d.name.trim().length > 0}
      onSubmit={() => void save()}
      extraAction={
        <Button
          variant="ghost"
          className="w-full text-destructive lg:w-auto"
          onClick={() => {
            void shoppingUpdate({ remove: [item.id] });
            onClose();
          }}
        >
          <Trash2 />
          Take off the list
        </Button>
      }
    >
      <Field label="Item">{(id) => <Input id={id} value={d.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount">{(id) => <Input id={id} value={d.quantity} inputMode="decimal" className="tabular" onChange={(e) => set({ quantity: e.target.value })} />}</Field>
        <Field label="Unit">{(id) => <UnitInput id={id} value={d.unit} onChange={(unit) => set({ unit })} />}</Field>
      </div>
      <Field label="Note" hint="Which kind, which store, or why.">
        {(id) => <Input id={id} value={d.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} />}
      </Field>
      <ErrorLine error={error} />
    </FormDialog>
  );
}
