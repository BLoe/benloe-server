-- Money: linked financial institutions, accounts, transactions, holdings (2026-08-02).
--
-- This is the storage half of the Plaid integration. The other half — the
-- access tokens — is deliberately NOT here. Read that sentence twice, because
-- it is the single most important fact about this schema.
--
-- ## Where the secrets are, and why they aren't in this file
-- Every linked institution ("Item" in Plaid's vocabulary) is controlled by one
-- long-lived bearer token. Anyone holding that token plus the client_id and
-- secret can read Ben's entire transaction history until it is explicitly
-- revoked. It is exactly the class of material migration 016 built the
-- `credential` table for, so that is where it goes: AES-256-GCM, key in
-- CABINET_CRED_KEY which this process cannot read back, blacklisted from the
-- agent's query_db tool, preserved across wipes.
--
-- `plaid_item.token_credential` therefore holds a NAME, not a token — the
-- lookup key into that table. The name is derived deterministically from the
-- Plaid item_id (see integrations/plaid.ts), which matters more than it looks:
-- re-linking the same bank after a password change returns the SAME item_id,
-- so the credential name is stable and the write becomes a rotation of the old
-- token rather than an orphaned second copy of a live bearer credential.
--
-- The consequence to hold onto: this schema is safe to SELECT * from. Nothing
-- in these tables is a credential. That is why none of them join the FORBIDDEN
-- list in db/index.ts — Cabinet is *supposed* to read Ben's spending; being
-- unable to query it would defeat the entire point of building it.
--
-- ## Read-only by construction
-- Cabinet requests exactly two Plaid products: `transactions` and
-- `investments`. Not `auth` (which returns account and routing numbers), not
-- `identity`, and categorically not `transfer`. There is no column below for a
-- routing number because Cabinet never asks for one and must never be able to
-- store one. Cabinet can see the money and cannot move it, and that boundary
-- is enforced at the point of consent, not by policy in a prompt.
--
-- ## The amount sign convention, stated once
-- Plaid reports `amount` as POSITIVE when money leaves the account and
-- NEGATIVE when it arrives. This is the reverse of what most people expect and
-- it is the #1 source of silent sign-flip bugs in personal finance code. The
-- raw Plaid value is stored verbatim in `financial_transaction.amount` — no
-- normalization at the storage layer, because a stored value that disagrees
-- with the upstream API is a debugging trap. Every read that needs human
-- semantics goes through domains/money.ts, which does the negation in one
-- audited place and names it.

-- ============================================================================
-- Superseding the speculative money schema from migration 001.
-- ============================================================================
-- 001_init.sql sketched a money domain before there was any integration to
-- fill it: `account`, `transaction_row`, and `holding`. They were written
-- against a hand-rolled CSV importer, and none of them survives contact with
-- Plaid's actual model — no Item concept, no sync cursor, no pending flag, no
-- account balances, no security_id, and `holding` keyed by a bare ticker
-- string with no securities table behind it.
--
-- They are empty in production (verified 2026-08-02, 0 rows each) but they are
-- NOT unused code: `transaction_row` backs the live Money card in
-- gateway/surfaces.ts, and `domains/misc.ts` imports CSVs into it. Both are
-- migrated onto the tables below in the same commit as this file. (An earlier
-- draft of this comment called them unreferenced dead schema. That was wrong,
-- and the test suite caught it — recorded here because the next person to read
-- this file deserves the accurate version.)
--
-- The reason they're dropped rather than left alongside: two overlapping money
-- schemas, one live and one empty, with `holding` colliding outright, is a
-- guaranteed future bug. The agent's query_db tool would happily SELECT from
-- the empty one and report that Ben has no transactions. A dead table that
-- answers queries is worse than no table.
--
-- The sign convention is the sharp edge in that migration and is worth naming:
-- surfaces.ts treated POSITIVE as money IN. Plaid means the opposite. Every
-- reader moved in this commit had to be re-derived, not just re-pointed, and
-- they now all go through domains/money.ts so there is exactly one place where
-- the convention is applied.
--
-- `budget` and `subscription` are deliberately NOT dropped. They're equally
-- speculative, but nothing here supersedes them, and deleting design intent
-- for a domain this migration doesn't build would be scope creep pointed
-- backwards. `budget` keeps working — its spend figure is now computed from
-- financial_transaction with the correct sign.
DROP INDEX IF EXISTS idx_txn_posted;
DROP TABLE IF EXISTS transaction_row;
DROP TABLE IF EXISTS holding;
DROP TABLE IF EXISTS account;

-- ============================================================================
-- plaid_item — one row per linked institution login.
-- ============================================================================
CREATE TABLE plaid_item (
  id INTEGER PRIMARY KEY,
  -- Plaid's opaque identifier for this Item. Not a secret (useless without the
  -- access token AND the client credentials), but it is the stable join key
  -- back to Plaid and the seed for the credential name.
  item_id TEXT NOT NULL UNIQUE,
  institution_id TEXT,
  institution_name TEXT,
  -- The NAME of the credential row holding this Item's access token. Never the
  -- token. Nullable only for the brief window between inserting the row and
  -- sealing the token; a row that stays NULL here is a failed link and is
  -- reported as status='error'.
  token_credential TEXT,
  -- 'active'        — healthy, syncing
  -- 'login_required'— Plaid's ITEM_LOGIN_REQUIRED; the bank needs Ben to
  --                   re-authenticate. Recoverable via Link in update mode.
  -- 'error'         — anything else Plaid told us about this Item
  -- 'revoked'       — we removed it at Plaid; kept for history, never synced
  status TEXT NOT NULL DEFAULT 'active',
  error_code TEXT,
  error_message TEXT,
  -- Some institutions (and all of Europe's) expire consent on a fixed date.
  -- Storing it lets Cabinet warn BEFORE the sync starts failing rather than
  -- explaining a gap afterwards.
  consent_expiration_time TEXT,
  -- The /transactions/sync cursor. This is what makes syncing incremental and
  -- idempotent: hand it back and Plaid returns only what changed since. NULL
  -- means "never synced", which triggers the initial full backfill.
  --
  -- It is updated ONLY after the page it describes has been committed, so a
  -- crash mid-sync re-fetches a page instead of skipping one. Losing this
  -- column is recoverable (re-sync from scratch); advancing it too early is
  -- not (a permanently missing window of transactions).
  transactions_cursor TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- financial_account — one row per account inside an Item (checking, card, …).
-- ============================================================================
CREATE TABLE financial_account (
  id INTEGER PRIMARY KEY,
  -- NULL means this account did not come from Plaid. That is a supported,
  -- first-class case, not a loophole: if Plaid cannot reach UBS (unresolved as
  -- of 2026-08-02 — answered definitively by one /institutions/search call once
  -- keys exist), statements get imported by CSV instead, and those balances
  -- must land in the SAME tables or net worth silently omits the investment
  -- accounts and reports a number that is wrong by six figures.
  item_pk INTEGER REFERENCES plaid_item(id) ON DELETE CASCADE,
  -- Plaid's account_id where there is one; for manual accounts, a generated
  -- 'manual:<slug>' key. Unique either way, which is what makes CSV re-import
  -- idempotent rather than duplicating an account per file.
  account_id TEXT NOT NULL UNIQUE,
  -- 'plaid' | 'manual'. Provenance travels with the row so the UI can mark a
  -- hand-imported balance as hand-imported, and so a stale manual account is
  -- never mistaken for one a bank is actively refreshing.
  source TEXT NOT NULL DEFAULT 'plaid',
  name TEXT,
  official_name TEXT,
  -- Last 2-4 digits. This is the whole account number Cabinet ever sees, and
  -- deliberately so — it is enough to tell two cards apart and useless to a
  -- thief. The full number would arrive only with the `auth` product, which
  -- Cabinet does not request.
  mask TEXT,
  -- Plaid taxonomy: depository | credit | loan | investment | brokerage | other
  type TEXT,
  -- checking | savings | credit card | 401k | ira | brokerage | …
  subtype TEXT,
  -- Balances are a SNAPSHOT, not a ledger. `balance_as_of` is when Plaid last
  -- refreshed them; a stale balance presented as current is how a budgeting
  -- tool tells a confident lie, so the timestamp travels with the number
  -- everywhere and the UI renders it.
  current_balance REAL,
  available_balance REAL,
  -- Credit limit for cards; loan principal for loans. Enables utilisation math.
  limit_amount REAL,
  iso_currency_code TEXT,
  balance_as_of TEXT,
  -- Ben can hide an account from rollups without unlinking it (a joint account,
  -- an old card). Soft, reversible, and it keeps the raw data intact.
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_financial_account_item ON financial_account(item_pk);

-- ============================================================================
-- financial_transaction — the spending record.
-- ============================================================================
CREATE TABLE financial_transaction (
  id INTEGER PRIMARY KEY,
  account_pk INTEGER NOT NULL REFERENCES financial_account(id) ON DELETE CASCADE,
  -- Plaid's transaction_id, or for CSV rows a content hash of the line. Unique
  -- in both cases, which is what makes re-importing the same statement a no-op
  -- instead of a duplicate month.
  transaction_id TEXT NOT NULL UNIQUE,
  -- 'plaid' | 'csv' | 'manual'.
  source TEXT NOT NULL DEFAULT 'plaid',
  -- POSITIVE = money out. See the header. Do not "fix" this.
  --
  -- CSV importers MUST normalize to this convention at the point of import
  -- (domains/money.ts), because most bank exports use the opposite one. The
  -- convention is enforced here, once, rather than negotiated per reader.
  amount REAL NOT NULL,
  iso_currency_code TEXT,
  -- 'YYYY-MM-DD', already local to the account. Deliberately the same shape as
  -- local_day everywhere else in Cabinet so a transaction can be joined
  -- straight onto a food log, a craving event, or a training day without a
  -- timezone conversion in the query. That join is the entire reason money
  -- lives in the same database as everything else: "the $47 Grubhub orders
  -- land on skipped-snack days" is a query, not a hunch.
  date TEXT NOT NULL,
  authorized_date TEXT,
  name TEXT,
  merchant_name TEXT,
  -- Plaid's personal_finance_category. Two levels: primary is the coarse
  -- bucket (FOOD_AND_DRINK), detailed is the leaf (FOOD_AND_DRINK_FAST_FOOD).
  -- Both stored — the coarse one for rollups, the leaf because the leaf is
  -- where the behaviourally interesting distinction lives (groceries vs
  -- delivery is invisible at the primary level and is the whole question).
  category_primary TEXT,
  category_detailed TEXT,
  payment_channel TEXT,
  -- Pending transactions are provisional: the amount can change and the id is
  -- replaced by a settled one. Kept (they are the freshest signal available on
  -- the day of a spend) but flagged, so a rollup can choose.
  pending INTEGER NOT NULL DEFAULT 0,
  -- When a pending transaction settles, Plaid points the new row back at the
  -- old id. Without this the same purchase double-counts for a few days.
  pending_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_financial_transaction_date ON financial_transaction(date);
CREATE INDEX idx_financial_transaction_account ON financial_transaction(account_pk, date);
CREATE INDEX idx_financial_transaction_category ON financial_transaction(category_primary, date);
CREATE INDEX idx_financial_transaction_pending ON financial_transaction(pending_transaction_id);

-- ============================================================================
-- security / holding — the investments half.
-- ============================================================================
-- Securities are shared across accounts and across institutions, so they get
-- their own table rather than being denormalized onto each holding. One AAPL
-- row, many holdings pointing at it.
CREATE TABLE security (
  id INTEGER PRIMARY KEY,
  security_id TEXT NOT NULL UNIQUE,
  name TEXT,
  ticker_symbol TEXT,
  -- equity | etf | mutual fund | fixed income | cash | derivative | other
  type TEXT,
  close_price REAL,
  close_price_as_of TEXT,
  iso_currency_code TEXT,
  -- Money-market and sweep positions. Flagged because counting them as
  -- "investments" overstates market exposure — they are cash wearing a ticker.
  is_cash_equivalent INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A holding is a CURRENT POSITION, not an event: one row per (account,
-- security), overwritten on every sync. There is no history here on purpose —
-- position history is derivable from investment transactions if it is ever
-- wanted, and a table that appends a full portfolio snapshot nightly would be
-- 99% duplicate rows within a month.
CREATE TABLE holding (
  id INTEGER PRIMARY KEY,
  account_pk INTEGER NOT NULL REFERENCES financial_account(id) ON DELETE CASCADE,
  security_pk INTEGER NOT NULL REFERENCES security(id) ON DELETE CASCADE,
  quantity REAL,
  cost_basis REAL,
  institution_price REAL,
  institution_price_as_of TEXT,
  institution_value REAL,
  iso_currency_code TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_pk, security_pk)
);
CREATE INDEX idx_holding_account ON holding(account_pk);

-- ============================================================================
-- net_worth_snapshot — the one thing that IS worth appending nightly.
-- ============================================================================
-- Balances get overwritten in place, which means without this table Cabinet
-- could answer "what do you have?" but never "which way is it going?" — and
-- the trend is the part that changes behaviour. One small row per day, written
-- by the nightly sync, is the cheapest possible way to make the money domain
-- work the way the weight domain already does: a line, not a number.
CREATE TABLE net_worth_snapshot (
  id INTEGER PRIMARY KEY,
  local_day TEXT NOT NULL UNIQUE,
  cash REAL NOT NULL DEFAULT 0,
  -- Stored POSITIVE (the amount owed). Net worth subtracts it.
  credit REAL NOT NULL DEFAULT 0,
  investments REAL NOT NULL DEFAULT 0,
  loans REAL NOT NULL DEFAULT 0,
  net_worth REAL NOT NULL DEFAULT 0,
  -- How many accounts actually reported. A net worth computed from 2 of 5
  -- accounts because three were in login_required is not a net worth, and this
  -- column is what lets a reader tell the difference instead of seeing a
  -- cliff in the chart and believing it.
  accounts_counted INTEGER NOT NULL DEFAULT 0,
  accounts_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
