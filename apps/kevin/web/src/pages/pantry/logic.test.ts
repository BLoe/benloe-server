import { describe, expect, it } from 'vitest';
import {
  addDays, draftOfItem, expiryLabel, filterItems, groupByLocation, itemChange, knownUnit, matchesText, parseQuantity, parseQuickAdd,
  shoppingSave, sortItems, sortShopping, stepFor, wherePhrase, midSentence, capitalise, type PantryItem, type ShoppingItem,
} from './logic';

const item = (over: Partial<PantryItem> = {}): PantryItem => ({
  id: 1, name: 'Eggs', location: 'fridge', category: 'dairy', quantity: 12, unit: null, amount_note: null, amount: '12', expires_on: null, days_left: null,
  expiry: null, notes: null, in_stock: true, ran_out_on: null, on_shopping_list: false, ...over,
});

describe('expiryLabel', () => {
  it('reads like a person would say it', () => {
    expect(expiryLabel(-2)).toBe('Expired 2 days ago');
    expect(expiryLabel(-1)).toBe('Expired yesterday');
    expect(expiryLabel(0)).toBe('Expires today');
    expect(expiryLabel(1)).toBe('Expires tomorrow');
    expect(expiryLabel(5)).toBe('Expires in 5 days');
  });
  it('gives the date once it is more than two weeks out', () => {
    expect(expiryLabel(20, '2026-12-04')).toBe('Expires Dec 4');
    expect(expiryLabel(400, '2027-12-19')).toBe('Expires Dec 19, 2027');
    expect(expiryLabel(20)).toBe('Expires in 20 days');
  });
});

describe('words', () => {
  it('says where things are', () => {
    expect(wherePhrase('fridge')).toBe('in the fridge');
    expect(wherePhrase('counter')).toBe('on the counter');
    expect(wherePhrase('other')).toBe('');
    expect(wherePhrase(null)).toBe('');
  });
  it('lowercases only relative days', () => {
    expect(midSentence('Yesterday')).toBe('yesterday');
    expect(midSentence('Sun, Nov 8')).toBe('Sun, Nov 8');
  });
  it('capitalises a typed name and leaves the rest alone', () => {
    expect(capitalise('kiwis')).toBe('Kiwis');
    expect(capitalise('iPhone cable')).toBe('IPhone cable');
    expect(capitalise('7up')).toBe('7up');
    expect(capitalise('Eggs')).toBe('Eggs');
  });
});

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-11-28', 3)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('search', () => {
  it('ignores case, accents and plurals', () => {
    expect(matchesText('Egg noodles', 'eggs')).toBe(true);
    expect(matchesText('Jalapeño', 'jalapeno')).toBe(true);
    expect(matchesText('Blueberries', 'berry')).toBe(true);
    expect(matchesText('Milk', 'oat')).toBe(false);
    expect(matchesText('Anything', '  ')).toBe(true);
  });
  it('needs every word', () => {
    expect(matchesText('Chicken thighs', 'thigh chicken')).toBe(true);
    expect(matchesText('Chicken thighs', 'chicken breast')).toBe(false);
  });
  it('filters by location and by text over name, category and notes', () => {
    const items = [item(), item({ id: 2, name: 'Peas', location: 'freezer', category: 'frozen' }), item({ id: 3, name: 'Milk', notes: 'oat, opened' })];
    expect(filterItems(items, { location: 'freezer' }).map((i) => i.id)).toEqual([2]);
    expect(filterItems(items, { q: 'oat' }).map((i) => i.id)).toEqual([3]);
    expect(filterItems(items, { q: 'frozen' }).map((i) => i.id)).toEqual([2]);
    expect(filterItems(items, {}).length).toBe(3);
  });
});

describe('sorting and grouping', () => {
  const items = [
    item({ id: 1, name: 'Yogurt', days_left: 2, expiry: 'soon' }),
    item({ id: 2, name: 'butter' }),
    item({ id: 3, name: 'Chicken', days_left: -1, expiry: 'expired' }),
    item({ id: 4, name: 'Apples', location: 'counter', days_left: 9, expiry: 'ok' }),
    item({ id: 5, name: 'Rice', location: 'pantry' }),
    item({ id: 6, name: 'Bread', location: 'breadbox' }),
  ];
  it('sorts by name without regard to case', () => {
    expect(sortItems(items, 'name').map((i) => i.name)).toEqual(['Apples', 'Bread', 'butter', 'Chicken', 'Rice', 'Yogurt']);
  });
  it('puts expired first, then soonest, then the undated by name', () => {
    expect(sortItems(items, 'expiry').map((i) => i.name)).toEqual(['Chicken', 'Yogurt', 'Apples', 'Bread', 'butter', 'Rice']);
  });
  it('groups in kitchen order with unknown places last, and counts what needs attention', () => {
    const groups = groupByLocation(items, 'expiry');
    expect(groups.map((g) => g.location)).toEqual(['fridge', 'pantry', 'counter', 'breadbox']);
    expect(groups[0]!.items.map((i) => i.name)).toEqual(['Chicken', 'Yogurt', 'butter']);
    expect(groups[0]!.attention).toBe(2);
    expect(groups[2]!.attention).toBe(0);
  });
  it('keeps unchecked shopping items first, oldest first', () => {
    const list = [{ id: 3, checked: true }, { id: 2, checked: false }, { id: 1, checked: true }, { id: 4, checked: false }];
    expect(sortShopping(list).map((s) => s.id)).toEqual([2, 4, 1, 3]);
  });
});

