import { describe, expect, it } from 'vitest';
import { extract, saveUpload } from '../src/attachments.js';
import type { Kevin } from '../src/kevin.js';
import { schemaText } from '../src/prompt.js';
import money from '../src/domains/money.js';
import { bankCategory, cleanMerchant } from '../src/domains/_money/categorize.js';
import { detectLayout, parseAmount, parseCsv, parseDate, readRows } from '../src/domains/_money/csv.js';
import { detectRecurring } from '../src/domains/_money/recurring.js';
import { call, makeKevin, ok, view } from './helpers.js';

// ---- fixtures: one per export dialect ------------------------------------------------

/** Chase checking: one signed Amount column, newest first, running balance, trailing commas. */
const CHASE = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,10/30/2026,"COSTCO WHSE #0110 SEATTLE WA",-212.40,DEBIT_CARD,5611.50,,
DEBIT,10/28/2026,"Online Transfer to SAV ...7781 transaction#: 1234567",-1000.00,ACCT_XFER,5823.90,,
DEBIT,10/21/2026,"CHASE CREDIT CRD EPAY PPD ID: 4760039224",-500.00,ACH_DEBIT,6823.90,,
DEBIT,10/15/2026,"NETFLIX.COM 866-579-7172 CA",-15.49,DEBIT_CARD,7323.90,,
CREDIT,10/15/2026,"ACME CORP PAYROLL PPD ID: 9111111111",3200.00,ACH_CREDIT,7339.39,,
DEBIT,10/09/2026,"SQ *BLUE BOTTLE COFFEE Oakland CA",-4.50,DEBIT_CARD,4139.39,,
DEBIT,10/09/2026,"SQ *BLUE BOTTLE COFFEE Oakland CA",-4.50,DEBIT_CARD,4143.89,,
DEBIT,10/05/2026,"TRADER JOE S #123 SEATTLE WA",-84.12,DEBIT_CARD,4148.39,,
DEBIT,10/02/2026,"CHIPOTLE 0456 SEATTLE WA",-31.60,DEBIT_CARD,4232.51,,
`;
const CHASE_OUT = -(212.4 + 1000 + 500 + 15.49 + 4.5 + 4.5 + 84.12 + 31.6);
const CHASE_SPENT = 212.4 + 15.49 + 9 + 84.12 + 31.6; // transfers and the card payment excluded

/** Capital One card: separate Debit and Credit columns, ISO dates, the bank's own categories. */
const CAPITAL_ONE = `Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2026-10-03,2026-10-04,1234,CHIPOTLE 0456,Dining,12.85,
2026-10-05,2026-10-06,1234,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,250.00
2026-10-09,2026-10-10,1234,SHELL OIL 57444,Gas/Automotive,48.10,
2026-10-12,2026-10-13,1234,LOCAL HARDWARE CO,Merchandise,31.00,
`;

/** Amex: purchases are positive, payments negative, M/D/YY dates. */
const AMEX = `Date,Description,Amount
10/2/26,UBER EATS,23.40
10/4/26,DELTA AIR LINES ATLANTA,412.20
10/15/26,AUTOPAY PAYMENT - THANK YOU,-600.00
10/20/26,WHOLEFDS MKT #10230,96.31
10/22/26,AMAZON.COM*RT4Y12 AMZN.COM/BILL WA,54.99
`;

/** Bank of America: BOM, CRLF, a summary block above the header, quoted fields with commas, quotes and a line break, oldest first. */
const BOFA =
  '﻿' +
  [
    'Description,,Summary Amt.',
    'Beginning balance as of 10/01/2026,,"5,000.00"',
    'Total credits,,"3,200.00"',
    '',
    'Date,Description,Amount,Running Bal.',
    '10/01/2026,"Beginning balance as of 10/01/2026",,"5,000.00"',
    '10/02/2026,"CHECKCARD 1001 SAFEWAY #1444, SEATTLE WA","-56.20","4,943.80"',
    '10/03/2026,"Zelle payment to ""Sam"", for\nrent share","($1,250.00)","3,693.80"',
    '10/15/2026,"ACME CORP DIRECT DEP","$3,200.00","6,893.80"',
    '10/16/2026,"Interest Paid","0.42 CR","6,894.22"',
    'Total,,,',
  ].join('\r\n') +
  '\r\n';

/** Wells Fargo: no header row at all. */
const WELLS = `"10/05/2026","-45.00","*","","PURCHASE AUTHORIZED ON 10/04 SAFEWAY STORE 1444 SEATTLE WA S123456 CARD 9999"
"10/06/2026","1500.00","*","","ACME CORP PAYROLL"
`;

async function upload(kevin: Kevin, text: string, filename: string): Promise<number> {
  const a = saveUpload(kevin.db, Buffer.from(text), filename);
  await extract(kevin.db, a.id);
  return a.id;
}

/** A Kevin with the Chase file committed into "Chase checking". */
async function withChase(): Promise<{ kevin: Kevin; attachment: number; batch: number }> {
  const kevin = await makeKevin([money]);
  const attachment = await upload(kevin, CHASE, 'chase.csv');
  const r = await ok(kevin, 'money_import', { attachment_id: attachment, account: 'Chase checking', create_account: { type: 'checking', institution: 'Chase' }, commit: true });
  return { kevin, attachment, batch: r.batch_id };
}

const rows = async (kevin: Kevin, sql: string) => (await ok(kevin, 'query', { sql })).rows as Record<string, any>[];

// ---- pure helpers ----------------------------------------------------------------

describe('csv parsing', () => {
  it('follows RFC 4180: quotes, embedded commas and newlines, escaped quotes, BOM, CRLF', () => {
    expect(parseCsv('﻿a,b,c\r\n1,"x, y","he said ""hi""\nthere"\r\n2,,\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'he said "hi"\nthere'],
      ['2', '', ''],
    ]);
    expect(parseCsv('a;b\n1;"2;3"')).toEqual([['a', 'b'], ['1', '2;3']]);
    expect(parseCsv('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('reads the amount formats banks use', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('(45.00)')).toBe(-45);
    expect(parseAmount('-45.00')).toBe(-45);
    expect(parseAmount('45.00-')).toBe(-45);
    expect(parseAmount('+45')).toBe(45);
    expect(parseAmount('45.00 CR')).toBe(45);
    expect(parseAmount('45.00 DR')).toBe(-45);
    expect(parseAmount('($1,250.00)')).toBe(-1250);
    expect(parseAmount('-$0.99')).toBe(-0.99);
    expect(parseAmount('.5')).toBe(0.5);
    for (const bad of ['', 'abc', '12.3.4', '--', '10/02/2026']) expect(parseAmount(bad), bad).toBeNull();
  });
  it('reads the date formats banks use and rejects impossible dates', () => {
    expect(parseDate('10/05/2026')).toBe('2026-10-05');
    expect(parseDate('1/5/26')).toBe('2026-01-05');
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('2026-10-05T14:22:00Z')).toBe('2026-10-05');
    expect(parseDate('10-05-2026')).toBe('2026-10-05');
    expect(parseDate('20261005')).toBe('2026-10-05');
    expect(parseDate('Oct 5, 2026')).toBe('2026-10-05');
    expect(parseDate('5 Oct 2026')).toBe('2026-10-05');
    expect(parseDate('25/12/2026')).toBe('2026-12-25'); // cannot be month-first
    for (const bad of ['02/30/2026', '13/13/2026', 'Total', '', '45.00']) expect(parseDate(bad), bad).toBeNull();
  });
  it('maps the columns of common exports by header name', () => {
    const m = (header: string) => detectLayout(parseCsv(header + '\n')).mapping;
    expect(m('Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #')).toEqual({ date: 'Posting Date', description: 'Description', amount: 'Amount', type: 'Type', balance: 'Balance' });
    expect(m('Transaction Date,Post Date,Description,Category,Type,Amount,Memo')).toMatchObject({ date: 'Transaction Date', amount: 'Amount', category: 'Category' });
    expect(m('Posted Date,Reference Number,Payee,Address,Amount')).toEqual({ date: 'Posted Date', description: 'Payee', amount: 'Amount' });
    expect(m('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit')).toEqual({ date: 'Transaction Date', description: 'Description', debit: 'Debit', credit: 'Credit', category: 'Category' });
    expect(m('Trans. Date,Post Date,Description,Amount,Category')).toMatchObject({ date: 'Trans. Date', description: 'Description', amount: 'Amount' });
    expect(m('Status,Date,Description,Debit,Credit')).toEqual({ date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit', status: 'Status' });
    expect(m('"Date","Type","Check #","Description","Withdrawal (-)","Deposit (+)","RunBalance"')).toEqual({ date: 'Date', description: 'Description', debit: 'Withdrawal (-)', credit: 'Deposit (+)', type: 'Type', balance: 'RunBalance' });
    expect(m('Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Amount ($),Settlement Date')).toMatchObject({ date: 'Run Date', description: 'Description', amount: 'Amount ($)' });
    expect(() => detectLayout(parseCsv('foo,bar\nbaz,qux\n'))).toThrow(/header row/);
  });
  it('signs unsigned amounts from a DEBIT/CREDIT type column and from CR suffixes', () => {
    const typed = parseCsv('Date,Description,Amount,Type\n10/01/2026,Rent,1500.00,Debit\n10/02/2026,Pay,3000.00,Credit\n');
    const a = readRows(typed, detectLayout(typed));
    expect(a.signSource).toBe('type_column');
    expect(a.rows.map((r) => r.amount)).toEqual([-1500, 3000]);
    const suffixed = parseCsv('Date,Description,Amount\n10/01/2026,Shoes,80.00\n10/02/2026,Refund,80.00 CR\n');
    const b = readRows(suffixed, detectLayout(suffixed), { autoInvert: true });
    expect(b.signSource).toBe('cr_dr_suffix');
    expect(b.rows.map((r) => r.amount)).toEqual([-80, 80]);
    expect(b.inverted).toBe(false);
  });
});

describe('merchant clean-up and bank categories', () => {
  it('strips processor prefixes, store numbers, codes and state suffixes', () => {
    expect(cleanMerchant('SQ *BLUE BOTTLE COFFEE #114 OAKLAND CA')).toBe('Blue Bottle Coffee Oakland');
    expect(cleanMerchant('COSTCO WHSE #0110 SEATTLE WA')).toBe('Costco Whse Seattle');
    expect(cleanMerchant('COSTCO WHSE #0456 SEATTLE WA')).toBe('Costco Whse Seattle');
    expect(cleanMerchant('AMAZON.COM*RT4Y12 AMZN.COM/BILL WA')).toBe('Amazon');
    expect(cleanMerchant('PURCHASE AUTHORIZED ON 10/04 SAFEWAY STORE 1444 SEATTLE WA S123456 CARD 9999')).toBe('Safeway Store Seattle');
    expect(cleanMerchant('NETFLIX.COM 866-579-7172 CA')).toBe('Netflix.com');
    expect(cleanMerchant('CVS PHARMACY')).toBe('CVS Pharmacy');
    expect(cleanMerchant('ACME CORP PAYROLL PPD ID: 9111111111')).toBe('Acme Corp Payroll');
    expect(cleanMerchant('Farmers market')).toBe('Farmers market');
    expect(cleanMerchant('12345')).toBe('12345');
  });
  it("maps the bank's category text", () => {
    expect(bankCategory('Food & Drink', { liability: true, amount: -10 })).toBe('dining');
    expect(bankCategory('Gas/Automotive', { liability: true, amount: -10 })).toBe('gas');
    expect(bankCategory('Payment/Credit', { liability: true, amount: 250 })).toBe('credit_card_payment');
    expect(bankCategory('Payment/Credit', { liability: false, amount: 250 })).toBeNull();
    expect(bankCategory('Something new', { liability: false, amount: -1 })).toBeNull();
    expect(bankCategory(null, { liability: false, amount: -1 })).toBeNull();
  });
});

// ---- import ----------------------------------------------------------------------

describe('money_import', () => {
  it('previews a signed-amount export without saving, then commits it', async () => {
    const kevin = await makeKevin([money]);
    const id = await upload(kevin, CHASE, 'chase.csv');
    const args = { attachment_id: id, account: 'Chase checking', create_account: { type: 'checking', institution: 'Chase' } };

    const preview = await ok(kevin, 'money_import', { ...args, commit: false });
    expect(preview).toMatchObject({
      committed: false,
      account: { id: null, name: 'Chase checking', type: 'checking', will_create: true },
      file: { filename: 'chase.csv', header_row: 1 },
      mapping: { date: 'Posting Date', description: 'Description', amount: 'Amount', type: 'Type', balance: 'Balance' },
      amount_sign: { applied: 'as_is', decided_by: 'amount_column' },
      parsed_count: 9, new_count: 9, duplicate_count: 0, skipped_count: 0,
      date_from: '2026-10-02', date_to: '2026-10-30',
      total_in: 3200, total_out: Math.round(CHASE_OUT * 100) / 100,
      uncategorized_count: 3, transfer_count: 2,
      ending_balance: { balance: 5611.5, date: '2026-10-30' },
    });
    expect(preview.sample).toHaveLength(9);
    expect(preview.sample[0]).toEqual({ row: 2, date: '2026-10-30', amount: -212.4, description: 'COSTCO WHSE #0110 SEATTLE WA', merchant: 'Costco Whse Seattle', category: null, is_transfer: false, pending: false, duplicate: false });
    expect(preview.sample[3]).toMatchObject({ merchant: 'Netflix', category: 'subscriptions' });
    expect(preview.sample[7]).toMatchObject({ merchant: "Trader Joe's", category: 'groceries', amount: -84.12 });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_accounts').get()).toEqual({ n: 0 });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 0 });

    const done = await ok(kevin, 'money_import', { ...args, commit: true });
    expect(done).toMatchObject({
      committed: true, batch_id: 1, inserted: 9, duplicate_count: 0, account: { name: 'Chase checking', created: true },
      balance_updated: { balance: 5611.5, as_of: '2026-10-30', is_current: true },
    });
    expect(done.top_uncategorized).toEqual([
      { merchant: 'BLUE BOTTLE COFFEE Oakland CA', count: 2, total: -9 },
      { merchant: 'Costco Whse Seattle', count: 1, total: -212.4 },
    ]);
    const saved = await rows(kevin, 'SELECT date, amount, merchant, category, categorized_by, is_transfer, import_batch_id FROM money_transactions ORDER BY date, id');
    expect(saved).toHaveLength(9);
    expect(saved.find((r) => r.merchant.startsWith('Acme'))).toMatchObject({ amount: 3200, category: 'income', categorized_by: 'rule', is_transfer: 0, import_batch_id: 1 });
    expect(saved.filter((r) => r.is_transfer).map((r) => r.category).sort()).toEqual(['credit_card_payment', 'transfer']);
    expect(await rows(kevin, 'SELECT name, institution, type, is_liability, balance, balance_as_of FROM money_accounts')).toEqual([
      { name: 'Chase checking', institution: 'Chase', type: 'checking', is_liability: 0, balance: 5611.5, balance_as_of: '2026-10-30' },
    ]);
    expect((await view(kevin, 'money/imports')).batches).toMatchObject([
      { id: 1, account: 'Chase checking', filename: 'chase.csv', row_count: 9, inserted_count: 9, duplicate_count: 0, skipped_count: 0, date_from: '2026-10-02', date_to: '2026-10-30', undone_at: null, remaining_count: 9 },
    ]);
  });

  it('adds nothing when the same file is imported again, and keeps both identical same-day charges', async () => {
    const { kevin, attachment } = await withChase();
    const coffees = await rows(kevin, "SELECT id, amount FROM money_transactions WHERE description LIKE '%BLUE BOTTLE%'");
    expect(coffees).toHaveLength(2);

    const preview = await ok(kevin, 'money_import', { attachment_id: attachment, account: 'Chase checking', commit: false });
    expect(preview).toMatchObject({ new_count: 0, duplicate_count: 9, total_in: 0, total_out: 0, account: { will_create: false } });
    expect(preview.sample.every((r: any) => r.duplicate)).toBe(true);
    const again = await ok(kevin, 'money_import', { attachment_id: attachment, account: 'chase', commit: true });
    expect(again).toMatchObject({ committed: true, inserted: 0, batch_id: null });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 9 });
    expect((await view(kevin, 'money/imports')).batches).toHaveLength(1);

    // A later, overlapping statement: only the row that is new is added, and a third coffee on the same day counts as new.
    const overlap = await upload(kevin, CHASE.replace('Check or Slip #\n', 'Check or Slip #\nDEBIT,11/02/2026,"CHIPOTLE 0456 SEATTLE WA",-11.00,DEBIT_CARD,5600.50,,\nDEBIT,10/09/2026,"SQ *BLUE BOTTLE COFFEE Oakland CA",-4.50,DEBIT_CARD,4134.89,,\n'), 'chase-nov.csv');
    const r = await ok(kevin, 'money_import', { attachment_id: overlap, account: 'Chase checking', commit: true });
    expect(r).toMatchObject({ inserted: 2, duplicate_count: 9, batch_id: 2, balance_updated: { balance: 5600.5, as_of: '2026-11-02' } });
    expect((await rows(kevin, "SELECT COUNT(*) AS n FROM money_transactions WHERE description LIKE '%BLUE BOTTLE%'"))[0]!.n).toBe(3);
  });

  it('reads debit/credit columns and falls back to the bank category', async () => {
    const kevin = await makeKevin([money]);
    const id = await upload(kevin, CAPITAL_ONE, 'capone.csv');
    const r = await ok(kevin, 'money_import', { attachment_id: id, account: 'Venture', create_account: { type: 'credit_card', institution: 'Capital One' }, commit: true });
    expect(r).toMatchObject({ inserted: 4, amount_sign: { applied: 'as_is', decided_by: 'debit_credit_columns' }, total_in: 250, total_out: -91.95, balance_updated: null });
    expect(await rows(kevin, 'SELECT date, amount, merchant, category, categorized_by, is_transfer FROM money_transactions ORDER BY date')).toEqual([
      { date: '2026-10-03', amount: -12.85, merchant: 'Chipotle', category: 'dining', categorized_by: 'rule', is_transfer: 0 },
      { date: '2026-10-05', amount: 250, merchant: 'Capital One Autopay Pymt', category: 'credit_card_payment', categorized_by: 'bank', is_transfer: 1 },
      { date: '2026-10-09', amount: -48.1, merchant: 'Shell', category: 'gas', categorized_by: 'rule', is_transfer: 0 },
      { date: '2026-10-12', amount: -31, merchant: 'Local Hardware', category: 'shopping', categorized_by: 'bank', is_transfer: 0 },
    ]);
  });

  it('flips a card export that lists purchases as positive, and obeys an explicit amount_sign', async () => {
    const kevin = await makeKevin([money]);
    const id = await upload(kevin, AMEX, 'amex.csv');
    const args = { attachment_id: id, account: 'Amex Gold', create_account: { type: 'credit_card', institution: 'Amex' } };
    const preview = await ok(kevin, 'money_import', { ...args, commit: false });
    expect(preview.amount_sign).toMatchObject({ applied: 'invert', decided_by: 'amount_column' });
    expect(preview.amount_sign.explanation).toMatch(/4 of 5 amounts are positive/);
    expect(preview).toMatchObject({ total_in: 600, total_out: -586.9, date_from: '2026-10-02', date_to: '2026-10-22' });
    expect(preview.sample.map((r: any) => [r.amount, r.category, r.merchant])).toEqual([
      [-23.4, 'dining', 'Uber Eats'],
      [-412.2, 'travel', 'Delta'],
      [600, 'credit_card_payment', 'Autopay Payment - Thank You'],
      [-96.31, 'groceries', 'Whole Foods'],
      [-54.99, null, 'Amazon'],
    ]);
    const asIs = await ok(kevin, 'money_import', { ...args, amount_sign: 'as_is', commit: false });
    expect(asIs).toMatchObject({ amount_sign: { applied: 'as_is' }, total_in: 586.9, total_out: -600 });

    // The same file into a checking account is not flipped unless asked.
    const checking = { attachment_id: id, account: 'Some checking', create_account: { type: 'checking' } };
    expect((await ok(kevin, 'money_import', { ...checking, commit: false })).amount_sign.applied).toBe('as_is');
    expect((await ok(kevin, 'money_import', { ...checking, amount_sign: 'invert', commit: false })).total_out).toBe(-586.9);

    await ok(kevin, 'money_import', { ...args, commit: true });
    expect(await rows(kevin, "SELECT ROUND(SUM(spent), 2) AS spent FROM money_spending WHERE account = 'Amex Gold'")).toEqual([{ spent: 586.9 }]);
  });

  it('handles a BOM, CRLF, a summary block above the header and quoted fields with commas and line breaks', async () => {
    const kevin = await makeKevin([money]);
    const id = await upload(kevin, BOFA, 'stmt.csv');
    const args = { attachment_id: id, account: 'BofA checking', create_account: { type: 'checking', institution: 'Bank of America' } };
    const preview = await ok(kevin, 'money_import', { ...args, commit: false });
    expect(preview).toMatchObject({
      file: { header_row: 5, headers: ['Date', 'Description', 'Amount', 'Running Bal.'] },
      mapping: { date: 'Date', description: 'Description', amount: 'Amount', balance: 'Running Bal.' },
      amount_sign: { decided_by: 'cr_dr_suffix' },
      parsed_count: 4, skipped_count: 2,
      skipped: [{ row: 6, reason: 'no amount' }, { row: 11, reason: '"Total" is not a date' }],
      total_in: 3200.42, total_out: -1306.2,
      ending_balance: { balance: 6894.22, date: '2026-10-16' },
    });
    expect(preview.sample.map((r: any) => [r.date, r.amount, r.description])).toEqual([
      ['2026-10-02', -56.2, 'CHECKCARD 1001 SAFEWAY #1444, SEATTLE WA'],
      ['2026-10-03', -1250, 'Zelle payment to "Sam", for rent share'],
      ['2026-10-15', 3200, 'ACME CORP DIRECT DEP'],
      ['2026-10-16', 0.42, 'Interest Paid'],
    ]);
    expect(preview.sample[0]).toMatchObject({ merchant: 'Safeway', category: 'groceries' });
    expect(preview.sample[3]).toMatchObject({ category: 'interest_dividends' });
    const done = await ok(kevin, 'money_import', { ...args, commit: true });
    expect(done.balance_updated).toEqual({ balance: 6894.22, as_of: '2026-10-16', is_current: true });
  });

  it('maps a file with no header row by content', async () => {
    const kevin = await makeKevin([money]);
    const id = await upload(kevin, WELLS, 'Checking1.csv');
    const preview = await ok(kevin, 'money_import', { attachment_id: id, account: 'Wells', create_account: { type: 'checking' }, commit: false });
    expect(preview).toMatchObject({ file: { header_row: null }, mapping: { date: 'col1', amount: 'col2', description: 'col5' }, parsed_count: 2, total_in: 1500, total_out: -45 });
    expect(preview.sample[0]).toMatchObject({ date: '2026-10-05', amount: -45, category: 'groceries', merchant: 'Safeway' });
  });

  it('lets mapping override the detected columns and find an unrecognised header', async () => {
    const kevin = await makeKevin([money]);
    const fidelity = await upload(kevin, 'Run Date,Action,Description,Amount ($)\n10/05/2026,DIVIDEND RECEIVED,VANGUARD TOTAL STOCK MKT,12.40\n10/06/2026,TRANSFERRED FROM BANK,CASH,500.00\n', 'fidelity.csv');
    const base = { attachment_id: fidelity, account: 'Fidelity', create_account: { type: 'brokerage' as const }, commit: false };
    expect((await ok(kevin, 'money_import', base)).sample[0].description).toBe('VANGUARD TOTAL STOCK MKT');
    const mapped = await ok(kevin, 'money_import', { ...base, mapping: { description: 'action' } });
    expect(mapped.mapping).toEqual({ date: 'Run Date', description: 'Action', amount: 'Amount ($)' });
    expect(mapped.sample[0].description).toBe('DIVIDEND RECEIVED');

    const odd = await upload(kevin, 'Export for account 1234\nBooked,Payment text,Out,In\n2026-10-05,Bakery,4.20,\n2026-10-06,Salary,,900.00\n', 'odd.csv');
    const failing = await call(kevin, 'money_import', { attachment_id: odd, account: 'Odd', create_account: { type: 'checking' }, commit: false });
    expect(failing.ok).toBe(false);
    expect(failing.text).toMatch(/Pass mapping/);
    const fixed = await ok(kevin, 'money_import', { attachment_id: odd, account: 'Odd', create_account: { type: 'checking' }, mapping: { date: 'Booked', description: 'Payment text', debit: 'Out', credit: 'In' }, commit: false });
    expect(fixed).toMatchObject({ file: { header_row: 2 }, parsed_count: 2, total_in: 900, total_out: -4.2 });
    const wrong = await call(kevin, 'money_import', { ...base, mapping: { amount: 'Total' } });
    expect(wrong.text).toMatch(/no column named "Total".*Run Date, Action, Description, Amount \(\$\)/);
  });

  it('explains bad input', async () => {
    const kevin = await makeKevin([money]);
    const id = await upload(kevin, CHASE, 'chase.csv');
    expect((await call(kevin, 'money_import', { attachment_id: 999, account: 'x', commit: false })).text).toMatch(/no attachment 999/);
    const noAccount = await call(kevin, 'money_import', { attachment_id: id, account: 'Chase checking', commit: false });
    expect(noAccount.ok).toBe(false);
    expect(noAccount.text).toMatch(/There are no accounts yet.*create_account/);
    expect((await call(kevin, 'money_import', { attachment_id: id, account: 'x' })).text).toMatch(/commit/);
    const png = saveUpload(kevin.db, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'shot.png');
    expect((await call(kevin, 'money_import', { attachment_id: png.id, account: 'x', create_account: { type: 'checking' }, commit: false })).text).toMatch(/image file/);
    const prose = await upload(kevin, 'Dear Ben,\nyour statement is ready.\n', 'note.txt');
    expect((await call(kevin, 'money_import', { attachment_id: prose, account: 'x', create_account: { type: 'checking' }, commit: false })).text).toMatch(/Could not find a header row/);
    const empty = await upload(kevin, 'Date,Description,Amount\nTotal,,\n', 'empty.csv');
    expect((await call(kevin, 'money_import', { attachment_id: empty, account: 'x', create_account: { type: 'checking' }, commit: false })).text).toMatch(/No transactions could be read/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_accounts').get()).toEqual({ n: 0 });
  });

  it('undoes an import after Ben confirms, and can import the file again', async () => {
    const { kevin, attachment, batch } = await withChase();
    const declined = await call(kevin, 'money_transactions_update', { undo_import: batch }, { confirm: false });
    expect(declined.ok).toBe(false);
    expect(declined.text).toMatch(/Ben declined undoing import 1/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 9 });

    let asked = '';
    const r = await kevin.tools.call('money_transactions_update', { undo_import: batch }, { db: kevin.db, source: 'agent', confirm: (s) => ((asked = s), Promise.resolve(true)) });
    expect(asked).toMatch(/Undo the import of chase\.csv into Chase checking .* deleting its 9 transactions\?/);
    expect(r.value).toMatchObject({ undone_import: { batch_id: 1, deleted: 9 } });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 0 });
    expect((await view(kevin, 'money/imports')).batches[0]).toMatchObject({ id: 1, remaining_count: 0 });
    expect((await view(kevin, 'money/imports')).batches[0].undone_at).toBeTruthy();
    expect((await call(kevin, 'money_transactions_update', { undo_import: batch })).text).toMatch(/already undone/);
    expect((await call(kevin, 'money_transactions_update', { undo_import: 77 })).text).toMatch(/no import batch 77/);
    expect(await ok(kevin, 'money_import', { attachment_id: attachment, account: 'Chase checking', commit: true })).toMatchObject({ inserted: 9, batch_id: 2 });
  });
});

// ---- categorization --------------------------------------------------------------

describe('rules and recategorizing', () => {
  it('adds a rule, applies it to existing transactions, and uses it on the next import', async () => {
    const { kevin } = await withChase();
    const r = await ok(kevin, 'money_transactions_update', { rules: [{ pattern: 'Costco', category: 'groceries', merchant: 'Costco' }] });
    expect(r).toMatchObject({ rules: [{ pattern: 'Costco' }], rules_applied_to: 1 });
    expect(await rows(kevin, "SELECT merchant, category, categorized_by FROM money_transactions WHERE description LIKE 'COSTCO%'")).toEqual([{ merchant: 'Costco', category: 'groceries', categorized_by: 'rule' }]);

    const next = await upload(kevin, 'Date,Description,Amount\n11/03/2026,COSTCO WHSE #0456 KIRKLAND WA,-80.00\n11/04/2026,COSTCO GAS #0456 KIRKLAND WA,-41.00\n', 'nov.csv');
    await ok(kevin, 'money_transactions_update', { rules: [{ pattern: 'costco gas', category: 'gas' }] });
    const done = await ok(kevin, 'money_import', { attachment_id: next, account: 'Chase checking', commit: true });
    expect(done).toMatchObject({ inserted: 2, uncategorized_count: 0 });
    // The longer pattern wins for the fuel purchase.
    expect(await rows(kevin, "SELECT category FROM money_transactions WHERE date >= '2026-11-01' ORDER BY date")).toEqual([{ category: 'groceries' }, { category: 'gas' }]);
  });

  it('recategorizes by filter and by id, and can turn a recategorization into a rule', async () => {
    const { kevin } = await withChase();
    const byFilter = await ok(kevin, 'money_transactions_update', { update: [{ filter: { q: 'blue bottle' }, set: { category: 'dining' }, make_rule: true }] });
    expect(byFilter).toMatchObject({ updated: [{ matched: 2, rules: ['blue bottle coffee oakland ca'] }] });
    expect(await rows(kevin, "SELECT DISTINCT category, categorized_by FROM money_transactions WHERE description LIKE '%BLUE BOTTLE%'")).toEqual([{ category: 'dining', categorized_by: 'manual' }]);
    expect(await rows(kevin, "SELECT pattern, match_type, category FROM money_rules WHERE pattern LIKE 'blue bottle%'")).toEqual([{ pattern: 'blue bottle coffee oakland ca', match_type: 'contains', category: 'dining' }]);

    const [costco] = await rows(kevin, "SELECT id FROM money_transactions WHERE description LIKE 'COSTCO%'");
    await ok(kevin, 'money_transactions_update', { update: [{ ids: [costco!.id], set: { category: 'shopping', notes: 'TV' } }] });
    // A manual choice survives a rule added later and a full re-run.
    const rule = await ok(kevin, 'money_transactions_update', { rules: [{ pattern: 'costco', category: 'groceries' }], reapply_rules: 'all' });
    expect(rule).toMatchObject({ rules_applied_to: 0, reapplied: 0 });
    expect(await rows(kevin, `SELECT category, categorized_by, notes FROM money_transactions WHERE id = ${costco!.id}`)).toEqual([{ category: 'shopping', categorized_by: 'manual', notes: 'TV' }]);
    // Clearing the category hands it back to the rules.
    await ok(kevin, 'money_transactions_update', { update: [{ ids: [costco!.id], set: { category: null } }], reapply_rules: 'uncategorized' });
    expect(await rows(kevin, `SELECT category, categorized_by FROM money_transactions WHERE id = ${costco!.id}`)).toEqual([{ category: 'groceries', categorized_by: 'rule' }]);
  });

  it('re-applies rules in bulk after a rule changes, and removes rules', async () => {
    const { kevin } = await withChase();
    await ok(kevin, 'money_transactions_update', { rules: [{ pattern: 'netflix', category: 'entertainment' }] });
    expect(await rows(kevin, "SELECT category, merchant FROM money_transactions WHERE description LIKE 'NETFLIX%'")).toEqual([{ category: 'entertainment', merchant: 'Netflix' }]);
    expect((await rows(kevin, "SELECT COUNT(*) AS n FROM money_rules WHERE pattern = 'netflix'"))[0]!.n).toBe(1);

    await ok(kevin, 'money_transactions_update', { rules: [{ pattern: '^sq \\*', match: 'regex', category: 'dining' }, { pattern: 'netflix', remove: true }] });
    expect((await rows(kevin, "SELECT COUNT(*) AS n FROM money_transactions WHERE category = 'dining' AND categorized_by = 'rule'"))[0]!.n).toBe(3);
    expect((await rows(kevin, "SELECT COUNT(*) AS n FROM money_rules WHERE pattern = 'netflix'"))[0]!.n).toBe(0);

    expect((await call(kevin, 'money_transactions_update', { rules: [{ pattern: '([a-z', match: 'regex', category: 'dining' }] })).text).toMatch(/not a valid regular expression/);
    expect((await call(kevin, 'money_transactions_update', { rules: [{ pattern: 'costco' }] })).text).toMatch(/needs a category/);
    expect((await call(kevin, 'money_transactions_update', { rules: [{ pattern: 'costco', category: 'grocery' }] })).text).toMatch(/no category "grocery".*groceries/);
    expect((await call(kevin, 'money_transactions_update', { rules: [{ pattern: 'nope', remove: true }] })).text).toMatch(/no contains rule/);
  });

  it('marks and unmarks transfers, keeping category and flag in step', async () => {
    const { kevin } = await withChase();
    const [costco] = await rows(kevin, "SELECT id FROM money_transactions WHERE description LIKE 'COSTCO%'");
    const spent = async () => (await rows(kevin, "SELECT ROUND(SUM(spent), 2) AS s FROM money_spending WHERE month = '2026-10'"))[0]!.s;
    expect(await spent()).toBeCloseTo(CHASE_SPENT, 2);

    await ok(kevin, 'money_transactions_update', { update: [{ ids: [costco!.id], set: { transfer: true } }] });
    expect(await rows(kevin, `SELECT category, is_transfer FROM money_transactions WHERE id = ${costco!.id}`)).toEqual([{ category: 'transfer', is_transfer: 1 }]);
    expect(await spent()).toBeCloseTo(CHASE_SPENT - 212.4, 2);

    await ok(kevin, 'money_transactions_update', { update: [{ ids: [costco!.id], set: { transfer: false } }] });
    expect(await rows(kevin, `SELECT category, is_transfer FROM money_transactions WHERE id = ${costco!.id}`)).toEqual([{ category: null, is_transfer: 0 }]);

    await ok(kevin, 'money_transactions_update', { update: [{ ids: [costco!.id], set: { category: 'credit_card_payment' } }] });
    expect((await rows(kevin, `SELECT is_transfer FROM money_transactions WHERE id = ${costco!.id}`))[0]!.is_transfer).toBe(1);
    expect((await call(kevin, 'money_transactions_update', { update: [{ ids: [costco!.id], set: { category: 'groceries', transfer: true } }] })).text).toMatch(/contradicts/);
    // A rule can mark transfers too.
    await ok(kevin, 'money_transactions_update', { rules: [{ pattern: 'blue bottle', transfer: true }] });
    expect((await rows(kevin, 'SELECT COUNT(*) AS n FROM money_transactions WHERE is_transfer = 1'))[0]!.n).toBe(5);
  });
});

describe('money_transactions_update: add, edit, delete', () => {
  it('adds manual transactions, categorizing by rule unless told', async () => {
    const kevin = await makeKevin([money]);
    await ok(kevin, 'money_account_update', { accounts: [{ name: 'Cash', type: 'cash' }] });
    const r = await ok(kevin, 'money_transactions_update', {
      add: [
        { account: 'Cash', date: '2026-11-14', amount: -20, description: 'Farmers market', category: 'groceries' },
        { account: 'Cash', date: '2026-11-14', amount: -6.5, description: 'Starbucks' },
        { account: 'Cash', date: '2026-11-14', amount: -6.5, description: 'Starbucks' },
        { account: 'cash', date: '2026-11-13', amount: -40, description: 'ATM to wallet', transfer: true },
      ],
    });
    expect(r.added.map((a: any) => a.category)).toEqual(['groceries', 'dining', 'dining', 'transfer']);
    expect(await rows(kevin, 'SELECT amount, category, categorized_by, is_transfer, import_batch_id FROM money_transactions ORDER BY id')).toEqual([
      { amount: -20, category: 'groceries', categorized_by: 'manual', is_transfer: 0, import_batch_id: null },
      { amount: -6.5, category: 'dining', categorized_by: 'rule', is_transfer: 0, import_batch_id: null },
      { amount: -6.5, category: 'dining', categorized_by: 'rule', is_transfer: 0, import_batch_id: null },
      { amount: -40, category: 'transfer', categorized_by: 'manual', is_transfer: 1, import_batch_id: null },
    ]);
    expect((await call(kevin, 'money_transactions_update', { add: [{ account: 'Wallet', date: '2026-11-14', amount: -1, description: 'x' }] })).text).toMatch(/No single account matches "Wallet". Accounts: Cash/);
    expect((await call(kevin, 'money_transactions_update', { add: [{ account: 'Cash', date: '11/14/2026', amount: -1, description: 'x' }] })).text).toMatch(/YYYY-MM-DD/);
    expect((await call(kevin, 'money_transactions_update', { add: [{ account: 'Cash', date: '2026-11-14', amount: 0, description: 'x' }] })).text).toMatch(/zero amount/);
    expect((await call(kevin, 'money_transactions_update', {})).text).toMatch(/Nothing to do/);
  });

  it('edits fields, deletes a few by id without asking, and asks before a filtered delete', async () => {
    const { kevin } = await withChase();
    await ok(kevin, 'money_account_update', { accounts: [{ name: 'Joint', type: 'checking' }] });
    const [chipotle] = await rows(kevin, "SELECT id FROM money_transactions WHERE description LIKE 'CHIPOTLE%'");
    await ok(kevin, 'money_transactions_update', { update: [{ ids: [chipotle!.id], set: { amount: -13.6, date: '2026-10-03', merchant: 'Chipotle Capitol Hill', account: 'Joint', pending: true } }] });
    expect(await rows(kevin, `SELECT t.amount, t.date, t.merchant, t.pending, a.name FROM money_transactions t JOIN money_accounts a ON a.id = t.account_id WHERE t.id = ${chipotle!.id}`)).toEqual([
      { amount: -13.6, date: '2026-10-03', merchant: 'Chipotle Capitol Hill', pending: 1, name: 'Joint' },
    ]);
    expect((await call(kevin, 'money_transactions_update', { update: [{ ids: [chipotle!.id], set: {} }] })).text).toMatch(/set is empty/);
    expect((await call(kevin, 'money_transactions_update', { update: [{ set: { notes: 'x' } }] })).text).toMatch(/needs ids or a filter/);
    expect((await call(kevin, 'money_transactions_update', { update: [{ filter: {}, set: { notes: 'x' } }] })).text).toMatch(/needs ids or a filter/);
    expect((await call(kevin, 'money_transactions_update', { update: [{ ids: [9999], set: { notes: 'x' } }] })).text).toMatch(/No transaction with id 9999/);

    // One by id: no confirmation, even when Ben would have declined.
    expect((await call(kevin, 'money_transactions_update', { delete: { ids: [chipotle!.id] } }, { confirm: false })).value).toEqual({ deleted: 1 });
    const declined = await call(kevin, 'money_transactions_update', { delete: { filter: { account: 'Chase checking', month: '2026-10', amount_max: -100 } } }, { confirm: false });
    expect(declined.text).toMatch(/Ben declined the delete/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 8 });
    let asked = '';
    const r = await kevin.tools.call('money_transactions_update', { delete: { filter: { account: 'Chase checking', month: '2026-10', amount_max: -100 } } }, { db: kevin.db, source: 'agent', confirm: (s) => ((asked = s), Promise.resolve(true)) });
    expect(asked).toBe('Delete 3 transactions dated 2026-10-21 to 2026-10-30 across 1 account (net -$1,712)?');
    expect(r.value).toEqual({ deleted: 3 });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 5 });
  });
});

// ---- accounts, net worth, holdings ---------------------------------------------------

describe('accounts and net worth', () => {
  it('creates accounts, treats liabilities as negative, and keeps a balance history', async () => {
    const kevin = await makeKevin([money]);
    const r = await ok(kevin, 'money_account_update', {
      accounts: [
        { name: 'Chase checking', type: 'checking', institution: 'Chase', last4: '4821', balance: 5000, balance_as_of: '2026-09-30' },
        { name: '401k', type: 'retirement', institution: 'Fidelity', balance: 170000, balance_as_of: '2026-09-30' },
        { name: 'Amex Gold', type: 'credit_card', balance: 1240.555, balance_as_of: '2026-10-15' },
        { name: 'Mortgage', type: 'mortgage', balance: 310000, balance_as_of: '2026-10-01' },
        { name: 'Old savings', type: 'savings', balance: 50, balance_as_of: '2026-09-30', active: false },
        { name: 'Wallet', type: 'cash' },
      ],
    });
    expect(r.accounts.find((a: any) => a.name === 'Amex Gold')).toMatchObject({ is_liability: true, balance: 1240.56, net_worth_contribution: -1240.56 });
    expect(r.net_worth).toEqual({ assets: 175000, liabilities: 311240.56, net_worth: -136240.56, as_of: '2026-10-15' });

    // "Update my 401k balance to 182,300", by a partial name.
    await ok(kevin, 'money_account_update', { accounts: [{ name: '401k', balance: 182300, balance_as_of: '2026-11-14' }] });
    // Back-filling an older statement adds history and leaves the current figure alone.
    await ok(kevin, 'money_account_update', { accounts: [{ name: '401k', balance: 150000, balance_as_of: '2026-01-31' }] });
    expect(await rows(kevin, "SELECT balance, balance_as_of FROM money_accounts WHERE name = '401k'")).toEqual([{ balance: 182300, balance_as_of: '2026-11-14' }]);
    expect(await rows(kevin, "SELECT h.date, h.balance FROM money_balance_history h JOIN money_accounts a ON a.id = h.account_id WHERE a.name = '401k' ORDER BY h.date")).toEqual([
      { date: '2026-01-31', balance: 150000 },
      { date: '2026-09-30', balance: 170000 },
      { date: '2026-11-14', balance: 182300 },
    ]);

    // The SQL the prompt note gives for net worth.
    expect(await rows(kevin, 'SELECT ROUND(SUM(CASE WHEN is_liability = 1 THEN -balance ELSE balance END), 2) AS net_worth FROM money_accounts WHERE active = 1 AND balance IS NOT NULL')).toEqual([{ net_worth: -123940.56 }]);

    const accounts = await view(kevin, 'money/accounts');
    expect(accounts.accounts.map((a: any) => a.name)).toEqual(['Wallet', 'Chase checking', '401k', 'Amex Gold', 'Mortgage']);
    expect(accounts.accounts[1]).toEqual({
      id: 1, name: 'Chase checking', institution: 'Chase', type: 'checking', is_liability: false, last4: '4821', currency: 'USD', balance: 5000, balance_as_of: '2026-09-30', active: true, notes: null,
      transaction_count: 0, last_transaction_date: null, holdings_count: 0, holdings_value: null,
    });
    expect(accounts.totals).toEqual({ assets: 187300, liabilities: 311240.56, net_worth: -123940.56, as_of: '2026-11-14' });
    expect((await view(kevin, 'money/accounts', { include_inactive: '1' })).accounts).toHaveLength(6);

    const history = await view(kevin, 'money/net_worth_history', { today: '2026-11-14', granularity: 'day' });
    expect(history.points).toEqual([
      { date: '2026-01-31', assets: 150000, liabilities: 0, net_worth: 150000 },
      { date: '2026-09-30', assets: 175050, liabilities: 0, net_worth: 175050 },
      { date: '2026-10-01', assets: 175050, liabilities: 310000, net_worth: -134950 },
      { date: '2026-10-15', assets: 175050, liabilities: 311240.56, net_worth: -136190.56 },
      { date: '2026-11-14', assets: 187350, liabilities: 311240.56, net_worth: -123890.56 },
    ]);
    const monthly = await view(kevin, 'money/net_worth_history', { today: '2026-11-14' });
    expect(monthly.points.map((pt: any) => pt.date)).toEqual(['2026-01-31', '2026-09-30', '2026-10-15', '2026-11-14']);
    expect(monthly).toMatchObject({ granularity: 'month', change: { from: '2026-01-31', to: '2026-11-14', amount: -273890.56 }, current: { net_worth: -123940.56 } });
    expect((await view(kevin, 'money/net_worth_history', { today: '2026-11-14', months: '1' })).points.map((pt: any) => pt.date)).toEqual(['2026-10-15', '2026-11-14']);
  });

  it('renames, closes, validates, and asks before deleting an account that has transactions', async () => {
    const { kevin } = await withChase();
    await ok(kevin, 'money_account_update', { accounts: [{ name: 'Chase checking', rename_to: 'Chase Total Checking', notes: 'joint with Sam' }, { name: 'Empty', type: 'savings' }] });
    expect(await rows(kevin, 'SELECT name, notes FROM money_accounts ORDER BY id')).toEqual([{ name: 'Chase Total Checking', notes: 'joint with Sam' }, { name: 'Empty', notes: null }]);
    expect((await call(kevin, 'money_account_update', { accounts: [{ name: 'Empty', rename_to: 'chase total checking' }] })).text).toMatch(/already an account named/);
    expect((await call(kevin, 'money_account_update', { accounts: [{ name: 'New one' }] })).text).toMatch(/needs a type: checking, savings/);
    expect((await call(kevin, 'money_account_update', { accounts: [{ name: 'X', type: 'piggybank' }] })).ok).toBe(false);
    expect((await call(kevin, 'money_account_update', {})).text).toMatch(/Pass accounts, holdings, or both/);
    expect((await call(kevin, 'money_account_update', { accounts: [{ name: 'Nope', delete: true }] })).text).toMatch(/No account named "Nope" to delete/);

    // An empty account goes without a prompt.
    expect((await call(kevin, 'money_account_update', { accounts: [{ name: 'Empty', delete: true }] }, { confirm: false })).value).toMatchObject({ deleted_accounts: ['Empty'] });
    const declined = await call(kevin, 'money_account_update', { accounts: [{ name: 'Chase Total Checking', delete: true }] }, { confirm: false });
    expect(declined.text).toMatch(/Ben declined deleting the account "Chase Total Checking"/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 9 });
    let asked = '';
    await kevin.tools.call('money_account_update', { accounts: [{ name: 'Chase Total Checking', delete: true }] }, { db: kevin.db, source: 'agent', confirm: (s) => ((asked = s), Promise.resolve(true)) });
    expect(asked).toBe('Delete the account "Chase Total Checking" along with its 9 transactions and its balance history?');
    for (const t of ['money_accounts', 'money_transactions', 'money_balance_history', 'money_import_batches']) expect(kevin.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
  });
});

describe('holdings', () => {
  it('tracks buys, sells and prices, and reports value, gain and allocation', async () => {
    const kevin = await makeKevin([money]);
    await ok(kevin, 'money_account_update', {
      accounts: [{ name: 'Schwab brokerage', type: 'brokerage' }, { name: 'Roth IRA', type: 'retirement' }],
      holdings: [
        { account: 'Schwab brokerage', symbol: 'vti', name: 'Vanguard Total Stock Market', add_quantity: 10, price: 268, asset_class: 'us_stock' },
        { account: 'Schwab brokerage', symbol: 'BND', quantity: 20, price: 72, asset_class: 'bond' },
        { account: 'Schwab brokerage', symbol: 'CASH', quantity: 500, price: 1 },
        { account: 'Roth IRA', symbol: 'VTI', quantity: 4, cost_basis: 800, price: 268, asset_class: 'us_stock' },
        { account: 'Roth IRA', symbol: 'VXUS', quantity: 30, cost_basis: 1700, asset_class: 'intl_stock' },
      ],
    });
    // A second lot at a higher price raises the cost basis and the last price.
    const buy = await ok(kevin, 'money_account_update', { holdings: [{ account: 'Schwab', symbol: 'VTI', add_quantity: 5, price: 280 }] });
    expect(buy.holdings).toEqual([{ account: 'Schwab brokerage', symbol: 'VTI', quantity: 15, cost_basis: 4080, last_price: 280, asset_class: 'us_stock', market_value: 4200 }]);

    const h = await view(kevin, 'money/holdings');
    expect(h.positions.find((p: any) => p.account === 'Schwab brokerage' && p.symbol === 'VTI')).toMatchObject({
      name: 'Vanguard Total Stock Market', asset_class: 'us_stock', quantity: 15, cost_basis: 4080, last_price: 280, market_value: 4200, priced: true, gain: 120, gain_pct: 0.0294,
    });
    // Roth VTI is still priced at 268; VXUS has no price, so its cost stands in for its value.
    expect(h.positions.find((p: any) => p.symbol === 'VXUS')).toMatchObject({ market_value: 1700, priced: false, gain: null, gain_pct: null });
    expect(h.totals).toEqual({ market_value: 8912, cost_basis: 8520, gain: 392, gain_pct: 0.046 });
    expect(h.by_asset_class).toEqual([
      { asset_class: 'us_stock', market_value: 5272, share: 0.5916, positions: 2 },
      { asset_class: 'intl_stock', market_value: 1700, share: 0.1908, positions: 1 },
      { asset_class: 'bond', market_value: 1440, share: 0.1616, positions: 1 },
      { asset_class: 'cash', market_value: 500, share: 0.0561, positions: 1 },
    ]);
    expect(h.by_account).toEqual([
      { account_id: 1, account: 'Schwab brokerage', market_value: 6140, cost_basis: 6020, gain: 120, share: 0.689, positions: 3, account_balance: null },
      { account_id: 2, account: 'Roth IRA', market_value: 2772, cost_basis: 2500, gain: 272, share: 0.311, positions: 2, account_balance: null },
    ]);

    // A price with no account updates the symbol everywhere; then the balance follows the holdings.
    const priced = await ok(kevin, 'money_account_update', { holdings: [{ symbol: 'VTI', price: 300 }], accounts: [{ name: 'Schwab brokerage', balance_from_holdings: true }] });
    expect(priced.holdings).toEqual([{ symbol: 'VTI', price: 300, updated_in_accounts: 2 }]);
    expect(priced.accounts[0]).toMatchObject({ name: 'Schwab brokerage', balance: 6440 });
    expect(await rows(kevin, "SELECT ROUND(SUM(quantity * last_price), 2) AS v FROM money_holdings WHERE symbol = 'VTI'")).toEqual([{ v: 5700 }]);

    // Selling a third of the position releases a third of its cost; selling the rest removes it.
    const sell = await ok(kevin, 'money_account_update', { holdings: [{ account: 'Schwab brokerage', symbol: 'VTI', add_quantity: -5 }] });
    expect(sell.holdings[0]).toMatchObject({ quantity: 10, cost_basis: 2720, market_value: 3000 });
    expect((await call(kevin, 'money_account_update', { holdings: [{ account: 'Schwab brokerage', symbol: 'VTI', add_quantity: -11 }] })).text).toMatch(/negative position/);
    expect((await ok(kevin, 'money_account_update', { holdings: [{ account: 'Schwab brokerage', symbol: 'VTI', add_quantity: -10 }] })).holdings[0]).toMatchObject({ removed: true });
    await ok(kevin, 'money_account_update', { holdings: [{ account: 'Schwab brokerage', symbol: 'BND', remove: true }] });
    expect((await view(kevin, 'money/holdings')).positions.map((p: any) => `${p.account}:${p.symbol}`)).toEqual(['Roth IRA:VTI', 'Roth IRA:VXUS', 'Schwab brokerage:CASH']);

    expect((await call(kevin, 'money_account_update', { holdings: [{ symbol: 'QQQ', price: 500 }] })).text).toMatch(/No account holds QQQ yet/);
    expect((await call(kevin, 'money_account_update', { holdings: [{ account: 'Roth IRA', symbol: 'QQQ', price: 500 }] })).text).toMatch(/new position.*quantity/);
    expect((await call(kevin, 'money_account_update', { accounts: [{ name: 'Roth IRA', balance_from_holdings: true }] })).text).toMatch(/price on every holding/);
    expect((await call(kevin, 'money_account_update', { holdings: [{ account: 'Roth IRA', symbol: 'VTI', asset_class: 'stonks' }] })).ok).toBe(false);
    expect((await view(kevin, 'money/accounts')).accounts.find((a: any) => a.name === 'Roth IRA')).toMatchObject({ holdings_count: 2, holdings_value: 2900 });
  });
});

// ---- budgets ---------------------------------------------------------------------

describe('budgets and categories', () => {
  it('reports spent, remaining and pace for an injected day', async () => {
    const { kevin } = await withChase();
    const set = await ok(kevin, 'money_budget_update', {
      budgets: [{ category: 'groceries', monthly_amount: 90 }, { category: 'dining', monthly_amount: 50 }, { category: 'subscriptions', monthly_amount: 15 }, { category: 'shopping', monthly_amount: 100 }],
    });
    expect(set).toMatchObject({ total_monthly_budget: 255 });

    const b = await view(kevin, 'money/budgets', { today: '2026-10-16' });
    expect(b).toMatchObject({ month: '2026-10', is_current_month: true, day_of_month: 16, days_in_month: 31, month_elapsed: 0.5161, totals: { budget: 255, spent: 131.21, remaining: 123.79, used: 0.5145 }, counts: { over: 1, near: 1, fast: 1, ok: 1 } });
    const item = (c: string) => b.items.find((i: any) => i.category === c);
    expect(item('groceries')).toEqual({ category: 'groceries', label: 'Groceries', group: 'essentials', monthly_amount: 90, spent: 84.12, remaining: 5.88, used: 0.9347, pace: 1.8109, projected: 162.98, status: 'near' });
    expect(item('dining')).toMatchObject({ spent: 31.6, remaining: 18.4, used: 0.632, pace: 1.2245, projected: 61.23, status: 'fast' });
    expect(item('subscriptions')).toMatchObject({ spent: 15.49, remaining: -0.49, status: 'over' });
    expect(item('shopping')).toMatchObject({ spent: 0, remaining: 100, used: 0, pace: 0, status: 'ok' });
    expect(b.unbudgeted).toEqual([{ category: 'uncategorized', label: 'Uncategorized', group: 'uncategorized', spent: 221.4 }]);

    // Looking back at a finished month: the whole month has elapsed, and nothing is "fast" or "near".
    const past = await view(kevin, 'money/budgets', { month: '2026-10', today: '2026-11-14' });
    expect(past).toMatchObject({ is_current_month: false, month_elapsed: 1, counts: { over: 1, near: 0, fast: 0, ok: 3 } });
    expect(past.items.find((i: any) => i.category === 'dining')).toMatchObject({ pace: 0.632, projected: 31.6, status: 'ok' });
    // The current month with nothing spent yet, and a month that has not started.
    expect((await view(kevin, 'money/budgets', { today: '2026-11-14' })).totals).toEqual({ budget: 255, spent: 0, remaining: 255, used: 0 });
    expect((await view(kevin, 'money/budgets', { month: '2026-12', today: '2026-11-14' })).items[0]).toMatchObject({ pace: null, projected: null, status: 'ok' });

    await ok(kevin, 'money_budget_update', { budgets: [{ category: 'groceries', monthly_amount: 600 }, { category: 'shopping', remove: true }] });
    expect(await rows(kevin, 'SELECT category, monthly_amount FROM money_budgets ORDER BY category')).toEqual([
      { category: 'dining', monthly_amount: 50 }, { category: 'groceries', monthly_amount: 600 }, { category: 'subscriptions', monthly_amount: 15 },
    ]);
    expect((await call(kevin, 'money_budget_update', { budgets: [{ category: 'income', monthly_amount: 10 }] })).text).toMatch(/budgets are for spending categories/);
    expect((await call(kevin, 'money_budget_update', { budgets: [{ category: 'groceries' }] })).text).toMatch(/needs monthly_amount/);
    expect((await call(kevin, 'money_budget_update', { budgets: [{ category: 'groceries', monthly_amount: -5 }] })).ok).toBe(false);
    expect((await call(kevin, 'money_budget_update', { budgets: [{ category: 'shopping', remove: true }] })).text).toMatch(/no budget on "shopping"/);
    expect((await call(kevin, 'money_budget_update', {})).text).toMatch(/Pass budgets, categories, or both/);
  });

  it('adds, renames, regroups and removes categories', async () => {
    const { kevin } = await withChase();
    const r = await ok(kevin, 'money_budget_update', { categories: [{ name: 'Kids Activities', group: 'lifestyle' }], budgets: [{ category: 'kids_activities', monthly_amount: 150 }] });
    expect(r.categories).toEqual([{ name: 'kids_activities', label: 'Kids activities', group: 'lifestyle', created: true }]);
    expect((await call(kevin, 'money_budget_update', { categories: [{ name: 'pets' }] })).text).toMatch(/needs a group/);

    await ok(kevin, 'money_budget_update', { categories: [{ name: 'dining', rename_to: 'restaurants', label: 'Restaurants' }] });
    expect(await rows(kevin, "SELECT COUNT(*) AS n FROM money_transactions WHERE category = 'restaurants'")).toEqual([{ n: 1 }]);
    expect((await rows(kevin, "SELECT COUNT(*) AS n FROM money_rules WHERE category = 'restaurants'"))[0]!.n).toBeGreaterThan(3);

    // Moving a category into the transfers group takes its transactions out of spending.
    await ok(kevin, 'money_budget_update', { categories: [{ name: 'subscriptions', group: 'transfers' }] });
    expect(await rows(kevin, "SELECT is_transfer FROM money_transactions WHERE category = 'subscriptions'")).toEqual([{ is_transfer: 1 }]);
    await ok(kevin, 'money_budget_update', { categories: [{ name: 'subscriptions', group: 'lifestyle' }] });

    const removed = await ok(kevin, 'money_budget_update', { categories: [{ name: 'restaurants', remove: true, move_to: 'entertainment' }, { name: 'groceries', remove: true }] });
    expect(removed.categories).toEqual([
      { name: 'restaurants', removed: true, transactions_moved: 1, moved_to: 'entertainment' },
      { name: 'groceries', removed: true, transactions_moved: 1, moved_to: null },
    ]);
    expect(await rows(kevin, "SELECT category, categorized_by FROM money_transactions WHERE description LIKE 'TRADER JOE%'")).toEqual([{ category: null, categorized_by: null }]);
    expect((await rows(kevin, "SELECT COUNT(*) AS n FROM money_rules WHERE category = 'entertainment'"))[0]!.n).toBeGreaterThan(3);
    expect(await rows(kevin, "SELECT COUNT(*) AS n FROM money_rules WHERE category IN ('groceries', 'restaurants')")).toEqual([{ n: 0 }]);
    expect((await call(kevin, 'money_budget_update', { categories: [{ name: 'transfer', remove: true }] })).text).toMatch(/cannot be removed/);

    const c = await view(kevin, 'money/categories');
    expect(c.groups).toEqual(['essentials', 'lifestyle', 'income', 'transfers']);
    expect(c.categories.find((x: any) => x.name === 'kids_activities')).toEqual({ name: 'kids_activities', label: 'Kids activities', group: 'lifestyle', budget: 150, transaction_count: 0, rule_count: 0 });
    expect(c.categories.find((x: any) => x.name === 'entertainment')).toMatchObject({ transaction_count: 1 });
    expect(c.rules[0]).toEqual(expect.objectContaining({ id: expect.any(Number), pattern: expect.any(String), match_type: expect.any(String), category: expect.any(String), category_label: expect.any(String), priority: 0 }));
    expect(c.uncategorized_count).toBe(4);
  });
});

// ---- recurring -------------------------------------------------------------------

describe('recurring charges', () => {
  it('finds monthly charges of a similar amount and ignores the rest', async () => {
    const kevin = await makeKevin([money]);
    await ok(kevin, 'money_account_update', { accounts: [{ name: 'Card', type: 'credit_card' }] });
    const tx = (date: string, amount: number, description: string) => ({ account: 'Card', date, amount, description });
    await ok(kevin, 'money_transactions_update', {
      add: [
        // A subscription with a price rise.
        tx('2026-06-15', -15.49, 'NETFLIX.COM'), tx('2026-07-15', -15.49, 'NETFLIX.COM'), tx('2026-08-14', -15.49, 'NETFLIX.COM'), tx('2026-09-15', -17.99, 'NETFLIX.COM'), tx('2026-10-15', -17.99, 'NETFLIX.COM'),
        // Rent, and a one-off payment to the same payee.
        tx('2026-08-01', -2100, 'Maple Court Apartments'), tx('2026-09-01', -2100, 'Maple Court Apartments'), tx('2026-10-01', -2100, 'Maple Court Apartments'), tx('2026-11-01', -2100, 'Maple Court Apartments'),
        tx('2026-09-12', -250, 'Maple Court Apartments'),
        // A gym that stopped charging in the summer.
        tx('2026-05-03', -40, 'PLANET FITNESS'), tx('2026-06-03', -40, 'PLANET FITNESS'), tx('2026-07-03', -40, 'PLANET FITNESS'),
        // Weekly groceries, two coffees, a refund, a transfer: not recurring.
        tx('2026-10-03', -80, 'SAFEWAY'), tx('2026-10-10', -82, 'SAFEWAY'), tx('2026-10-17', -79, 'SAFEWAY'), tx('2026-10-24', -81, 'SAFEWAY'),
        tx('2026-09-15', -5, 'Corner Cafe'), tx('2026-10-15', -5, 'Corner Cafe'),
        tx('2026-10-20', 17.99, 'NETFLIX.COM'),
        { ...tx('2026-08-05', -500, 'To savings'), transfer: true }, { ...tx('2026-09-05', -500, 'To savings'), transfer: true }, { ...tx('2026-10-05', -500, 'To savings'), transfer: true },
      ],
    });
    const r = await view(kevin, 'money/recurring', { today: '2026-11-14' });
    expect(r.items.map((i: any) => [i.merchant, i.typical_amount, i.occurrences, i.active])).toEqual([
      ['Maple Court Apartments', 2100, 4, true],
      ['Netflix', 15.49, 5, true],
      ['Planet Fitness', 40, 3, false],
    ]);
    expect(r.items[1]).toMatchObject({
      category: 'subscriptions', account: 'Card', last_amount: 17.99, cadence: 'monthly', first_date: '2026-06-15', last_date: '2026-10-15', next_expected: '2026-11-14', annual_cost: 185.88,
    });
    expect(r.items[1].transaction_ids).toHaveLength(5);
    expect(r).toMatchObject({ today: '2026-11-14', since: '2026-05-01', monthly_total: 2115.49, subscriptions_monthly_total: 15.49 });
    // A shorter window no longer reaches the gym.
    expect((await view(kevin, 'money/recurring', { today: '2026-11-14', months: '3' })).items.map((i: any) => i.merchant)).toEqual(['Maple Court Apartments', 'Netflix']);
  });

  it('needs three charges and a monthly rhythm', () => {
    const o = (id: number, date: string, spent: number, merchant = 'Gym') => ({ id, date, spent, merchant, category: null, account: 'Card' });
    expect(detectRecurring([o(1, '2026-09-01', 30), o(2, '2026-10-01', 30)], '2026-11-01')).toEqual([]);
    expect(detectRecurring([o(1, '2026-09-01', 30), o(2, '2026-09-08', 30), o(3, '2026-09-15', 30)], '2026-11-01')).toEqual([]);
    expect(detectRecurring([o(1, '2026-08-01', 30), o(2, '2026-09-01', 30), o(3, '2026-10-01', 90)], '2026-11-01')).toEqual([]);
    expect(detectRecurring([o(1, '2026-08-01', 30), o(2, '2026-09-02', 31), o(3, '2026-10-01', 30)], '2026-11-01')).toHaveLength(1);
  });
});

// ---- the page's read views ---------------------------------------------------------

describe('views', () => {
  async function household() {
    const { kevin } = await withChase();
    const amex = await upload(kevin, AMEX, 'amex.csv');
    await ok(kevin, 'money_import', { attachment_id: amex, account: 'Amex Gold', create_account: { type: 'credit_card', institution: 'Amex' }, commit: true });
    await ok(kevin, 'money_account_update', { accounts: [{ name: 'Amex Gold', balance: 1240, balance_as_of: '2026-11-10' }, { name: '401k', type: 'retirement', balance: 182300, balance_as_of: '2026-11-14' }] });
    await ok(kevin, 'money_transactions_update', {
      add: [
        { account: 'Chase checking', date: '2026-09-10', amount: -140, description: 'TRADER JOE S #123' },
        { account: 'Chase checking', date: '2026-09-15', amount: 3200, description: 'ACME CORP PAYROLL' },
        { account: 'Chase checking', date: '2026-11-03', amount: -62.5, description: 'TRADER JOE S #123' },
        { account: 'Chase checking', date: '2026-11-05', amount: -48, description: 'CHIPOTLE 0456' },
        { account: 'Chase checking', date: '2026-11-06', amount: 20, description: 'CHIPOTLE 0456 REFUND' },
        { account: 'Chase checking', date: '2026-11-12', amount: -30, description: 'Hold at hotel', pending: true },
      ],
    });
    await ok(kevin, 'money_budget_update', { budgets: [{ category: 'groceries', monthly_amount: 600 }, { category: 'dining', monthly_amount: 25 }] });
    return kevin;
  }
  const OCT_SPENT = Math.round((CHASE_SPENT + 586.9) * 100) / 100; // 939.51

  it('overview: net worth, this month against last, top categories, budget summary', async () => {
    const kevin = await household();
    const o = await view(kevin, 'money/overview', { today: '2026-11-14' });
    expect(o).toMatchObject({
      today: '2026-11-14', month: '2026-11',
      net_worth: { assets: 187911.5, liabilities: 1240, net_worth: 186671.5, as_of: '2026-11-14' },
      this_month: { month: '2026-11', spent: 90.5, income: 0, net: -90.5, day_of_month: 14, days_in_month: 30 },
      last_month: { month: '2026-10', spent: OCT_SPENT, income: 3200, net: Math.round((3200 - OCT_SPENT) * 100) / 100, spent_by_same_day: 560.32 },
      uncategorized_count: 5, transaction_count: 20,
      last_import: { id: 2, filename: 'amex.csv', inserted_count: 5, account: 'Amex Gold' },
    });
    expect(o.accounts.map((a: any) => [a.name, a.is_liability, a.balance])).toEqual([['Chase checking', false, 5611.5], ['401k', false, 182300], ['Amex Gold', true, 1240]]);
    expect(o.top_categories).toEqual([
      { category: 'groceries', label: 'Groceries', group: 'essentials', spent: 62.5, count: 1, budget: 600 },
      { category: 'dining', label: 'Dining', group: 'lifestyle', spent: 28, count: 2, budget: 25 },
    ]);
    expect(o.budgets).toMatchObject({ totals: { budget: 625, spent: 90.5, remaining: 534.5 }, counts: { over: 1, near: 0, fast: 0, ok: 1 }, month_elapsed: 0.4667 });
    expect(o.budgets.attention).toMatchObject([{ category: 'dining', spent: 28, remaining: -3, status: 'over' }]);

    const empty = await view(await makeKevin([money]), 'money/overview', { today: '2026-11-14' });
    expect(empty).toMatchObject({ net_worth: { assets: 0, liabilities: 0, net_worth: 0, as_of: null }, accounts: [], this_month: { spent: 0, income: 0 }, top_categories: [], uncategorized_count: 0, last_import: null });
  });

  it('transactions: filters, search, paging, totals', async () => {
    const kevin = await household();
    const all = await view(kevin, 'money/transactions');
    expect(all).toMatchObject({ total: 20, limit: 50, offset: 0 });
    expect(all.rows[0]).toEqual({
      id: expect.any(Number), date: '2026-11-12', amount: -30, description: 'Hold at hotel', merchant: 'Hold at hotel', category: null, category_label: null, category_group: null, categorized_by: null,
      is_transfer: false, pending: true, notes: null, account_id: 1, account: 'Chase checking', import_batch_id: null,
    });
    const oct = await view(kevin, 'money/transactions', { month: '2026-10', account: 'Chase checking' });
    expect(oct).toMatchObject({ total: 9, sum: Math.round((3200 + CHASE_OUT) * 100) / 100, sum_in: 3200, sum_out: Math.round(CHASE_OUT * 100) / 100 });
    expect((await view(kevin, 'money/transactions', { account: '2' })).total).toBe(5);
    expect((await view(kevin, 'money/transactions', { category: 'dining' })).rows.map((r: any) => r.amount)).toEqual([20, -48, -23.4, -31.6]);
    expect((await view(kevin, 'money/transactions', { q: 'trader' })).total).toBe(3);
    expect((await view(kevin, 'money/transactions', { q: '100%' })).total).toBe(0);
    expect((await view(kevin, 'money/transactions', { uncategorized: '1' })).rows.map((r: any) => r.merchant).sort()).toEqual(['Amazon', 'BLUE BOTTLE COFFEE Oakland CA', 'BLUE BOTTLE COFFEE Oakland CA', 'Costco Whse Seattle', 'Hold at hotel']);
    expect((await view(kevin, 'money/transactions', { from: '2026-10-15', to: '2026-10-15' })).rows.map((r: any) => r.merchant).sort()).toEqual(['Acme Corp Payroll', 'Autopay Payment - Thank You', 'Netflix']);
    expect((await view(kevin, 'money/transactions', { transfers: 'only' })).total).toBe(3);
    expect((await view(kevin, 'money/transactions', { transfers: 'exclude', month: '2026-10' })).total).toBe(11);
    expect((await view(kevin, 'money/transactions', { batch: '2' })).total).toBe(5);
    const page = await view(kevin, 'money/transactions', { limit: '3', offset: '3', sort: 'amount_asc' });
    expect(page.rows.map((r: any) => r.amount)).toEqual([-212.4, -140, -96.31]);
    expect(page).toMatchObject({ total: 20, limit: 3, offset: 3 });
    expect((await view(kevin, 'money/transactions', { sort: 'date_asc', limit: '1' })).rows[0].date).toBe('2026-09-10');
  });

  it('spending: categories, groups, merchants and the trailing series', async () => {
    const kevin = await household();
    const s = await view(kevin, 'money/spending', { month: '2026-10', today: '2026-11-14', months: '3' });
    expect(s).toMatchObject({ month: '2026-10', total: OCT_SPENT, income: 3200, net: Math.round((3200 - OCT_SPENT) * 100) / 100, months: ['2026-08', '2026-09', '2026-10'] });
    expect(s.by_category).toEqual([
      { category: 'travel', label: 'Travel', group: 'lifestyle', spent: 412.2, count: 1, share: 0.4387, budget: null },
      { category: 'uncategorized', label: 'Uncategorized', group: 'uncategorized', spent: 276.39, count: 4, share: 0.2942, budget: null },
      { category: 'groceries', label: 'Groceries', group: 'essentials', spent: 180.43, count: 2, share: 0.192, budget: 600 },
      { category: 'dining', label: 'Dining', group: 'lifestyle', spent: 55, count: 2, share: 0.0585, budget: 25 },
      { category: 'subscriptions', label: 'Subscriptions', group: 'lifestyle', spent: 15.49, count: 1, share: 0.0165, budget: null },
    ]);
    expect(s.by_group).toEqual([{ group: 'lifestyle', spent: 482.69 }, { group: 'uncategorized', spent: 276.39 }, { group: 'essentials', spent: 180.43 }]);
    expect(s.top_merchants.slice(0, 3)).toEqual([{ merchant: 'Delta', spent: 412.2, count: 1 }, { merchant: 'Costco Whse Seattle', spent: 212.4, count: 1 }, { merchant: 'Whole Foods', spent: 96.31, count: 1 }]);
    expect(s.series).toEqual([
      { month: '2026-08', spent: 0, income: 0, net: 0 },
      { month: '2026-09', spent: 140, income: 3200, net: 3060 },
      { month: '2026-10', spent: OCT_SPENT, income: 3200, net: Math.round((3200 - OCT_SPENT) * 100) / 100 },
    ]);
    expect(s.category_series.find((c: any) => c.category === 'groceries')).toEqual({ category: 'groceries', label: 'Groceries', spent: [0, 140, 180.43] });
    // Defaults: this month, six months. The refund nets against dining; the pending hold is left out.
    const now = await view(kevin, 'money/spending', { today: '2026-11-14' });
    expect(now).toMatchObject({ month: '2026-11', total: 90.5 });
    expect(now.months).toHaveLength(6);
    expect(now.by_category.find((c: any) => c.category === 'dining')).toMatchObject({ spent: 28, count: 2 });
  });

  it('home: cards for budgets that need attention and for a backlog of uncategorized transactions', async () => {
    const quiet = await makeKevin([money]);
    expect(await view(quiet, 'money/home', { today: '2026-11-14' })).toEqual({ cards: [] });

    const kevin = await household();
    expect(await view(kevin, 'money/home', { today: '2026-11-14' })).toEqual({ cards: [{ title: 'Budgets', lines: ['Dining: $28 of $25, over by $3'], link: '/money' }] });
    await ok(kevin, 'money_budget_update', { budgets: [{ category: 'groceries', monthly_amount: 65 }, { category: 'dining', monthly_amount: 40 }] });
    expect((await view(kevin, 'money/home', { today: '2026-11-14' })).cards[0].lines).toEqual(['Groceries: $63 of $65, $3 left', 'Dining: $28 of $40 with 47% of the month gone']);

    await ok(kevin, 'money_transactions_update', { add: Array.from({ length: 8 }, (_, i) => ({ account: 'Chase checking', date: '2026-11-08', amount: -(i + 1), description: `Mystery shop ${i}` })) });
    const cards = (await view(kevin, 'money/home', { today: '2026-11-14' })).cards;
    expect(cards[1]).toEqual({ title: 'Money', lines: ['13 transactions need a category'], link: '/money' });
    // Without an injected day the views use today in Ben's timezone and still answer.
    expect(Array.isArray((await view(kevin, 'money/home')).cards)).toBe(true);
    expect((await view(kevin, 'money/overview')).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---- what the model sees and writes ------------------------------------------------

describe('SQL a model would write', () => {
  it('answers the usual questions from the schema and the prompt note', async () => {
    const { kevin } = await withChase();
    const amex = await upload(kevin, AMEX, 'amex.csv');
    await ok(kevin, 'money_import', { attachment_id: amex, account: 'Amex Gold', create_account: { type: 'credit_card' }, commit: true });

    // "How much did I spend on dining last month?"
    expect(await rows(kevin, "SELECT ROUND(SUM(spent), 2) AS spent FROM money_spending WHERE month = '2026-10' AND category = 'dining'")).toEqual([{ spent: 55 }]);
    // The same from the base table, with the WHERE clause the note gives.
    expect(await rows(kevin, "SELECT ROUND(-SUM(amount), 2) AS spent FROM money_transactions WHERE is_transfer = 0 AND pending = 0 AND date >= '2026-10-01' AND date < '2026-11-01' AND category = 'dining'")).toEqual([{ spent: 55 }]);
    // "What did I spend in October?" Neither the card payment (seen from both accounts) nor the move to savings counts.
    expect(await rows(kevin, "SELECT ROUND(SUM(spent), 2) AS spent FROM money_spending WHERE month = '2026-10'")).toEqual([{ spent: 939.51 }]);
    expect(await rows(kevin, "SELECT ROUND(SUM(received), 2) AS income FROM money_income WHERE month = '2026-10'")).toEqual([{ income: 3200 }]);
    expect(await rows(kevin, 'SELECT a.name, t.amount, t.category FROM money_transactions t JOIN money_accounts a ON a.id = t.account_id WHERE t.is_transfer = 1 ORDER BY t.amount')).toEqual([
      { name: 'Chase checking', amount: -1000, category: 'transfer' },
      { name: 'Chase checking', amount: -500, category: 'credit_card_payment' },
      { name: 'Amex Gold', amount: 600, category: 'credit_card_payment' },
    ]);
    // "Biggest merchants this year?"
    expect(await rows(kevin, "SELECT merchant, ROUND(SUM(spent), 2) AS spent, COUNT(*) AS n FROM money_spending WHERE date >= '2026-01-01' GROUP BY merchant ORDER BY spent DESC LIMIT 3")).toEqual([
      { merchant: 'Delta', spent: 412.2, n: 1 },
      { merchant: 'Costco Whse Seattle', spent: 212.4, n: 1 },
      { merchant: 'Whole Foods', spent: 96.31, n: 1 },
    ]);
    // "Spending by category group in October?"
    expect(await rows(kevin, "SELECT category_group, ROUND(SUM(spent), 2) AS spent FROM money_spending WHERE month = '2026-10' GROUP BY category_group ORDER BY spent DESC")).toEqual([
      { category_group: 'lifestyle', spent: 482.69 },
      { category_group: 'uncategorized', spent: 276.39 },
      { category_group: 'essentials', spent: 180.43 },
    ]);
    // Writes are refused through query.
    expect((await call(kevin, 'query', { sql: 'DELETE FROM money_transactions' })).ok).toBe(false);
  });

  it('puts the commented schema and the four tools in front of the model', async () => {
    const kevin = await makeKevin([money]);
    const schema = schemaText(kevin.db);
    expect(schema).toMatch(/CREATE TABLE money_transactions/);
    expect(schema).toMatch(/SIGNED: negative = money out/);
    expect(schema).toMatch(/amount OWED as a POSITIVE number/);
    expect(schema).toMatch(/CREATE VIEW money_spending AS/);
    expect(kevin.stableSystem).toMatch(/SELECT ROUND\(SUM\(spent\), 2\) FROM money_spending WHERE month = '2026-10'/);
    const tools = kevin.tools.apiTools().filter((t) => t.name.startsWith('money_'));
    expect(tools.map((t) => t.name)).toEqual(['money_account_update', 'money_budget_update', 'money_import', 'money_transactions_update']);
    for (const t of tools) expect(t.input_schema.type).toBe('object');
    expect(tools.find((t) => t.name === 'money_import')!.input_schema).toMatchObject({ required: ['attachment_id', 'account', 'commit'] });
    // The seeds are in place and consistent.
    expect((kevin.db.prepare('SELECT COUNT(*) AS n FROM money_categories').get() as { n: number }).n).toBe(24);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_rules r LEFT JOIN money_categories c ON c.name = r.category WHERE c.name IS NULL').get()).toEqual({ n: 0 });
  });

  it('is usable from the page: writes auto-approve their confirmations', async () => {
    const { kevin, batch } = await withChase();
    const r = await call(kevin, 'money_transactions_update', { undo_import: batch }, { source: 'ui' });
    expect(r.ok).toBe(true);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM money_transactions').get()).toEqual({ n: 0 });
  });
});
