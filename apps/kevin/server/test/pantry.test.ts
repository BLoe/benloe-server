import { describe, expect, it } from 'vitest';
import pantry from '../src/domains/pantry.js';
import { addDays, convert, formatAmount, guessLocation, isDay, nameMatch, normalizeName } from '../src/domains/_pantry/names.js';
import { localDay } from '../src/time.js';
import { call, makeKevin, ok, view } from './helpers.js';

const today = localDay();
const inDays = (n: number) => addDays(today, n);
const item = (kevin: Awaited<ReturnType<typeof makeKevin>>, name: string, location?: string) =>
  kevin.db
    .prepare(`SELECT * FROM pantry_items WHERE name_key = ? ${location ? 'AND location = ?' : ''}`)
    .get(...(location ? [normalizeName(name), location] : [normalizeName(name)])) as Record<string, any> | undefined;

describe('names and units', () => {
  it('normalises case, plurals, punctuation and spacing to one key', () => {
    expect(normalizeName('  Chicken   Thighs ')).toBe('chicken thigh');
    expect(normalizeName('EGGS')).toBe(normalizeName('egg'));
    expect(normalizeName('Tomatoes')).toBe(normalizeName('tomato'));
    expect(normalizeName('Blueberries')).toBe(normalizeName('blueberry'));
    expect(normalizeName('cookies')).toBe(normalizeName('Cookie'));
    expect(normalizeName('Peaches')).toBe('peach');
    expect(normalizeName("Ben's hummus")).toBe('ben hummus');
    expect(normalizeName('Swiss cheese')).toBe('swiss cheese');
    expect(normalizeName('jalapeño peppers')).toBe('jalapeno pepper');
    expect(normalizeName('  ')).toBe('');
  });
  it('relates a spoken name to a stored one', () => {
    expect(nameMatch('egg', 'egg')).toBe('exact');
    expect(nameMatch('bean', 'black bean')).toBe('similar');
    expect(nameMatch('olive oil', 'oil')).toBe('similar');
    expect(nameMatch('chicken broth', 'chicken')).toBeNull();
    expect(nameMatch('milk', 'egg')).toBeNull();
  });
  it('converts within weight, volume and count, and refuses across them', () => {
    expect(convert(8, 'oz', 'lb')).toBe(0.5);
    expect(convert(1, 'Lbs.', 'ounces')).toBe(16);
    expect(convert(2, 'tbsp', 'cup')).toBeCloseTo(0.125, 6);
    expect(convert(1, 'dozen', null)).toBe(12);
    expect(convert(3, 'eggs', null, 'egg')).toBe(3);
    expect(convert(1, 'bag', 'bag')).toBe(1);
    expect(convert(1, 'cup', 'lb')).toBeNull();
    expect(convert(1, 'bag', 'lb')).toBeNull();
  });
  it('formats amounts, checks dates and guesses a location', () => {
    expect(formatAmount(2, 'lb')).toBe('2 lb');
    expect(formatAmount(6, null)).toBe('6');
    expect(formatAmount(null, null, 'half a bag')).toBe('half a bag');
    expect(formatAmount(1.5, 'lb', 'opened')).toBe('1.5 lb (opened)');
    expect(formatAmount(null, null)).toBe('');
    expect(isDay('2026-11-20')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('Friday')).toBe(false);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(guessLocation('milk')).toBe('fridge');
    expect(guessLocation('frozen pea')).toBe('freezer');
    expect(guessLocation('coconut milk')).toBe('pantry');
    expect(guessLocation('rice')).toBe('pantry');
  });
});