describe('amounts', () => {
  it('parses numbers and fractions', () => {
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity(' 0.5 ')).toBe(0.5);
    expect(parseQuantity('.5')).toBe(0.5);
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('1 1/2')).toBe(1.5);
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('half')).toBeNull();
    expect(parseQuantity('1/0')).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
  });
  it('knows units and their plurals', () => {
    expect(knownUnit('Lbs.')).toBe('lb');
    expect(knownUnit('cans')).toBe('can');
    expect(knownUnit('gallon')).toBe('gallon');
    expect(knownUnit('lemons')).toBeNull();
  });
  it('steps by one for counted things and by less for small measures', () => {
    expect(stepFor(item({ quantity: 12 }))).toBe(1);
    expect(stepFor(item({ quantity: 2, unit: 'lb' }))).toBe(1);
    expect(stepFor(item({ quantity: 1.5, unit: 'lb' }))).toBe(0.5);
    expect(stepFor(item({ quantity: 1, unit: 'gallon' }))).toBe(0.25);
    expect(stepFor(item({ quantity: 0.5 }))).toBe(1);
    expect(stepFor(item({ quantity: null, amount_note: 'half a bag' }))).toBeNull();
    expect(stepFor(item({ quantity: 0, in_stock: false }))).toBeNull();
  });
});

describe('parseQuickAdd', () => {
  it('takes a bare name', () => {
    expect(parseQuickAdd('olive oil')).toEqual({ name: 'Olive oil' });
    expect(parseQuickAdd('  ')).toBeNull();
  });
  it('takes an amount in front', () => {
    expect(parseQuickAdd('2 lb chicken thighs')).toEqual({ name: 'Chicken thighs', quantity: 2, unit: 'lb' });
    expect(parseQuickAdd('3 lemons')).toEqual({ name: 'Lemons', quantity: 3 });
    expect(parseQuickAdd('1 1/2 cups flour')).toEqual({ name: 'Flour', quantity: 1.5, unit: 'cup' });
    expect(parseQuickAdd('2 cans of black beans')).toEqual({ name: 'Black beans', quantity: 2, unit: 'can' });
    expect(parseQuickAdd('2lb ground beef')).toEqual({ name: 'Ground beef', quantity: 2, unit: 'lb' });
    expect(parseQuickAdd('1/2 gallon milk')).toEqual({ name: 'Milk', quantity: 0.5, unit: 'gallon' });
  });
  it('takes an amount at the end', () => {
    expect(parseQuickAdd('eggs 12')).toEqual({ name: 'Eggs', quantity: 12 });
    expect(parseQuickAdd('milk, 1 gallon')).toEqual({ name: 'Milk', quantity: 1, unit: 'gallon' });
    expect(parseQuickAdd('lemons x3')).toEqual({ name: 'Lemons', quantity: 3 });
    expect(parseQuickAdd('chicken thighs 2lb')).toEqual({ name: 'Chicken thighs', quantity: 2, unit: 'lb' });
  });
  it('does not mistake a name for an amount', () => {
    expect(parseQuickAdd('7up')).toEqual({ name: '7up' });
    expect(parseQuickAdd('2 cans')).toEqual({ name: 'Cans', quantity: 2 });
    expect(parseQuickAdd('12')).toEqual({ name: '12' });
    expect(parseQuickAdd('0 eggs')).toEqual({ name: '0 eggs' });
    expect(parseQuickAdd('half and half')).toEqual({ name: 'Half and half' });
  });
});

