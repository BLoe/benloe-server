import { describe, expect, it } from 'vitest';
import spaces from '../src/domains/spaces.js';
import { localDay } from '../src/time.js';
import { call, makeKevin, ok, view } from './helpers.js';

describe('spaces', () => {
  it('makes a space for something new, with records, in two calls, and it shows up in the nav', async () => {
    const kevin = await makeKevin([spaces]);
    const s = await ok(kevin, 'space_save', {
      name: 'Car maintenance', icon: 'car', layout: 'table', description: 'Service history for the Subaru',
      fields: [{ label: 'Mileage', type: 'number' }, { label: 'Cost', type: 'money' }, { label: 'Shop' }],
    });
    expect(s).toMatchObject({ slug: 'car-maintenance', link: '/s/car-maintenance', layout: 'table', created_by: 'kevin' });
    expect(s.fields.map((f: any) => f.key)).toEqual(['mileage', 'cost', 'shop']);

    const due = localDay(new Date(Date.now() + 86_400_000));
    const r = await ok(kevin, 'space_records_update', {
      space: 'Car maintenance',
      records: [
        { title: 'Oil change', data: { mileage: '48,200', cost: '$89.50', shop: 'Midas' }, done: true },
        { title: 'Tire rotation', due_on: due },
        { title: 'Brake inspection', due_on: '2030-01-01', body: 'Squeak on the **front left**.' },
      ],
    });
    expect(r).toMatchObject({ added: ['Oil change', 'Tire rotation', 'Brake inspection'], counts: { total: 3, open: 2, due_soon: 1 } });

    const page = await view(kevin, 'spaces/get', { space: 'car-maintenance' });
    expect(page.records.map((x: any) => x.title)).toEqual(['Tire rotation', 'Brake inspection', 'Oil change']); // open first, by due date
    expect(page.records[2].data).toEqual({ mileage: 48200, cost: 89.5, shop: 'Midas' });

    const nav = await view(kevin, 'spaces/nav');
    expect(nav.spaces.map((x: any) => x.slug)).toEqual(['car-maintenance']);
    expect(nav.builtin.map((b: any) => b.path)).toContain('/pantry');
    expect((await view(kevin, 'spaces/home')).cards).toEqual([{ title: 'Car maintenance', lines: [`Tire rotation — due ${due}`], link: '/s/car-maintenance' }]);

    // The model reads it with plain SQL, and recall finds it.
    const q = await ok(kevin, 'query', { sql: "SELECT r.title, json_extract(r.data, '$.cost') AS cost FROM space_records r JOIN spaces s ON s.id = r.space_id WHERE s.slug = 'car-maintenance' AND r.done = 1" });
    expect(q.rows).toEqual([{ title: 'Oil change', cost: 89.5 }]);
    expect((await ok(kevin, 'recall', { query: 'squeak front left' })).hits[0]).toMatchObject({ kind: 'space-record' });
    expect(kevin.stableSystem).toContain('CREATE TABLE space_records');
  });

  it('updates by id or by title, ticks off, and deletes', async () => {
    const kevin = await makeKevin([spaces]);
    await ok(kevin, 'space_save', { name: 'Reading list', layout: 'checklist' });
    await ok(kevin, 'space_records_update', { space: 'reading-list', records: [{ title: 'Dune' }, { title: 'Piranesi' }] });
    const r = await ok(kevin, 'space_records_update', { space: 'reading-list', records: [{ title: 'dune', match_title: true, done: true }, { title: 'Piranesi', delete: true }, { title: 'Dune' }] });
    expect(r).toMatchObject({ updated: ['dune'], deleted: ['Piranesi'], added: ['Dune'] });
    const page = await view(kevin, 'spaces/get', { space: 'reading-list' });
    expect(page.records.map((x: any) => [x.title, x.done])).toEqual([['Dune', false], ['dune', true]]);
    expect((await ok(kevin, 'recall', { query: 'Piranesi', kinds: ['space-record'] })).hits).toEqual([]);
  });

  it('validates values against the space\'s fields with messages the model can act on', async () => {
    const kevin = await makeKevin([spaces]);
    await ok(kevin, 'space_save', { name: 'Trip', layout: 'board', fields: [{ label: 'Status', type: 'select', options: ['Idea', 'Booked'] }, { label: 'When', type: 'date' }] });
    const bad = async (data: unknown) => (await call(kevin, 'space_records_update', { space: 'trip', records: [{ title: 'x', data }] })).text;
    expect(await bad({ status: 'Maybe' })).toMatch(/must be one of: Idea, Booked/);
    expect(await bad({ when: 'next week' })).toMatch(/YYYY-MM-DD/);
    expect(await bad({ hotel: 'Ritz' })).toMatch(/not a field.*status, when/);
    expect((await view(kevin, 'spaces/get', { space: 'trip' })).records).toEqual([]); // nothing half-applied
    await ok(kevin, 'space_records_update', { space: 'trip', records: [{ title: 'Flights', data: { status: 'booked' } }] });
    expect((await view(kevin, 'spaces/get', { space: 'trip' })).space.board_field).toBe('status');
    expect((await call(kevin, 'space_save', { name: 'Bad board', layout: 'board' })).text).toMatch(/needs a select field/);
    expect((await call(kevin, 'space_save', { name: 'Trip' })).text).toMatch(/already a space/);
    expect((await call(kevin, 'space_records_update', { space: 'nope', records: [{ title: 'x' }] })).text).toMatch(/No space "nope". Spaces: trip/);
  });

  it('changes fields without losing stored values, archives, and deletes only with a yes', async () => {
    const kevin = await makeKevin([spaces]);
    await ok(kevin, 'space_save', { name: 'Gifts', fields: [{ label: 'For' }, { label: 'Price', type: 'money' }] });
    await ok(kevin, 'space_records_update', { space: 'gifts', records: [{ title: 'Scarf', data: { for: 'Mom', price: 40 } }] });
    await ok(kevin, 'space_save', { space: 'gifts', fields: [{ label: 'For' }, { label: 'Price', type: 'money' }, { label: 'Bought', type: 'checkbox' }] });
    await ok(kevin, 'space_records_update', { space: 'gifts', records: [{ title: 'Scarf', match_title: true, data: { bought: 'yes' } }] });
    expect((await view(kevin, 'spaces/get', { space: 'gifts' })).records[0].data).toEqual({ for: 'Mom', price: 40, bought: true });
    await ok(kevin, 'space_save', { space: 'gifts', archived: true });
    expect((await view(kevin, 'spaces/nav')).spaces).toEqual([]);
    expect((await view(kevin, 'spaces/list', { archived: '1' })).spaces[0].archived).toBe(true);
    // Deleting for good is Ben's, from the app; Kevin archives.
    expect((await call(kevin, 'space_delete', { space: 'gifts' })).ok).toBe(false);
    expect(kevin.tools.apiTools().map((t) => t.name)).not.toContain('space_delete');
    expect((await call(kevin, 'space_delete', { space: 'gifts' }, { source: 'ui' })).value).toEqual({ deleted: 'Gifts', records: 1 });
    expect((await view(kevin, 'spaces/get', { space: 'gifts' })).space).toBeNull();
  });

  it('lets Ben, not the agent, hide built-in pages', async () => {
    const kevin = await makeKevin([spaces]);
    expect((await call(kevin, 'nav_update', { hidden_pages: ['/taxes'] })).ok).toBe(false);
    expect((await call(kevin, 'nav_update', { hidden_pages: ['/taxes', '/nonsense'] }, { source: 'ui' })).ok).toBe(true);
    expect((await view(kevin, 'spaces/nav')).builtin.filter((b: any) => b.hidden).map((b: any) => b.path)).toEqual(['/taxes']);
  });

  it('stops a near-duplicate space unless Kevin insists, and lists spaces in the uncached prompt block', async () => {
    const kevin = await makeKevin([spaces]);
    const { factsBlock } = await import('../src/prompt.js');
    expect(factsBlock(kevin.db, kevin.domains)).toMatch(/# Spaces\n\nNone yet/);
    await ok(kevin, 'space_save', { name: 'Trip to Japan', layout: 'checklist', description: 'April 2027', fields: [{ label: 'Cost', type: 'money' }] });
    const dup = await call(kevin, 'space_save', { name: 'Japan trip' });
    expect(dup.ok).toBe(false);
    expect(dup.text).toMatch(/already "Trip to Japan" \(trip-to-japan\).*confirm_new/);
    expect((await call(kevin, 'space_save', { name: 'Japan trip', confirm_new: true })).ok).toBe(true);
    expect((await call(kevin, 'space_save', { name: 'Car maintenance' })).ok).toBe(true); // unrelated names pass
    const block = factsBlock(kevin.db, kevin.domains);
    expect(block).toMatch(/- trip-to-japan — Trip to Japan \(checklist; fields: cost\): April 2027/);
    expect(kevin.stableSystem).not.toContain('trip-to-japan'); // never in the cached prefix
  });

  it('keeps a field\'s key through a rename and converts values on a type change, refusing a lossy one', async () => {
    const kevin = await makeKevin([spaces]);
    await ok(kevin, 'space_save', { name: 'Repairs', fields: [{ label: 'Cost' }, { label: 'Shop' }] });
    await ok(kevin, 'space_records_update', { space: 'repairs', records: [{ title: 'Brakes', data: { cost: '$420.50', shop: 'Midas' } }, { title: 'Wipers', data: { cost: '18' } }] });
    // Rename by label match and by key; change Cost from text to money.
    const s = await ok(kevin, 'space_save', { space: 'repairs', fields: [{ key: 'cost', label: 'Total cost', type: 'money' }, { key: 'shop', label: 'Garage' }] });
    expect(s.fields).toEqual([{ key: 'cost', label: 'Total cost', type: 'money' }, { key: 'shop', label: 'Garage', type: 'text' }]);
    const q = await ok(kevin, 'query', { sql: "SELECT title, json_extract(data, '$.cost') AS cost, json_extract(data, '$.shop') AS shop FROM space_records ORDER BY id" });
    expect(q.rows).toEqual([{ title: 'Brakes', cost: 420.5, shop: 'Midas' }, { title: 'Wipers', cost: 18, shop: null }]);
    // A change that cannot be converted is refused and nothing is altered.
    const bad = await call(kevin, 'space_save', { space: 'repairs', fields: [{ key: 'cost', label: 'Total cost', type: 'money' }, { key: 'shop', label: 'Garage', type: 'date' }] });
    expect(bad.text).toMatch(/would lose data: the record "Brakes" holds "Midas"/);
    expect((await view(kevin, 'spaces/get', { space: 'repairs' })).space.fields[1].type).toBe('text');
  });

  it('puts an uploaded file on a record', async () => {
    const kevin = await makeKevin([spaces]);
    const { saveUpload } = await import('../src/attachments.js');
    const a = saveUpload(kevin.db, Buffer.from('Confirmation ABC123'), 'booking.txt');
    await ok(kevin, 'space_save', { name: 'Lisbon' });
    await ok(kevin, 'space_records_update', { space: 'lisbon', records: [{ title: 'Hotel', attachment_ids: [a.id] }] });
    expect((await view(kevin, 'spaces/get', { space: 'lisbon' })).records[0].attachments).toEqual([{ id: a.id, filename: 'booking.txt', mime: 'text/plain', kind: 'text', url: `/api/attachments/${a.id}/raw` }]);
    expect((await call(kevin, 'space_records_update', { space: 'lisbon', records: [{ title: 'Flight', attachment_ids: [999] }] })).text).toMatch(/no attachment #999/);
  });
});