describe('pantry_update', () => {
  it('"I used 3 eggs" is one call, and using the rest marks them out of stock', async () => {
    const kevin = await makeKevin([pantry]);
    const added = await ok(kevin, 'pantry_update', { items: [{ name: 'Eggs', quantity: 12, location: 'fridge', category: 'Dairy', expires_on: inDays(14) }] });
    expect(added.changed).toEqual([{ id: 1, name: 'Eggs', did: 'added', now: `12 in fridge, expires ${inDays(14)}`, in_stock: true }]);
    expect(item(kevin, 'eggs')!.category).toBe('dairy');

    const used = await ok(kevin, 'pantry_update', { items: [{ name: 'eggs', op: 'use', quantity: 3 }] });
    expect(used.changed[0]).toMatchObject({ id: 1, name: 'Eggs', did: 'used', now: `9 in fridge, expires ${inDays(14)}` });
    expect(used.not_applied).toBeUndefined();

    // A different spelling of the same thing, and more than is left.
    const rest = await ok(kevin, 'pantry_update', { items: [{ name: ' EGG', op: 'use', quantity: 10 }] });
    expect(rest.changed[0]).toMatchObject({ did: 'ran_out', now: 'out of stock', in_stock: false, note: 'only 9 was on record' });
    expect(item(kevin, 'eggs')).toMatchObject({ in_stock: 0, quantity: 0, expires_on: null, ran_out_on: today });

    // Buying more brings the same row back, with a clean slate.
    const back = await ok(kevin, 'pantry_update', { items: [{ name: 'eggs', quantity: 6 }] });
    expect(back.changed[0]).toMatchObject({ id: 1, did: 'restocked', now: '6 in fridge' });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM pantry_items').get()).toEqual({ n: 1 });
  });

  it('adds "chicken thighs, 2 lbs, expires Friday" and subtracts across units', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'chicken thighs', quantity: 2, unit: 'lb', expires_on: inDays(5) }] });
    expect(item(kevin, 'Chicken Thigh')).toMatchObject({ name: 'chicken thighs', location: 'fridge', quantity: 2, unit: 'lb', expires_on: inDays(5) });
    const r = await ok(kevin, 'pantry_update', { items: [{ name: 'Chicken thighs', op: 'use', quantity: 8, unit: 'oz' }] });
    expect(r.changed[0].now).toBe(`1.5 lb in fridge, expires ${inDays(5)}`);
    // More of the same: quantities add, and the earlier date stays for the older stock.
    const more = await ok(kevin, 'pantry_update', { items: [{ name: 'chicken thighs', quantity: 1, unit: 'lb', expires_on: inDays(9) }] });
    expect(more.changed[0]).toMatchObject({ did: 'increased', now: `2.5 lb in fridge, expires ${inDays(5)}` });
    expect(more.changed[0].note).toMatch(/earlier expiry/);
  });

  it('"we\'re out of milk" keeps the row, and can put it on the shopping list in the same call', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'Milk', quantity: 1, unit: 'gallon', expires_on: inDays(2) }, { name: 'butter', quantity: 2, unit: 'stick' }] });
    const r = await ok(kevin, 'pantry_update', { items: [{ name: 'milk', op: 'out', add_to_shopping_list: true }] });
    expect(r.changed[0]).toMatchObject({ name: 'Milk', did: 'ran_out', now: 'out of stock', note: 'on the shopping list' });
    expect((await view(kevin, 'pantry/shopping_list')).items).toMatchObject([{ name: 'Milk', source: 'ran_out', checked: false, in_pantry: false }]);

    // The SQL the model would write for "what am I out of".
    const out = await ok(kevin, 'query', { sql: 'SELECT name, ran_out_on FROM pantry_items WHERE in_stock = 0 ORDER BY ran_out_on DESC' });
    expect(out.rows).toEqual([{ name: 'Milk', ran_out_on: today }]);
    const have = await ok(kevin, 'query', { sql: "SELECT name FROM pantry_items WHERE in_stock = 1 AND name_key LIKE '%butter%'" });
    expect(have.rows).toEqual([{ name: 'butter' }]);
    // Saying it twice changes nothing and says so.
    const again = await ok(kevin, 'pantry_update', { items: [{ name: 'milk', op: 'out' }] });
    expect(again.changed[0]).toMatchObject({ did: 'unchanged', note: 'was already out' });
  });

  it('takes a 25-item receipt in one call and merges with what is already there', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'bananas', quantity: 2, location: 'counter' }, { name: 'Olive oil', amount_note: 'almost empty', location: 'pantry' }] });
    const receipt = [
      { name: 'Bananas', quantity: 6 },
      { name: 'olive oil', quantity: 1, unit: 'bottle' },
      { name: 'Whole milk', quantity: 1, unit: 'gallon', location: 'fridge', category: 'dairy', expires_on: inDays(10) },
      { name: 'Eggs', quantity: 12, location: 'fridge', category: 'dairy' },
      { name: 'Ground beef', quantity: 1.5, unit: 'lb', location: 'fridge', category: 'meat', expires_on: inDays(2) },
      { name: 'Chicken thighs', quantity: 2, unit: 'lb', location: 'freezer', category: 'meat' },
      { name: 'Yellow onions', quantity: 3, location: 'pantry', category: 'produce' },
      { name: 'Garlic', quantity: 2, unit: 'head', location: 'pantry', category: 'produce' },
      { name: 'Roma tomatoes', quantity: 5, location: 'counter', category: 'produce' },
      { name: 'Baby spinach', quantity: 1, unit: 'bag', location: 'fridge', category: 'produce', expires_on: inDays(4) },
      { name: 'Cilantro', quantity: 1, unit: 'bunch', location: 'fridge', category: 'produce', expires_on: inDays(5) },
      { name: 'Limes', quantity: 4, location: 'fridge', category: 'produce' },
      { name: 'Black beans', quantity: 3, unit: 'can', location: 'pantry', category: 'canned' },
      { name: 'Kidney beans', quantity: 2, unit: 'can', location: 'pantry', category: 'canned' },
      { name: 'Crushed tomatoes', quantity: 2, unit: 'can', location: 'pantry', category: 'canned' },
      { name: 'Chicken broth', quantity: 32, unit: 'oz', location: 'pantry', category: 'canned' },
      { name: 'Arborio rice', quantity: 2, unit: 'lb', location: 'pantry', category: 'grains' },
      { name: 'Spaghetti', quantity: 1, unit: 'lb', location: 'pantry', category: 'grains' },
      { name: 'Flour', quantity: 5, unit: 'lb', location: 'pantry', category: 'baking' },
      { name: 'Chili powder', quantity: 1, unit: 'jar', location: 'pantry', category: 'spices' },
      { name: 'Cumin', quantity: 1, unit: 'jar', location: 'pantry', category: 'spices' },
      { name: 'Parmesan', quantity: 8, unit: 'oz', location: 'fridge', category: 'dairy' },
      { name: 'Butter', quantity: 1, unit: 'lb', location: 'fridge', category: 'dairy' },
      { name: 'Greek yogurt', quantity: 32, unit: 'oz', location: 'fridge', category: 'dairy', expires_on: inDays(12) },
      { name: 'Frozen peas', quantity: 1, unit: 'bag' },
    ];
    expect(receipt).toHaveLength(25);
    const r = await ok(kevin, 'pantry_update', { items: receipt });
    expect(r.changed).toHaveLength(25);
    expect(r.not_applied).toBeUndefined();
    expect(r.changed[0]).toMatchObject({ name: 'bananas', did: 'increased', now: '8 in counter' });
    // "almost empty" could not be added to numerically: the new bottle becomes the amount.
    expect(r.changed[1]).toMatchObject({ name: 'Olive oil', did: 'set' });
    expect(item(kevin, 'frozen peas')!.location).toBe('freezer');
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM pantry_items WHERE in_stock = 1').get()).toEqual({ n: 25 });
    const o = await view(kevin, 'pantry/overview');
    expect(o.counts).toMatchObject({ in_stock: 25, out_of_stock: 0, expiring_soon: 1, expired: 0 });
    expect(o.counts.by_location).toEqual({ counter: 2, fridge: 9, freezer: 2, pantry: 12 });
    // The whole call is one audit row and one daily-log event.
    expect(kevin.db.prepare("SELECT COUNT(*) AS n FROM tool_audit WHERE tool = 'pantry_update' AND ok = 1").get()).toEqual({ n: 2 });
  });

  it('sets, edits, renames and removes; amounts in words are kept as words', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'rice', amount_note: 'half a bag', location: 'pantry' }] });
    expect(item(kevin, 'rice')).toMatchObject({ quantity: null, amount_note: 'half a bag', in_stock: 1 });
    expect((await view(kevin, 'pantry/items')).items[0]).toMatchObject({ name: 'rice', amount: 'half a bag', days_left: null, expiry: null });

    // "used some rice": nothing to subtract from, and the reply says what to do.
    const used = await ok(kevin, 'pantry_update', { items: [{ name: 'rice', op: 'use', quantity: 1, unit: 'cup' }] });
    expect(used.changed[0]).toMatchObject({ did: 'unchanged' });
    expect(used.changed[0].note).toMatch(/not a number.*half a bag/);

    // A fridge photo count: set replaces the amount and clears the words.
    const set = await ok(kevin, 'pantry_update', { items: [{ name: 'Rice', op: 'set', quantity: 2, unit: 'lb' }] });
    expect(set.changed[0]).toMatchObject({ did: 'set', now: '2 lb in pantry' });
    expect(item(kevin, 'rice')!.amount_note).toBeNull();

    const edit = await ok(kevin, 'pantry_update', { items: [{ name: 'rice', op: 'edit', new_name: 'Basmati rice', category: 'grains', notes: 'the big bag', expires_on: inDays(300), location: 'other' }] });
    expect(edit.changed[0]).toMatchObject({ name: 'Basmati rice', did: 'edited', now: `2 lb in other, expires ${inDays(300)}` });
    expect(item(kevin, 'basmati rice')).toMatchObject({ category: 'grains', notes: 'the big bag', quantity: 2 });
    // "rice" still finds it, as the only similar item.
    expect((await ok(kevin, 'pantry_update', { items: [{ name: 'rice', op: 'edit', expires_on: null }] })).changed[0].now).toBe('2 lb in other');

    // set to zero is running out; by id works for the page.
    const id = item(kevin, 'basmati rice')!.id;
    expect((await ok(kevin, 'pantry_update', { items: [{ id, op: 'set', quantity: 0 }] })).changed[0].did).toBe('ran_out');
    expect((await ok(kevin, 'pantry_update', { items: [{ id, op: 'remove' }] })).changed[0]).toMatchObject({ did: 'removed', name: 'Basmati rice' });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM pantry_items').get()).toEqual({ n: 0 });
  });

  it('records an extra amount it cannot add up instead of losing it', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'flour', quantity: 1, unit: 'bag' }] });
    const r = await ok(kevin, 'pantry_update', { items: [{ name: 'flour', quantity: 2, unit: 'lb' }, { name: 'flour', op: 'use', quantity: 1, unit: 'cup' }] });
    expect(r.changed[0].now).toBe('1 bag (plus 2 lb) in pantry');
    expect(r.changed[1]).toMatchObject({ did: 'unchanged' });
    expect(r.changed[1].note).toMatch(/cannot subtract 1 cup from 1 bag/);
  });

  it('keeps the same item in two places apart, and uses the one that expires first', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'chicken thighs', quantity: 2, unit: 'lb', location: 'freezer' }] });
    const fresh = await ok(kevin, 'pantry_update', { items: [{ name: 'Chicken thighs', quantity: 1, unit: 'lb', location: 'fridge', expires_on: inDays(2) }] });
    expect(fresh.changed[0]).toMatchObject({ did: 'added', note: 'also 2 lb in freezer' });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM pantry_items').get()).toEqual({ n: 2 });

    const used = await ok(kevin, 'pantry_update', { items: [{ name: 'chicken thighs', op: 'use', quantity: 0.5, unit: 'lb' }] });
    expect(used.changed[0].now).toBe(`0.5 lb in fridge, expires ${inDays(2)}`);
    // "We're out of chicken" could mean either: ask.
    const out = await call(kevin, 'pantry_update', { items: [{ name: 'chicken thighs', op: 'out' }] });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/is in (fridge and freezer|freezer and fridge)\. Give the location/);
    expect((await ok(kevin, 'pantry_update', { items: [{ name: 'chicken thighs', op: 'out', location: 'fridge' }] })).changed[0].did).toBe('ran_out');
    // With one row out, the name alone means the one that is left.
    expect((await ok(kevin, 'pantry_update', { items: [{ name: 'chicken thighs', op: 'use', quantity: 1 }] })).changed[0].now).toBe('1 lb in freezer');
    // Moving a row onto another is refused, not merged silently.
    const move = await call(kevin, 'pantry_update', { items: [{ id: item(kevin, 'chicken thighs', 'fridge')!.id, op: 'edit', location: 'freezer' }] });
    expect(move.text).toMatch(/already chicken thighs in freezer/i);
  });

  it('applies what it can from a list and explains the rest', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'black beans', quantity: 2, unit: 'can' }, { name: 'green beans', quantity: 1, unit: 'lb' }, { name: 'salsa', quantity: 1, unit: 'jar' }] });
    const r = await ok(kevin, 'pantry_update', {
      items: [{ name: 'salsa', op: 'out' }, { name: 'beans', op: 'use', quantity: 1 }, { name: 'saffron', op: 'use', quantity: 1 }, { name: 'bean dip', op: 'out' }],
    });
    expect(r.changed.map((c: any) => c.name)).toEqual(['salsa']);
    expect(r.not_applied).toEqual([
      { name: 'beans', reason: '"beans" could be black beans (pantry) or green beans (pantry). Use the exact name.' },
      { name: 'saffron', reason: 'No "saffron" in the pantry.' },
      { name: 'bean dip', reason: 'No "bean dip" in the pantry. Closest: black beans, green beans.' },
    ]);
    // A looser name with one candidate just works.
    expect((await ok(kevin, 'pantry_update', { items: [{ name: 'black bean', op: 'use', quantity: 1 }] })).changed[0].now).toBe('1 can in pantry');

    // Nothing applicable at all is an error the model can act on.
    const none = await call(kevin, 'pantry_update', { items: [{ name: 'saffron', op: 'use', quantity: 1 }] });
    expect(none.ok).toBe(false);
    expect(none.text).toBe('Nothing was changed. No "saffron" in the pantry.');
  });

  it('rejects bad input with a message naming the field', async () => {
    const kevin = await makeKevin([pantry]);
    for (const [input, re] of [
      [{ items: [] }, /items/],
      [{}, /items/],
      [{ items: [{ name: 'milk', expires_on: 'Friday' }] }, /expires_on.*YYYY-MM-DD/],
      [{ items: [{ name: 'milk', expires_on: '2026-02-31' }] }, /expires_on/],
      [{ items: [{ name: 'milk', quantity: -1 }] }, /quantity/],
      [{ items: [{ name: 'milk', quantity: 'two' }] }, /quantity/],
      [{ items: [{ name: 'milk', op: 'drink' }] }, /op/],
      [{ items: [{ name: 'milk', location: 'garage' }] }, /location/],
      [{ items: [{ op: 'out' }] }, /needs a name or an id/],
      [{ items: [{ id: 99, op: 'out' }] }, /No pantry item with id 99/],
    ] as [unknown, RegExp][]) {
      const r = await call(kevin, 'pantry_update', input);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(r.text).toMatch(re);
    }
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM pantry_items').get()).toEqual({ n: 0 });
  });

  it('is callable from the page and is offered to the model with a usable schema', async () => {
    const kevin = await makeKevin([pantry]);
    expect((await call(kevin, 'pantry_update', { items: [{ name: 'lemons', quantity: 3 }] }, { source: 'ui' })).ok).toBe(true);
    const tools = kevin.tools.apiTools().filter((t) => t.name.startsWith('pantry_'));
    expect(tools.map((t) => t.name)).toEqual(['pantry_shopping_list_update', 'pantry_update']);
    expect(tools[1]!.input_schema).toMatchObject({ type: 'object', required: ['items'] });
    // The schema, comments included, and the area note are in the system prompt.
    expect(kevin.stableSystem).toMatch(/CREATE TABLE pantry_items \(/);
    expect(kevin.stableSystem).toMatch(/in_stock INTEGER NOT NULL DEFAULT 1,\s+-- 1 = in the house/);
    expect(kevin.stableSystem).toMatch(/CREATE TABLE pantry_shopping_list/);
    expect(kevin.stableSystem).toMatch(/## pantry\n/);
  });
});

