import { describe, expect, it } from 'vitest';
import {
  addMonths, barLayout, budgetBar, budgetNote, categorizeMerchantInput, dayLabel, daysBetween, draftOfTx, emptyImport, filterFromSearch, flipped, groupCategories, headerCandidates, importArgs, importError,
  isFlipped, lineLayout, monthLabel, nearestIndex, newTxInput, nextPage, niceCeil, ordinal, parseAmount, parseQuantity, recentMonths, searchFor, setMapping, shownMapping, signedMoney, snake,
  stackSegments, tabOf, tradeInput, txQuery, txToolFilter, txUpdate, withTransfer, EMPTY_FILTER, MAX_WINDOW, PAGE_SIZE,
} from './logic';
import type { BudgetItem, Category, Tx } from './types';

const cat = (name: string, group: string): Category => ({ name, label: name, group, budget: null, transaction_count: 0, rule_count: 0 });
const CATS = [cat('groceries', 'essentials'), cat('dining', 'lifestyle'), cat('income', 'income'), cat('transfer', 'transfers'), cat('credit_card_payment', 'transfers')];
const tx = (over: Partial<Tx> = {}): Tx => ({
  id: 7, date: '2026-10-05', amount: -84.12, description: 'TRADER JOE S #123', merchant: "Trader Joe's", category: 'groceries', category_label: 'Groceries', category_group: 'essentials',
  categorized_by: 'rule', is_transfer: false, pending: false, notes: null, account_id: 1, account: 'Chase checking', import_batch_id: 1, ...over,
});

describe('months and days', () => {
  it('adds months across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(recentMonths('2026-02', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });
  it('labels months and days', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-10', { thisYear: '2026' })).toBe('October');
    expect(monthLabel('2025-12', { short: true, thisYear: '2026' })).toBe('Dec 2025');
    expect(dayLabel('2026-11-14', '2026-11-15')).toBe('Nov 14');
    expect(dayLabel('2025-11-14', '2026-11-15')).toBe('Nov 14, 2025');
    expect(dayLabel(null, '2026-11-15')).toBe('—');
    expect(daysBetween('2026-11-14', '2026-12-01')).toBe(17);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
  });
});

describe('amounts', () => {
  it('writes the direction out', () => {
    expect(signedMoney(3200)).toBe('+$3,200.00');
    expect(signedMoney(-12.5)).toBe('-$12.50');
    expect(signedMoney(0)).toBe('$0.00');
    expect(signedMoney(-1499.6, { cents: false })).toBe('-$1,500');
  });
  it('parses what is typed in a dollar field', () => {
    expect(parseAmount('1,234.5')).toBe(1234.5);
    expect(parseAmount(' $40 ')).toBe(40);
    expect(parseAmount('-12.344')).toBe(-12.34);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12abc')).toBeNull();
    expect(parseQuantity('0.0421')).toBe(0.0421);
    expect(parseQuantity('-3')).toBeNull();
  });
  it('makes category keys the way the server does', () => {
    expect(snake(' Kids  Activities! ')).toBe('kids_activities');
    expect(snake('Gifts & charity')).toBe('gifts_charity');
  });
  it('groups categories in group order and drops empty groups', () => {
    const g = groupCategories(CATS, ['essentials', 'lifestyle', 'income', 'transfers', 'nothing']);
    expect(g.map((x) => [x.label, x.categories.length])).toEqual([['Essentials', 1], ['Lifestyle', 1], ['Income', 1], ['Transfers', 2]]);
  });
});

