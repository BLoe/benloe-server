// Bank CSV reading: RFC-4180 parsing, finding the header row, mapping columns
// by header name, and turning each row into { date, amount, description }.
// Pure functions, no database. Every bank's export is different; the cases
// handled here are listed next to the code that handles them and exercised in
// test/money.test.ts.

export class CsvError extends Error {}

// ---- RFC 4180 ------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 12; i++) {
    const ch = text[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '\n') lines++;
    else if (!inQuotes && ch in counts) counts[ch]!++;
  }
  let best = ',';
  for (const d of Object.keys(counts)) if (counts[d]! > counts[best]!) best = d;
  return best;
}

/** Records and fields per RFC 4180: quoted fields, "" escapes, embedded delimiters and newlines, BOM, CRLF or LF. Cells are trimmed. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
    } else if (ch === delim) endCell();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') endRow();
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

// ---- cells -----------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2200 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A bank's date as YYYY-MM-DD, or null. Reads YYYY-MM-DD (with or without a
 * time), MM/DD/YYYY, M/D/YY, MM-DD-YYYY, YYYYMMDD, "Jan 5, 2026" and
 * "5 Jan 2026". Slash dates are month-first unless the first number cannot be
 * a month.
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s))) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 12 && b <= 12 ? ymd(Number(m[3]), b, a) : ymd(Number(m[3]), a, b);
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s))) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return mo < 0 ? null : ymd(Number(m[3]), mo + 1, Number(m[2]));
  }
  if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{4}|\d{2})/.exec(s))) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return mo < 0 ? null : ymd(Number(m[3]), mo + 1, Number(m[1]));
  }
  return null;
}

export interface Amount {
  /** Signed as written: "(45.00)", "-45.00" and "45.00-" are negative. A CR/DR suffix does not change it. */
  value: number;
  /** A trailing "CR" or "DR", which outranks the written sign (see readRows). */
  mark: 'CR' | 'DR' | null;
}

/** Reads "$1,234.56", "(45.00)", "-45.00", "45.00-", "+45.00", "45.00 CR", "USD 45". Null when the cell is not an amount. */
export function parseAmountCell(raw: string): Amount | null {
  let t = raw.trim();
  if (!t) return null;
  let negative = false;
  let mark: Amount['mark'] = null;
  const suffix = /\s*(CR|DR)\.?$/i.exec(t);
  if (suffix) {
    mark = suffix[1]!.toUpperCase() as 'CR' | 'DR';
    t = t.slice(0, suffix.index);
  }
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/USD|[$,\s]/gi, '');
  if (t.endsWith('-')) {
    negative = !negative;
    t = t.slice(0, -1);
  }
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? { value: negative ? -n : n, mark } : null;
}

/** The signed number in an amount cell; "45.00 CR" is +45 and "45.00 DR" is -45. */
export function parseAmount(raw: string): number | null {
  const a = parseAmountCell(raw);
  if (!a) return null;
  return a.mark === 'CR' ? Math.abs(a.value) : a.mark === 'DR' ? -Math.abs(a.value) : a.value;
}

// ---- header detection and column mapping ----------------------------------------------

export const MAPPING_FIELDS = ['date', 'description', 'amount', 'debit', 'credit', 'category', 'type', 'balance', 'status'] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];
/** Field -> the header text of the column that supplies it ("col3" style names when the file has no header row). */
export type ColumnMapping = Partial<Record<MappingField, string>>;

