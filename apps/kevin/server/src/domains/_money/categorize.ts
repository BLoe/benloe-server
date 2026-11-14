// Categories, merchant clean-up and rules. Pure functions and seed data; the
// database work is in ../money.ts.

export const CATEGORY_GROUPS = ['essentials', 'lifestyle', 'income', 'transfers'] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

/**
 * Seeded once by the first migration (money-001), whose SQL is built from
 * this list and SEED_RULES. Editing either after that migration has run
 * changes nothing in an existing database: add a new migration instead. Ben
 * and Kevin add categories with money_budget_update.
 */
export const SEED_CATEGORIES: [name: string, label: string, group: CategoryGroup][] = [
  ['housing', 'Housing', 'essentials'],
  ['utilities', 'Utilities', 'essentials'],
  ['groceries', 'Groceries', 'essentials'],
  ['transport', 'Transport', 'essentials'],
  ['gas', 'Gas', 'essentials'],
  ['insurance', 'Insurance', 'essentials'],
  ['health', 'Health', 'essentials'],
  ['taxes', 'Taxes', 'essentials'],
  ['fees', 'Fees & interest', 'essentials'],
  ['education', 'Education', 'essentials'],
  ['dining', 'Dining', 'lifestyle'],
  ['subscriptions', 'Subscriptions', 'lifestyle'],
  ['shopping', 'Shopping', 'lifestyle'],
  ['home', 'Home & garden', 'lifestyle'],
  ['entertainment', 'Entertainment', 'lifestyle'],
  ['travel', 'Travel', 'lifestyle'],
  ['fitness', 'Fitness', 'lifestyle'],
  ['personal_care', 'Personal care', 'lifestyle'],
  ['gifts_charity', 'Gifts & charity', 'lifestyle'],
  ['other', 'Other', 'lifestyle'],
  ['income', 'Income', 'income'],
  ['interest_dividends', 'Interest & dividends', 'income'],
  ['transfer', 'Transfer', 'transfers'],
  ['credit_card_payment', 'Credit card payment', 'transfers'],
];

/**
 * Starter rules, seeded once so a first import is not a wall of uncategorized
 * rows. They are ordinary rows in money_rules: visible on the page, editable
 * and removable. Short names that occur inside other words are regexes with
 * word boundaries.
 */