describe('the transaction filter', () => {
  it('reads the URL and drops what is malformed', () => {
    const f = filterFromSearch(new URLSearchParams('tab=transactions&account=3&category=dining&month=2026-13&q=costco&transfers=maybe&batch=x'));
    expect(f).toEqual({ account: '3', category: 'dining', month: '', q: 'costco', transfers: '', batch: '' });
    expect(filterFromSearch(new URLSearchParams('month=2026-10&transfers=exclude&batch=4'))).toMatchObject({ month: '2026-10', transfers: 'exclude', batch: '4' });
  });
  it('writes a short URL and round-trips', () => {
    expect(searchFor('overview')).toEqual({});
    expect(searchFor('budgets', { category: 'dining' })).toEqual({ tab: 'budgets' });
    const s = searchFor('transactions', { ...EMPTY_FILTER, category: 'uncategorized', q: '  blue bottle ' });
    expect(s).toEqual({ tab: 'transactions', category: 'uncategorized', q: 'blue bottle' });
    expect(filterFromSearch(new URLSearchParams(s))).toEqual({ ...EMPTY_FILTER, category: 'uncategorized', q: 'blue bottle' });
    expect(tabOf('nonsense')).toBe('overview');
  });
  it('builds the view query', () => {
    expect(txQuery(EMPTY_FILTER)).toEqual({ limit: 50 });
    expect(txQuery({ ...EMPTY_FILTER, account: '3', category: 'uncategorized', month: '2026-10', q: ' costco ', transfers: 'exclude', batch: '2' }, 150)).toEqual({
      account: '3', category: 'uncategorized', month: '2026-10', q: 'costco', transfers: 'exclude', batch: '2', limit: 150, offset: undefined,
    });
    expect(txQuery(EMPTY_FILTER, 9999, 500)).toMatchObject({ limit: MAX_WINDOW, offset: 500 });
    expect(txQuery(EMPTY_FILTER, 3)).toMatchObject({ limit: PAGE_SIZE });
  });
  it('builds the tool filter with typed values', () => {
    expect(txToolFilter({ ...EMPTY_FILTER, account: '3', month: '2026-10', batch: '2', q: ' x ' })).toEqual({ account: 3, month: '2026-10', batch_id: 2, q: 'x' });
    expect(txToolFilter(EMPTY_FILTER)).toEqual({});
  });
  it('pages by 50 up to the window, then by windows', () => {
    expect(nextPage(50, 0, 40)).toBeNull();
    expect(nextPage(50, 0, 51)).toEqual({ shown: 100, offset: 0 });
    expect(nextPage(480, 0, 900)).toEqual({ shown: 500, offset: 0 });
    expect(nextPage(500, 0, 900)).toEqual({ shown: 500, offset: 500 });
    expect(nextPage(500, 500, 900)).toBeNull();
  });
});

describe('editing a transaction', () => {
  it('sends nothing when nothing changed', () => {
    expect(txUpdate(tx(), draftOfTx(tx()))).toBeNull();
    expect(txUpdate(tx({ notes: null }), { ...draftOfTx(tx()), notes: '  ' })).toBeNull();
  });
  it('sends only what changed', () => {
    expect(txUpdate(tx(), { ...draftOfTx(tx()), category: 'dining' })).toEqual({ ids: [7], set: { category: 'dining' } });
    expect(txUpdate(tx(), { ...draftOfTx(tx()), category: '' })).toEqual({ ids: [7], set: { category: null } });
    expect(txUpdate(tx({ notes: 'old' }), { ...draftOfTx(tx({ notes: 'old' })), notes: '', merchant: 'TJ' })).toEqual({ ids: [7], set: { merchant: 'TJ', notes: null } });
  });
  it('a rule carries the category even when it did not change, and never without one', () => {
    expect(txUpdate(tx(), { ...draftOfTx(tx()), makeRule: true })).toEqual({ ids: [7], set: { category: 'groceries' }, make_rule: true });
    expect(txUpdate(tx({ category: null }), { ...draftOfTx(tx({ category: null })), makeRule: true })).toBeNull();
  });
  it('the transfer switch moves the category', () => {
    expect(withTransfer(CATS, 'groceries', true)).toBe('transfer');
    expect(withTransfer(CATS, 'credit_card_payment', true)).toBe('credit_card_payment');
    expect(withTransfer(CATS, 'credit_card_payment', false)).toBe('');
    expect(withTransfer(CATS, 'dining', false)).toBe('dining');
    expect(withTransfer(CATS, '', true)).toBe('transfer');
  });
  it('builds a hand-entered transaction with the right sign', () => {
    const d = { account: '2', date: '2026-11-14', direction: 'out' as const, amount: '20', description: ' Farmers market ', category: '', notes: '' };
    expect(newTxInput(d)).toEqual({ input: { account: 2, date: '2026-11-14', amount: -20, description: 'Farmers market' } });
    expect(newTxInput({ ...d, direction: 'in', amount: '-35.5', category: 'income', notes: 'refund' })).toEqual({ input: { account: 2, date: '2026-11-14', amount: 35.5, description: 'Farmers market', category: 'income', notes: 'refund' } });
    expect(newTxInput({ ...d, amount: '0' })).toEqual({ error: 'Enter an amount.' });
    expect(newTxInput({ ...d, account: '' })).toEqual({ error: 'Choose an account.' });
    expect(newTxInput({ ...d, description: ' ' })).toEqual({ error: 'Say what it was.' });
  });
});

