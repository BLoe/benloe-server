// Money: accounts, transactions, budgets and holdings. Data arrives mostly as
// bank CSV exports (money_import); Kevin reads with SQL and writes through the
// four tools here; the Money page uses the same tools and the views below.
//
// Conventions, also stated in the schema comments the model sees:
// - Amounts are REAL dollars rounded to cents. Transaction amounts are signed:
//   negative = money out, positive = money in.
// - A liability's balance is the amount owed, stored positive.
// - is_transfer = 1 exactly when the category's group is 'transfers'. Every
//   write goes through categoryPatch() to keep that true.
// - Nothing in this file logs: these are Ben's financial records.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { attachmentPath, getAttachment } from '../attachments.js';
import { type DB, nowIso } from '../db.js';
import { defineDomain } from '../domains.js';
import { localDay } from '../time.js';
import { defineTool, ToolError, type ToolCtx } from '../tools.js';
import { bankCategory, CATEGORY_GROUPS, cleanMerchant, compileRule, matchRule, orderRules, type CompiledRule, type Rule, SEED_CATEGORIES, SEED_RULES } from './_money/categorize.js';
import { CsvError, detectLayout, endingBalance, MAPPING_FIELDS, parseCsv, readRows } from './_money/csv.js';
import { detectRecurring, type Outflow } from './_money/recurring.js';

const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'brokerage', 'retirement', 'hsa', 'loan', 'mortgage', 'cash', 'other'] as const;
const LIABILITY_TYPES = new Set<string>(['credit_card', 'loan', 'mortgage']);
const ASSET_CLASSES = ['us_stock', 'intl_stock', 'bond', 'cash', 'crypto', 'real_estate', 'other'] as const;

const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;

const SCHEMA = `
CREATE TABLE money_accounts (
  -- One row per real account. Net worth = SUM(balance) over assets minus SUM(balance) over liabilities, active accounts with a balance.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,       -- Ben's nickname: 'Chase checking', 'Amex Gold', '401k'
  institution TEXT,                               -- 'Chase', 'Fidelity'
  type TEXT NOT NULL CHECK (type IN (${ACCOUNT_TYPES.map(sq).join(', ')})),
  is_liability INTEGER GENERATED ALWAYS AS (type IN ('credit_card', 'loan', 'mortgage')) VIRTUAL,  -- 1 = money Ben owes; derived from type
  last4 TEXT,                                     -- last four digits of the account or card number
  currency TEXT NOT NULL DEFAULT 'USD',
  balance REAL,                                   -- dollars as of balance_as_of. Asset: what the account holds. Liability: the amount OWED as a POSITIVE number (1200 = Ben owes $1,200). NULL = never set.
  balance_as_of TEXT,                             -- YYYY-MM-DD
  active INTEGER NOT NULL DEFAULT 1,              -- 0 = closed; kept for its history, left out of net worth
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE money_balance_history (
  -- One balance per account per day, written every time a balance is set. The net-worth trend is built from this.
  account_id INTEGER NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                             -- YYYY-MM-DD
  balance REAL NOT NULL,                          -- same convention as money_accounts.balance (liabilities positive)
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (account_id, date)
);
CREATE TABLE money_categories (
  name TEXT PRIMARY KEY,                          -- snake_case key used in money_transactions.category: 'groceries', 'dining'
  label TEXT NOT NULL,                            -- display name: 'Gifts & charity'
  category_group TEXT NOT NULL CHECK (category_group IN (${CATEGORY_GROUPS.map(sq).join(', ')}))  -- 'transfers' categories are not spending or income
);
CREATE TABLE money_import_batches (
  -- One row per committed CSV import. Undoing an import deletes its transactions and sets undone_at.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  attachment_id INTEGER,                          -- attachments.id of the uploaded file
  filename TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL,                     -- transactions read from the file
  inserted_count INTEGER NOT NULL,                -- new transactions added
  duplicate_count INTEGER NOT NULL,               -- already present, left alone
  skipped_count INTEGER NOT NULL,                 -- rows that could not be read (totals, footers)
  date_from TEXT,                                 -- earliest and latest transaction date in the file, YYYY-MM-DD
  date_to TEXT,
  undone_at TEXT
);
CREATE TABLE money_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                             -- YYYY-MM-DD
  amount REAL NOT NULL,                           -- dollars, SIGNED: negative = money out (a purchase, a bill), positive = money in (pay, a refund). Same on every account type, credit cards included.
  description TEXT NOT NULL,                      -- the bank's text, unchanged: 'SQ *BLUE BOTTLE COFFEE #114 OAKLAND CA'
  merchant TEXT NOT NULL,                         -- cleaned payee for display and grouping: 'Blue Bottle Coffee Oakland'
  category TEXT REFERENCES money_categories(name) ON UPDATE CASCADE,  -- NULL = uncategorized
  categorized_by TEXT,                            -- 'rule' | 'bank' (the bank's own category column) | 'manual' (Ben or Kevin chose it; rules leave it alone) | NULL
  is_transfer INTEGER NOT NULL DEFAULT 0,         -- 1 = moving money between Ben's own accounts or paying a credit card; excluded from spending and income. Always 1 when the category's group is 'transfers'.
  pending INTEGER NOT NULL DEFAULT 0,             -- 1 = not yet posted; excluded from spending totals
  notes TEXT,
  import_batch_id INTEGER REFERENCES money_import_batches(id) ON DELETE SET NULL,  -- NULL = entered by hand
  dedupe_hash TEXT NOT NULL UNIQUE,               -- identity of the source row (account, date, amount, description, occurrence that day); re-importing a file adds nothing
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX money_transactions_date ON money_transactions(date);
CREATE INDEX money_transactions_category ON money_transactions(category, date);
CREATE INDEX money_transactions_account ON money_transactions(account_id, date);
CREATE INDEX money_transactions_batch ON money_transactions(import_batch_id);
CREATE TABLE money_rules (
  -- Categorization rules, applied to every imported or added transaction that has no manual category. The highest priority wins, then the longest pattern.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL COLLATE NOCASE,           -- matched case-insensitively against the description and the merchant
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'regex')),
  category TEXT REFERENCES money_categories(name) ON UPDATE CASCADE ON DELETE CASCADE,  -- category to set; one in the 'transfers' group marks the transaction a transfer
  merchant TEXT,                                  -- when set, the merchant is renamed to this
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (pattern, match_type)
);
CREATE TABLE money_budgets (
  -- One monthly amount per category, in force every month.
  category TEXT PRIMARY KEY REFERENCES money_categories(name) ON UPDATE CASCADE ON DELETE CASCADE,
  monthly_amount REAL NOT NULL,                   -- dollars per calendar month
  updated_at TEXT NOT NULL
);
CREATE TABLE money_holdings (
  -- Investment positions. Prices are entered by hand or by Kevin; nothing fetches them.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,                           -- ticker, upper case: 'VTI'. 'CASH' for uninvested cash.
  name TEXT,
  asset_class TEXT NOT NULL DEFAULT 'other' CHECK (asset_class IN (${ASSET_CLASSES.map(sq).join(', ')})),
  quantity REAL NOT NULL,                         -- shares or units
  cost_basis REAL,                                -- TOTAL dollars paid for the position, not per share
  last_price REAL,                                -- dollars per share as of price_as_of; market value = quantity * last_price
  price_as_of TEXT,                               -- YYYY-MM-DD
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, symbol)
);
CREATE VIEW money_spending AS
  SELECT t.id, t.date, substr(t.date, 1, 7) AS month, a.name AS account, t.merchant, t.description,
         COALESCE(t.category, 'uncategorized') AS category, COALESCE(c.category_group, 'uncategorized') AS category_group,
         -t.amount AS spent
  FROM money_transactions t
  JOIN money_accounts a ON a.id = t.account_id
  LEFT JOIN money_categories c ON c.name = t.category
  WHERE t.is_transfer = 0 AND t.pending = 0
    AND NOT (COALESCE(c.category_group, '') = 'income' OR (t.category IS NULL AND t.amount > 0));
CREATE VIEW money_income AS
  SELECT t.id, t.date, substr(t.date, 1, 7) AS month, a.name AS account, t.merchant, t.description,
         COALESCE(t.category, 'uncategorized') AS category, t.amount AS received
  FROM money_transactions t
  JOIN money_accounts a ON a.id = t.account_id
  LEFT JOIN money_categories c ON c.name = t.category
  WHERE t.is_transfer = 0 AND t.pending = 0
    AND (COALESCE(c.category_group, '') = 'income' OR (t.category IS NULL AND t.amount > 0));
${SEED_CATEGORIES.map(([name, label, group]) => `INSERT INTO money_categories (name, label, category_group) VALUES (${sq(name)}, ${sq(label)}, ${sq(group)});`).join('\n')}
${SEED_RULES.map(([pattern, matchType, category, merchant]) => `INSERT INTO money_rules (pattern, match_type, category, merchant, created_at) VALUES (${sq(pattern)}, ${sq(matchType)}, ${sq(category)}, ${merchant ? sq(merchant) : 'NULL'}, '2026-11-14T00:00:00.000Z');`).join('\n')}
`;

const PROMPT_NOTE = `Ben's accounts, transactions, budgets and investment holdings. Transactions arrive as bank CSV exports; balances and holdings are entered by hand.

- Dollars are REAL, rounded to cents. \`money_transactions.amount\` is signed: negative = money out, positive = money in, on every account type. A liability's \`balance\` (credit_card, loan, mortgage) is the amount owed as a positive number.
- Transfers between Ben's own accounts and credit-card payments have \`is_transfer = 1\` and count as neither spending nor income. A transaction Ben calls a transfer gets \`set: { transfer: true }\`.
- Two SQL views at the end of the schema carry the rules for totals; use them for every spending or income question. \`money_spending\` is posted, non-transfer, non-income transactions: \`spent\` is positive dollars for a purchase and negative for a refund, so SUM nets refunds; \`month\` is 'YYYY-MM'; \`category\` is 'uncategorized' where none is set. \`money_income\` is posted, non-transfer money in under an income category or uncategorized, as \`received\`.
  Spending in a month: \`SELECT ROUND(SUM(spent), 2) FROM money_spending WHERE month = '2026-10'\`; add \`AND category = 'dining'\`, or \`GROUP BY category\` or \`merchant\`. The same clause on the base table is \`WHERE is_transfer = 0 AND pending = 0 AND date >= '2026-10-01' AND date < '2026-11-01'\`.
- Net worth: \`SELECT ROUND(SUM(CASE WHEN is_liability = 1 THEN -balance ELSE balance END), 2) FROM money_accounts WHERE active = 1 AND balance IS NOT NULL\`. The trend is in \`money_balance_history\`.
- Market value of a holding is \`quantity * last_price\`; \`cost_basis\` is the total paid.
- Importing a CSV: call \`money_import\` with \`commit: false\`, check the preview (the sign of the sample amounts, the date range, new versus duplicate counts), tell Ben what it will add, then call it again with \`commit: true\`. Importing the same file twice adds nothing.
- After an import, look at \`top_uncategorized\` in the result and offer rules for the merchants that repeat. When Ben says a merchant is always a category, add a rule; it recategorizes existing transactions too.`;

// ---- small helpers ---------------------------------------------------------------