export const SEED_RULES: [pattern: string, matchType: 'contains' | 'regex', category: string, merchant?: string][] = [
  // Paying a card from a bank account, seen from either side.
  ['payment thank you', 'contains', 'credit_card_payment'],
  ['payment, thank you', 'contains', 'credit_card_payment'],
  ['payment - thank you', 'contains', 'credit_card_payment'],
  ['autopay payment', 'contains', 'credit_card_payment'],
  ['credit crd epay', 'contains', 'credit_card_payment'],
  ['crcardpmt', 'contains', 'credit_card_payment'],
  ['amex epayment', 'contains', 'credit_card_payment'],
  ['discover e-payment', 'contains', 'credit_card_payment'],
  ['citi card online', 'contains', 'credit_card_payment'],
  ['applecard gsbank', 'contains', 'credit_card_payment'],
  ['online transfer', 'contains', 'transfer'],
  ['payroll', 'contains', 'income'],
  ['direct dep', 'contains', 'income'],
  ['interest paid', 'contains', 'interest_dividends'],
  ['interest payment', 'contains', 'interest_dividends'],
  ['irs treas', 'contains', 'taxes'],
  ['atm fee', 'contains', 'fees'],
  ['overdraft', 'contains', 'fees'],
  ['foreign transaction fee', 'contains', 'fees'],
  ['annual fee', 'contains', 'fees'],
  ['late fee', 'contains', 'fees'],
  ['netflix', 'contains', 'subscriptions', 'Netflix'],
  ['spotify', 'contains', 'subscriptions', 'Spotify'],
  ['\\bhulu\\b', 'regex', 'subscriptions', 'Hulu'],
  ['disney plus', 'contains', 'subscriptions', 'Disney+'],
  ['apple.com/bill', 'contains', 'subscriptions', 'Apple'],
  ['trader joe', 'contains', 'groceries', "Trader Joe's"],
  ['whole foods', 'contains', 'groceries', 'Whole Foods'],
  ['wholefds', 'contains', 'groceries', 'Whole Foods'],
  ['safeway', 'contains', 'groceries', 'Safeway'],
  ['kroger', 'contains', 'groceries', 'Kroger'],
  ['uber eats', 'contains', 'dining', 'Uber Eats'],
  ['doordash', 'contains', 'dining', 'DoorDash'],
  ['grubhub', 'contains', 'dining', 'Grubhub'],
  ['starbucks', 'contains', 'dining', 'Starbucks'],
  ['chipotle', 'contains', 'dining', 'Chipotle'],
  ['mcdonald', 'contains', 'dining', "McDonald's"],
  ['\\buber\\b', 'regex', 'transport', 'Uber'],
  ['\\blyft\\b', 'regex', 'transport', 'Lyft'],
  ['shell oil', 'contains', 'gas', 'Shell'],
  ['chevron', 'contains', 'gas', 'Chevron'],
  ['exxon', 'contains', 'gas', 'Exxon'],
  ['comcast', 'contains', 'utilities', 'Comcast'],
  ['xfinity', 'contains', 'utilities', 'Xfinity'],
  ['verizon', 'contains', 'utilities', 'Verizon'],
  ['t-mobile', 'contains', 'utilities', 'T-Mobile'],
  ['geico', 'contains', 'insurance', 'Geico'],
  ['state farm', 'contains', 'insurance', 'State Farm'],
  ['\\bcvs\\b', 'regex', 'health', 'CVS'],
  ['walgreens', 'contains', 'health', 'Walgreens'],
  ['airbnb', 'contains', 'travel', 'Airbnb'],
  ['delta air', 'contains', 'travel', 'Delta'],
  ['united air', 'contains', 'travel', 'United'],
  ['southwest air', 'contains', 'travel', 'Southwest'],
  ['planet fitness', 'contains', 'fitness', 'Planet Fitness'],
  ['peloton', 'contains', 'fitness', 'Peloton'],
];

// ---- merchant clean-up ---------------------------------------------------------------