describe('budget bars', () => {
  const item = (monthly_amount: number, spent: number, status: BudgetItem['status']) => ({ monthly_amount, spent, status });
  it('under budget: the bar is the budget and the tick is today', () => {
    expect(budgetBar(item(600, 150, 'ok'), 0.5, true)).toEqual({ fillPct: 25, pacePct: 50, budgetPct: null, tone: 'primary' });
    expect(budgetBar(item(600, 560, 'near'), 0.5, true).tone).toBe('warning');
  });
  it('over budget: the bar is the spend, with the budget and today scaled inside it', () => {
    const b = budgetBar(item(300, 400, 'over'), 0.5, true);
    expect(b.fillPct).toBe(100);
    expect(b.budgetPct).toBe(75);
    expect(b.pacePct).toBe(37.5);
    expect(b.tone).toBe('danger');
  });
  it('no pace tick outside the current month or at its ends', () => {
    expect(budgetBar(item(600, 150, 'ok'), 1, false).pacePct).toBeNull();
    expect(budgetBar(item(600, 150, 'ok'), 1, true).pacePct).toBeNull();
    expect(budgetBar(item(600, 150, 'ok'), 0, true).pacePct).toBeNull();
    expect(budgetBar(item(0, 0, 'ok'), 0.5, true)).toMatchObject({ fillPct: 0, pacePct: null });
  });
  it('says what is left or how far over', () => {
    const base: BudgetItem = { category: 'dining', label: 'Dining', group: 'lifestyle', monthly_amount: 300, spent: 120, remaining: 180, used: 0.4, pace: 0.8, projected: 240, status: 'ok' };
    expect(budgetNote(base, true)).toBe('$180 left');
    expect(budgetNote({ ...base, spent: 340, remaining: -40, status: 'over' }, true)).toBe('$40 over');
    expect(budgetNote({ ...base, status: 'fast', projected: 410 }, true)).toBe('$180 left, heading for $410');
    expect(budgetNote({ ...base, status: 'fast', projected: 410 }, false)).toBe('$180 left');
  });
});

