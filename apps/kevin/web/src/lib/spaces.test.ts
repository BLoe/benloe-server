import { describe, expect, it } from 'vitest';
import { buildNav, tabEntries } from './nav';
import {
  boardColumns, boardField, countsLabel, draftOf, dueLabel, dueState, fieldDrafts, fieldInputs, formatValue, fromInput, iconName, keyify, parseOptions, recordInput, rowSummary, safeUrl, splitDone,
  tableColumns, toInput, type Field, type NavPayload, type Space, type SpaceRecord,
} from './spaces';

const TODAY = '2026-11-14';
const f = (type: Field['type'], extra: Partial<Field> = {}): Field => ({ key: type, label: type.charAt(0).toUpperCase() + type.slice(1), type, ...extra });
const status = f('select', { key: 'status', label: 'Status', options: ['Idea', 'Booked', 'Done'] });

function space(over: Partial<Space> = {}): Space {
  return {
    id: 1, slug: 'trip', name: 'Trip', icon: 'plane', description: null, layout: 'list', fields: [], board_field: null, pinned: true, archived: false, created_by: 'kevin',
    link: '/s/trip', counts: { total: 0, open: 0, due_soon: 0 }, ...over,
  };
}
let nextId = 1;
function rec(over: Partial<SpaceRecord> = {}): SpaceRecord {
  return { id: nextId++, title: 'A', done: false, due_on: null, body: null, data: {}, position: 0, created_at: '', updated_at: '', ...over };
}

describe('due dates', () => {
  it('classifies against today', () => {
    expect(dueState('2026-11-10', TODAY)).toBe('overdue');
    expect(dueState('2026-11-14', TODAY)).toBe('today');
    expect(dueState('2026-11-17', TODAY)).toBe('soon');
    expect(dueState('2026-11-18', TODAY)).toBe('later');
    expect(dueState(null, TODAY)).toBeNull();
    expect(dueState('2026-11-10', TODAY, true)).toBeNull();
    expect(dueState('next week', TODAY)).toBeNull();
  });
  it('labels in words', () => {
    expect(dueLabel('2026-11-14', TODAY)).toBe('Due today');
    expect(dueLabel('2026-11-15', TODAY)).toBe('Due tomorrow');
    expect(dueLabel('2026-11-20', TODAY)).toBe('Due Fri, Nov 20');
    expect(dueLabel('2026-11-13', TODAY)).toBe('Overdue since yesterday');
    expect(dueLabel('2026-11-10', TODAY)).toBe('Overdue, Tue, Nov 10');
  });
});