describe('expiry', () => {
  const stock = async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', {
      items: [
        { name: 'Milk', quantity: 0.5, unit: 'gallon', location: 'fridge', expires_on: inDays(1) },
        { name: 'Spinach', quantity: 1, unit: 'bag', location: 'fridge', expires_on: inDays(-2) },
        { name: 'Ground beef', quantity: 1, unit: 'lb', location: 'fridge', expires_on: inDays(0) },
        { name: 'Yogurt', quantity: 2, location: 'fridge', expires_on: inDays(3) },
        { name: 'Cheddar', quantity: 8, unit: 'oz', location: 'fridge', expires_on: inDays(6) },
        { name: 'Tortillas', quantity: 10, location: 'pantry', expires_on: inDays(20) },
        { name: 'Rice', quantity: 2, unit: 'lb', location: 'pantry' },
        { name: 'Sour cream', quantity: 1, unit: 'tub', location: 'fridge', expires_on: inDays(1) },
      ],
    });
    // Out of stock things never count as expiring.
    await ok(kevin, 'pantry_update', { items: [{ name: 'sour cream', op: 'out' }] });
    return kevin;
  };

  it('answers "what\'s expiring this week" through SQL', async () => {
    const kevin = await stock();
    const r = await ok(kevin, 'query', {
      sql: `SELECT name, location, quantity, unit, expires_on FROM pantry_items WHERE in_stock = 1 AND expires_on <= '${inDays(7)}' ORDER BY expires_on`,
    });
    expect(r.rows.map((x: any) => x.name)).toEqual(['Spinach', 'Ground beef', 'Milk', 'Yogurt', 'Cheddar']);
    expect(r.rows[0]).toEqual({ name: 'Spinach', location: 'fridge', quantity: 1, unit: 'bag', expires_on: inDays(-2) });
  });

  it('gives the page expiry status per item and an expiring list', async () => {
    const kevin = await stock();
    const week = await view(kevin, 'pantry/expiring');
    expect(week).toMatchObject({ today, days: 7 });
    expect(week.items.map((i: any) => [i.name, i.days_left, i.expiry])).toEqual([
      ['Spinach', -2, 'expired'], ['Ground beef', 0, 'soon'], ['Milk', 1, 'soon'], ['Yogurt', 3, 'soon'], ['Cheddar', 6, 'soon'],
    ]);
    expect((await view(kevin, 'pantry/expiring', { days: '1' })).items.map((i: any) => i.name)).toEqual(['Spinach', 'Ground beef', 'Milk']);

    const o = await view(kevin, 'pantry/overview');
    expect(o.soon_days).toBe(3);
    expect(o.expiring.map((i: any) => i.name)).toEqual(['Spinach', 'Ground beef', 'Milk', 'Yogurt']);
    expect(o.counts).toMatchObject({ in_stock: 7, out_of_stock: 1, expired: 1, expiring_soon: 3, to_buy: 0, checked: 0 });
    expect(o.out_of_stock).toMatchObject([{ name: 'Sour cream', in_stock: false, ran_out_on: today, amount: '', days_left: null, expiry: null }]);
    const cheddar = o.items.find((i: any) => i.name === 'Cheddar');
    expect(cheddar).toEqual({
      id: cheddar.id, name: 'Cheddar', location: 'fridge', category: null, quantity: 8, unit: 'oz', amount_note: null, amount: '8 oz',
      expires_on: inDays(6), days_left: 6, expiry: 'ok', notes: null, in_stock: true, ran_out_on: null, on_shopping_list: false,
      created_at: cheddar.created_at, updated_at: cheddar.updated_at,
    });

    const fridge = await view(kevin, 'pantry/items', { location: 'fridge' });
    expect(fridge.items.map((i: any) => i.name)).toEqual(['Cheddar', 'Ground beef', 'Milk', 'Spinach', 'Yogurt']);
    expect((await view(kevin, 'pantry/items', { q: 'CREAM', include_out: '1' })).items.map((i: any) => i.name)).toEqual(['Sour cream']);
    expect((await view(kevin, 'pantry/items', { q: 'cream' })).items).toEqual([]);
  });

  it('puts expired and soon-to-expire items on Home, and nothing when nothing matters', async () => {
    const kevin = await stock();
    expect(await view(kevin, 'pantry/home')).toEqual({
      cards: [{ title: 'Use soon', lines: ['Spinach — expired 2 days ago', 'Ground beef — expires today', 'Milk — expires tomorrow', 'Yogurt — expires in 3 days'], link: '/pantry' }],
    });
    await ok(kevin, 'pantry_shopping_list_update', { add: [{ name: 'eggs' }, { name: 'limes' }, { name: 'bread' }, { name: 'coffee' }, { name: 'oat milk' }] });
    const home = await view(kevin, 'pantry/home');
    expect(home.cards[1]).toEqual({ title: 'Shopping list', lines: ['5 items to buy', 'eggs, limes, bread, coffee +1'], link: '/pantry' });

    const empty = await makeKevin([pantry]);
    expect(await view(empty, 'pantry/home')).toEqual({ cards: [] });
    await ok(empty, 'pantry_update', { items: [{ name: 'rice', quantity: 1, unit: 'bag' }, { name: 'cheddar', expires_on: inDays(30) }] });
    expect(await view(empty, 'pantry/home')).toEqual({ cards: [] });
  });
});