// Normalised header names (lowercase, letters and digits only), most preferred first.
// "Amount ($)" -> amount, "Withdrawal (-)" -> withdrawal, "Trans. Date" -> transdate.
const HEADER_NAMES: Record<MappingField, string[]> = {
  date: ['transactiondate', 'transdate', 'date', 'tradedate', 'rundate', 'postingdate', 'posteddate', 'postdate', 'effectivedate', 'settlementdate', 'datetime'],
  description: ['description', 'originaldescription', 'transactiondescription', 'payee', 'merchant', 'merchantname', 'name', 'action', 'memo', 'details', 'narrative'],
  amount: ['amount', 'transactionamount', 'amountusd', 'amt', 'value'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'debitamount', 'withdrawalamount', 'withdrawalamt', 'moneyout', 'paidout', 'amountdebit'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'creditamount', 'depositamount', 'depositamt', 'moneyin', 'paidin', 'amountcredit'],
  category: ['category', 'bankcategory', 'transactioncategory'],
  type: ['type', 'transactiontype', 'details', 'creditdebit', 'debitcredit'],
  balance: ['balance', 'runningbalance', 'runningbal', 'runbalance', 'runningbalanceusd', 'accountbalance', 'balanceusd', 'endingbalance'],
  status: ['status'],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface Layout {
  /** Index into the parsed records of the header row; -1 when the file has none. */
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  /** Field -> column index. */
  columns: Partial<Record<MappingField, number>>;
}

function mapByName(headers: string[]): Partial<Record<MappingField, number>> {
  const normed = headers.map(norm);
  const out: Partial<Record<MappingField, number>> = {};
  const used = new Set<number>();
  for (const field of MAPPING_FIELDS) {
    for (const name of HEADER_NAMES[field]) {
      const i = normed.findIndex((h, idx) => h === name && !used.has(idx));
      if (i >= 0) {
        out[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

const usable = (c: Partial<Record<MappingField, number>>) => c.date != null && (c.amount != null || c.debit != null || c.credit != null);

function layoutOf(headerRow: number, headers: string[], columns: Partial<Record<MappingField, number>>): Layout {
  const mapping: ColumnMapping = {};
  for (const f of MAPPING_FIELDS) if (columns[f] != null) mapping[f] = headers[columns[f]!]!;
  return { headerRow, headers, mapping, columns };
}

/**
 * Finds the header row and decides which column is which.
 *
 * - Banks put account summaries above the header (Bank of America, Schwab),
 *   so the header is the first of the leading 40 records that names a date
 *   column and an amount (or debit/credit) column.
 * - A file with no header at all (Wells Fargo) is mapped by content: the
 *   first column holding a date, the first holding a number, the wordiest
 *   remaining column as the description. Its columns are named col1, col2, ...
 * - `override` replaces individual choices by header name, case-insensitively.
 */
export function detectLayout(rows: string[][], override: ColumnMapping = {}): Layout {
  const wanted = Object.entries(override).filter(([, v]) => v != null && v !== '') as [MappingField, string][];
  const scan = rows.slice(0, 40);

  let headerRow = -1;
  let columns: Partial<Record<MappingField, number>> = {};
  for (let i = 0; i < scan.length; i++) {
    const c = mapByName(scan[i]!);
    if (usable(c)) {
      headerRow = i;
      columns = c;
      break;
    }
  }
  // No row is recognisable by name alone: accept the first row that contains every header the override names.
  if (headerRow < 0 && wanted.length) {
    const names = wanted.map(([, v]) => norm(v));
    headerRow = scan.findIndex((r) => {
      const normed = r.map(norm);
      return names.every((n) => normed.includes(n));
    });
    if (headerRow >= 0) columns = mapByName(scan[headerRow]!);
  }

  let headers: string[];
  if (headerRow >= 0) {
    headers = scan[headerRow]!;
  } else {
    // Headerless: the first record with a date cell and a separate numeric cell is data.
    const first = scan.find((r) => r.some((c) => parseDate(c)) && r.some((c) => !parseDate(c) && parseAmountCell(c)));
    if (!first) {
      throw new CsvError(
        `Could not find a header row with a date column and an amount column. The file starts: ${scan.slice(0, 3).map((r) => r.join(' | ').slice(0, 160)).join(' // ')}. Pass mapping with the header names to use.`,
      );
    }
    // A row of plain words directly above the data is a header in words this file does not share with any known export.
    const above = scan[scan.indexOf(first) - 1];
    if (above && above.filter(Boolean).length >= 2 && above.every((c) => !parseDate(c) && !parseAmountCell(c))) {
      throw new CsvError(`The header row does not name a date column and an amount column in words I recognise. The columns are: ${above.filter(Boolean).join(', ')}. Pass mapping with the header names to use, e.g. { date: '...', description: '...', amount: '...' }.`);
    }
    headers = first.map((_, i) => `col${i + 1}`);
    const date = first.findIndex((c) => parseDate(c));
    const amount = first.findIndex((c, i) => i !== date && !parseDate(c) && parseAmountCell(c));
    let description = -1;
    let letters = 0;
    first.forEach((c, i) => {
      const n = c.replace(/[^A-Za-z]/g, '').length;
      if (i !== date && i !== amount && n > letters) {
        letters = n;
        description = i;
      }
    });
    columns = { date, amount, ...(description >= 0 ? { description } : {}) };
  }

  const normed = headers.map(norm);
  for (const [field, name] of wanted) {
    if (!MAPPING_FIELDS.includes(field)) continue;
    const i = normed.indexOf(norm(name));
    if (i < 0) throw new CsvError(`mapping.${field}: there is no column named "${name}". The columns are: ${headers.filter(Boolean).join(', ')}.`);
    for (const f of MAPPING_FIELDS) if (f !== field && columns[f] === i) delete columns[f];
    columns[field] = i;
  }
  // One signed column and split columns are alternatives; an explicit choice of one drops the other.
  if (override.amount && !override.debit && !override.credit) {
    delete columns.debit;
    delete columns.credit;
  } else if ((override.debit || override.credit) && !override.amount) delete columns.amount;
  else if (columns.amount != null && (columns.debit != null || columns.credit != null) && !override.amount) {
    // Both present by detection (rare): split columns are unambiguous about direction.
    delete columns.amount;
  }

  if (columns.date == null) throw new CsvError(`No date column found. The columns are: ${headers.filter(Boolean).join(', ')}. Pass mapping.date.`);
  if (columns.amount == null && columns.debit == null && columns.credit == null) {
    throw new CsvError(`No amount column found. The columns are: ${headers.filter(Boolean).join(', ')}. Pass mapping.amount, or mapping.debit and mapping.credit.`);
  }
  if (columns.description == null) throw new CsvError(`No description column found. The columns are: ${headers.filter(Boolean).join(', ')}. Pass mapping.description.`);
  return layoutOf(headerRow, headers, columns);
}

// ---- rows ------------------------------------------------------------------------

export interface ParsedRow {
  /** 1-based record number in the file. */
  row: number;
  date: string;
  /** Signed dollars in Kevin's convention: negative = money out. */
  amount: number;
  description: string;
  bankCategory: string | null;
  bankType: string | null;
  balance: number | null;
  pending: boolean;
}

export interface SkippedRow {
  row: number;
  reason: string;
}

export type AmountSign = 'as_is' | 'invert';

export interface ReadResult {
  rows: ParsedRow[];
  skipped: SkippedRow[];
  /** How the direction of each amount was decided. */
  signSource: 'debit_credit_columns' | 'cr_dr_suffix' | 'type_column' | 'amount_column';
  /** Whether the amounts were flipped after reading. */
  inverted: boolean;
  /** Rows whose raw amount was above zero / below zero before any flip (single amount column only). */
  rawPositive: number;
  rawNegative: number;
}

const DEBIT_TYPE = /^(debit|dr|withdrawal|withdraw)$/i;
const CREDIT_TYPE = /^(credit|cr|deposit)$/i;
const cents = (n: number) => Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;

/**
 * Turns the records under the header into transactions.
 *
 * Direction of money, in order of what the file itself says:
 * 1. Separate debit and credit (withdrawal/deposit) columns: debit is money out.
 * 2. "CR"/"DR" suffixes on the amounts: CR is money in, DR is money out, and
 *    an unmarked amount is money out unless the file also uses minus signs.
 * 3. A type column that says DEBIT or CREDIT beside amounts that are all unsigned.
 * 4. Otherwise the sign in the single amount column, as written.
 * `sign: 'invert'` then flips every amount; `autoInvert` (used for credit
 * cards and loans) flips a single signed column when most rows are positive,
 * which is how Amex, Discover and Citi list purchases.
 */
export function readRows(rows: string[][], layout: Layout, opts: { sign?: AmountSign; autoInvert?: boolean } = {}): ReadResult {
  const c = layout.columns;
  const cell = (r: string[], i: number | undefined) => (i == null ? '' : (r[i] ?? ''));
  const split = c.debit != null || c.credit != null;
  const out: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  const raw: { row: number; date: string; amount: Amount; r: string[] }[] = [];

  for (let i = layout.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.every((x) => x === '')) continue;
    const rowNo = i + 1;
    const date = parseDate(cell(r, c.date));
    if (!date) {
      skipped.push({ row: rowNo, reason: cell(r, c.date) ? `"${cell(r, c.date).slice(0, 40)}" is not a date` : 'no date' });
      continue;
    }
    let amount: Amount | null;
    if (split) {
      const debit = parseAmountCell(cell(r, c.debit));
      const credit = parseAmountCell(cell(r, c.credit));
      const d = debit ? Math.abs(debit.value) : 0;
      const cr = credit ? Math.abs(credit.value) : 0;
      if (!debit && !credit) {
        const text = cell(r, c.debit) || cell(r, c.credit);
        skipped.push({ row: rowNo, reason: text ? `"${text.slice(0, 40)}" is not an amount` : 'no amount' });
        continue;
      }
      amount = { value: cr - d, mark: null };
    } else {
      amount = parseAmountCell(cell(r, c.amount));
      if (!amount) {
        const text = cell(r, c.amount);
        skipped.push({ row: rowNo, reason: text ? `"${text.slice(0, 40)}" is not an amount` : 'no amount' });
        continue;
      }
    }
    if (amount.value === 0) {
      skipped.push({ row: rowNo, reason: 'zero amount' });
      continue;
    }
    raw.push({ row: rowNo, date, amount, r });
  }

  let signSource: ReadResult['signSource'] = split ? 'debit_credit_columns' : 'amount_column';
  if (!split) {
    const types = raw.map((x) => cell(x.r, c.type));
    if (raw.some((x) => x.amount.mark)) signSource = 'cr_dr_suffix';
    else if (c.type != null && raw.every((x) => x.amount.value > 0) && types.some((t) => DEBIT_TYPE.test(t)) && types.some((t) => CREDIT_TYPE.test(t))) signSource = 'type_column';
  }
  // In a file that marks credits with "CR", an unmarked amount is money out, unless the file also writes minus signs.
  const signedFile = raw.some((x) => !x.amount.mark && x.amount.value < 0);
  const rawPositive = split ? 0 : raw.filter((x) => x.amount.value > 0).length;
  const rawNegative = split ? 0 : raw.filter((x) => x.amount.value < 0).length;
  const inverted = opts.sign === 'invert' || (opts.sign == null && !!opts.autoInvert && signSource === 'amount_column' && rawPositive > rawNegative);

  for (const x of raw) {
    let v = x.amount.value;
    if (signSource === 'cr_dr_suffix') v = x.amount.mark === 'CR' ? Math.abs(v) : x.amount.mark === 'DR' || !signedFile ? -Math.abs(v) : v;
    else if (signSource === 'type_column') v = DEBIT_TYPE.test(cell(x.r, c.type)) ? -Math.abs(v) : Math.abs(v);
    if (inverted) v = -v;
    const balance = c.balance != null ? parseAmount(cell(x.r, c.balance)) : null;
    out.push({
      row: x.row,
      date: x.date,
      amount: cents(v),
      description: cell(x.r, c.description).replace(/\s+/g, ' ').trim() || '(no description)',
      bankCategory: cell(x.r, c.category) || null,
      bankType: cell(x.r, c.type) || null,
      balance: balance == null ? null : cents(balance),
      pending: /pending/i.test(cell(x.r, c.status)),
    });
  }
  return { rows: out, skipped, signSource, inverted, rawPositive, rawNegative };
}

/**
 * The balance after the newest transaction, when the file has a running
 * balance column. Files list newest-first or oldest-first; within the newest
 * day the row nearest that end of the file is the latest.
 */
export function endingBalance(rows: ParsedRow[]): { balance: number; date: string } | null {
  const withBalance = rows.filter((r) => r.balance != null);
  if (!withBalance.length) return null;
  const first = withBalance[0]!;
  // A file covering a single day says nothing about its order; newest-first is what most banks export.
  const newestFirst = rows[0]!.date >= rows[rows.length - 1]!.date;
  const maxDate = withBalance.reduce((m, r) => (r.date > m ? r.date : m), first.date);
  const sameDay = withBalance.filter((r) => r.date === maxDate);
  const pick = newestFirst ? sameDay[0]! : sameDay[sameDay.length - 1]!;
  return { balance: pick.balance!, date: pick.date };
}

/**
 * For a credit card, loan or mortgage: the amount owed, from the file's ending balance, with its sign.
 * Banks write a liability's running balance either as the amount owed (a purchase raises it) or as
 * the account's value (a purchase lowers it, so a debt is negative). The file says which: between two
 * consecutive rows the balance moves by the later row's amount, one way or the other. A card in credit
 * (overpaid) is then a negative amount owed, not a debt.
 * `convention` is 'unknown' when no pair of rows shows it; the owed amount is then the balance's size,
 * which is right for a card that is not in credit, and the caller says it was assumed.
 */
export function liabilityOwed(rows: ParsedRow[], balance: number): { owed: number; convention: 'owed' | 'value' | 'unknown' } {
  const withBalance = rows.filter((r) => r.balance != null);
  // Oldest first: files list either way, and a single day says nothing about order (newest-first is usual).
  const newestFirst = withBalance.length < 2 || withBalance[0]!.date >= withBalance[withBalance.length - 1]!.date;
  const ordered = newestFirst ? [...withBalance].reverse() : withBalance;
  let owedVotes = 0;
  let valueVotes = 0;
  for (let i = 1; i < ordered.length; i++) {
    const delta = Math.round((ordered[i]!.balance! - ordered[i - 1]!.balance!) * 100);
    const amount = Math.round(ordered[i]!.amount * 100);
    if (amount === 0) continue;
    if (delta === -amount) owedVotes++;
    else if (delta === amount) valueVotes++;
  }
  if (owedVotes > valueVotes) return { owed: balance, convention: 'owed' };
  if (valueVotes > owedVotes) return { owed: -balance, convention: 'value' };
  return { owed: Math.abs(balance), convention: 'unknown' };
}
