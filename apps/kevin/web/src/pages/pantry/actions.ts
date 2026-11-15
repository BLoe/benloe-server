// The Pantry page's writes. Each is one call to the tool Kevin uses, with the
// toast that tells Ben what the pantry now says.
import { act } from '@/lib/act';
import { openChat, uploadFile } from '@/lib/chat';
import { plural } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { PantryItem, PantryResult, QuickItem, ShoppingResult } from './logic';

/** One `pantry_update` item. Returns the item's resulting state, or null when it failed (already toasted). */
export async function changeItem(change: Record<string, unknown>, opts: { quiet?: boolean } = {}): Promise<PantryResult['changed'][number] | null> {
  const r = await act<PantryResult>('pantry_update', { items: [change] });
  if (!r.ok) return null;
  const c = r.result.changed[0];
  if (!c) return null;
  if (c.did === 'ran_out') toast.info(`${c.name} ran out`, { body: 'It’s under Out of stock now.' });
  else if (c.did === 'removed') toast.success(`Removed ${c.name}`);
  else if (!opts.quiet) toast.success(c.name, [c.now, c.note].filter(Boolean).join(' · '));
  return c;
}

export const takeAmount = (item: PantryItem, quantity: number, unit?: string | null) =>
  changeItem({ id: item.id, op: 'use', quantity, ...(unit !== undefined ? { unit } : {}) }, { quiet: true });
export const addAmount = (item: PantryItem, quantity: number) => changeItem({ id: item.id, op: 'add', quantity }, { quiet: true });
export const markOut = (item: PantryItem) => changeItem({ id: item.id, op: 'out' });
export const restock = (item: PantryItem) => changeItem({ id: item.id, op: 'set' });
export const removeItem = (item: PantryItem) => changeItem({ id: item.id, op: 'remove' });
export const quickAdd = (q: QuickItem) => changeItem({ ...q, op: 'add' });

export async function shoppingUpdate(input: Record<string, unknown>, success?: string): Promise<ShoppingResult | null> {
  const r = await act<ShoppingResult>('pantry_shopping_list_update', input, success ? { success } : {});
  return r.ok ? r.result : null;
}

/** Puts things on the shopping list and says which were new. */
export async function addToList(items: { name: string; quantity?: number; unit?: string | null; note?: string | null; recipe_id?: number }[]): Promise<boolean> {
  if (!items.length) return false;
  const r = await shoppingUpdate({ add: items });
  if (!r) return false;
  const added = r.added ?? [];
  const listed = r.already_listed ?? [];
  if (added.length === 1 && !listed.length) toast.success(`${added[0]} is on the shopping list`);
  else if (added.length) toast.success(`${plural(added.length, 'item')} added to the shopping list`, listed.length ? `${listed.join(', ')} already there.` : undefined);
  else toast.success(listed.length === 1 ? `${listed[0]} is already on the list` : 'Already on the shopping list');
  return true;
}

export async function purchase(which: 'checked' | 'all'): Promise<void> {
  const r = await shoppingUpdate({ purchase: which });
  if (!r) return;
  const bought = r.purchased ?? [];
  const skipped = r.not_purchased ?? [];
  if (bought.length) toast.success(`${plural(bought.length, 'item')} moved into the pantry`, bought.length <= 4 ? bought.map((b) => b.name).join(', ') : undefined);
  if (skipped.length) toast.error(`${plural(skipped.length, 'item')} stayed on the list`, skipped.map((s) => `${s.name}: ${s.reason}`).join(' '));
}

export type PhotoKind = 'kitchen' | 'receipt' | 'any';
const photoMessage: Record<PhotoKind, string> = {
  kitchen: 'Here’s what’s in my kitchen right now. Update the pantry to match what you can see.',
  receipt: 'Here’s a grocery receipt. Add what I bought to the pantry.',
  any: 'Here’s a photo for the pantry: a fridge or shelf shot, or a receipt. Update the pantry from it.',
};

/** Uploads a photo and hands it to Kevin in a new chat, the way Home's "Snap fridge photo" does. */
export async function sendPhoto(file: File, kind: PhotoKind, onProgress: (label: string | null) => void): Promise<void> {
  onProgress('Uploading…');
  try {
    const upload = await uploadFile(file, (p) => onProgress(p >= 1 ? 'Kevin is looking…' : `Uploading ${Math.round(p * 100)}%`));
    openChat({ send: photoMessage[kind], attachments: [upload], newThread: true });
  } catch (e) {
    toast.error('Photo not uploaded', e instanceof Error ? e.message : undefined);
  } finally {
    onProgress(null);
  }
}