describe('chart scaling', () => {
  it('rounds the axis top up to a round number', () => {
    expect([0, 0.4, 1, 7, 18, 23, 240, 4999, 5001].map(niceCeil)).toEqual([1, 0.5, 1, 10, 20, 25, 250, 5000, 10000]);
  });
  it('lays bars on a baseline, scaled to the axis top', () => {
    const { bars, max } = barLayout([100, 50, 0, -20], { width: 400, height: 100 });
    expect(max).toBe(100);
    expect(bars.map((b) => b.height)).toEqual([100, 50, 0, 0]);
    expect(bars[1]).toMatchObject({ y: 50, slotX: 100, slotWidth: 100 });
    expect(bars[0]!.x).toBeCloseTo(19);
    expect(bars[0]!.width).toBeCloseTo(62);
    expect(barLayout([1, 4000], { width: 100, height: 100 }).bars[0]!.height).toBe(2);
    expect(barLayout([], { width: 100, height: 100 }).bars).toEqual([]);
  });
  it('fits a line to its own range', () => {
    const c = lineLayout([10, 20, 15], { width: 100, height: 50, padX: 0, padY: 0 });
    expect(c.points).toEqual([{ x: 0, y: 50 }, { x: 50, y: 0 }, { x: 100, y: 25 }]);
    expect(c.path).toBe('M0 50 L50 0 L100 25');
    expect(c.area).toBe('M0 50 L50 0 L100 25 L100 50 L0 50 Z');
    expect([c.min, c.max]).toEqual([10, 20]);
  });
  it('handles a flat line, one point and none', () => {
    const flat = lineLayout([5, 5], { width: 100, height: 50, padX: 0, padY: 0 });
    expect(flat.points.map((p) => p.y)).toEqual([25, 25]);
    const one = lineLayout([5], { width: 100, height: 50 });
    expect(one.points[0]!.x).toBe(50);
    expect(one.area).toBe('');
    expect(lineLayout([], { width: 100, height: 50 }).path).toBe('');
    expect(lineLayout([-300, -100], { width: 100, height: 50, padX: 0, padY: 0 }).points.map((p) => p.y)).toEqual([50, 0]);
  });
  it('finds the nearest point and stacks segments to exactly 100', () => {
    expect(nearestIndex([{ x: 0 }, { x: 50 }, { x: 100 }], 70)).toBe(1);
    expect(nearestIndex([{ x: 0 }, { x: 50 }, { x: 100 }], 80)).toBe(2);
    const segs = stackSegments([{ share: 0.5 }, { share: 0.3 }, { share: 0.1 }]);
    expect(segs.map((s) => Math.round(s.widthPct * 100) / 100)).toEqual([55.56, 33.33, 11.11]);
    expect(segs[2]!.startPct + segs[2]!.widthPct).toBeCloseTo(100);
    expect(stackSegments([{ share: 0 }])[0]!.widthPct).toBe(0);
  });
});