describe('formatValue', () => {
  it('formats each field type', () => {
    expect(formatValue(f('money'), 89)).toBe('$89');
    expect(formatValue(f('money'), 89.5)).toBe('$89.50');
    expect(formatValue(f('money'), 1234567.891)).toBe('$1,234,567.89');
    expect(formatValue(f('number'), 48200)).toBe('48,200');
    expect(formatValue(f('number'), 3.25)).toBe('3.25');
    expect(formatValue(f('date'), '2026-12-25')).toBe('Dec 25, 2026');
    expect(formatValue(f('date'), '2026-11-15', TODAY)).toBe('Tomorrow');
    expect(formatValue(f('checkbox'), true)).toBe('Yes');
    expect(formatValue(f('checkbox'), false)).toBe('No');
    expect(formatValue(f('select'), 'Booked')).toBe('Booked');
    expect(formatValue(f('url'), 'https://www.example.com/')).toBe('example.com');
    expect(formatValue(f('url'), 'https://example.com/a/very/long/path/that/keeps/going/and/going')).toHaveLength(40);
    expect(formatValue(f('text'), 'Midas')).toBe('Midas');
  });
  it('is empty for missing values and tolerant of values stored under another type', () => {
    for (const v of [null, undefined, '']) expect(formatValue(f('money'), v)).toBe('');
    expect(formatValue(f('money'), 'about fifty')).toBe('about fifty');
    expect(formatValue(f('number'), '48200')).toBe('48,200');
    expect(formatValue(f('date'), 'someday')).toBe('someday');
    expect(formatValue(f('checkbox'), 'yes')).toBe('Yes');
    expect(formatValue(f('url'), 'not a url')).toBe('not a url');
    expect(formatValue(f('text'), 0)).toBe('0');
  });
  it('only treats http(s) as a link', () => {
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('example.com')).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe('fromInput / toInput', () => {
  it('parses what a person types', () => {
    expect(fromInput(f('money'), ' $1,234.567 ')).toEqual({ value: 1234.57 });
    expect(fromInput(f('number'), '48,200')).toEqual({ value: 48200 });
    expect(fromInput(f('number'), '-3.5')).toEqual({ value: -3.5 });
    expect(fromInput(f('date'), '2026-12-25')).toEqual({ value: '2026-12-25' });
    expect(fromInput(status, 'booked')).toEqual({ value: 'Booked' });
    expect(fromInput(f('url'), 'example.com/menu')).toEqual({ value: 'https://example.com/menu' });
    expect(fromInput(f('url'), 'http://example.com')).toEqual({ value: 'http://example.com/' });
    expect(fromInput(f('checkbox'), 'true')).toEqual({ value: true });
    expect(fromInput(f('checkbox'), '')).toEqual({ value: false });
    expect(fromInput(f('text'), '  Midas  ')).toEqual({ value: '  Midas' });
  });
  it('clears with null on empty input', () => {
    for (const t of ['text', 'longtext', 'number', 'money', 'date', 'select', 'url'] as const) expect(fromInput(f(t), '  ')).toEqual({ value: null });
  });
  it('explains what is wrong', () => {
    expect(fromInput(f('money'), 'lots')).toEqual({ error: 'Money needs a number.' });
    expect(fromInput(f('date'), '12/25/2026')).toEqual({ error: 'Date needs a date.' });
    expect(fromInput(status, 'Maybe')).toEqual({ error: 'Status must be one of: Idea, Booked, Done.' });
    expect(fromInput(f('url'), 'javascript:alert(1)')).toEqual({ error: 'Url needs a web address.' });
  });
  it('round-trips stored values through the form', () => {
    const cases: [Field, unknown][] = [[f('money'), 89.5], [f('number'), 48200], [f('date'), '2026-12-25'], [status, 'Booked'], [f('checkbox'), true], [f('checkbox'), false], [f('text'), 'Midas'], [f('url'), 'https://example.com/a']];
    for (const [field, value] of cases) expect(fromInput(field, toInput(field, value))).toEqual({ value });
    expect(toInput(f('text'), null)).toBe('');
  });
});

describe('recordInput', () => {
  const s = space({ fields: [f('number', { key: 'mileage', label: 'Mileage' }), f('money', { key: 'cost', label: 'Cost' }), status] });

  it('sends everything filled in for a new record', () => {
    const d = { ...draftOf(s, null), title: ' Oil change ', due_on: '2026-11-20', data: { mileage: '48,200', cost: '$89', status: '' } };
    expect(recordInput(s, null, d)).toEqual({ input: { title: 'Oil change', due_on: '2026-11-20', data: { mileage: 48200, cost: 89 } } });
  });
  it('starts a new record from a preset (the board column it was added to)', () => {
    expect(draftOf(s, null, { status: 'Booked' }).data.status).toBe('Booked');
  });
  it('sends only what changed on an edit', () => {
    const r = rec({ id: 7, title: 'Oil change', due_on: '2026-11-20', body: 'note', data: { mileage: 48200, cost: 89, status: 'Idea' } });
    const same = draftOf(s, r);
    expect(recordInput(s, r, same)).toEqual({ input: { id: 7 } });
    expect(recordInput(s, r, { ...same, done: true, due_on: '', body: ' ', data: { ...same.data, cost: '', status: 'Booked' } })).toEqual({
      input: { id: 7, done: true, due_on: null, body: null, data: { cost: null, status: 'Booked' } },
    });
  });
  it('does not re-send a stale value that would fail validation', () => {
    const r = rec({ id: 8, title: 'Flights', data: { status: 'Retired option' } });
    expect(recordInput(s, r, { ...draftOf(s, r), title: 'Flights to Lisbon' })).toEqual({ input: { id: 8, title: 'Flights to Lisbon' } });
  });
  it('sends the whole file list when it changed, and nothing when it did not', () => {
    const file = (id: number) => ({ id, filename: `f${id}.jpg`, mime: 'image/jpeg', kind: 'image', url: `/api/attachments/${id}/raw` });
    const r = rec({ id: 9, title: 'Receipt', attachments: [file(1), file(2)] });
    const same = draftOf(s, r);
    expect(recordInput(s, r, same)).toEqual({ input: { id: 9 } });
    expect(recordInput(s, r, { ...same, attachments: [file(2), file(5)] })).toEqual({ input: { id: 9, attachment_ids: [2, 5] } });
    expect(recordInput(s, r, { ...same, attachments: [] })).toEqual({ input: { id: 9, attachment_ids: [] } });
    expect(recordInput(s, null, { ...draftOf(s, null), title: 'New', attachments: [file(3)] })).toEqual({ input: { title: 'New', attachment_ids: [3] } });
    expect(recordInput(s, null, { ...draftOf(s, null), title: 'New' })).toEqual({ input: { title: 'New' } });
  });

  it('reports a missing title or a bad value', () => {
    expect(recordInput(s, null, draftOf(s, null))).toEqual({ error: 'Give it a title.' });
    expect(recordInput(s, null, { ...draftOf(s, null), title: 'x', data: { mileage: 'far', cost: '', status: '' } })).toEqual({ error: 'Mileage needs a number.' });
  });
});

describe('grouping', () => {
  it('splits open from done, keeping the server order', () => {
    const rs = [rec({ title: 'a' }), rec({ title: 'b', done: true }), rec({ title: 'c' })];
    const g = splitDone(rs);
    expect(g.open.map((r) => r.title)).toEqual(['a', 'c']);
    expect(g.done.map((r) => r.title)).toEqual(['b']);
  });

  it('picks the board field: board_field if it is a choice, else the first choice field', () => {
    const other = f('select', { key: 'priority', label: 'Priority', options: ['Low', 'High'] });
    expect(boardField({ fields: [other, status], board_field: 'status' })?.key).toBe('status');
    expect(boardField({ fields: [f('text'), other, status], board_field: null })?.key).toBe('priority');
    expect(boardField({ fields: [f('text'), other], board_field: 'text' })?.key).toBe('priority');
    expect(boardField({ fields: [f('text')], board_field: null })).toBeNull();
  });

  it('builds one column per option, in order, keeping record order within a column', () => {
    const rs = [rec({ title: 'a', data: { status: 'Booked' } }), rec({ title: 'b', data: { status: 'Idea' } }), rec({ title: 'c', data: { status: 'booked' } })];
    const cols = boardColumns(status, rs);
    expect(cols.map((c) => [c.label, c.records.map((r) => r.title)])).toEqual([['Idea', ['b']], ['Booked', ['a', 'c']], ['Done', []]]);
  });

  it('puts records with no or an unknown value in a leading column that exists only when needed', () => {
    const rs = [rec({ title: 'a' }), rec({ title: 'b', data: { status: 'Cancelled' } }), rec({ title: 'c', data: { status: 'Done' } })];
    const cols = boardColumns(status, rs);
    expect(cols[0]).toMatchObject({ value: null, label: 'No status' });
    expect(cols[0]!.records.map((r) => r.title)).toEqual(['a', 'b']);
    expect(cols).toHaveLength(4);
    expect(boardColumns(status, [])).toHaveLength(3);
  });

  it('adds due and done columns to a table only when a record uses them', () => {
    const s = space({ fields: [f('text')] });
    expect(tableColumns(s, [rec()])).toMatchObject({ due: false, done: false });
    expect(tableColumns(s, [rec({ due_on: TODAY }), rec({ done: true })])).toMatchObject({ due: true, done: true });
  });

  it('summarises a row with its first set values', () => {
    const s = space({ fields: [f('longtext', { key: 'notes' }), f('number', { key: 'mileage', label: 'Mileage' }), f('checkbox', { key: 'booked', label: 'Booked' }), f('money', { key: 'cost', label: 'Cost' }), status] });
    const r = rec({ data: { notes: 'long…', mileage: 48200, booked: true, cost: 89, status: 'Idea' } });
    expect(rowSummary(s, r).map((x) => x.text)).toEqual(['48,200', 'Booked']);
    expect(rowSummary(s, rec({ data: { booked: false, cost: 89, status: 'Idea' } }), 2, 'status').map((x) => x.text)).toEqual(['$89']);
    expect(rowSummary(s, rec())).toEqual([]);
  });

  it('describes counts', () => {
    expect(countsLabel({ total: 0, open: 0, due_soon: 0 })).toBe('Empty');
    expect(countsLabel({ total: 1, open: 1, due_soon: 0 })).toBe('1 item');
    expect(countsLabel({ total: 5, open: 3, due_soon: 2 })).toBe('3 open of 5, 2 due soon');
  });
});

describe('the field editor', () => {
  it('parses choices from lines or commas, dropping blanks and repeats', () => {
    expect(parseOptions('To do\nDoing, Done\n\n doing ')).toEqual(['To do', 'Doing', 'Done']);
  });
  it('keeps keys of existing fields and leaves new ones for the server to derive', () => {
    const drafts = [...fieldDrafts([status]), { label: ' Cost ', type: 'money' as const, options: '' }];
    expect(fieldInputs(drafts, 'table')).toEqual({ fields: [{ key: 'status', label: 'Status', type: 'select', options: ['Idea', 'Booked', 'Done'] }, { label: 'Cost', type: 'money' }] });
  });
  it('rejects what the server would reject, in plain words', () => {
    expect(fieldInputs([{ label: '', type: 'text', options: '' }], 'list')).toEqual({ error: 'Every field needs a name.' });
    expect(fieldInputs([{ label: 'Cost', type: 'money', options: '' }, { label: 'cost', type: 'text', options: '' }], 'list')).toEqual({ error: 'Two fields are named “cost”.' });
    expect(fieldInputs([{ label: 'Stage', type: 'select', options: ' \n' }], 'list')).toEqual({ error: '“Stage” needs at least one choice.' });
    expect(fieldInputs([{ label: 'Title', type: 'text', options: '' }], 'list')).toMatchObject({ error: expect.stringContaining('already has') });
    expect(fieldInputs([{ label: 'Cost', type: 'money', options: '' }], 'board')).toMatchObject({ error: expect.stringContaining('board needs') });
  });
  it('derives keys and icon names the way the server and lucide spell them', () => {
    expect(keyify('Cost ($)')).toBe('cost');
    expect(keyify('Booked?')).toBe('booked');
    expect(iconName('BookOpen')).toBe('book-open');
    expect(iconName('heart_pulse')).toBe('heart-pulse');
    expect(iconName(' Car ')).toBe('car');
    expect(iconName(null)).toBe('');
  });
});

describe('navigation', () => {
  const builtin = [{ path: '/pantry', label: 'Pantry' }, { path: '/cooking', label: 'Cooking' }, { path: '/workouts', label: 'Workouts' }, { path: '/money', label: 'Money' }];
  const payload = (over: Partial<NavPayload> = {}): NavPayload => ({
    builtin: builtin.map((b) => ({ path: b.path, name: b.label, hidden: false })),
    spaces: [space({ slug: 'car', name: 'Car', link: '/s/car', icon: 'car', counts: { total: 3, open: 2, due_soon: 1 } }), space({ id: 2, slug: 'books', name: 'Books', link: '/s/books', pinned: false })],
    ...over,
  });

  it('shows every built-in until the server answers', () => {
    expect(buildNav(undefined, builtin).entries.map((e) => e.path)).toEqual(['/pantry', '/cooking', '/workouts', '/money']);
  });
  it('lists visible built-ins then pinned spaces, with a badge for what is due soon', () => {
    const nav = buildNav(payload(), builtin);
    expect(nav.entries.map((e) => e.path)).toEqual(['/pantry', '/cooking', '/workouts', '/money', '/s/car']);
    expect(nav.entries.at(-1)).toMatchObject({ kind: 'space', label: 'Car', icon: 'car', badge: 1 });
    expect(nav.spaces.map((s) => s.slug)).toEqual(['car', 'books']);
  });
  it('drops hidden built-ins, so the tab bar fills with what is left', () => {
    const p = payload();
    p.builtin[0]!.hidden = true;
    p.builtin[2]!.hidden = true;
    const nav = buildNav(p, builtin);
    expect(nav.hidden).toEqual(['/pantry', '/workouts']);
    expect(tabEntries(nav.entries).tabs.map((e) => e.path)).toEqual(['/cooking', '/money', '/s/car']);
    expect(tabEntries(nav.entries).rest).toEqual([]);
  });
  it('ignores built-ins this client has no page for, and keeps ones the server does not list', () => {
    const p = payload({ builtin: [{ path: '/garden', name: 'Garden', hidden: false }, { path: '/money', name: 'Money', hidden: false }], spaces: [] });
    expect(buildNav(p, builtin).entries.map((e) => e.path)).toEqual(['/money', '/pantry', '/cooking', '/workouts']);
  });
  it('splits the phone tab bar from what goes behind More', () => {
    const { tabs, rest } = tabEntries(buildNav(payload(), builtin).entries);
    expect(tabs.map((e) => e.path)).toEqual(['/pantry', '/cooking', '/workouts']);
    expect(rest.map((e) => e.path)).toEqual(['/money', '/s/car']);
  });
});
