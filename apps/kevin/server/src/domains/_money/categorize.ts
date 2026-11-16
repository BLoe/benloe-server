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

/** A rule's regex is matched against at most this much of a transaction's text. */
const REGEX_TEXT_CHARS = 200;
/** A regex rule that takes longer than this on one transaction is switched off (see compileRule). */
export const SLOW_RULE_MS = 100;
const slowPatterns = new Set<string>();

/**
 * Refuses a pattern that could take the regex engine a very long time. Rule patterns can be written by
 * the model, they run on the server's one thread against every imported transaction, and JavaScript
 * has no way to stop a match that has started: "(a+)+b" against thirty characters runs for a minute.
 *
 * What is refused is what makes matching time explode, not what is merely unusual:
 *   - a repeated group that itself contains a repeat or an alternative, such as (a+)+ or (a|ab)*;
 *   - back-references and look-around;
 *   - more than one repeat (*, +, {n,m}), more than four optional parts (?), or more than one
 *     optional group with a repeat or an alternative inside it: each further one multiplies the worst case;
 *   - patterns longer than 200 characters.
 * This is a screen, not a proof. compileRule adds the backstop: the text is capped at
 * REGEX_TEXT_CHARS, and a rule whose match ever takes longer than SLOW_RULE_MS is switched off.
 * Throws a plain Error that says which rule was broken.
 */
export function assertSafeRegex(pattern: string): void {
  const no = (why: string): never => {
    throw new Error(`"${pattern}" cannot be used as a rule: ${why}. Use a simpler pattern, or a "contains" rule.`);
  };
  if (pattern.length > 200) no('it is longer than 200 characters');
  let repeats = 0;
  let optionals = 0;
  let optionalChoices = 0;
  /** One entry per open group: does it contain a repeat or an alternative? */
  const groups: boolean[] = [];
  const markComplex = () => {
    if (groups.length) groups[groups.length - 1] = true;
  };
  /** Reads a quantifier at `i`, if there is one. */
  const quantifierAt = (i: number): { kind: 'repeat' | 'optional'; end: number } | null => {
    const c = pattern[i];
    let end = i;
    let kind: 'repeat' | 'optional';
    if (c === '*' || c === '+') kind = 'repeat';
    else if (c === '?') kind = 'optional';
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
      if (!m) return null; // a literal brace
      // {1} and {0,1} repeat nothing; everything else in braces is a repeat.
      kind = (m[2] === undefined && m[1] === '1') || (m[1] === '0' && m[3] === '1') ? 'optional' : 'repeat';
      end = i + m[0].length - 1;
    } else return null;
    if (pattern[end + 1] === '?') end++; // lazy
    return { kind, end };
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      if (/[1-9]/.test(next) || next === 'k') no('it uses a back-reference');
      i++;
    } else if (c === '[') {
      // Skip the character class: nothing inside it repeats.
      i++;
      if (pattern[i] === '^') i++;
      if (pattern[i] === ']') i++;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
    } else if (c === '(') {
      if (/^\(\?<?[=!]/.test(pattern.slice(i))) no('it uses look-ahead or look-behind');
      groups.push(false);
      // "(?:" and "(?<name>" open a group; their "?" is not an optional part.
      const prefix = /^\((\?:|\?<[^>]*>)/.exec(pattern.slice(i));
      if (prefix) i += prefix[0].length - 1;
    } else if (c === ')') {
      const complex = groups.pop() ?? false;
      const q = quantifierAt(i + 1);
      if (q?.kind === 'repeat' && complex) no('it repeats a group that already contains a repeat or an alternative');
      if (q?.kind === 'optional' && complex && ++optionalChoices > 1) no('it has more than one optional group that contains a repeat or an alternative');
      // Seen from outside, a group that held a repeat still does.
      if (complex) markComplex();
    } else if (c === '|') {
      markComplex();
    } else {
      const q = quantifierAt(i);
      if (q) {
        if (q.kind === 'repeat') {
          repeats++;
          markComplex();
        } else optionals++;
        i = q.end;
      }
    }
  }
  if (repeats > 1) no('it has more than one repeat (*, + or {n,m})');
  if (optionals > 4) no('it has more than four optional parts (?)');
}

/** Throws a plain Error with a readable message when a regex pattern does not compile or is refused by assertSafeRegex. */
export function compileRule(r: Rule): CompiledRule {
  if (r.match_type === 'regex') {
    assertSafeRegex(r.pattern);
    let re: RegExp;
    try {
      re = new RegExp(r.pattern, 'i');
    } catch (e) {
      throw new Error(`"${r.pattern}" is not a valid regular expression: ${(e as Error).message}`);
    }
    return {
      ...r,
      test: (text) => {
        if (slowPatterns.has(r.pattern)) return false;
        const started = performance.now();
        const hit = re.test(text.length > REGEX_TEXT_CHARS ? text.slice(0, REGEX_TEXT_CHARS) : text);
        if (performance.now() - started > SLOW_RULE_MS) {
          // A match cannot be interrupted, but it can be the last slow one: the pattern matches nothing
          // from here on, until the server restarts or the rule is rewritten.
          slowPatterns.add(r.pattern);
          console.error(`money rule ${r.id} ("${r.pattern}") took more than ${SLOW_RULE_MS} ms on one transaction and is switched off`);
        }
        return hit;
      },
    };
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
      } catch (e) {
        // A stored rule that cannot be used (it no longer compiles, or it predates the safety check) matches nothing.
        console.error(`money rule ${r.id} is skipped: ${(e as Error).message}`);
        return null;
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