const STATES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '),
);
const LEADING = /^(purchase authorized on|recurring payment authorized on|debit card purchase|pos purchase|pos debit|debit purchase|card purchase|visa purchase|checkcard|check card|pos)\s+(\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+)?/i;
const PROCESSOR = /^(sq|tst|sp|pp|py|paypal|ic|fsp|bt|ext)\s*\*\s*/i;

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => (w.length <= 3 && !/[aeiou]/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * A readable payee from a bank's description: card-processor prefixes, store
 * numbers, reference codes, phone numbers and a trailing state code removed.
 * "SQ *BLUE BOTTLE COFFEE #114 OAKLAND CA" -> "Blue Bottle Coffee Oakland".
 * Deterministic, so the same merchant cleans to the same text on every import.
 */
export function cleanMerchant(description: string): string {
  const original = description.replace(/\s+/g, ' ').trim();
  let s = original.replace(LEADING, '').replace(PROCESSOR, '');
  if (/^amazon prime/i.test(s)) return 'Amazon Prime';
  if (/^(amzn|amazon)\b/i.test(s)) return 'Amazon';
  s = s
    .replace(/\s+[A-Z]?\d{6,}\s+CARD\s+\d{4}$/i, '') // "S123456 CARD 9999" (Wells Fargo)
    .replace(/\s+((PPD|WEB|CCD|TEL|CO|ARC)\s+)?ID:.*$/i, '') // ACH trailers: "PPD ID: 9111111111"
    .replace(/\*\S*\d\S*/g, ' ') // *AB12CD34 reference codes
    .replace(/\*/g, ' ')
    .replace(/\b\d{3}-\d{3}-\d{4}\b.*$/, '') // phone number and what follows
    .replace(/#\s*\d+/g, ' ') // store numbers
    .replace(/\b\d{4,}\b/g, ' ') // long digit runs
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ') // embedded dates
    .replace(/\s+/g, ' ')
    .trim();
  const allCaps = s === s.toUpperCase();
  const words = s.split(' ');
  if (allCaps && words.length >= 3 && STATES.has(words[words.length - 1]!)) words.pop();
  s = words.join(' ').replace(/[\s\-,.:]+$/, '').slice(0, 48).trim();
  if (!s) return original.slice(0, 48) || '(unknown)';
  return allCaps ? titleCase(s) : s;
}

// ---- rules -----------------------------------------------------------------------

export interface Rule {
  id: number;
  pattern: string;
  match_type: 'contains' | 'regex';
  category: string | null;
  merchant: string | null;
  priority: number;
}

export interface CompiledRule extends Rule {
  test(text: string): boolean;
}

/** Throws a plain Error with a readable message when a regex pattern does not compile. */
export function compileRule(r: Rule): CompiledRule {
  if (r.match_type === 'regex') {
    let re: RegExp;
    try {
      re = new RegExp(r.pattern, 'i');
    } catch (e) {
      throw new Error(`"${r.pattern}" is not a valid regular expression: ${(e as Error).message}`);
    }
    return { ...r, test: (text) => re.test(text) };
  }
  const needle = r.pattern.toLowerCase();
  return { ...r, test: (text) => text.toLowerCase().includes(needle) };
}

/** Highest priority first, then the longest pattern (the most specific), then the oldest. */
export function orderRules(rules: Rule[]): CompiledRule[] {
  return rules
    .map((r) => {
      try {
        return compileRule(r);
      } catch {
        return null; // a stored regex that no longer compiles matches nothing
      }
    })
    .filter((r): r is CompiledRule => r !== null)
    .sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length || a.id - b.id);
}

/** The text a rule is matched against: the bank's description and the cleaned merchant. */
export const ruleText = (description: string, merchant: string) => `${description}\n${merchant}`;

export function matchRule(rules: CompiledRule[], description: string, merchant: string): CompiledRule | null {
  const text = ruleText(description, merchant);
  for (const r of rules) if (r.test(text)) return r;
  return null;
}

// ---- the bank's own category column -----------------------------------------------------

const BANK_CATEGORIES: [RegExp, string][] = [
  [/grocer|supermarket/, 'groceries'],
  [/food|restaurant|dining/, 'dining'],
  [/^gas|gasoline|fuel/, 'gas'],
  [/automotive|transportation|taxi|rideshare|parking/, 'transport'],
  [/travel|airfare|airline|lodging|hotel/, 'travel'],
  [/utilit|phone|cable|internet/, 'utilities'],
  [/health|medical|pharmac/, 'health'],
  [/entertainment/, 'entertainment'],
  [/subscription/, 'subscriptions'],
  [/shopping|merchandise|department store/, 'shopping'],
  [/^home/, 'home'],
  [/personal/, 'personal_care'],
  [/education/, 'education'],
  [/gift|donation|charit/, 'gifts_charity'],
  [/insurance/, 'insurance'],
  [/^tax/, 'taxes'],
  [/fee|interest charge/, 'fees'],
  [/paycheck|payroll|^income/, 'income'],
  [/transfer/, 'transfer'],
];

/**
 * Kevin's category for the bank's category text ("Food & Drink" -> dining),
 * used only when no rule matched. A "Payment" on a card or loan is the other
 * half of a transfer from a bank account.
 */
export function bankCategory(text: string | null, opts: { liability: boolean; amount: number }): string | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (opts.liability && opts.amount > 0 && /^payments?\b/.test(t)) return 'credit_card_payment';
  for (const [re, cat] of BANK_CATEGORIES) if (re.test(t)) return cat;
  return null;
}