type Params = Record<string, string>;
const r2 = (n: number | null | undefined): number => Math.round((n ?? 0) * 100) / 100;
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const int = (v: string | undefined, fallback: number, max: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};
const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonth = (s: string | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const todayOf = (p: Params): string => (isDay(p.today) ? p.today : localDay());
const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const daysInMonth = (month: string): number => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** [first day, first day of the next month): a half-open range that uses the date index. */
const monthRange = (month: string): [string, string] => [`${month}-01`, `${addMonths(month, 1)}-01`];
const addDays = (day: string, n: number): string => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const accountRef = z.union([z.string().min(1), z.number().int()]);

// ---- accounts --------------------------------------------------------------------

interface AccountRow {
  id: number; name: string; institution: string | null; type: string; is_liability: number; last4: string | null; currency: string;
  balance: number | null; balance_as_of: string | null; active: number; notes: string | null; created_at: string; updated_at: string;
}

function findAccount(db: DB, ref: string | number): AccountRow | undefined {
  if (typeof ref === 'number') return db.prepare('SELECT * FROM money_accounts WHERE id = ?').get(ref) as AccountRow | undefined;
  const name = ref.trim();
  const exact = db.prepare('SELECT * FROM money_accounts WHERE name = ?').get(name) as AccountRow | undefined;
  if (exact) return exact;
  const like = db.prepare("SELECT * FROM money_accounts WHERE name LIKE '%' || ? || '%' ESCAPE '\\'").all(name.replace(/[\\%_]/g, '\\$&')) as AccountRow[];
  return like.length === 1 ? like[0] : undefined;
}

const accountNames = (db: DB): string => {
  const names = (db.prepare('SELECT name FROM money_accounts ORDER BY name').all() as { name: string }[]).map((r) => r.name);
  return names.length ? `Accounts: ${names.join(', ')}.` : 'There are no accounts yet.';
};

function requireAccount(db: DB, ref: string | number): AccountRow {
  const a = findAccount(db, ref);
  if (!a) throw new ToolError(`No single account matches "${ref}". ${accountNames(db)}`);
  return a;
}

/** A view's ?account= is an id when it is all digits, a name otherwise. */
const accountParam = (db: DB, v: string): AccountRow | undefined => findAccount(db, /^\d+$/.test(v) ? Number(v) : v);

/**
 * Records a balance for a day. The account's current balance moves only when
 * the day is not older than the one it already has, so an old statement can
 * be back-filled into the history without disturbing today's figure.
 */
function setBalance(db: DB, accountId: number, balance: number, asOf: string): { current: boolean } {
  const amount = r2(balance);
  db.prepare('INSERT INTO money_balance_history (account_id, date, balance, recorded_at) VALUES (?,?,?,?) ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance, recorded_at = excluded.recorded_at')
    .run(accountId, asOf, amount, nowIso());
  const a = db.prepare('SELECT balance_as_of FROM money_accounts WHERE id = ?').get(accountId) as { balance_as_of: string | null };
  const current = !a.balance_as_of || asOf >= a.balance_as_of;
  if (current) db.prepare('UPDATE money_accounts SET balance = ?, balance_as_of = ?, updated_at = ? WHERE id = ?').run(amount, asOf, nowIso(), accountId);
  return { current };
}

const accountOut = (a: AccountRow) => ({
  id: a.id, name: a.name, institution: a.institution, type: a.type, is_liability: !!a.is_liability, last4: a.last4, currency: a.currency,
  balance: a.balance == null ? null : r2(a.balance), balance_as_of: a.balance_as_of, active: !!a.active, notes: a.notes,
});

function netWorth(db: DB): { assets: number; liabilities: number; net_worth: number; as_of: string | null } {
  const r = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN is_liability = 0 THEN balance END), 0) AS assets, COALESCE(SUM(CASE WHEN is_liability = 1 THEN balance END), 0) AS liabilities, MAX(balance_as_of) AS as_of
              FROM money_accounts WHERE active = 1 AND balance IS NOT NULL`)
    .get() as { assets: number; liabilities: number; as_of: string | null };
  return { assets: r2(r.assets), liabilities: r2(r.liabilities), net_worth: r2(r.assets - r.liabilities), as_of: r.as_of };
}

// ---- categories and rules ------------------------------------------------------------

interface CategoryRow { name: string; label: string; category_group: string }

const categoryMap = (db: DB): Map<string, CategoryRow> =>
  new Map((db.prepare('SELECT name, label, category_group FROM money_categories').all() as CategoryRow[]).map((c) => [c.name, c]));

function requireCategory(cats: Map<string, CategoryRow>, name: string): CategoryRow {
  const c = cats.get(name.trim().toLowerCase());
  if (!c) throw new ToolError(`There is no category "${name}". Categories: ${[...cats.keys()].sort().join(', ')}. Add one with money_budget_update { categories: [{ name, group }] }.`);
  return c;
}

/**
 * The one place a category or transfer choice becomes column values, so
 * is_transfer always agrees with the category's group.
 */
function categoryPatch(cats: Map<string, CategoryRow>, category: string | null | undefined, transfer: boolean | undefined): { category: string | null; is_transfer: number } | 'clear_transfer' | null {
  if (category === null) {
    if (transfer) return { category: 'transfer', is_transfer: 1 };
    return { category: null, is_transfer: 0 };
  }
  if (category !== undefined) {
    const c = requireCategory(cats, category);
    const isTransfer = c.category_group === 'transfers';
    if (transfer !== undefined && transfer !== isTransfer) {
      throw new ToolError(`Category "${c.name}" is ${isTransfer ? '' : 'not '}a transfer category, which contradicts transfer: ${transfer}. Pass one or the other.`);
    }
    return { category: c.name, is_transfer: isTransfer ? 1 : 0 };
  }
  if (transfer === true) return { category: 'transfer', is_transfer: 1 };
  if (transfer === false) return 'clear_transfer';
  return null;
}

const loadRules = (db: DB): CompiledRule[] => orderRules(db.prepare('SELECT id, pattern, match_type, category, merchant, priority FROM money_rules').all() as Rule[]);

interface Categorized { merchant: string; category: string | null; categorized_by: string | null; is_transfer: number }

function categorize(rules: CompiledRule[], cats: Map<string, CategoryRow>, description: string, bank: { text: string | null; liability: boolean; amount: number }): Categorized {
  let merchant = cleanMerchant(description);
  const rule = matchRule(rules, description, merchant);
  let category: string | null = null;
  let by: string | null = null;
  if (rule) {
    if (rule.merchant) merchant = rule.merchant;
    if (rule.category) {
      category = rule.category;
      by = 'rule';
    }
  }
  if (!category) {
    const fromBank = bankCategory(bank.text, bank);
    if (fromBank && cats.has(fromBank)) {
      category = fromBank;
      by = 'bank';
    }
  }
  return { merchant, category, categorized_by: by, is_transfer: category && cats.get(category)?.category_group === 'transfers' ? 1 : 0 };
}

/**
 * Runs the rules over existing transactions, leaving manual choices alone.
 * 'uncategorized' fills in blanks; 'all' re-evaluates every non-manual
 * transaction; `onlyRules` limits the changes to transactions those rules win.
 */
function applyRules(db: DB, scope: 'uncategorized' | 'all', onlyRules?: Set<number>): number {
  const rules = loadRules(db);
  const cats = categoryMap(db);
  const rows = db
    .prepare(`SELECT id, description, merchant, category FROM money_transactions WHERE COALESCE(categorized_by, '') != 'manual' ${scope === 'uncategorized' ? 'AND category IS NULL' : ''}`)
    .all() as { id: number; description: string; merchant: string; category: string | null }[];
  const update = db.prepare('UPDATE money_transactions SET merchant = ?, category = ?, categorized_by = ?, is_transfer = ?, updated_at = ? WHERE id = ?');
  const now = nowIso();
  let changed = 0;
  for (const t of rows) {
    const rule = matchRule(rules, t.description, t.merchant);
    if (!rule || (onlyRules && !onlyRules.has(rule.id))) continue;
    const merchant = rule.merchant ?? t.merchant;
    const category = rule.category ?? t.category;
    if (merchant === t.merchant && category === t.category) continue;
    update.run(merchant, category, rule.category ? 'rule' : category ? 'bank' : null, category && cats.get(category)?.category_group === 'transfers' ? 1 : 0, now, t.id);
    changed++;
  }
  return changed;
}

function upsertRule(db: DB, cats: Map<string, CategoryRow>, r: { pattern: string; match: 'contains' | 'regex'; category?: string; merchant?: string; transfer?: boolean; priority?: number }): number {
  const pattern = r.pattern.trim();
  const patch = categoryPatch(cats, r.category, r.transfer === true ? true : undefined);
  const category = patch && patch !== 'clear_transfer' ? patch.category : null;
  if (!category && !r.merchant) throw new ToolError(`Rule "${pattern}" needs a category, transfer: true, or a merchant name to rename to.`);
  try {
    compileRule({ id: 0, pattern, match_type: r.match, category, merchant: r.merchant ?? null, priority: 0 });
  } catch (e) {
    throw new ToolError((e as Error).message);
  }
  const existing = db.prepare('SELECT id, category, merchant, priority FROM money_rules WHERE pattern = ? AND match_type = ?').get(pattern, r.match) as { id: number; category: string | null; merchant: string | null; priority: number } | undefined;
  if (existing) {
    db.prepare('UPDATE money_rules SET category = ?, merchant = ?, priority = ? WHERE id = ?').run(category ?? existing.category, r.merchant ?? existing.merchant, r.priority ?? existing.priority, existing.id);
    return existing.id;
  }
  return Number(db.prepare('INSERT INTO money_rules (pattern, match_type, category, merchant, priority, created_at) VALUES (?,?,?,?,?,?)').run(pattern, r.match, category, r.merchant ?? null, r.priority ?? 0, nowIso()).lastInsertRowid);
}

// ---- transactions ----------------------------------------------------------------

const normDescription = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const occurrenceKey = (date: string, amount: number, description: string): string => `${date}|${Math.round(amount * 100)}|${normDescription(description)}`;
const dedupeHash = (accountId: number, key: string, occurrence: number): string => createHash('sha256').update(`${accountId}|${key}|${occurrence}`).digest('hex').slice(0, 32);

const filterShape = {
  account: accountRef.optional().describe('Account name or id.'),
  category: z.string().optional().describe("A category name, or 'uncategorized'."),
  q: z.string().min(1).optional().describe("Text contained in the description or merchant, case-insensitive: 'costco'."),
  month: monthStr.optional().describe('YYYY-MM.'),
  date_from: day.optional().describe('First day, inclusive.'),
  date_to: day.optional().describe('Last day, inclusive.'),
  amount_min: z.number().optional().describe('Signed dollars: amount >= this. Spending is negative, so purchases over $100 are amount_max: -100.'),
  amount_max: z.number().optional().describe('Signed dollars: amount <= this.'),
  batch_id: z.number().int().optional().describe('Only transactions from this import batch.'),
};
const filterSchema = z.object(filterShape);
type TxFilter = z.infer<typeof filterSchema> & { transfers?: 'only' | 'exclude' };

/** WHERE conditions over money_transactions aliased t. */
function txWhere(db: DB, f: TxFilter, lookup: (ref: string | number) => AccountRow | undefined): { where: string; params: unknown[]; conditions: number } {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (f.account != null && f.account !== '') {
    const a = lookup(f.account);
    if (!a) throw new ToolError(`No single account matches "${f.account}". ${accountNames(db)}`);
    cond.push('t.account_id = ?');
    params.push(a.id);
  }
  if (f.category) {
    if (f.category === 'uncategorized') cond.push('t.category IS NULL');
    else {
      cond.push('t.category = ?');
      params.push(f.category.trim().toLowerCase());
    }
  }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
    cond.push("(t.description LIKE ? ESCAPE '\\' OR t.merchant LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (f.month) {
    const [from, to] = monthRange(f.month);
    cond.push('t.date >= ? AND t.date < ?');
    params.push(from, to);
  }
  if (f.date_from) {
    cond.push('t.date >= ?');
    params.push(f.date_from);
  }
  if (f.date_to) {
    cond.push('t.date <= ?');
    params.push(f.date_to);
  }
  if (f.amount_min != null) {
    cond.push('t.amount >= ?');
    params.push(f.amount_min);
  }
  if (f.amount_max != null) {
    cond.push('t.amount <= ?');
    params.push(f.amount_max);
  }
  if (f.batch_id != null) {
    cond.push('t.import_batch_id = ?');
    params.push(f.batch_id);
  }
  if (f.transfers === 'only') cond.push('t.is_transfer = 1');
  if (f.transfers === 'exclude') cond.push('t.is_transfer = 0');
  return { where: cond.length ? cond.join(' AND ') : '1', params, conditions: cond.length };
}

/** Ids chosen by an explicit list, a filter, or both (the intersection). */
function selectIds(db: DB, sel: { ids?: number[]; filter?: TxFilter }, what: string): number[] {
  const hasFilter = sel.filter && Object.values(sel.filter).some((v) => v != null);
  if (!sel.ids?.length && !hasFilter) throw new ToolError(`${what} needs ids or a filter with at least one condition.`);
  const w = hasFilter ? txWhere(db, sel.filter!, (ref) => findAccount(db, ref)) : { where: '1', params: [] as unknown[] };
  const rows = db.prepare(`SELECT t.id FROM money_transactions t WHERE ${w.where} ORDER BY t.id`).all(...w.params) as { id: number }[];
  if (!sel.ids?.length) return rows.map((r) => r.id);
  const wanted = new Set(sel.ids);
  const found = rows.filter((r) => wanted.has(r.id)).map((r) => r.id);
  if (!hasFilter && found.length !== wanted.size) {
    const have = new Set(found);
    throw new ToolError(`No transaction with id ${[...wanted].filter((id) => !have.has(id)).join(', ')}.`);
  }
  return found;
}

const inList = (ids: number[]): string => ids.map((n) => Math.trunc(n)).join(',');

// ---- import ----------------------------------------------------------------------

const importInput = z.object({
  attachment_id: z.number().int().describe('The id of the uploaded CSV file.'),
  account: accountRef.describe("The account the file belongs to, by Ben's name for it: 'Chase checking'."),
  create_account: z
    .object({ type: z.enum(ACCOUNT_TYPES), institution: z.string().max(80).optional() })
    .optional()
    .describe('Pass when the account does not exist yet; it is created under the name in `account` on commit.'),
  mapping: z
    .object(Object.fromEntries(MAPPING_FIELDS.map((f) => [f, z.string().optional()])) as Record<(typeof MAPPING_FIELDS)[number], z.ZodOptional<z.ZodString>>)
    .optional()
    .describe("Column choices by header name, for the fields auto-detection got wrong: { date: 'Posting Date', description: 'Payee', amount: 'Amount' }, or debit and credit in place of amount. Fields: date, description, amount, debit, credit, category, type, balance, status. A file with no header row has columns named col1, col2, ..."),
  amount_sign: z
    .enum(['as_is', 'invert'])
    .optional()
    .describe("How to read a single Amount column. 'as_is': negative in the file is money out. 'invert': positive in the file is a purchase (Amex, Discover, Citi card exports). Left out, it is chosen for you: 'invert' when the account is a credit card or loan and most amounts in the file are positive, otherwise 'as_is'. Files with separate Debit and Credit columns need neither."),
  update_balance: z.boolean().default(true).describe('When the file has a running balance column, set the account balance from its newest row.'),
  commit: z.boolean().describe('false: return a preview and change nothing. true: insert the new transactions.'),
});

interface PlannedRow {
  row: number; date: string; amount: number; description: string; merchant: string; category: string | null; categorized_by: string | null;
  is_transfer: number; pending: boolean; hash: string; duplicate: boolean;
}

function runImport(input: z.infer<typeof importInput>, ctx: ToolCtx): unknown {
  const { db } = ctx;
  const att = getAttachment(db, input.attachment_id);
  if (!att) throw new ToolError(`There is no attachment ${input.attachment_id}.`);
  if (att.kind !== 'text') throw new ToolError(`Attachment ${att.id} (${att.filename}) is a ${att.kind} file. money_import reads CSV exports; ask Ben for the bank's CSV download.`);
  let text: string;
  try {
    text = readFileSync(attachmentPath(att), 'utf8');
  } catch {
    text = att.extracted_text ?? '';
  }
  if (!text.trim()) throw new ToolError(`Attachment ${att.id} (${att.filename}) is empty.`);

  const existing = findAccount(db, input.account);
  if (!existing && (!input.create_account || typeof input.account !== 'string')) {
    throw new ToolError(`No single account matches "${input.account}". ${accountNames(db)} To import into a new account, pass create_account: { type, institution }.`);
  }
  const accountType = existing?.type ?? input.create_account!.type;
  const liability = LIABILITY_TYPES.has(accountType);

  const records = parseCsv(text);
  let layout;
  try {
    layout = detectLayout(records, input.mapping ?? {});
  } catch (e) {
    if (e instanceof CsvError) throw new ToolError(e.message);
    throw e;
  }
  const read = readRows(records, layout, { sign: input.amount_sign, autoInvert: liability });
  if (!read.rows.length) {
    throw new ToolError(
      `No transactions could be read from ${att.filename} using columns ${JSON.stringify(layout.mapping)}. ${read.skipped.length} row(s) were skipped; the first: ${read.skipped.slice(0, 3).map((s) => `row ${s.row}: ${s.reason}`).join('; ') || 'none'}. Columns in the file: ${layout.headers.filter(Boolean).join(', ')}. Pass mapping to choose others.`,
    );
  }

  const cats = categoryMap(db);
  const rules = loadRules(db);
  const plan = (accountId: number | null): PlannedRow[] => {
    const seen = new Map<string, number>();
    const exists = db.prepare('SELECT 1 FROM money_transactions WHERE dedupe_hash = ?');
    return read.rows.map((r) => {
      const key = occurrenceKey(r.date, r.amount, r.description);
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const hash = accountId == null ? '' : dedupeHash(accountId, key, n);
      const c = categorize(rules, cats, r.description, { text: r.bankCategory, liability, amount: r.amount });
      return { row: r.row, date: r.date, amount: r.amount, description: r.description, ...c, pending: r.pending, hash, duplicate: accountId != null && !!exists.get(hash) };
    });
  };

  const summarize = (rows: PlannedRow[]) => {
    const fresh = rows.filter((r) => !r.duplicate);
    const dates = rows.map((r) => r.date).sort();
    return {
      parsed_count: rows.length,
      new_count: fresh.length,
      duplicate_count: rows.length - fresh.length,
      skipped_count: read.skipped.length,
      skipped: read.skipped.slice(0, 20),
      date_from: dates[0] ?? null,
      date_to: dates[dates.length - 1] ?? null,
      total_in: r2(fresh.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0)),
      total_out: r2(fresh.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0)),
      uncategorized_count: fresh.filter((r) => !r.category).length,
      transfer_count: fresh.filter((r) => r.is_transfer).length,
    };
  };

  const signExplanation =
    read.signSource === 'debit_credit_columns' ? 'The debit column is money out and the credit column is money in.'
    : read.signSource === 'cr_dr_suffix' ? 'Amounts marked CR are money in; the rest are money out.'
    : read.signSource === 'type_column' ? 'The type column says DEBIT or CREDIT for each row; debits are money out.'
    : read.inverted && input.amount_sign == null ? `Flipped: this is a ${accountType} account and ${read.rawPositive} of ${read.rawPositive + read.rawNegative} amounts are positive in the file, so a positive amount was read as a purchase. Pass amount_sign: 'as_is' if the sample looks backwards.`
    : read.inverted ? 'Flipped as asked: a positive amount in the file is money out.'
    : 'Kept as written: a negative amount in the file is money out.';
  const amountSign = { applied: read.inverted ? 'invert' : 'as_is', decided_by: read.signSource, explanation: signExplanation } as const;

  const ending = endingBalance(read.rows);
  const endBalance = ending ? { balance: r2(liability ? Math.abs(ending.balance) : ending.balance), date: ending.date } : null;
  const file = { attachment_id: att.id, filename: att.filename, headers: layout.headers.filter(Boolean), header_row: layout.headerRow < 0 ? null : layout.headerRow + 1 };

  if (!input.commit) {
    const rows = plan(existing?.id ?? null);
    return {
      committed: false,
      account: existing ? { id: existing.id, name: existing.name, type: existing.type, will_create: false } : { id: null, name: String(input.account).trim(), type: accountType, will_create: true },
      file,
      mapping: layout.mapping,
      amount_sign: amountSign,
      ...summarize(rows),
      ending_balance: endBalance,
      sample: rows.slice(0, 10).map((r) => ({ row: r.row, date: r.date, amount: r.amount, description: r.description, merchant: r.merchant, category: r.category, is_transfer: !!r.is_transfer, pending: r.pending, duplicate: r.duplicate })),
      next: 'Nothing was saved. Check that purchases in the sample are negative, then call money_import again with the same arguments and commit: true.',
    };
  }

  return db.transaction(() => {
    const now = nowIso();
    let account = existing;
    if (!account) {
      const id = Number(
        db.prepare('INSERT INTO money_accounts (name, institution, type, created_at, updated_at) VALUES (?,?,?,?,?)').run(String(input.account).trim(), input.create_account!.institution ?? null, accountType, now, now).lastInsertRowid,
      );
      account = db.prepare('SELECT * FROM money_accounts WHERE id = ?').get(id) as AccountRow;
    }
    const rows = plan(account.id);
    const summary = summarize(rows);
    const fresh = rows.filter((r) => !r.duplicate);
    const accountInfo = { id: account.id, name: account.name, type: account.type, created: !existing };
    if (!fresh.length) {
      return { committed: true, batch_id: null, account: accountInfo, inserted: 0, ...summary, note: 'Every transaction in this file is already recorded; nothing was added.' };
    }
    const batchId = Number(
      db.prepare('INSERT INTO money_import_batches (account_id, attachment_id, filename, imported_at, row_count, inserted_count, duplicate_count, skipped_count, date_from, date_to) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(account.id, att.id, att.filename, now, rows.length, fresh.length, summary.duplicate_count, summary.skipped_count, summary.date_from, summary.date_to).lastInsertRowid,
    );
    const insert = db.prepare(
      'INSERT INTO money_transactions (account_id, date, amount, description, merchant, category, categorized_by, is_transfer, pending, import_batch_id, dedupe_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    for (const r of fresh) insert.run(account.id, r.date, r.amount, r.description, r.merchant, r.category, r.categorized_by, r.is_transfer, r.pending ? 1 : 0, batchId, r.hash, now, now);

    let balanceUpdated: { balance: number; as_of: string; is_current: boolean } | null = null;
    if (endBalance && input.update_balance) {
      const { current } = setBalance(db, account.id, endBalance.balance, endBalance.date);
      balanceUpdated = { balance: endBalance.balance, as_of: endBalance.date, is_current: current };
    }
    const uncategorized = new Map<string, { merchant: string; count: number; total: number }>();
    for (const r of fresh) {
      if (r.category) continue;
      const u = uncategorized.get(r.merchant) ?? { merchant: r.merchant, count: 0, total: 0 };
      u.count++;
      u.total += r.amount;
      uncategorized.set(r.merchant, u);
    }
    return {
      committed: true,
      batch_id: batchId,
      account: accountInfo,
      inserted: fresh.length,
      ...summary,
      amount_sign: amountSign,
      balance_updated: balanceUpdated,
      top_uncategorized: [...uncategorized.values()].sort((a, b) => b.count - a.count || a.total - b.total).slice(0, 10).map((u) => ({ ...u, total: r2(u.total) })),
    };
  })();
}

// ---- account and holdings tool -----------------------------------------------------------

const accountUpdateInput = z.object({
  accounts: z
    .array(
      z.object({
        name: z.string().min(1).max(80).describe("Ben's name for the account. An unknown name creates the account (type is then required)."),
        rename_to: z.string().min(1).max(80).optional(),
        type: z.enum(ACCOUNT_TYPES).optional().describe('credit_card, loan and mortgage are liabilities; the rest are assets.'),
        institution: z.string().max(80).optional(),
        last4: z.string().regex(/^\d{4}$/).optional(),
        balance: z.number().optional().describe('Dollars. For a credit card, loan or mortgage this is the amount owed as a positive number.'),
        balance_as_of: day.optional().describe('The day the balance was true; today when left out. An older day than the current one is added to the history only.'),
        balance_from_holdings: z.boolean().optional().describe("Set the balance to the market value of the account's holdings, after the holdings in this same call are applied."),
        active: z.boolean().optional().describe('false closes the account: kept for history, left out of net worth.'),
        notes: z.string().max(1000).optional(),
        delete: z.boolean().optional().describe('Remove the account with its transactions, holdings and balance history.'),
      }),
    )
    .max(50)
    .optional(),
  holdings: z
    .array(
      z.object({
        account: accountRef.optional().describe('The account holding the position. May be left out for a price-only update, which then applies to that symbol in every account.'),
        symbol: z.string().min(1).max(20).describe("Ticker: 'VTI'. Use 'CASH' for uninvested cash, with quantity in dollars and price 1."),
        name: z.string().max(120).optional(),
        asset_class: z.enum(ASSET_CLASSES).optional().describe('Pass it when first adding a position.'),
        quantity: z.number().min(0).optional().describe('Total shares now held (replaces the stored quantity).'),
        add_quantity: z.number().optional().describe('Shares bought (positive) or sold (negative), added to the stored quantity. A buy adds add_quantity * price to the cost basis; a sale reduces the cost basis in proportion.'),
        price: z.number().min(0).optional().describe('Dollars per share: the purchase price with add_quantity, and the latest price either way.'),
        price_as_of: day.optional(),
        cost_basis: z.number().min(0).optional().describe('Total dollars paid for the whole position; overrides the computed value.'),
        remove: z.boolean().optional().describe('Delete the position.'),
      }),
    )
    .max(200)
    .optional(),
});

interface HoldingRow {
  id: number; account_id: number; symbol: string; name: string | null; asset_class: string; quantity: number; cost_basis: number | null; last_price: number | null; price_as_of: string | null;
}

const holdingValue = (h: { quantity: number; last_price: number | null; cost_basis: number | null }): number => r2(h.last_price != null ? h.quantity * h.last_price : (h.cost_basis ?? 0));

async function runAccountUpdate(input: z.infer<typeof accountUpdateInput>, ctx: ToolCtx): Promise<unknown> {
  const { db } = ctx;
  if (!input.accounts?.length && !input.holdings?.length) throw new ToolError('Pass accounts, holdings, or both.');
  const today = localDay();

  // Confirmations first: nothing below can wait on Ben once the transaction has begun.
  for (const a of input.accounts ?? []) {
    if (!a.delete) continue;
    const row = db.prepare('SELECT * FROM money_accounts WHERE name = ?').get(a.name.trim()) as AccountRow | undefined;
    if (!row) throw new ToolError(`No account named "${a.name}" to delete. ${accountNames(db)}`);
    const tx = (db.prepare('SELECT COUNT(*) AS n FROM money_transactions WHERE account_id = ?').get(row.id) as { n: number }).n;
    const holdings = (db.prepare('SELECT COUNT(*) AS n FROM money_holdings WHERE account_id = ?').get(row.id) as { n: number }).n;
    if (tx || holdings) {
      const parts = [tx ? `${tx} transaction${tx === 1 ? '' : 's'}` : '', holdings ? `${holdings} holding${holdings === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
      if (!(await ctx.confirm(`Delete the account "${row.name}" along with its ${parts} and its balance history?`))) throw new ToolError(`Ben declined deleting the account "${row.name}". Nothing was changed.`);
    }
  }

  return db.transaction(() => {
    const now = nowIso();
    const accountsOut: unknown[] = [];
    const deleted: string[] = [];
    const fromHoldings: number[] = [];
    for (const a of input.accounts ?? []) {
      const name = a.name.trim();
      let row = db.prepare('SELECT * FROM money_accounts WHERE name = ?').get(name) as AccountRow | undefined;
      if (a.delete) {
        db.prepare('DELETE FROM money_accounts WHERE id = ?').run(row!.id);
        deleted.push(row!.name);
        continue;
      }
      if (!row) {
        if (!a.type) throw new ToolError(`"${name}" is a new account, so it needs a type: ${ACCOUNT_TYPES.join(', ')}. ${accountNames(db)}`);
        const id = Number(db.prepare('INSERT INTO money_accounts (name, institution, type, last4, active, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(a.rename_to?.trim() ?? name, a.institution ?? null, a.type, a.last4 ?? null, a.active === false ? 0 : 1, a.notes ?? null, now, now).lastInsertRowid);
        row = db.prepare('SELECT * FROM money_accounts WHERE id = ?').get(id) as AccountRow;
      } else {
        const rename = a.rename_to?.trim();
        if (rename && rename.toLowerCase() !== row.name.toLowerCase() && db.prepare('SELECT 1 FROM money_accounts WHERE name = ?').get(rename)) throw new ToolError(`There is already an account named "${rename}".`);
        db.prepare('UPDATE money_accounts SET name = ?, type = ?, institution = ?, last4 = ?, active = ?, notes = ?, updated_at = ? WHERE id = ?').run(
          rename ?? row.name, a.type ?? row.type, a.institution ?? row.institution, a.last4 ?? row.last4, a.active == null ? row.active : a.active ? 1 : 0, a.notes ?? row.notes, now, row.id,
        );
      }
      if (a.balance != null) setBalance(db, row.id, a.balance, a.balance_as_of ?? today);
      if (a.balance_from_holdings) fromHoldings.push(row.id);
      accountsOut.push(row.id);
    }

    const holdingsOut: unknown[] = [];
    for (const h of input.holdings ?? []) {
      const symbol = h.symbol.trim().toUpperCase();
      const priceOnly = h.price != null && h.quantity == null && h.add_quantity == null && h.cost_basis == null && !h.remove;
      let targets: HoldingRow[];
      let account: AccountRow | undefined;
      if (h.account == null) {
        targets = db.prepare('SELECT * FROM money_holdings WHERE symbol = ?').all(symbol) as HoldingRow[];
        if (!targets.length) throw new ToolError(`No account holds ${symbol} yet; pass account to add it. ${accountNames(db)}`);
        if (!priceOnly && targets.length > 1) throw new ToolError(`${symbol} is held in ${targets.length} accounts; pass account to say which one.`);
        if (!priceOnly) account = db.prepare('SELECT * FROM money_accounts WHERE id = ?').get(targets[0]!.account_id) as AccountRow;
      } else {
        account = requireAccount(db, h.account);
        targets = db.prepare('SELECT * FROM money_holdings WHERE account_id = ? AND symbol = ?').all(account.id, symbol) as HoldingRow[];
      }
      const asOf = h.price_as_of ?? today;

      if (priceOnly && h.account == null) {
        db.prepare('UPDATE money_holdings SET last_price = ?, price_as_of = ?, updated_at = ? WHERE symbol = ?').run(h.price, asOf, now, symbol);
        holdingsOut.push({ symbol, price: h.price, updated_in_accounts: targets.length });
        continue;
      }
      const cur = targets[0];
      if (h.remove) {
        if (!cur) throw new ToolError(`${account!.name} has no ${symbol} position to remove.`);
        db.prepare('DELETE FROM money_holdings WHERE id = ?').run(cur.id);
        holdingsOut.push({ account: account!.name, symbol, removed: true });
        continue;
      }
      if (!cur) {
        const quantity = h.quantity ?? h.add_quantity;
        if (quantity == null || quantity <= 0) throw new ToolError(`${symbol} is a new position in ${account!.name}: pass quantity (or add_quantity) above zero.`);
        const cost = h.cost_basis ?? (h.price != null ? r2(quantity * h.price) : null);
        db.prepare('INSERT INTO money_holdings (account_id, symbol, name, asset_class, quantity, cost_basis, last_price, price_as_of, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
          account!.id, symbol, h.name ?? null, h.asset_class ?? (symbol === 'CASH' ? 'cash' : 'other'), quantity, cost, h.price ?? null, h.price != null ? asOf : null, now,
        );
      } else {
        let quantity = cur.quantity;
        let cost = cur.cost_basis;
        if (h.quantity != null) quantity = h.quantity;
        if (h.add_quantity != null) {
          const next = quantity + h.add_quantity;
          if (next < -1e-9) throw new ToolError(`${account!.name} holds ${quantity} ${symbol}; selling ${-h.add_quantity} would leave a negative position.`);
          if (h.add_quantity > 0) {
            const price = h.price ?? cur.last_price;
            if (price != null) cost = r2((cost ?? 0) + h.add_quantity * price);
          } else if (cost != null && quantity > 0) cost = r2(cost * (next / quantity));
          quantity = Math.max(0, next);
        }
        if (h.cost_basis != null) cost = h.cost_basis;
        if (quantity <= 1e-9) {
          db.prepare('DELETE FROM money_holdings WHERE id = ?').run(cur.id);
          holdingsOut.push({ account: account!.name, symbol, removed: true, note: 'quantity reached zero' });
          continue;
        }
        db.prepare('UPDATE money_holdings SET name = ?, asset_class = ?, quantity = ?, cost_basis = ?, last_price = ?, price_as_of = ?, updated_at = ? WHERE id = ?').run(
          h.name ?? cur.name, h.asset_class ?? cur.asset_class, quantity, cost, h.price ?? cur.last_price, h.price != null ? asOf : cur.price_as_of, now, cur.id,
        );
      }
      const saved = db.prepare('SELECT * FROM money_holdings WHERE account_id = ? AND symbol = ?').get(account!.id, symbol) as HoldingRow;
      holdingsOut.push({
        account: account!.name, symbol, quantity: saved.quantity, cost_basis: saved.cost_basis == null ? null : r2(saved.cost_basis), last_price: saved.last_price, asset_class: saved.asset_class,
        market_value: saved.last_price == null ? null : r2(saved.quantity * saved.last_price),
      });
    }

    for (const id of fromHoldings) {
      const rows = db.prepare('SELECT quantity, last_price, cost_basis FROM money_holdings WHERE account_id = ?').all(id) as HoldingRow[];
      if (!rows.length) throw new ToolError('balance_from_holdings needs at least one holding in the account.');
      const unpriced = rows.filter((r) => r.last_price == null).length;
      if (unpriced) throw new ToolError(`balance_from_holdings needs a price on every holding in the account; ${unpriced} have none.`);
      setBalance(db, id, rows.reduce((s, r) => s + r.quantity * r.last_price!, 0), today);
    }
    return {
      accounts: (accountsOut as number[]).map((id) => {
        const a = accountOut(db.prepare('SELECT * FROM money_accounts WHERE id = ?').get(id) as AccountRow);
        return { ...a, net_worth_contribution: a.balance == null || !a.active ? 0 : a.is_liability ? -a.balance : a.balance };
      }),
      deleted_accounts: deleted,
      holdings: holdingsOut,
      net_worth: netWorth(db),
    };
  })();
}

// ---- transactions tool -----------------------------------------------------------

const setShape = z.object({
  category: z.string().nullable().optional().describe('Category name; null clears it back to uncategorized.'),
  transfer: z.boolean().optional().describe("true marks a move between Ben's own accounts or a card payment (category becomes 'transfer'); false undoes that."),
  merchant: z.string().min(1).max(80).optional(),
  notes: z.string().max(1000).nullable().optional(),
  pending: z.boolean().optional(),
  date: day.optional(),
  amount: z.number().optional().describe('Signed dollars: negative = money out.'),
  account: accountRef.optional().describe('Move the transaction to this account.'),
});

const transactionsInput = z.object({
  add: z
    .array(
      z.object({
        account: accountRef,
        date: day,
        amount: z.number().describe('Signed dollars: negative = money out (a $12.50 lunch is -12.5), positive = money in.'),
        description: z.string().min(1).max(300).describe('What it was, as Ben said it or as the receipt reads.'),
        merchant: z.string().max(80).optional(),
        category: z.string().optional().describe('Left out, the rules choose.'),
        transfer: z.boolean().optional(),
        pending: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      }),
    )
    .max(500)
    .optional()
    .describe('Transactions entered by hand: cash spending, or something no CSV will carry.'),
  update: z
    .array(
      z.object({
        ids: z.array(z.number().int()).max(1000).optional().describe('money_transactions.id values.'),
        filter: filterSchema.optional().describe('Every transaction matching all the conditions given. With ids as well, only those ids that also match.'),
        set: setShape.describe('The fields to change on every selected transaction.'),
        make_rule: z.boolean().optional().describe("Also add a rule sending each selected transaction's merchant to set.category from now on."),
      }),
    )
    .max(50)
    .optional()
    .describe("Edits. Recategorizing by hand marks the transaction 'manual', which rules then leave alone."),
  delete: z
    .object({ ids: z.array(z.number().int()).max(1000).optional(), filter: filterSchema.optional() })
    .optional()
    .describe('Delete transactions by id or by filter. Ben is asked to confirm a filter or more than ten ids.'),
  undo_import: z.number().int().optional().describe('money_import_batches.id: delete every transaction that import added. Ben is asked to confirm.'),
  rules: z
    .array(
      z.object({
        pattern: z.string().min(2).max(200).describe("Text to look for in the description or merchant, case-insensitive: 'trader joe'. With match: 'regex', a regular expression: '\\\\bshell\\\\b'."),
        match: z.enum(['contains', 'regex']).default('contains'),
        category: z.string().optional().describe('Category to assign.'),
        transfer: z.boolean().optional().describe("true: matching transactions are transfers (category 'transfer')."),
        merchant: z.string().min(1).max(80).optional().describe('Rename the merchant on matching transactions.'),
        priority: z.number().int().min(-100).max(100).optional().describe('Higher wins when several rules match; ties go to the longest pattern. Default 0.'),
        remove: z.boolean().optional().describe('Delete the rule with this pattern and match.'),
      }),
    )
    .max(100)
    .optional()
    .describe('Add, change or remove categorization rules. A new or changed rule is applied straight away to existing transactions it matches, except those categorized by hand.'),
  reapply_rules: z
    .enum(['uncategorized', 'all'])
    .optional()
    .describe("Run every rule again: 'uncategorized' fills in transactions with no category; 'all' re-evaluates every transaction not categorized by hand."),
});

async function runTransactionsUpdate(input: z.infer<typeof transactionsInput>, ctx: ToolCtx): Promise<unknown> {
  const { db } = ctx;
  if (!input.add?.length && !input.update?.length && !input.delete && input.undo_import == null && !input.rules?.length && !input.reapply_rules) {
    throw new ToolError('Nothing to do: pass add, update, delete, undo_import, rules or reapply_rules.');
  }

  // Confirmations first. Deletes are resolved to ids here so what Ben approves is exactly what is removed.
  let deleteIds: number[] | null = null;
  if (input.delete) {
    deleteIds = selectIds(db, input.delete, 'delete');
    const byFilter = !!input.delete.filter && Object.values(input.delete.filter).some((v) => v != null);
    if (deleteIds.length && (byFilter || deleteIds.length > 10)) {
      const s = db.prepare(`SELECT MIN(date) AS a, MAX(date) AS b, ROUND(SUM(amount), 2) AS total, COUNT(DISTINCT account_id) AS accounts FROM money_transactions WHERE id IN (${inList(deleteIds)})`).get() as { a: string; b: string; total: number; accounts: number };
      const summary = `Delete ${deleteIds.length} transaction${deleteIds.length === 1 ? '' : 's'} dated ${s.a} to ${s.b} across ${s.accounts} account${s.accounts === 1 ? '' : 's'} (net ${usd(s.total)})?`;
      if (!(await ctx.confirm(summary))) throw new ToolError('Ben declined the delete. Nothing was changed.');
    }
  }
  let undo: { id: number; filename: string; account: string; remaining: number } | null = null;
  if (input.undo_import != null) {
    const b = db.prepare('SELECT b.id, b.filename, b.imported_at, b.undone_at, a.name AS account FROM money_import_batches b JOIN money_accounts a ON a.id = b.account_id WHERE b.id = ?').get(input.undo_import) as
      | { id: number; filename: string; imported_at: string; undone_at: string | null; account: string }
      | undefined;
    if (!b) throw new ToolError(`There is no import batch ${input.undo_import}. Recent ones: SELECT id, filename, imported_at FROM money_import_batches ORDER BY id DESC.`);
    if (b.undone_at) throw new ToolError(`Import ${b.id} (${b.filename}) was already undone on ${b.undone_at.slice(0, 10)}.`);
    const remaining = (db.prepare('SELECT COUNT(*) AS n FROM money_transactions WHERE import_batch_id = ?').get(b.id) as { n: number }).n;
    if (!(await ctx.confirm(`Undo the import of ${b.filename} into ${b.account} (${b.imported_at.slice(0, 10)}) by deleting its ${remaining} transaction${remaining === 1 ? '' : 's'}?`))) {
      throw new ToolError(`Ben declined undoing import ${b.id}. Nothing was changed.`);
    }
    undo = { id: b.id, filename: b.filename, account: b.account, remaining };
  }

  return db.transaction(() => {
    const now = nowIso();
    const cats = categoryMap(db);
    const result: Record<string, unknown> = {};

    if (input.add?.length) {
      const rules = loadRules(db);
      const insert = db.prepare(
        'INSERT INTO money_transactions (account_id, date, amount, description, merchant, category, categorized_by, is_transfer, pending, notes, dedupe_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      const exists = db.prepare('SELECT 1 FROM money_transactions WHERE dedupe_hash = ?');
      const added: unknown[] = [];
      for (const t of input.add) {
        const account = requireAccount(db, t.account);
        const amount = r2(t.amount);
        if (amount === 0) throw new ToolError(`"${t.description}" has a zero amount.`);
        const description = t.description.trim();
        const auto = categorize(rules, cats, description, { text: null, liability: !!account.is_liability, amount });
        const patch = categoryPatch(cats, t.category, t.transfer);
        const chosen = patch && patch !== 'clear_transfer' ? patch : null;
        const key = occurrenceKey(t.date, amount, description);
        let n = 0;
        while (exists.get(dedupeHash(account.id, key, n))) n++;
        const id = Number(
          insert.run(
            account.id, t.date, amount, description, t.merchant?.trim() || auto.merchant, chosen ? chosen.category : auto.category, chosen ? 'manual' : auto.categorized_by,
            chosen ? chosen.is_transfer : auto.is_transfer, t.pending ? 1 : 0, t.notes ?? null, dedupeHash(account.id, key, n), now, now,
          ).lastInsertRowid,
        );
        added.push({ id, account: account.name, date: t.date, amount, merchant: t.merchant?.trim() || auto.merchant, category: chosen ? chosen.category : auto.category });
      }
      result.added = added;
    }

    const ruleIds = new Set<number>();
    const rulesOut: { id: number; pattern: string; removed?: boolean }[] = [];
    for (const r of input.rules ?? []) {
      if (r.remove) {
        const row = db.prepare('SELECT id FROM money_rules WHERE pattern = ? AND match_type = ?').get(r.pattern.trim(), r.match) as { id: number } | undefined;
        if (!row) throw new ToolError(`There is no ${r.match} rule with the pattern "${r.pattern}".`);
        db.prepare('DELETE FROM money_rules WHERE id = ?').run(row.id);
        rulesOut.push({ id: row.id, pattern: r.pattern, removed: true });
        continue;
      }
      const id = upsertRule(db, cats, r);
      ruleIds.add(id);
      rulesOut.push({ id, pattern: r.pattern.trim() });
    }

    if (input.update?.length) {
      const updates: unknown[] = [];
      for (const u of input.update) {
        const ids = selectIds(db, u, 'update');
        const sets: string[] = [];
        const params: unknown[] = [];
        const patch = categoryPatch(cats, u.set.category, u.set.transfer);
        if (patch === 'clear_transfer') sets.push('category = CASE WHEN is_transfer = 1 THEN NULL ELSE category END', 'categorized_by = CASE WHEN is_transfer = 1 THEN NULL ELSE categorized_by END', 'is_transfer = 0');
        else if (patch) {
          sets.push('category = ?', 'is_transfer = ?', 'categorized_by = ?');
          params.push(patch.category, patch.is_transfer, patch.category ? 'manual' : null);
        }
        if (u.set.merchant != null) {
          sets.push('merchant = ?');
          params.push(u.set.merchant.trim());
        }
        if (u.set.notes !== undefined) {
          sets.push('notes = ?');
          params.push(u.set.notes);
        }
        if (u.set.pending != null) {
          sets.push('pending = ?');
          params.push(u.set.pending ? 1 : 0);
        }
        if (u.set.date != null) {
          sets.push('date = ?');
          params.push(u.set.date);
        }
        if (u.set.amount != null) {
          if (r2(u.set.amount) === 0) throw new ToolError('A transaction amount cannot be zero; delete it instead.');
          sets.push('amount = ?');
          params.push(r2(u.set.amount));
        }
        if (u.set.account != null) {
          sets.push('account_id = ?');
          params.push(requireAccount(db, u.set.account).id);
        }
        if (!sets.length) throw new ToolError('update.set is empty: name at least one field to change.');
        if (ids.length) db.prepare(`UPDATE money_transactions SET ${sets.join(', ')}, updated_at = ? WHERE id IN (${inList(ids)})`).run(...params, now);
        const entry: Record<string, unknown> = { matched: ids.length };
        if (u.make_rule) {
          if (!patch || patch === 'clear_transfer' || !patch.category) throw new ToolError('make_rule needs set.category (or set.transfer: true) to know what the rule should assign.');
          if (!ids.length) throw new ToolError('make_rule matched no transactions to take a merchant from.');
          const merchants = (db.prepare(`SELECT DISTINCT merchant FROM money_transactions WHERE id IN (${inList(ids)})`).all() as { merchant: string }[]).map((m) => m.merchant);
          if (merchants.length > 10) throw new ToolError(`The selection covers ${merchants.length} different merchants, too many for make_rule. Pass rules: [{ pattern, category }] with the text they share.`);
          entry.rules = merchants.map((m) => {
            const id = upsertRule(db, cats, { pattern: m.toLowerCase(), match: 'contains', category: patch.category! });
            ruleIds.add(id);
            rulesOut.push({ id, pattern: m.toLowerCase() });
            return m.toLowerCase();
          });
        }
        updates.push(entry);
      }
      result.updated = updates;
    }

    if (ruleIds.size) result.rules_applied_to = applyRules(db, 'all', ruleIds);
    if (rulesOut.length) result.rules = rulesOut;

    if (deleteIds) {
      if (deleteIds.length) db.prepare(`DELETE FROM money_transactions WHERE id IN (${inList(deleteIds)})`).run();
      result.deleted = deleteIds.length;
    }
    if (undo) {
      const n = db.prepare('DELETE FROM money_transactions WHERE import_batch_id = ?').run(undo.id).changes;
      db.prepare('UPDATE money_import_batches SET undone_at = ? WHERE id = ?').run(now, undo.id);
      result.undone_import = { batch_id: undo.id, filename: undo.filename, account: undo.account, deleted: n, note: 'Account balances were left as they are.' };
    }
    if (input.reapply_rules) result.reapplied = applyRules(db, input.reapply_rules);
    return result;
  })();
}

// ---- budgets and categories tool -------------------------------------------------------

const budgetInput = z.object({
  budgets: z
    .array(
      z.object({
        category: z.string().describe("Category name: 'groceries'."),
        monthly_amount: z.number().positive().optional().describe('Dollars per calendar month.'),
        remove: z.boolean().optional().describe('Stop budgeting this category.'),
      }),
    )
    .max(100)
    .optional(),
  categories: z
    .array(
      z.object({
        name: z.string().min(2).max(40).describe("snake_case key: 'kids_activities'."),
        label: z.string().max(60).optional().describe("Display name: 'Kids activities'. Derived from the name when left out."),
        group: z.enum(CATEGORY_GROUPS).optional().describe("Required for a new category. 'essentials' and 'lifestyle' are spending; 'income' is money in; 'transfers' is neither."),
        rename_to: z.string().min(2).max(40).optional().describe('New snake_case key; transactions, rules and the budget follow.'),
        remove: z.boolean().optional(),
        move_to: z.string().optional().describe("With remove: the category that takes over this one's transactions and rules. Left out, its transactions become uncategorized."),
      }),
    )
    .max(50)
    .optional()
    .describe('Add, relabel, regroup, rename or remove categories. Applied before budgets, so a new category can be budgeted in the same call.'),
});

const snake = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function runBudgetUpdate(input: z.infer<typeof budgetInput>, ctx: ToolCtx): unknown {
  const { db } = ctx;
  if (!input.budgets?.length && !input.categories?.length) throw new ToolError('Pass budgets, categories, or both.');
  return db.transaction(() => {
    const now = nowIso();
    const categoriesOut: unknown[] = [];
    for (const c of input.categories ?? []) {
      const name = snake(c.name);
      if (name.length < 2 || name === 'uncategorized') throw new ToolError(`"${c.name}" cannot be used as a category name.`);
      const cats = categoryMap(db);
      const existing = cats.get(name);
      if (c.remove) {
        if (!existing) throw new ToolError(`There is no category "${name}" to remove.`);
        if (name === 'transfer') throw new ToolError("The 'transfer' category is what marking a transaction as a transfer assigns; it cannot be removed.");
        const target = c.move_to ? requireCategory(cats, c.move_to) : null;
        if (target?.name === name) throw new ToolError('move_to must be a different category.');
        const moved = db
          .prepare('UPDATE money_transactions SET category = ?, is_transfer = ?, categorized_by = CASE WHEN ? IS NULL THEN NULL ELSE categorized_by END, updated_at = ? WHERE category = ?')
          .run(target?.name ?? null, target?.category_group === 'transfers' ? 1 : 0, target?.name ?? null, now, name).changes;
        if (target) db.prepare('UPDATE OR IGNORE money_rules SET category = ? WHERE category = ?').run(target.name, name);
        db.prepare('DELETE FROM money_categories WHERE name = ?').run(name); // cascades to its rules and budget
        categoriesOut.push({ name, removed: true, transactions_moved: moved, moved_to: target?.name ?? null });
        continue;
      }
      if (!existing) {
        if (!c.group) throw new ToolError(`"${name}" is a new category, so it needs a group: ${CATEGORY_GROUPS.join(', ')}.`);
        const label = c.label?.trim() || name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');
        db.prepare('INSERT INTO money_categories (name, label, category_group) VALUES (?,?,?)').run(name, label, c.group);
        categoriesOut.push({ name, label, group: c.group, created: true });
        continue;
      }
      const newName = c.rename_to ? snake(c.rename_to) : name;
      if (newName !== name && (newName.length < 2 || cats.has(newName))) throw new ToolError(`Cannot rename "${name}" to "${c.rename_to}": that name is ${cats.has(newName) ? 'taken' : 'not usable'}.`);
      const group = c.group ?? existing.category_group;
      db.prepare('UPDATE money_categories SET name = ?, label = ?, category_group = ? WHERE name = ?').run(newName, c.label?.trim() || existing.label, group, name);
      if (group !== existing.category_group) {
        db.prepare('UPDATE money_transactions SET is_transfer = ?, updated_at = ? WHERE category = ?').run(group === 'transfers' ? 1 : 0, now, newName);
        if (group === 'income' || group === 'transfers') db.prepare('DELETE FROM money_budgets WHERE category = ?').run(newName);
      }
      categoriesOut.push({ name: newName, label: c.label?.trim() || existing.label, group });
    }

    const cats = categoryMap(db);
    const budgetsOut: unknown[] = [];
    for (const b of input.budgets ?? []) {
      const cat = requireCategory(cats, b.category);
      if (b.remove) {
        const n = db.prepare('DELETE FROM money_budgets WHERE category = ?').run(cat.name).changes;
        if (!n) throw new ToolError(`There is no budget on "${cat.name}" to remove.`);
        budgetsOut.push({ category: cat.name, removed: true });
        continue;
      }
      if (b.monthly_amount == null) throw new ToolError(`The budget for "${cat.name}" needs monthly_amount.`);
      if (cat.category_group === 'income' || cat.category_group === 'transfers') throw new ToolError(`"${cat.name}" is in the ${cat.category_group} group; budgets are for spending categories.`);
      db.prepare('INSERT INTO money_budgets (category, monthly_amount, updated_at) VALUES (?,?,?) ON CONFLICT(category) DO UPDATE SET monthly_amount = excluded.monthly_amount, updated_at = excluded.updated_at').run(cat.name, r2(b.monthly_amount), now);
      budgetsOut.push({ category: cat.name, monthly_amount: r2(b.monthly_amount) });
    }
    const total = (db.prepare('SELECT COALESCE(SUM(monthly_amount), 0) AS s FROM money_budgets').get() as { s: number }).s;
    return { categories: categoriesOut, budgets: budgetsOut, total_monthly_budget: r2(total) };
  })();
}

// ---- reads shared by several views ------------------------------------------------------

function monthTotals(db: DB, from: string, to: string): { spent: number; income: number } {
  const spent = (db.prepare('SELECT COALESCE(SUM(spent), 0) AS s FROM money_spending WHERE date >= ? AND date < ?').get(from, to) as { s: number }).s;
  const income = (db.prepare('SELECT COALESCE(SUM(received), 0) AS s FROM money_income WHERE date >= ? AND date < ?').get(from, to) as { s: number }).s;
  return { spent: r2(spent), income: r2(income) };
}

interface CategorySpend { category: string; label: string; group: string; spent: number; count: number }

function spendByCategory(db: DB, from: string, to: string): CategorySpend[] {
  return (
    db
      .prepare(`SELECT s.category, COALESCE(c.label, 'Uncategorized') AS label, s.category_group AS "group", ROUND(SUM(s.spent), 2) AS spent, COUNT(*) AS count
                FROM money_spending s LEFT JOIN money_categories c ON c.name = s.category
                WHERE s.date >= ? AND s.date < ? GROUP BY s.category ORDER BY spent DESC, s.category`)
      .all(from, to) as CategorySpend[]
  );
}

type BudgetStatus = 'over' | 'near' | 'fast' | 'ok';
interface BudgetItem {
  category: string; label: string; group: string; monthly_amount: number; spent: number; remaining: number;
  /** spent / monthly_amount. */
  used: number;
  /** used / month_elapsed: 1 = spending exactly in step with the calendar. Null before the month starts. */
  pace: number | null;
  /** Month-end spending at the current rate. Null before the month starts. */
  projected: number | null;
  status: BudgetStatus;
}

function budgetReport(db: DB, month: string, today: string) {
  const [from, to] = monthRange(month);
  const current = today.slice(0, 7);
  const dim = daysInMonth(month);
  const dayOfMonth = month === current ? Number(today.slice(8, 10)) : month < current ? dim : 0;
  const elapsed = dayOfMonth / dim;
  const spent = new Map(spendByCategory(db, from, to).map((s) => [s.category, s]));
  const rows = db
    .prepare('SELECT b.category, c.label, c.category_group AS "group", b.monthly_amount FROM money_budgets b JOIN money_categories c ON c.name = b.category ORDER BY c.category_group, c.label')
    .all() as { category: string; label: string; group: string; monthly_amount: number }[];
  const items: BudgetItem[] = rows.map((b) => {
    const s = spent.get(b.category)?.spent ?? 0;
    const used = b.monthly_amount > 0 ? s / b.monthly_amount : 0;
    const projected = elapsed > 0 ? s / elapsed : null;
    const status: BudgetStatus =
      s > b.monthly_amount ? 'over'
      : used >= 0.9 && month === current ? 'near'
      : month === current && elapsed < 1 && projected != null && projected > b.monthly_amount * 1.1 && used - elapsed > 0.1 ? 'fast'
      : 'ok';
    return {
      category: b.category, label: b.label, group: b.group, monthly_amount: r2(b.monthly_amount), spent: r2(s), remaining: r2(b.monthly_amount - s),
      used: r4(used), pace: elapsed > 0 ? r4(used / elapsed) : null, projected: projected == null ? null : r2(projected), status,
    };
  });
  const budgeted = new Set(rows.map((r) => r.category));
  const totalBudget = items.reduce((s, i) => s + i.monthly_amount, 0);
  const totalSpent = items.reduce((s, i) => s + i.spent, 0);
  return {
    month, today, is_current_month: month === current, day_of_month: dayOfMonth, days_in_month: dim, month_elapsed: r4(elapsed),
    totals: { budget: r2(totalBudget), spent: r2(totalSpent), remaining: r2(totalBudget - totalSpent), used: totalBudget > 0 ? r4(totalSpent / totalBudget) : 0 },
    counts: { over: items.filter((i) => i.status === 'over').length, near: items.filter((i) => i.status === 'near').length, fast: items.filter((i) => i.status === 'fast').length, ok: items.filter((i) => i.status === 'ok').length },
    items,
    unbudgeted: [...spent.values()].filter((s) => !budgeted.has(s.category) && s.spent > 0).map((s) => ({ category: s.category, label: s.label, group: s.group, spent: s.spent })),
  };
}

const uncategorizedCount = (db: DB): number => (db.prepare('SELECT COUNT(*) AS n FROM money_transactions WHERE category IS NULL').get() as { n: number }).n;

function recurringReport(db: DB, today: string, months: number) {
  const from = `${addMonths(today.slice(0, 7), -months)}-01`;
  const rows = db
    .prepare(`SELECT t.id, t.date, -t.amount AS spent, t.merchant, t.category, a.name AS account FROM money_transactions t JOIN money_accounts a ON a.id = t.account_id
              WHERE t.is_transfer = 0 AND t.pending = 0 AND t.amount < 0 AND t.date >= ? AND t.date <= ?`)
    .all(from, today) as Outflow[];
  const items = detectRecurring(rows, today);
  const active = items.filter((i) => i.active);
  return {
    today, since: from, items,
    monthly_total: r2(active.reduce((s, i) => s + i.typical_amount, 0)),
    subscriptions_monthly_total: r2(active.filter((i) => i.category === 'subscriptions').reduce((s, i) => s + i.typical_amount, 0)),
  };
}

// ---- the domain ------------------------------------------------------------------

export default defineDomain({
  name: 'money',
  migrations: [{ id: 'money-001', sql: SCHEMA }],
  promptNote: PROMPT_NOTE,
  tools: [
    defineTool({
      name: 'money_import',
      description:
        "Import a bank or card CSV export that Ben uploaded into one account. Two steps with the same arguments: commit: false returns a preview (the columns it chose, row count, date range, how many rows are new versus already recorded, money in and out, the first 10 rows as they would be saved, rows it could not read); commit: true saves the new rows, applies the categorization rules, records an import batch and, when the file has a running balance, updates the account balance. Rows already recorded are skipped, so overlapping or repeated files are safe. Example: { attachment_id: 12, account: 'Chase checking', commit: false }. For an account that does not exist yet add create_account: { type: 'credit_card', institution: 'Amex' }. If the preview's purchases come out positive pass amount_sign; if it picked the wrong columns pass mapping.",
      input: importInput,
      touches: ['money'],
      run: runImport,
    }),
    defineTool({
      name: 'money_account_update',
      description:
        "Create, change or delete accounts, set balances, and maintain investment holdings; each list takes many entries. Setting a balance also records it in the balance history that the net-worth trend is drawn from. Examples: update a balance { accounts: [{ name: '401k', balance: 182300 }] }; a new card owing $1,240 { accounts: [{ name: 'Amex Gold', type: 'credit_card', institution: 'Amex', balance: 1240 }] }; buy 10 shares of VTI at $268 { holdings: [{ account: 'Schwab brokerage', symbol: 'VTI', add_quantity: 10, price: 268, asset_class: 'us_stock' }] }; refresh a price everywhere { holdings: [{ symbol: 'VTI', price: 271.4 }] }. Returns the saved rows and the resulting net worth.",
      input: accountUpdateInput,
      touches: ['money'],
      run: runAccountUpdate,
    }),
    defineTool({
      name: 'money_transactions_update',
      description:
        "Everything that changes transactions or the rules that categorize them, in one call: add transactions by hand, edit or recategorize by ids or by filter, mark transfers, delete, undo a whole import, and add or remove rules. Examples: recategorize Costco and keep doing it { update: [{ filter: { q: 'costco' }, set: { category: 'groceries' } }], rules: [{ pattern: 'costco', category: 'groceries' }] }; mark one as a transfer { update: [{ ids: [412], set: { transfer: true } }] }; recategorize one and make it a rule { update: [{ ids: [412], set: { category: 'dining' }, make_rule: true }] }; cash spending { add: [{ account: 'Cash', date: '2026-11-14', amount: -20, description: 'Farmers market' }] }; undo an import { undo_import: 3 }. Find ids with the query tool first.",
      input: transactionsInput,
      touches: ['money'],
      run: runTransactionsUpdate,
    }),
    defineTool({
      name: 'money_budget_update',
      description:
        "Set or remove monthly budgets, and manage the category list. A budget is one dollar amount per category that applies to every month; spending against it is the category's total in money_spending for that month. Examples: { budgets: [{ category: 'groceries', monthly_amount: 600 }, { category: 'dining', monthly_amount: 300 }] }; a new category with a budget { categories: [{ name: 'kids_activities', group: 'lifestyle' }], budgets: [{ category: 'kids_activities', monthly_amount: 150 }] }.",
      input: budgetInput,
      touches: ['money'],
      run: runBudgetUpdate,
    }),
  ],
  views: {
    /** ?today=YYYY-MM-DD. Everything the top of the Money page shows. */
    overview: (p, db) => {
      const today = todayOf(p);
      const month = today.slice(0, 7);
      const last = addMonths(month, -1);
      const [from, to] = monthRange(month);
      const [lastFrom, lastTo] = monthRange(last);
      const dayOfMonth = Number(today.slice(8, 10));
      const samePoint = `${last}-${String(Math.min(dayOfMonth, daysInMonth(last))).padStart(2, '0')}`;
      const thisMonth = monthTotals(db, from, to);
      const lastMonth = monthTotals(db, lastFrom, lastTo);
      const lastToDate = monthTotals(db, lastFrom, addDays(samePoint, 1));
      const budgets = budgetReport(db, month, today);
      const budgetOf = new Map(budgets.items.map((b) => [b.category, b.monthly_amount]));
      const accounts = (db.prepare('SELECT * FROM money_accounts WHERE active = 1 ORDER BY is_liability, type, name').all() as AccountRow[]).map(accountOut);
      return {
        today,
        month,
        net_worth: netWorth(db),
        accounts,
        this_month: { month, ...thisMonth, net: r2(thisMonth.income - thisMonth.spent), day_of_month: dayOfMonth, days_in_month: daysInMonth(month) },
        last_month: { month: last, ...lastMonth, net: r2(lastMonth.income - lastMonth.spent), spent_by_same_day: lastToDate.spent },
        top_categories: spendByCategory(db, from, to).filter((c) => c.spent > 0).slice(0, 6).map((c) => ({ ...c, budget: budgetOf.get(c.category) ?? null })),
        budgets: { totals: budgets.totals, counts: budgets.counts, month_elapsed: budgets.month_elapsed, attention: budgets.items.filter((b) => b.status !== 'ok') },
        uncategorized_count: uncategorizedCount(db),
        transaction_count: (db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get() as { n: number }).n,
        last_import: db.prepare('SELECT b.id, b.filename, b.imported_at, b.inserted_count, a.name AS account FROM money_import_batches b JOIN money_accounts a ON a.id = b.account_id WHERE b.undone_at IS NULL ORDER BY b.id DESC LIMIT 1').get() ?? null,
      };
    },

    /** ?include_inactive=1 */
    accounts: (p, db) => {
      const rows = db
        .prepare(`SELECT a.*,
                    (SELECT COUNT(*) FROM money_transactions t WHERE t.account_id = a.id) AS transaction_count,
                    (SELECT MAX(date) FROM money_transactions t WHERE t.account_id = a.id) AS last_transaction_date,
                    (SELECT COUNT(*) FROM money_holdings h WHERE h.account_id = a.id) AS holdings_count,
                    (SELECT SUM(CASE WHEN h.last_price IS NOT NULL THEN h.quantity * h.last_price ELSE COALESCE(h.cost_basis, 0) END) FROM money_holdings h WHERE h.account_id = a.id) AS holdings_value
                  FROM money_accounts a ${p.include_inactive === '1' ? '' : 'WHERE a.active = 1'} ORDER BY a.active DESC, a.is_liability, a.type, a.name`)
        .all() as (AccountRow & { transaction_count: number; last_transaction_date: string | null; holdings_count: number; holdings_value: number | null })[];
      return {
        accounts: rows.map((a) => ({
          ...accountOut(a), transaction_count: a.transaction_count, last_transaction_date: a.last_transaction_date, holdings_count: a.holdings_count,
          holdings_value: a.holdings_count ? r2(a.holdings_value) : null,
        })),
        totals: netWorth(db),
        account_types: ACCOUNT_TYPES,
      };
    },

    /**
     * ?account=<id|name> &category=<name|uncategorized> &month=YYYY-MM | &from= &to= &q= &uncategorized=1
     * &transfers=only|exclude &batch=<id> &sort=date_desc|date_asc|amount_asc|amount_desc &limit=50 &offset=0
     */
    transactions: (p, db) => {
      const filter: TxFilter = {
        account: p.account || undefined,
        category: p.uncategorized === '1' ? 'uncategorized' : p.category || undefined,
        q: p.q || undefined,
        month: isMonth(p.month) ? p.month : undefined,
        date_from: isDay(p.from) ? p.from : undefined,
        date_to: isDay(p.to) ? p.to : undefined,
        batch_id: p.batch && /^\d+$/.test(p.batch) ? Number(p.batch) : undefined,
        transfers: p.transfers === 'only' || p.transfers === 'exclude' ? p.transfers : undefined,
      };
      const w = txWhere(db, filter, (ref) => accountParam(db, String(ref)));
      const limit = int(p.limit, 50, 500);
      const offset = int(p.offset, 0, 10_000_000);
      const order = { date_asc: 't.date, t.id', amount_asc: 't.amount, t.date DESC', amount_desc: 't.amount DESC, t.date DESC' }[p.sort ?? ''] ?? 't.date DESC, t.id DESC';
      const agg = db
        .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(t.amount), 0) AS sum, COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) AS sum_in, COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0) AS sum_out FROM money_transactions t WHERE ${w.where}`)
        .get(...w.params) as { total: number; sum: number; sum_in: number; sum_out: number };
      const rows = db
        .prepare(`SELECT t.id, t.date, t.amount, t.description, t.merchant, t.category, c.label AS category_label, c.category_group, t.categorized_by, t.is_transfer, t.pending, t.notes,
                         t.account_id, a.name AS account, t.import_batch_id
                  FROM money_transactions t JOIN money_accounts a ON a.id = t.account_id LEFT JOIN money_categories c ON c.name = t.category
                  WHERE ${w.where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...w.params, limit, offset) as Record<string, unknown>[];
      return {
        rows: rows.map((r) => ({ ...r, amount: r2(r.amount as number), is_transfer: !!r.is_transfer, pending: !!r.pending })),
        total: agg.total, sum: r2(agg.sum), sum_in: r2(agg.sum_in), sum_out: r2(agg.sum_out), limit, offset,
      };
    },

    /** ?month=YYYY-MM (default: this month) &months=6 &today= */
    spending: (p, db) => {
      const today = todayOf(p);
      const month = isMonth(p.month) ? p.month : today.slice(0, 7);
      const n = Math.max(1, int(p.months, 6, 36));
      const [from, to] = monthRange(month);
      const totals = monthTotals(db, from, to);
      const byCategory = spendByCategory(db, from, to);
      const budgets = new Map((db.prepare('SELECT category, monthly_amount FROM money_budgets').all() as { category: string; monthly_amount: number }[]).map((b) => [b.category, b.monthly_amount]));
      const groups = new Map<string, number>();
      for (const c of byCategory) groups.set(c.group, (groups.get(c.group) ?? 0) + c.spent);
      const months = Array.from({ length: n }, (_, i) => addMonths(month, i - n + 1));
      const seriesFrom = `${months[0]!}-01`;
      const perMonthCategory = db
        .prepare('SELECT month, category, ROUND(SUM(spent), 2) AS spent FROM money_spending WHERE date >= ? AND date < ? GROUP BY month, category')
        .all(seriesFrom, to) as { month: string; category: string; spent: number }[];
      const incomeByMonth = new Map((db.prepare('SELECT month, ROUND(SUM(received), 2) AS income FROM money_income WHERE date >= ? AND date < ? GROUP BY month').all(seriesFrom, to) as { month: string; income: number }[]).map((r) => [r.month, r.income]));
      const spentByMonth = new Map<string, number>();
      const categoryTotals = new Map<string, number>();
      for (const r of perMonthCategory) {
        spentByMonth.set(r.month, (spentByMonth.get(r.month) ?? 0) + r.spent);
        categoryTotals.set(r.category, (categoryTotals.get(r.category) ?? 0) + r.spent);
      }
      const labels = categoryMap(db);
      return {
        month,
        total: totals.spent,
        income: totals.income,
        net: r2(totals.income - totals.spent),
        by_category: byCategory.map((c) => ({ ...c, share: totals.spent > 0 ? r4(c.spent / totals.spent) : 0, budget: budgets.get(c.category) ?? null })),
        by_group: [...groups.entries()].map(([group, spent]) => ({ group, spent: r2(spent) })).sort((a, b) => b.spent - a.spent),
        top_merchants: db.prepare('SELECT merchant, ROUND(SUM(spent), 2) AS spent, COUNT(*) AS count FROM money_spending WHERE date >= ? AND date < ? GROUP BY merchant COLLATE NOCASE ORDER BY spent DESC LIMIT 10').all(from, to),
        months,
        series: months.map((m) => {
          const spent = r2(spentByMonth.get(m));
          const income = r2(incomeByMonth.get(m));
          return { month: m, spent, income, net: r2(income - spent) };
        }),
        category_series: [...categoryTotals.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([category]) => ({
            category,
            label: labels.get(category)?.label ?? 'Uncategorized',
            spent: months.map((m) => r2(perMonthCategory.find((r) => r.month === m && r.category === category)?.spent)),
          })),
      };
    },

    /** ?month=YYYY-MM (default: this month) &today= */
    budgets: (p, db) => {
      const today = todayOf(p);
      return budgetReport(db, isMonth(p.month) ? p.month : today.slice(0, 7), today);
    },

    /** ?today= &months=6 (how far back to look) */
    recurring: (p, db) => recurringReport(db, todayOf(p), Math.max(3, int(p.months, 6, 36))),

    holdings: (_p, db) => {
      const rows = db
        .prepare('SELECT h.*, a.name AS account, a.balance AS account_balance FROM money_holdings h JOIN money_accounts a ON a.id = h.account_id ORDER BY a.name, h.symbol')
        .all() as (HoldingRow & { account: string; account_balance: number | null })[];
      const total = rows.reduce((s, h) => s + holdingValue(h), 0);
      const share = (v: number) => (total > 0 ? r4(v / total) : 0);
      const positions = rows.map((h) => {
        const value = holdingValue(h);
        const gain = h.cost_basis != null && h.last_price != null ? r2(value - h.cost_basis) : null;
        return {
          id: h.id, account_id: h.account_id, account: h.account, symbol: h.symbol, name: h.name, asset_class: h.asset_class, quantity: h.quantity,
          cost_basis: h.cost_basis == null ? null : r2(h.cost_basis), last_price: h.last_price, price_as_of: h.price_as_of,
          /** quantity * last_price; the cost basis stands in when there is no price (priced: false). */
          market_value: value, priced: h.last_price != null, gain, gain_pct: gain != null && h.cost_basis! > 0 ? r4(gain / h.cost_basis!) : null, weight: share(value),
        };
      });
      const sumBy = <K extends string | number>(key: (p: (typeof positions)[number]) => K) => {
        const m = new Map<K, { market_value: number; cost_basis: number; gain: number; positions: number }>();
        for (const pos of positions) {
          const e = m.get(key(pos)) ?? { market_value: 0, cost_basis: 0, gain: 0, positions: 0 };
          e.market_value += pos.market_value;
          e.cost_basis += pos.cost_basis ?? 0;
          e.gain += pos.gain ?? 0;
          e.positions++;
          m.set(key(pos), e);
        }
        return m;
      };
      const cost = positions.reduce((s, x) => s + (x.cost_basis ?? 0), 0);
      const gain = positions.reduce((s, x) => s + (x.gain ?? 0), 0);
      const names = new Map(rows.map((h) => [h.account_id, h]));
      return {
        positions,
        totals: { market_value: r2(total), cost_basis: r2(cost), gain: r2(gain), gain_pct: cost > 0 ? r4(gain / cost) : null },
        by_asset_class: [...sumBy((x) => x.asset_class).entries()]
          .map(([asset_class, e]) => ({ asset_class, market_value: r2(e.market_value), share: share(e.market_value), positions: e.positions }))
          .sort((a, b) => b.market_value - a.market_value),
        by_account: [...sumBy((x) => x.account_id).entries()]
          .map(([account_id, e]) => ({
            account_id, account: names.get(account_id)!.account, market_value: r2(e.market_value), cost_basis: r2(e.cost_basis), gain: r2(e.gain), share: share(e.market_value), positions: e.positions,
            account_balance: names.get(account_id)!.account_balance == null ? null : r2(names.get(account_id)!.account_balance),
          }))
          .sort((a, b) => b.market_value - a.market_value),
        asset_classes: ASSET_CLASSES,
      };
    },

    /** ?months=24 &granularity=month|day &today=. Each point carries every account's latest balance on or before that date. */
    net_worth_history: (p, db) => {
      const today = todayOf(p);
      const from = `${addMonths(today.slice(0, 7), -Math.max(1, int(p.months, 24, 600)))}-01`;
      const rows = db
        .prepare('SELECT h.account_id, h.date, h.balance, a.is_liability FROM money_balance_history h JOIN money_accounts a ON a.id = h.account_id WHERE h.date <= ? ORDER BY h.date, h.account_id')
        .all(today) as { account_id: number; date: string; balance: number; is_liability: number }[];
      const latest = new Map<number, { balance: number; liability: boolean }>();
      const points: { date: string; assets: number; liabilities: number; net_worth: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        latest.set(r.account_id, { balance: r.balance, liability: !!r.is_liability });
        if (rows[i + 1]?.date === r.date) continue;
        let assets = 0;
        let liabilities = 0;
        for (const v of latest.values()) {
          if (v.liability) liabilities += v.balance;
          else assets += v.balance;
        }
        points.push({ date: r.date, assets: r2(assets), liabilities: r2(liabilities), net_worth: r2(assets - liabilities) });
      }
      let out = points.filter((pt) => pt.date >= from);
      if (p.granularity !== 'day') out = out.filter((pt, i) => out[i + 1]?.date.slice(0, 7) !== pt.date.slice(0, 7));
      const first = out[0];
      const lastPoint = out[out.length - 1];
      return {
        granularity: p.granularity === 'day' ? 'day' : 'month',
        points: out,
        change: first && lastPoint && first !== lastPoint ? { from: first.date, to: lastPoint.date, amount: r2(lastPoint.net_worth - first.net_worth) } : null,
        current: netWorth(db),
      };
    },

    categories: (_p, db) => ({
      groups: CATEGORY_GROUPS,
      categories: db
        .prepare(`SELECT c.name, c.label, c.category_group AS "group", b.monthly_amount AS budget,
                    (SELECT COUNT(*) FROM money_transactions t WHERE t.category = c.name) AS transaction_count,
                    (SELECT COUNT(*) FROM money_rules r WHERE r.category = c.name) AS rule_count
                  FROM money_categories c LEFT JOIN money_budgets b ON b.category = c.name
                  ORDER BY CASE c.category_group WHEN 'essentials' THEN 0 WHEN 'lifestyle' THEN 1 WHEN 'income' THEN 2 ELSE 3 END, c.label`)
        .all(),
      rules: db.prepare('SELECT r.id, r.pattern, r.match_type, r.category, c.label AS category_label, r.merchant, r.priority, r.created_at FROM money_rules r LEFT JOIN money_categories c ON c.name = r.category ORDER BY r.category, r.pattern').all(),
      uncategorized_count: uncategorizedCount(db),
    }),

    /** ?limit=20 */
    imports: (p, db) => ({
      batches: db
        .prepare(`SELECT b.id, b.account_id, a.name AS account, b.attachment_id, b.filename, b.imported_at, b.row_count, b.inserted_count, b.duplicate_count, b.skipped_count, b.date_from, b.date_to, b.undone_at,
                    (SELECT COUNT(*) FROM money_transactions t WHERE t.import_batch_id = b.id) AS remaining_count
                  FROM money_import_batches b JOIN money_accounts a ON a.id = b.account_id ORDER BY b.id DESC LIMIT ?`)
        .all(int(p.limit, 20, 200)),
    }),

    /** ?today=. Budgets that are over or close, and a backlog of uncategorized transactions. */
    home: (p, db) => {
      const today = todayOf(p);
      const cards: { title: string; lines: string[]; link: string }[] = [];
      const b = budgetReport(db, today.slice(0, 7), today);
      const rank = { over: 0, near: 1, fast: 2, ok: 3 } as const;
      const lines = b.items
        .filter((i) => i.status !== 'ok')
        .sort((x, y) => rank[x.status] - rank[y.status] || y.used - x.used)
        .slice(0, 5)
        .map((i) =>
          i.status === 'over' ? `${i.label}: ${usd(i.spent)} of ${usd(i.monthly_amount)}, over by ${usd(-i.remaining)}`
          : i.status === 'near' ? `${i.label}: ${usd(i.spent)} of ${usd(i.monthly_amount)}, ${usd(i.remaining)} left`
          : `${i.label}: ${usd(i.spent)} of ${usd(i.monthly_amount)} with ${Math.round(b.month_elapsed * 100)}% of the month gone`,
        );
      if (lines.length) cards.push({ title: 'Budgets', lines, link: '/money' });
      const uncategorized = uncategorizedCount(db);
      if (uncategorized >= 10) cards.push({ title: 'Money', lines: [`${uncategorized} transactions need a category`], link: '/money' });
      return { cards };
    },
  },
});
