// Shapes of the money views and tool results, as server/src/domains/money.ts returns them.

export interface Account {
  id: number;
  name: string;
  institution: string | null;
  type: string;
  is_liability: boolean;
  last4: string | null;
  currency: string;
  /** Dollars. For a liability this is the amount owed, positive. Null = never set. */
  balance: number | null;
  balance_as_of: string | null;
  active: boolean;
  notes: string | null;
}

export interface AccountDetail extends Account {
  transaction_count: number;
  last_transaction_date: string | null;
  holdings_count: number;
  holdings_value: number | null;
}

export interface NetWorth { assets: number; liabilities: number; net_worth: number; as_of: string | null }

export interface AccountsView { accounts: AccountDetail[]; totals: NetWorth; account_types: string[] }

export interface Category { name: string; label: string; group: string; budget: number | null; transaction_count: number; rule_count: number }

export interface Rule { id: number; pattern: string; match_type: 'contains' | 'regex'; problem?: string | null; category: string | null; category_label: string | null; merchant: string | null; priority: number; created_at: string }

export interface CategoriesView { groups: string[]; categories: Category[]; rules: Rule[]; uncategorized_count: number }

export interface Tx {
  id: number;
  date: string;
  /** Signed: negative = money out. */
  amount: number;
  description: string;
  merchant: string;
  category: string | null;
  category_label: string | null;
  category_group: string | null;
  categorized_by: string | null;
  is_transfer: boolean;
  pending: boolean;
  notes: string | null;
  account_id: number;
  account: string;
  import_batch_id: number | null;
}

export interface TransactionsView { rows: Tx[]; total: number; sum: number; sum_in: number; sum_out: number; limit: number; offset: number }

export type BudgetStatus = 'over' | 'near' | 'fast' | 'ok';

export interface BudgetItem {
  category: string;
  label: string;
  group: string;
  monthly_amount: number;
  spent: number;
  remaining: number;
  used: number;
  pace: number | null;
  projected: number | null;
  status: BudgetStatus;
}

export interface BudgetsView {
  month: string;
  today: string;
  is_current_month: boolean;
  day_of_month: number;
  days_in_month: number;
  month_elapsed: number;
  totals: { budget: number; spent: number; remaining: number; used: number };
  counts: Record<BudgetStatus, number>;
  items: BudgetItem[];
  unbudgeted: { category: string; label: string; group: string; spent: number }[];
}

export interface CategorySpend { category: string; label: string; group: string; spent: number; count: number }

export interface OverviewView {
  today: string;
  month: string;
  net_worth: NetWorth;
  accounts: Account[];
  this_month: { month: string; spent: number; income: number; net: number; day_of_month: number; days_in_month: number };
  last_month: { month: string; spent: number; income: number; net: number; spent_by_same_day: number };
  top_categories: (CategorySpend & { budget: number | null })[];
  budgets: { totals: BudgetsView['totals']; counts: BudgetsView['counts']; month_elapsed: number; attention: BudgetItem[] };
  uncategorized_count: number;
  transaction_count: number;
  last_import: { id: number; filename: string; imported_at: string; inserted_count: number; account: string } | null;
}

export interface SpendingView {
  month: string;
  total: number;
  income: number;
  net: number;
  by_category: (CategorySpend & { share: number; budget: number | null })[];
  by_group: { group: string; spent: number }[];
  top_merchants: { merchant: string; spent: number; count: number }[];
  months: string[];
  series: { month: string; spent: number; income: number; net: number }[];
  category_series: { category: string; label: string; spent: number[] }[];
}

export interface RecurringItem {
  merchant: string;
  category: string | null;
  account: string;
  typical_amount: number;
  last_amount: number;
  cadence: 'monthly';
  occurrences: number;
  first_date: string;
  last_date: string;
  next_expected: string;
  active: boolean;
  annual_cost: number;
  transaction_ids: number[];
}

export interface RecurringView { today: string; since: string; items: RecurringItem[]; monthly_total: number; subscriptions_monthly_total: number }

export interface Position {
  id: number;
  account_id: number;
  account: string;
  symbol: string;
  name: string | null;
  asset_class: string;
  quantity: number;
  cost_basis: number | null;
  last_price: number | null;
  price_as_of: string | null;
  market_value: number;
  priced: boolean;
  gain: number | null;
  gain_pct: number | null;
  weight: number;
}

export interface HoldingsView {
  positions: Position[];
  totals: { market_value: number; cost_basis: number; gain: number; gain_pct: number | null };
  by_asset_class: { asset_class: string; market_value: number; share: number; positions: number }[];
  by_account: { account_id: number; account: string; market_value: number; cost_basis: number; gain: number; share: number; positions: number; account_balance: number | null }[];
  asset_classes: string[];
}

export interface NetWorthHistoryView {
  granularity: 'day' | 'month';
  points: { date: string; assets: number; liabilities: number; net_worth: number }[];
  change: { from: string; to: string; amount: number } | null;
  current: NetWorth;
}

export interface ImportBatch {
  id: number;
  account_id: number;
  account: string;
  attachment_id: number | null;
  filename: string;
  imported_at: string;
  row_count: number;
  inserted_count: number;
  duplicate_count: number;
  skipped_count: number;
  date_from: string | null;
  date_to: string | null;
  undone_at: string | null;
  remaining_count: number;
}

export interface ImportsView { batches: ImportBatch[] }

interface ImportCounts {
  parsed_count: number;
  new_count: number;
  duplicate_count: number;
  skipped_count: number;
  skipped: { row: number; reason: string; text?: string }[];
  date_from: string | null;
  date_to: string | null;
  total_in: number;
  total_out: number;
  uncategorized_count: number;
  transfer_count: number;
}

export interface AmountSign { applied: 'as_is' | 'invert'; decided_by: 'debit_credit_columns' | 'cr_dr_suffix' | 'type_column' | 'amount_column'; explanation: string }

export interface ImportPreview extends ImportCounts {
  committed: false;
  account: { id: number | null; name: string; type: string; will_create: boolean };
  file: { attachment_id: number; filename: string; headers: string[]; header_row: number | null };
  mapping: Partial<Record<string, string>>;
  amount_sign: AmountSign;
  ending_balance: { balance: number; date: string } | null;
  sample: { row: number; date: string; amount: number; description: string; merchant: string; category: string | null; is_transfer: boolean; pending: boolean; duplicate: boolean }[];
}

export interface ImportResult extends ImportCounts {
  committed: true;
  batch_id: number | null;
  account: { id: number; name: string; type: string; created: boolean };
  inserted: number;
  note?: string;
  amount_sign?: AmountSign;
  balance_updated?: { balance: number; as_of: string; is_current: boolean } | null;
  top_uncategorized?: { merchant: string; count: number; total: number }[];
}