describe('shopping list', () => {
  it('adds many at once, without duplicating what is already listed', async () => {
    const kevin = await makeKevin([pantry]);
    const r = await ok(kevin, 'pantry_shopping_list_update', {
      add: [{ name: 'Eggs' }, { name: 'ground beef', quantity: 2, unit: 'lb' }, { name: 'Limes', quantity: 4, note: 'for tacos' }],
    });
    expect(r).toEqual({ added: ['Eggs', 'ground beef', 'Limes'], list: { to_buy: 3, checked: 0 } });
    const again = await ok(kevin, 'pantry_shopping_list_update', { add: [{ name: 'eggs', quantity: 12 }, { name: 'LIME' }] });
    expect(again).toEqual({ already_listed: ['Eggs', 'Limes'], list: { to_buy: 3, checked: 0 } });
    const list = await view(kevin, 'pantry/shopping_list');
    expect(list).toMatchObject({ to_buy: 3, checked: 0 });
    expect(list.items[0]).toEqual({
      id: 1, name: 'Eggs', quantity: 12, unit: null, amount: '12', note: null, checked: false, source: 'manual', recipe_id: null, for_recipe: null, in_pantry: false,
      created_at: list.items[0].created_at, updated_at: list.items[0].updated_at,
    });
    expect(list.items[2]).toMatchObject({ name: 'Limes', quantity: 4, note: 'for tacos' });
  });

  it('checks, unchecks, removes and clears', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_shopping_list_update', { add: [{ name: 'eggs' }, { name: 'milk' }, { name: 'bread' }, { name: 'coffee' }] });
    const r = await ok(kevin, 'pantry_shopping_list_update', { check: ['Eggs', 2, 'butter'], remove: ['coffee'] });
    expect(r).toEqual({ checked: ['eggs', 'milk'], removed: ['coffee'], not_found: ['butter'], list: { to_buy: 1, checked: 2 } });
    // Checked items sort to the bottom for the page.
    expect((await view(kevin, 'pantry/shopping_list')).items.map((i: any) => [i.name, i.checked])).toEqual([['bread', false], ['eggs', true], ['milk', true]]);
    expect(await ok(kevin, 'pantry_shopping_list_update', { uncheck: ['milk'] })).toEqual({ unchecked: ['milk'], list: { to_buy: 2, checked: 1 } });
    expect(await ok(kevin, 'pantry_shopping_list_update', { clear: 'checked' })).toEqual({ cleared: 1, list: { to_buy: 2, checked: 0 } });
    // Clearing puts nothing in the pantry.
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM pantry_items').get()).toEqual({ n: 0 });
    expect(await ok(kevin, 'pantry_shopping_list_update', { clear: 'all' })).toEqual({ cleared: 2, list: { to_buy: 0, checked: 0 } });
  });

  it('"I bought everything on the list" moves it all into the pantry in one call', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_update', { items: [{ name: 'eggs', quantity: 2, location: 'fridge' }, { name: 'Milk', quantity: 1, unit: 'gallon', location: 'fridge' }] });
    await ok(kevin, 'pantry_update', { items: [{ name: 'milk', op: 'out', add_to_shopping_list: true }] });
    await ok(kevin, 'pantry_shopping_list_update', { add: [{ name: 'Eggs', quantity: 12 }, { name: 'ground beef', quantity: 2, unit: 'lb' }, { name: 'paper towels' }] });
    expect((await view(kevin, 'pantry/overview')).items.find((i: any) => i.name === 'eggs').on_shopping_list).toBe(true);

    const r = await ok(kevin, 'pantry_shopping_list_update', { purchase: 'all' });
    expect(r).toEqual({
      purchased: [
        { name: 'Milk', now: 'some in fridge' },
        { name: 'eggs', now: '14 in fridge' },
        { name: 'ground beef', now: '2 lb in fridge' },
        { name: 'paper towels', now: 'some in pantry' },
      ],
      list: { to_buy: 0, checked: 0 },
    });
    expect((await view(kevin, 'pantry/shopping_list')).items).toEqual([]);
    expect(item(kevin, 'milk')).toMatchObject({ in_stock: 1, ran_out_on: null, quantity: null });
    expect((await call(kevin, 'pantry_shopping_list_update', { purchase: 'all' })).text).toBe('The shopping list is empty.');
  });

  it('purchases only the checked items, or only the ones named', async () => {
    const kevin = await makeKevin([pantry]);
    await ok(kevin, 'pantry_shopping_list_update', { add: [{ name: 'eggs', quantity: 12 }, { name: 'whole milk', quantity: 1, unit: 'gallon' }, { name: 'bread' }, { name: 'coffee' }] });
    expect((await call(kevin, 'pantry_shopping_list_update', { purchase: 'checked' })).text).toMatch(/No items on the shopping list are checked/);
    await ok(kevin, 'pantry_shopping_list_update', { check: ['eggs'] });
    const checked = await ok(kevin, 'pantry_shopping_list_update', { purchase: 'checked' });
    expect(checked).toEqual({ purchased: [{ name: 'eggs', now: '12 in fridge' }], list: { to_buy: 3, checked: 0 } });
    // "Got the milk and the bread" — "milk" finds "whole milk".
    const named = await ok(kevin, 'pantry_shopping_list_update', { purchase: ['milk', 'bread', 'bananas'] });
    expect(named.purchased.map((p: any) => p.name)).toEqual(['whole milk', 'bread']);
    expect(named.not_found).toEqual(['bananas']);
    expect(named.list).toEqual({ to_buy: 1, checked: 0 });
    expect(kevin.db.prepare('SELECT name FROM pantry_items WHERE in_stock = 1 ORDER BY name').all()).toEqual([{ name: 'bread' }, { name: 'eggs' }, { name: 'whole milk' }]);
  });

  it('explains a call that does nothing', async () => {
    const kevin = await makeKevin([pantry]);
    expect((await call(kevin, 'pantry_shopping_list_update', {})).text).toMatch(/Nothing to do/);
    await ok(kevin, 'pantry_shopping_list_update', { add: [{ name: 'eggs' }] });
    expect((await call(kevin, 'pantry_shopping_list_update', { check: ['butter'] })).text).toBe('Not on the shopping list: butter. On it: eggs.');
    expect((await call(kevin, 'pantry_shopping_list_update', { add: [{ name: 'x', quantity: 0 }] })).ok).toBe(false);
    expect((await call(kevin, 'pantry_shopping_list_update', { purchase: 'some' })).ok).toBe(false);
  });
});