describe('itemChange', () => {
  it('builds an add for a new item with only what was filled in', () => {
    expect(itemChange(null, { ...draftOfItem(null), name: ' Chicken  thighs ', quantity: '2', unit: 'lb', expires_on: '2026-11-20' })).toEqual({
      change: { name: 'Chicken thighs', op: 'add', quantity: 2, unit: 'lb', expires_on: '2026-11-20' },
    });
    expect(itemChange(null, draftOfItem(null))).toEqual({ error: 'Give it a name.' });
  });
  it('sends nothing when nothing changed', () => {
    const it0 = item({ quantity: 1.5, unit: 'lb', amount_note: 'opened', expires_on: '2026-11-20', notes: 'brand X' });
    expect(itemChange(it0, draftOfItem(it0))).toEqual({ change: null });
  });
  it('sends only the changed fields of an edit', () => {
    const it0 = item({ expires_on: '2026-11-20' });
    expect(itemChange(it0, { ...draftOfItem(it0), location: 'counter', expires_on: '' })).toEqual({ change: { id: 1, op: 'edit', location: 'counter', expires_on: null } });
    expect(itemChange(it0, { ...draftOfItem(it0), name: 'Large eggs' })).toEqual({ change: { id: 1, op: 'edit', new_name: 'Large eggs' } });
  });
  it('sends the number and the words of an amount together', () => {
    const it0 = item({ quantity: 2, unit: 'bag', amount_note: 'one opened' });
    expect(itemChange(it0, { ...draftOfItem(it0), quantity: '1' })).toEqual({ change: { id: 1, op: 'edit', quantity: 1, amount_note: 'one opened' } });
    expect(itemChange(it0, { ...draftOfItem(it0), amount_note: '' })).toEqual({ change: { id: 1, op: 'edit', quantity: 2, amount_note: null } });
    expect(itemChange(it0, { ...draftOfItem(it0), quantity: '', amount_note: 'about half' })).toEqual({ change: { id: 1, op: 'edit', amount_note: 'about half' } });
  });
  it('refuses an amount it cannot express', () => {
    const it0 = item();
    expect(itemChange(it0, { ...draftOfItem(it0), quantity: 'lots' })).toHaveProperty('error');
    expect(itemChange(it0, { ...draftOfItem(it0), quantity: '' })).toHaveProperty('error');
  });
  it('treats an out-of-stock row as having no amount, so a number restocks it', () => {
    const out = item({ quantity: 0, in_stock: false, ran_out_on: '2026-11-10' });
    expect(draftOfItem(out).quantity).toBe('');
    expect(itemChange(out, draftOfItem(out))).toEqual({ change: null });
    expect(itemChange(out, { ...draftOfItem(out), quantity: '6' })).toEqual({ change: { id: 1, op: 'edit', quantity: 6, amount_note: null } });
  });
});

describe('shoppingSave', () => {
  const row = (over: Partial<ShoppingItem> = {}): ShoppingItem => ({
    id: 7, name: 'Ground beef', quantity: 2, unit: 'lb', amount: '2 lb', note: null, checked: false, source: 'manual', recipe_id: null, for_recipe: null, in_pantry: false, ...over,
  });
  const draft = (r: ShoppingItem, over = {}) => ({ name: r.name, quantity: r.quantity == null ? '' : String(r.quantity), unit: r.unit ?? '', note: r.note ?? '', ...over });
  it('does nothing when nothing changed', () => {
    expect(shoppingSave(row(), draft(row()))).toEqual({ calls: [] });
  });
  it('updates in place, and re-ticks a ticked row', () => {
    expect(shoppingSave(row(), draft(row(), { quantity: '3', note: 'lean' }))).toEqual({ calls: [{ add: [{ name: 'Ground beef', quantity: 3, unit: 'lb', note: 'lean' }] }] });
    const ticked = row({ checked: true });
    expect(shoppingSave(ticked, draft(ticked, { note: 'lean' }))).toEqual({ calls: [{ add: [{ name: 'Ground beef', quantity: 2, unit: 'lb', note: 'lean' }], check: [7] }] });
  });
  it('removes then adds for a rename or a cleared amount, keeping the recipe', () => {
    const r = row({ recipe_id: 4, for_recipe: 'Chili' });
    expect(shoppingSave(r, draft(r, { name: 'Ground turkey' }))).toEqual({ calls: [{ remove: [7] }, { add: [{ name: 'Ground turkey', quantity: 2, unit: 'lb', note: null, recipe_id: 4 }] }] });
    expect(shoppingSave(r, draft(r, { quantity: '', unit: '' }))).toEqual({ calls: [{ remove: [7] }, { add: [{ name: 'Ground beef', unit: null, note: null, recipe_id: 4 }] }] });
  });
  it('rejects a bad amount', () => {
    expect(shoppingSave(row(), draft(row(), { quantity: '0' }))).toHaveProperty('error');
    expect(shoppingSave(row(), draft(row(), { name: ' ' }))).toHaveProperty('error');
  });
});
