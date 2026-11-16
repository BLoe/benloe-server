// The Money page's pure logic: URL <-> filter, view query params, month and
// amount helpers, budget bar geometry, chart scaling, what a transaction edit
// sends, and the import flow's tool arguments. No React, no fetch; tested in
// logic.test.ts.
import { money } from '@/lib/format';
import type { ViewParams } from '@/lib/useView';
import type { Account, BudgetItem, Category, ImportPreview, Tx } from './types';

// ---- tabs --------------------------------------------------------------------

export const TABS = ['overview', 'transactions', 'budgets', 'spending', 'recurring', 'accounts', 'holdings', 'categories', 'imports'] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview', transactions: 'Transactions', budgets: 'Budgets', spending: 'Spending', recurring: 'Recurring',
  accounts: 'Accounts', holdings: 'Holdings', categories: 'Categories', imports: 'Imports',
};
export const tabOf = (v: string | null): Tab => TABS.find((t) => t === v) ?? 'overview';

// ---- months and days -----------------------------------------------------------

export const isMonth = (s: string | null | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'October 2026', or 'October' when `thisYear` matches. */
export function monthLabel(month: string, opts: { short?: boolean; thisYear?: string } = {}): string {
  if (!isMonth(month)) return month;
  const d = new Date(`${month}-15T12:00:00Z`);
  const name = d.toLocaleDateString('en-US', { month: opts.short ? 'short' : 'long', timeZone: 'UTC' });
  return opts.thisYear === month.slice(0, 4) ? name : `${name} ${month.slice(0, 4)}`;
}

/** The `count` months ending at `last`, newest first. */
export function recentMonths(last: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(last, -i));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 'Nov 14', with the year when it differs from today's. */
export function dayLabel(day: string | null | undefined, today: string): string {
  if (!isDay(day)) return '—';
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

export function ordinal(n: number): string {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

// ---- amounts -------------------------------------------------------------------

/** A transaction amount with its direction spelled out: "+$3,200.00" in, "-$12.50" out. */
export function signedMoney(amount: number, opts: { cents?: boolean } = {}): string {
  return amount > 0 ? `+${money(amount, opts)}` : money(amount, opts);
}

/** What Ben typed in a dollar field: "1,234.5", "$12", " 40 ". Null when it is not a number. */
export function parseAmount(text: string): number | null {
  const s = text.replace(/[$,\s]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** A positive number of shares or a price; keeps more decimals than dollars do. */
export function parseQuantity(text: string): number | null {
  const s = text.replace(/[$,\s]/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const percent = (fraction: number | null | undefined, digits = 0): string => (fraction == null ? '—' : `${(fraction * 100).toFixed(digits)}%`);

/** "+12.4%" / "-3.1%" for a gain. */
export const signedPercent = (fraction: number | null | undefined): string => (fraction == null ? '—' : `${fraction > 0 ? '+' : ''}${(fraction * 100).toFixed(1)}%`);

/** Shares without trailing zeros: 12, 3.5, 0.0421. */
export const quantityLabel = (q: number): string => q.toLocaleString('en-US', { maximumFractionDigits: 4 });

// ---- labels --------------------------------------------------------------------

export const GROUP_LABELS: Record<string, string> = { essentials: 'Essentials', lifestyle: 'Lifestyle', income: 'Income', transfers: 'Transfers', uncategorized: 'Uncategorized' };
export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', credit_card: 'Credit card', brokerage: 'Brokerage', retirement: 'Retirement', hsa: 'HSA',
  loan: 'Loan', mortgage: 'Mortgage', cash: 'Cash', other: 'Other',
};
export const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'mortgage']);
export const ASSET_CLASS_LABELS: Record<string, string> = {
  us_stock: 'US stocks', intl_stock: 'International stocks', bond: 'Bonds', cash: 'Cash', crypto: 'Crypto', real_estate: 'Real estate', other: 'Other',
};

/** The server's rule for a category key, so the page can say what a label will be stored as. */
export const snake = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Categories in display order, by group. Groups with nothing in them are left out. */
export function groupCategories(categories: Category[], groups: readonly string[]): { group: string; label: string; categories: Category[] }[] {
  return groups
    .map((group) => ({ group, label: GROUP_LABELS[group] ?? group, categories: categories.filter((c) => c.group === group) }))
    .filter((g) => g.categories.length > 0);
}

// ---- the transaction filter ------------------------------------------------------

export interface TxFilter {
  /** Account id as a string; '' = every account. */
  account: string;
  /** Category key, 'uncategorized', or '' = every category. */
  category: string;
  /** YYYY-MM, or '' = all time. */
  month: string;
  q: string;
  transfers: '' | 'only' | 'exclude';
  /** An import batch id as a string: "what did this import add?". */
  batch: string;
}

export const EMPTY_FILTER: TxFilter = { account: '', category: '', month: '', q: '', transfers: '', batch: '' };
const FILTER_KEYS = ['account', 'category', 'month', 'q', 'transfers', 'batch'] as const;

/** The filter held in the page's URL. Anything malformed is dropped rather than sent to the server. */
export function filterFromSearch(sp: URLSearchParams): TxFilter {
  const transfers = sp.get('transfers');
  const month = sp.get('month');
  const batch = sp.get('batch') ?? '';
  return {
    account: sp.get('account') ?? '',
    category: sp.get('category') ?? '',
    month: isMonth(month) ? month : '',
    q: sp.get('q') ?? '',
    transfers: transfers === 'only' || transfers === 'exclude' ? transfers : '',
    batch: /^\d+$/.test(batch) ? batch : '',
  };
}

/** The page URL's search params for a tab and a filter; defaults are left out so links stay short. */
export function searchFor(tab: Tab, filter: Partial<TxFilter> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (tab !== 'overview') out.tab = tab;
  if (tab === 'transactions') {
    for (const k of FILTER_KEYS) {
      const v = filter[k]?.trim();
      if (v) out[k] = v;
    }
  }
  return out;
}

export const PAGE_SIZE = 50;
/** The most rows the server returns in one answer. */
export const MAX_WINDOW = 500;

/** Query params for `money/transactions`. `shown` is how many rows the list has grown to. */
export function txQuery(filter: TxFilter, shown: number = PAGE_SIZE, offset = 0): ViewParams {
  return {
    account: filter.account || undefined,
    category: filter.category || undefined,
    month: filter.month || undefined,
    q: filter.q.trim() || undefined,
    transfers: filter.transfers || undefined,
    batch: filter.batch || undefined,
    limit: Math.min(Math.max(shown, PAGE_SIZE), MAX_WINDOW),
    offset: offset || undefined,
  };
}

/** The same filter in the shape `money_transactions_update` takes, for "apply to everything that matches". */
export function txToolFilter(filter: TxFilter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filter.account) out.account = /^\d+$/.test(filter.account) ? Number(filter.account) : filter.account;
  if (filter.category) out.category = filter.category;
  if (filter.month) out.month = filter.month;
  if (filter.q.trim()) out.q = filter.q.trim();
  if (filter.batch) out.batch_id = Number(filter.batch);
  return out;
}

export const activeFilterCount = (f: TxFilter): number => FILTER_KEYS.filter((k) => f[k].trim() !== '').length;

/** How the list grows: 50 at a time up to the server's window, then by whole windows. */
export function nextPage(shown: number, offset: number, total: number): { shown: number; offset: number } | null {
  if (offset + shown >= total) return null;
  if (shown < MAX_WINDOW) return { shown: Math.min(shown + PAGE_SIZE, MAX_WINDOW), offset };
  return { shown: MAX_WINDOW, offset: offset + MAX_WINDOW };
}

// ---- editing a transaction ---------------------------------------------------------

export interface TxDraft {
  merchant: string;
  /** '' = uncategorized. */
  category: string;
  notes: string;
  makeRule: boolean;
}

export const draftOfTx = (t: Tx): TxDraft => ({ merchant: t.merchant, category: t.category ?? '', notes: t.notes ?? '', makeRule: false });

export const isTransferCategory = (categories: Category[], name: string): boolean => categories.find((c) => c.name === name)?.group === 'transfers';

/**
 * The transfer switch is a shortcut over the category, because the server
 * keeps is_transfer equal to "the category is in the transfers group". On:
 * the category becomes 'transfer' unless it already is one. Off: a transfer
 * category is cleared.
 */
export function withTransfer(categories: Category[], category: string, on: boolean): string {
  const already = isTransferCategory(categories, category);
  if (on) return already ? category : 'transfer';
  return already ? '' : category;
}

/** The `update` entry for one edited transaction, or null when nothing changed. */
export function txUpdate(t: Tx, d: TxDraft): { ids: number[]; set: Record<string, unknown>; make_rule?: boolean } | null {
  const set: Record<string, unknown> = {};
  const merchant = d.merchant.trim();
  if (merchant && merchant !== t.merchant) set.merchant = merchant;
  if (d.category !== (t.category ?? '')) set.category = d.category || null;
  const notes = d.notes.trim();
  if (notes !== (t.notes ?? '').trim()) set.notes = notes || null;
  const rule = d.makeRule && !!d.category;
  // A rule needs set.category even when the category itself did not change.
  if (rule && set.category === undefined) set.category = d.category;
  if (!Object.keys(set).length) return null;
  return { ids: [t.id], set, ...(rule ? { make_rule: true } : {}) };
}

/** make_rule writes one rule per merchant and the server refuses more than ten. */
export const MAX_RULE_MERCHANTS = 10;
export const distinctMerchants = (rows: Tx[]): string[] => [...new Set(rows.map((r) => r.merchant.toLowerCase()))];

export interface NewTxDraft { account: string; date: string; direction: 'out' | 'in'; amount: string; description: string; category: string; notes: string }

/** The `add` entry for a hand-entered transaction, or why it cannot be saved yet. */
export function newTxInput(d: NewTxDraft): { input: Record<string, unknown> } | { error: string } {
  if (!d.account) return { error: 'Choose an account.' };
  if (!isDay(d.date)) return { error: 'Choose a date.' };
  const amount = parseAmount(d.amount);
  if (amount == null || amount === 0) return { error: 'Enter an amount.' };
  if (!d.description.trim()) return { error: 'Say what it was.' };
  return {
    input: {
      account: Number(d.account), date: d.date, amount: d.direction === 'out' ? -Math.abs(amount) : Math.abs(amount), description: d.description.trim(),
      ...(d.category ? { category: d.category } : {}), ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    },
  };
}

// ---- budgets -------------------------------------------------------------------

export interface BudgetBar {
  /** Width of the filled part, 0-100. */
  fillPct: number;
  /** Where "today" falls along the bar, 0-100; null outside the current month. */
  pacePct: number | null;
  /** When over budget the bar is the amount spent, and this marks where the budget sits inside it. */
  budgetPct: number | null;
  tone: 'primary' | 'warning' | 'danger';
}

/**
 * Geometry of one budget bar. Under budget, the bar's full width is the
 * budget. Over budget, the full width is what was spent and the budget becomes
 * a notch inside it, so "how far over" is visible instead of clipped at 100%.
 */
export function budgetBar(item: Pick<BudgetItem, 'monthly_amount' | 'spent' | 'status'>, monthElapsed: number, isCurrentMonth: boolean): BudgetBar {
  const budget = Math.max(0, item.monthly_amount);
  const spent = Math.max(0, item.spent);
  const scale = Math.max(budget, spent);
  const tone = item.status === 'over' ? 'danger' : item.status === 'ok' ? 'primary' : 'warning';
  if (scale <= 0) return { fillPct: 0, pacePct: null, budgetPct: null, tone };
  const over = spent > budget;
  const showPace = isCurrentMonth && monthElapsed > 0 && monthElapsed < 1;
  return {
    fillPct: (spent / scale) * 100,
    pacePct: showPace ? ((monthElapsed * budget) / scale) * 100 : null,
    budgetPct: over ? (budget / scale) * 100 : null,
    tone,
  };
}

/** One line under a budget: what is left, or how far over, and where the month is heading. */
export function budgetNote(item: BudgetItem, isCurrentMonth: boolean): string {
  if (item.status === 'over') return `${money(-item.remaining, { cents: false })} over`;
  const left = `${money(item.remaining, { cents: false })} left`;
  if (isCurrentMonth && item.status === 'fast' && item.projected != null) return `${left}, heading for ${money(item.projected, { cents: false })}`;
  return left;
}

export const STATUS_LABELS: Record<BudgetItem['status'], string> = { over: 'Over', near: 'Nearly spent', fast: 'Ahead of pace', ok: 'On track' };

// ---- charts --------------------------------------------------------------------

/** A round number at or above `max` for the top of an axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceCeil(max: number): number {
  if (!(max > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const f = max / pow;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * pow;
}

export interface Bar { x: number; y: number; width: number; height: number; slotX: number; slotWidth: number }

/** Bars along a baseline at the bottom. Negative values (a month of net refunds) draw as nothing. */
export function barLayout(values: number[], box: { width: number; height: number; fill?: number; top?: number }): { bars: Bar[]; max: number } {
  const max = niceCeil(Math.max(0, ...values));
  const slot = values.length ? box.width / values.length : box.width;
  const barW = slot * (box.fill ?? 0.62);
  const usable = box.height - (box.top ?? 0);
  return {
    max,
    bars: values.map((v, i) => {
      const h = v > 0 ? Math.max(2, (v / max) * usable) : 0;
      return { x: i * slot + (slot - barW) / 2, y: box.height - h, width: barW, height: h, slotX: i * slot, slotWidth: slot };
    }),
  };
}

export interface LineChart { points: { x: number; y: number }[]; path: string; area: string; min: number; max: number }

/**
 * A line through `values`, left to right. The y range is the data's own range
 * with a little headroom rather than starting at zero: a net-worth trend is
 * about the change, and from zero a 2% move is a flat line.
 */
export function lineLayout(values: number[], box: { width: number; height: number; padX?: number; padY?: number }): LineChart {
  const padX = box.padX ?? 4;
  const padY = box.padY ?? 8;
  if (!values.length) return { points: [], path: '', area: '', min: 0, max: 0 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) {
    const bump = Math.abs(max) * 0.05 || 1;
    min -= bump;
    max += bump;
  }
  const w = box.width - padX * 2;
  const h = box.height - padY * 2;
  const points = values.map((v, i) => ({
    x: values.length === 1 ? box.width / 2 : padX + (i / (values.length - 1)) * w,
    y: padY + (1 - (v - min) / (max - min)) * h,
  }));
  const r = (n: number) => Math.round(n * 100) / 100;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${r(p.x)} ${r(p.y)}`).join(' ');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = points.length > 1 ? `${path} L${r(last.x)} ${box.height} L${r(first.x)} ${box.height} Z` : '';
  return { points, path, area, min, max };
}

/** Index of the point nearest to x, for hover and touch. */
export function nearestIndex(points: { x: number }[], x: number): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.x - x) < Math.abs(points[best]!.x - x)) best = i;
  return best;
}

/** Segments of a stacked bar; shares are renormalised so rounding never leaves a gap. */
export function stackSegments<T extends { share: number }>(items: T[]): (T & { startPct: number; widthPct: number })[] {
  const total = items.reduce((s, i) => s + Math.max(0, i.share), 0);
  let start = 0;
  return items.map((i) => {
    const widthPct = total > 0 ? (Math.max(0, i.share) / total) * 100 : 0;
    const seg = { ...i, startPct: start, widthPct };
    start += widthPct;
    return seg;
  });
}

// ---- the import flow -------------------------------------------------------------

export const MAPPING_FIELDS = ['date', 'description', 'amount', 'debit', 'credit', 'category', 'balance', 'type', 'status'] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];
export const MAPPING_LABELS: Record<MappingField, string> = {
  date: 'Date', description: 'Description', amount: 'Amount (one signed column)', debit: 'Money out (debit)', credit: 'Money in (credit)',
  category: 'Bank’s category', balance: 'Running balance', type: 'Debit/credit type', status: 'Status (pending/posted)',
};

export interface ImportDraft {
  upload: { id: number; filename: string } | null;
  /** An existing account's id as a string, 'new', or '' = not chosen. */
  account: string;
  newName: string;
  newType: string;
  newInstitution: string;
  /** Only the columns Ben chose himself; detection handles the rest. */
  mapping: Partial<Record<MappingField, string>>;
  amountSign: 'auto' | 'as_is' | 'invert';
  updateBalance: boolean;
}

export const emptyImport = (): ImportDraft => ({ upload: null, account: '', newName: '', newType: 'checking', newInstitution: '', mapping: {}, amountSign: 'auto', updateBalance: true });

/** The `money_import` input for the draft, or the reason it is not ready. Preview and commit send the same arguments but for `commit`. */
export function importArgs(d: ImportDraft, accounts: Pick<Account, 'id' | 'name'>[], commit: boolean): { input: Record<string, unknown> } | { error: string } {
  if (!d.upload) return { error: 'Choose a CSV file.' };
  if (!d.account) return { error: 'Choose the account this file is from.' };
  const input: Record<string, unknown> = { attachment_id: d.upload.id, commit };
  if (d.account === 'new') {
    const name = d.newName.trim();
    if (!name) return { error: 'Name the new account.' };
    const existing = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
    // A name that already exists means that account; the server would otherwise match it silently.
    if (existing) input.account = existing.id;
    else {
      input.account = name;
      input.create_account = { type: d.newType, ...(d.newInstitution.trim() ? { institution: d.newInstitution.trim() } : {}) };
    }
  } else {
    if (!accounts.some((a) => String(a.id) === d.account)) return { error: 'That account no longer exists.' };
    input.account = Number(d.account);
  }
  const mapping = Object.fromEntries(Object.entries(d.mapping).filter(([, v]) => !!v));
  if (Object.keys(mapping).length) input.mapping = mapping;
  if (d.amountSign !== 'auto') input.amount_sign = d.amountSign;
  if (!d.updateBalance) input.update_balance = false;
  return { input };
}

/** "Amounts look inverted": the opposite of what was applied when nothing was forced. */
export const flipped = (applied: 'as_is' | 'invert'): 'as_is' | 'invert' => (applied === 'invert' ? 'as_is' : 'invert');

/** The switch is on when Ben has forced the opposite of the automatic choice. */
export const isFlipped = (d: ImportDraft, autoApplied: 'as_is' | 'invert' | null): boolean => d.amountSign !== 'auto' && autoApplied != null && d.amountSign !== autoApplied;

/** What each mapping dropdown shows: Ben's override, else what detection chose. */
export function shownMapping(d: ImportDraft, preview: Pick<ImportPreview, 'mapping'> | null): Partial<Record<MappingField, string>> {
  return { ...(preview?.mapping ?? {}), ...Object.fromEntries(Object.entries(d.mapping).filter(([, v]) => !!v)) };
}

/** Sets one override. Picking a column for `amount` drops overrides for debit/credit and the reverse, as the server treats them as alternatives. */
export function setMapping(d: ImportDraft, field: MappingField, header: string): ImportDraft {
  const mapping = { ...d.mapping };
  if (header) mapping[field] = header;
  else delete mapping[field];
  if (header && field === 'amount') {
    delete mapping.debit;
    delete mapping.credit;
  }
  if (header && (field === 'debit' || field === 'credit')) delete mapping.amount;
  return { ...d, mapping };
}

const looksLikeData = (cell: string): boolean => /^\(?-?\$?[\d,]+(\.\d+)?\)?( ?(CR|DR))?$/i.test(cell) || /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(cell);

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') quoted = true;
    else if (ch === delim) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/**
 * Column names to offer when the server could not work out the layout (a
 * failed preview carries no headers). Reads the start of the file in the
 * browser: the widest of the first rows that is made of words is the header;
 * a file that starts straight into data gets col1, col2, ... which is what
 * the server calls the columns of a headerless file.
 */
export function headerCandidates(text: string): string[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  if (!lines.length) return [];
  const delim = [',', ';', '\t', '|'].map((d) => ({ d, n: lines.reduce((s, l) => s + l.split(d).length - 1, 0) })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows = lines.map((l) => splitCsvLine(l, delim));
  const width = Math.max(...rows.map((r) => r.filter(Boolean).length));
  const header = rows.find((r) => r.filter(Boolean).length === width && r.filter(Boolean).every((c) => !looksLikeData(c)));
  if (header) return header.filter(Boolean);
  const widest = rows.find((r) => r.filter(Boolean).length === width) ?? rows[0]!;
  return widest.map((_, i) => `col${i + 1}`);
}

/** The server words its import errors for the model; the part telling it which argument to pass is not for Ben. */
export const importError = (message: string): string => message.replace(/\s*Pass (mapping|amount_sign)\b[\s\S]*$/, '').replace(/\s*To import into a new account, pass[\s\S]*$/, '').trim();

/**
 * One categorize tap in the import summary: recategorize that merchant's rows from this import and keep
 * doing it. Exactly that merchant: "Uber" must not sweep in "Uber Eats" (the server's `q` would).
 */
export function categorizeMerchantInput(batchId: number, merchant: string, category: string): Record<string, unknown> {
  return { update: [{ filter: { batch_id: batchId, merchant }, set: { category }, make_rule: true }] };
}

// ---- holdings ------------------------------------------------------------------

/** A buy or a sale as the holdings tool takes it: shares signed, price as traded. */
export function tradeInput(account: number, symbol: string, side: 'buy' | 'sell', shares: string, price: string, held: number): { input: Record<string, unknown> } | { error: string } {
  const n = parseQuantity(shares);
  if (n == null || n <= 0) return { error: 'Enter how many shares.' };
  const p = price.trim() ? parseQuantity(price) : null;
  if (price.trim() && p == null) return { error: 'The price is not a number.' };
  if (side === 'buy' && p == null) return { error: 'Enter the price paid per share.' };
  if (side === 'sell' && n > held + 1e-9) return { error: `Only ${quantityLabel(held)} held.` };
  return { input: { account, symbol, add_quantity: side === 'buy' ? n : -n, ...(p != null ? { price: p } : {}) } };
}