describe('the import flow', () => {
  const accounts = [{ id: 1, name: 'Chase checking' }, { id: 2, name: 'Amex Gold' }];
  const up = { id: 12, filename: 'chase.csv' };
  it('is not ready without a file and an account', () => {
    expect(importArgs(emptyImport(), accounts, false)).toEqual({ error: 'Choose a CSV file.' });
    expect(importArgs({ ...emptyImport(), upload: up }, accounts, false)).toEqual({ error: 'Choose the account this file is from.' });
    expect(importArgs({ ...emptyImport(), upload: up, account: 'new' }, accounts, false)).toEqual({ error: 'Name the new account.' });
    expect(importArgs({ ...emptyImport(), upload: up, account: '9' }, accounts, false)).toEqual({ error: 'That account no longer exists.' });
  });
  it('preview and commit differ only in commit', () => {
    const d = { ...emptyImport(), upload: up, account: '1' };
    expect(importArgs(d, accounts, false)).toEqual({ input: { attachment_id: 12, account: 1, commit: false } });
    expect(importArgs(d, accounts, true)).toEqual({ input: { attachment_id: 12, account: 1, commit: true } });
  });
  it('creates a new account, unless the name is one that exists', () => {
    const d = { ...emptyImport(), upload: up, account: 'new', newName: ' Capital One ', newType: 'credit_card', newInstitution: 'Capital One' };
    expect(importArgs(d, accounts, false)).toEqual({ input: { attachment_id: 12, account: 'Capital One', create_account: { type: 'credit_card', institution: 'Capital One' }, commit: false } });
    expect(importArgs({ ...d, newInstitution: ' ' }, accounts, false)).toMatchObject({ input: { create_account: { type: 'credit_card' } } });
    expect(importArgs({ ...d, newName: 'amex gold' }, accounts, true)).toEqual({ input: { attachment_id: 12, account: 2, commit: true } });
  });
  it('sends overrides only when Ben made them', () => {
    const d = { ...emptyImport(), upload: up, account: '1', mapping: { date: 'Booked', amount: '' }, amountSign: 'invert' as const, updateBalance: false };
    expect(importArgs(d, accounts, false)).toEqual({ input: { attachment_id: 12, account: 1, commit: false, mapping: { date: 'Booked' }, amount_sign: 'invert', update_balance: false } });
  });
  it('the inverted switch forces the opposite of the automatic choice', () => {
    expect(flipped('as_is')).toBe('invert');
    expect(flipped('invert')).toBe('as_is');
    const d = emptyImport();
    expect(isFlipped(d, 'invert')).toBe(false);
    expect(isFlipped({ ...d, amountSign: 'as_is' }, 'invert')).toBe(true);
    expect(isFlipped({ ...d, amountSign: 'invert' }, 'invert')).toBe(false);
    expect(isFlipped({ ...d, amountSign: 'invert' }, null)).toBe(false);
  });
  it('mapping overrides sit on top of detection; amount and debit/credit exclude each other', () => {
    let d = setMapping(emptyImport(), 'debit', 'Out');
    d = setMapping(d, 'credit', 'In');
    expect(d.mapping).toEqual({ debit: 'Out', credit: 'In' });
    expect(shownMapping(d, { mapping: { date: 'Date', amount: 'Amount' } })).toEqual({ date: 'Date', amount: 'Amount', debit: 'Out', credit: 'In' });
    d = setMapping(d, 'amount', 'Total');
    expect(d.mapping).toEqual({ amount: 'Total' });
    expect(setMapping(d, 'amount', '').mapping).toEqual({});
    expect(setMapping(setMapping(emptyImport(), 'amount', 'A'), 'debit', 'Out').mapping).toEqual({ debit: 'Out' });
  });
  it('finds header names in the browser when the server could not', () => {
    expect(headerCandidates('Export for account 1234\nBooked,Payment text,Out,In\n2026-10-05,Bakery,4.20,\n')).toEqual(['Booked', 'Payment text', 'Out', 'In']);
    expect(headerCandidates('﻿Date;"Payee, name";Amount\r\n01/02/2026;"A, B";-4,20\r\n')).toEqual(['Date', 'Payee, name', 'Amount']);
    expect(headerCandidates('"10/05/2026","-45.00","*","","PURCHASE AUTHORIZED"\n"10/06/2026","-5.00","*","","X"\n')).toEqual(['col1', 'col2', 'col3', 'col4', 'col5']);
    expect(headerCandidates('')).toEqual([]);
  });
  it('keeps tool instructions out of what Ben reads', () => {
    expect(importError("The header row does not name a date column. The columns are: Booked, Out, In. Pass mapping with the header names to use, e.g. { date: '...' }.")).toBe('The header row does not name a date column. The columns are: Booked, Out, In.');
    expect(importError("Flipped: this is a credit_card account and 30 of 34 amounts are positive in the file, so a positive amount was read as a purchase. Pass amount_sign: 'as_is' if the sample looks backwards.")).toMatch(/read as a purchase\.$/);
    expect(importError('Attachment 3 (x.csv) is empty.')).toBe('Attachment 3 (x.csv) is empty.');
  });
  it('one tap categorizes that merchant in the batch and keeps doing it', () => {
    expect(categorizeMerchantInput(3, 'Local Hardware Co', 'home')).toEqual({ update: [{ filter: { batch_id: 3, merchant: 'Local Hardware Co' }, set: { category: 'home' }, make_rule: true }] });
    // Never a containment search, which would also take in longer names.
    expect(JSON.stringify(categorizeMerchantInput(3, 'Uber', 'transport'))).not.toMatch(/"q"/);
  });
});

describe('holdings trades', () => {
  it('signs the shares and requires a price to buy', () => {
    expect(tradeInput(4, 'VTI', 'buy', '10', '268', 20)).toEqual({ input: { account: 4, symbol: 'VTI', add_quantity: 10, price: 268 } });
    expect(tradeInput(4, 'VTI', 'sell', '5', '', 20)).toEqual({ input: { account: 4, symbol: 'VTI', add_quantity: -5 } });
    expect(tradeInput(4, 'VTI', 'buy', '10', '', 20)).toEqual({ error: 'Enter the price paid per share.' });
    expect(tradeInput(4, 'VTI', 'sell', '25', '270', 20)).toEqual({ error: 'Only 20 held.' });
    expect(tradeInput(4, 'VTI', 'buy', '0', '270', 20)).toEqual({ error: 'Enter how many shares.' });
    expect(tradeInput(4, 'VTI', 'buy', '1', 'abc', 20)).toEqual({ error: 'The price is not a number.' });
  });
});
