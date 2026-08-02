/* ============================================================================
   Plaid — the only module in Cabinet that talks to a bank.

   ## Why this is hand-rolled instead of `npm i plaid`
   The official SDK is a generated axios client that pulls a dependency tree in
   behind it. Cabinet needs nine endpoints. For the one integration in this
   codebase that can read Ben's entire financial history, a smaller and fully
   readable supply chain is worth more than generated types — and it matches
   how integrations/githubApp.ts already mints RS256 JWTs by hand rather than
   taking a JWT library. `fetch` and `node:crypto` are enough.

   ## The rules this module exists to hold
   - It is the ONLY file permitted to import getCredentialSecret (see the
     tripwire comment in domains/credentials.ts). Routes, tools and jobs get a
     PlaidClient instance; they never get a token.
   - No request body is ever logged. Every one of them carries client_id +
     secret, and the Item calls also carry the access token. There is a single
     `logSafe` helper and it takes an endpoint name, never a payload.
   - Errors thrown out of here carry Plaid's error_code and a display message.
     They never carry the request body, and PlaidApiError.toString() is safe to
     put in a response.

   ## Product scope — the security boundary that matters most
   Cabinet requests `transactions` and (optionally) `investments`. It does not
   request `auth`, which is what returns account and routing numbers, and it
   does not request `transfer`, which is what moves money. This is enforced
   here, at the point where consent is created, because a scope Ben never
   granted cannot be abused by a later bug, a prompt injection, or a confused
   agent. Read access to the money; no ability to touch it.
   ========================================================================== */
import type Database from 'better-sqlite3';
import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';
import { getCredentialSecret, putCredential } from '../domains/credentials.js';
import { getSetting } from '../domains/settings.js';
import {
  applyTransactionSync,
  getItem,
  markItemSynced,
  replaceHoldings,
  setConsentExpiration,
  setItemCredential,
  setItemCursor,
  setItemStatus,
  snapshotNetWorth,
  syncableItems,
  upsertAccounts,
  upsertItem,
  upsertSecurities,
  type PlaidItemRow,
  type SyncCounts,
  type TransactionInput,
} from '../domains/money.js';

/** Credential names. Lowercase slugs — CREDENTIAL_NAME_RE enforces the shape. */
export const CLIENT_ID_CRED = 'plaid-client-id';
export const SECRET_CRED = 'plaid-secret';

/**
 * Per-Item credential name, derived from the Plaid item_id.
 *
 * A hash rather than the raw id for two reasons. The credential name regex is
 * lowercase-only and Plaid item_ids are mixed case, so the raw id is not a
 * legal name. And the derivation is deterministic, which is the load-bearing
 * property: re-linking a bank returns the same item_id, so the same credential
 * row is ROTATED rather than a second live bearer token being left behind
 * under a new name with nothing pointing at it.
 */
export function itemCredentialName(itemId: string): string {
  return `plaid-item-${createHash('sha256').update(itemId).digest('hex').slice(0, 32)}`;
}

export type PlaidEnv = 'sandbox' | 'production';

/**
 * Case- and whitespace-tolerant on the way in, exact on the way out. Anything
 * unrecognised — including the 'development' environment Plaid decommissioned
 * in June 2024 — falls back to sandbox rather than reaching real bank data by
 * accident. Fail-closed is the right default here, but 'Production' silently
 * meaning sandbox would be a genuinely nasty afternoon, so normalize first.
 *
 * This is applied to the value coming out of the settings store as well as to
 * the env var. The settings layer validates writes against the enum, but this
 * function is the last line before a hostname gets built, and it is cheap.
 */
export function normalisePlaidEnv(raw: string | null | undefined): PlaidEnv {
  return raw?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
}

export function plaidEnv(env: NodeJS.ProcessEnv = process.env): PlaidEnv {
  return normalisePlaidEnv(env.PLAID_ENV);
}

export class PlaidApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
    readonly errorType: string | null,
    readonly displayMessage: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'PlaidApiError';
  }
  /** True when Ben personally has to re-authenticate at the bank. */
  get needsRelink(): boolean {
    return this.errorCode === 'ITEM_LOGIN_REQUIRED' || this.errorCode === 'PENDING_EXPIRATION';
  }
}

export class PlaidNotConfiguredError extends Error {}

interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  name: string | null;
  merchant_name: string | null;
  payment_channel: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
}

function toTransactionInput(t: PlaidTxn): TransactionInput {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    iso_currency_code: t.iso_currency_code,
    date: t.date,
    authorized_date: t.authorized_date,
    name: t.name,
    merchant_name: t.merchant_name,
    category_primary: t.personal_finance_category?.primary ?? null,
    category_detailed: t.personal_finance_category?.detailed ?? null,
    payment_channel: t.payment_channel,
    pending: t.pending,
    pending_transaction_id: t.pending_transaction_id,
  };
}

interface PlaidAccount {
  account_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  balances?: {
    current: number | null;
    available: number | null;
    limit: number | null;
    iso_currency_code: string | null;
  } | null;
}

function toAccountInput(a: PlaidAccount) {
  return {
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    current_balance: a.balances?.current ?? null,
    available_balance: a.balances?.available ?? null,
    limit_amount: a.balances?.limit ?? null,
    iso_currency_code: a.balances?.iso_currency_code ?? null,
  };
}

export interface SyncReport {
  item_id: number;
  institution: string | null;
  ok: boolean;
  accounts: number;
  transactions: SyncCounts;
  holdings: number;
  status?: string;
  error?: string;
}

export class PlaidClient {
  private jwkCache = new Map<string, Record<string, unknown>>();

  /**
   * Both overrides default to null, which means "resolve from settings on every
   * access". They are NOT snapshotted at construction, and that is the point:
   * one PlaidClient is built at boot in index.ts and lives for the life of the
   * process, so a constructor-frozen environment would mean every edit on the
   * settings page silently required a restart to take effect. A settings page
   * whose changes do nothing until you remember to restart is the same chore
   * this whole exercise exists to delete, just moved to a different screen.
   *
   * The overrides exist for tests, which want a fixed environment without a
   * settings row, and they win when supplied.
   */
  constructor(
    private readonly db: Database.Database,
    private readonly key: Buffer | null,
    private readonly envOverride: PlaidEnv | null = null,
    private readonly originOverride: string | null = null,
  ) {}

  get environment(): PlaidEnv {
    return this.envOverride ?? normalisePlaidEnv(getSetting(this.db, 'plaid.env'));
  }

  /** Public origin, for redirect_uri and the webhook. */
  get origin(): string {
    return this.originOverride ?? getSetting(this.db, 'public.origin');
  }

  private get base(): string {
    return `https://${this.environment}.plaid.com`;
  }

  /** The Link redirect landing page, and the URI that must be allow-listed in Plaid's dashboard. */
  get redirectUri(): string {
    return `${this.origin}/plaid/oauth`;
  }

  get webhookUrl(): string {
    return `${this.origin}/api/plaid/webhook`;
  }

  /**
   * True when both halves of the API credential are present and decryptable.
   * Used by routes and the UI to render "not configured yet" instead of
   * throwing — an unconfigured integration is a normal state, not an error.
   */
  configured(): boolean {
    if (!this.key) return false;
    try {
      return !!this.credentials();
    } catch {
      return false;
    }
  }

  private credentials(): { client_id: string; secret: string } | null {
    const client_id = getCredentialSecret(this.db, this.key, CLIENT_ID_CRED);
    const secret = getCredentialSecret(this.db, this.key, SECRET_CRED);
    if (!client_id || !secret) return null;
    return { client_id, secret };
  }

  /**
   * One POST to Plaid.
   *
   * The credentials are merged in HERE and nowhere else, so no caller ever
   * holds them — callers pass the interesting half of the body and this method
   * completes it. On failure the response body is parsed for Plaid's structured
   * error and re-thrown as PlaidApiError; the REQUEST body never appears in the
   * thrown message, because it contains the secret.
   */
  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const creds = this.credentials();
    if (!creds) {
      throw new PlaidNotConfiguredError(
        `Plaid is not configured: store the '${CLIENT_ID_CRED}' and '${SECRET_CRED}' credentials first.`,
      );
    }
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...creds, ...body }),
      });
    } catch (err) {
      throw new PlaidApiError(0, 'NETWORK', null, null, `Plaid ${path} unreachable: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let code: string | null = null;
      let type: string | null = null;
      let display: string | null = null;
      let msg = `Plaid ${path} failed (${res.status})`;
      try {
        const e = JSON.parse(text) as {
          error_code?: string;
          error_type?: string;
          display_message?: string;
          error_message?: string;
        };
        code = e.error_code ?? null;
        type = e.error_type ?? null;
        display = e.display_message ?? null;
        if (e.error_message) msg = `Plaid ${path}: ${e.error_message}`;
      } catch {
        // A non-JSON error body is a Plaid outage or a proxy page. Don't echo
        // it — it is unbounded and could contain anything.
      }
      throw new PlaidApiError(res.status, code, type, display, msg);
    }
    return JSON.parse(text) as T;
  }

  /* ------------------------------------------------------------ linking --- */

  /**
   * Create a Link token — the short-lived, single-use handle the browser needs
   * to open Plaid's UI.
   *
   * `products: ['transactions']` with `optional_products: ['investments']` is
   * the deliberate combination. Putting investments in the REQUIRED list would
   * filter every institution that doesn't support it out of Link's search
   * results — including, quite possibly, the credit card side of a bank — so a
   * required-investments token can silently make an institution unlinkable.
   * Optional means "grant it where it exists", which is exactly the intent.
   *
   * Passing `accessTokenFor` switches Link into UPDATE MODE: no products, just
   * a repair of an existing consent that hit ITEM_LOGIN_REQUIRED.
   */
  async createLinkToken(opts: { userId: string; itemPk?: number } = { userId: 'ben' }): Promise<string> {
    const body: Record<string, unknown> = {
      client_name: 'Cabinet',
      language: 'en',
      country_codes: ['US'],
      user: { client_user_id: opts.userId },
      webhook: this.webhookUrl,
      redirect_uri: this.redirectUri,
    };
    if (opts.itemPk) {
      const item = getItem(this.db, opts.itemPk);
      if (!item) throw new Error(`No linked institution with id ${opts.itemPk}`);
      body.access_token = this.accessToken(item);
    } else {
      body.products = ['transactions'];
      body.optional_products = ['investments'];
      // Two years is the maximum initial pull and costs nothing extra. A
      // longer history makes the first month of analysis immediately useful
      // instead of waiting for data to accumulate.
      body.transactions = { days_requested: 730 };
    }
    const r = await this.request<{ link_token: string }>('/link/token/create', body);
    return r.link_token;
  }

  /**
   * Exchange the browser's public_token for a permanent access token, seal it
   * in the credential store, and record the Item.
   *
   * Order matters and is deliberate: the Item row is written FIRST so that a
   * failure sealing the token leaves a visible row in 'error' rather than a
   * live bearer token at Plaid that Cabinet has no record of and therefore can
   * never revoke. An orphaned row is a cleanup task; an orphaned token is a
   * security problem.
   */
  async exchangePublicToken(publicToken: string): Promise<PlaidItemRow> {
    const ex = await this.request<{ access_token: string; item_id: string }>('/item/public_token/exchange', {
      public_token: publicToken,
    });
    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      const info = await this.request<{ item: { institution_id?: string | null } }>('/item/get', {
        access_token: ex.access_token,
      });
      institutionId = info.item?.institution_id ?? null;
      if (institutionId) {
        const inst = await this.request<{ institution: { name?: string } }>('/institutions/get_by_id', {
          institution_id: institutionId,
          country_codes: ['US'],
        });
        institutionName = inst.institution?.name ?? null;
      }
    } catch {
      // Cosmetic metadata only. A bank that links fine but whose display name
      // we couldn't fetch must not fail the link.
    }

    const item = upsertItem(this.db, {
      item_id: ex.item_id,
      institution_id: institutionId,
      institution_name: institutionName,
    });
    const credName = itemCredentialName(ex.item_id);
    try {
      putCredential(this.db, this.key, {
        name: credName,
        provider: 'plaid',
        description: `Plaid access token — ${institutionName ?? 'linked institution'} (${this.environment})`,
        secret: ex.access_token,
      });
      setItemCredential(this.db, item.id, credName);
    } catch (err) {
      setItemStatus(this.db, item.id, 'error', {
        code: 'TOKEN_STORE_FAILED',
        message: (err as Error).message,
      });
      throw err;
    }
    return getItem(this.db, item.id)!;
  }

  private accessToken(item: PlaidItemRow): string {
    if (!item.token_credential) {
      throw new PlaidNotConfiguredError(`Item ${item.id} has no stored access token — re-link it.`);
    }
    const token = getCredentialSecret(this.db, this.key, item.token_credential);
    if (!token) {
      throw new PlaidNotConfiguredError(`Access token for item ${item.id} is missing from the credential store.`);
    }
    return token;
  }

  /** Revoke at Plaid, then delete locally. Order matters: a local delete first would strand a live token. */
  async removeItem(itemPk: number): Promise<void> {
    const item = getItem(this.db, itemPk);
    if (!item) return;
    try {
      await this.request('/item/remove', { access_token: this.accessToken(item) });
    } catch (err) {
      // A token that is already dead at Plaid (or unreadable here) still has
      // to be removable locally, or a broken link becomes permanently
      // un-deletable from the UI.
      logSafe(`item/remove failed for item ${itemPk}, deleting locally anyway`, err);
    }
    setItemStatus(this.db, itemPk, 'revoked');
  }

  /* --------------------------------------------------------------- sync --- */

  /**
   * Pull everything for one Item: accounts, then transactions, then holdings.
   *
   * ACCOUNTS FIRST is not stylistic — financial_transaction has a foreign key
   * to financial_account, so transactions for an account we haven't inserted
   * yet get counted as `skipped` and silently lost.
   *
   * The cursor is written only after its page commits. A crash re-fetches a
   * page (harmless, every write is an upsert); the opposite ordering would
   * skip a page permanently.
   */
  async syncItem(itemPk: number): Promise<SyncReport> {
    const item = getItem(this.db, itemPk);
    if (!item) throw new Error(`No linked institution with id ${itemPk}`);
    const report: SyncReport = {
      item_id: itemPk,
      institution: item.institution_name,
      ok: false,
      accounts: 0,
      transactions: { added: 0, modified: 0, removed: 0, skipped: 0 },
      holdings: 0,
    };
    let token: string;
    try {
      token = this.accessToken(item);
    } catch (err) {
      report.error = (err as Error).message;
      report.status = 'error';
      setItemStatus(this.db, itemPk, 'error', { code: 'NO_TOKEN', message: report.error });
      return report;
    }

    try {
      let cursor = item.transactions_cursor ?? undefined;
      let hasMore = true;
      let guard = 0;
      while (hasMore) {
        // 60 pages × 500 = 30k transactions. A real ceiling rather than
        // while(true): a cursor bug that never advances would otherwise spin
        // against Plaid forever.
        if (guard++ > 60) {
          logSafe(`transactions/sync page guard hit for item ${itemPk}`, null);
          break;
        }
        const page = await this.request<{
          accounts?: PlaidAccount[];
          added: PlaidTxn[];
          modified: PlaidTxn[];
          removed: { transaction_id: string }[];
          next_cursor: string;
          has_more: boolean;
        }>('/transactions/sync', {
          access_token: token,
          ...(cursor ? { cursor } : {}),
          count: 500,
        });

        if (page.accounts?.length) {
          report.accounts = upsertAccounts(this.db, itemPk, page.accounts.map(toAccountInput));
        }
        const counts = applyTransactionSync(this.db, {
          added: page.added.map(toTransactionInput),
          modified: page.modified.map(toTransactionInput),
          removed: page.removed.map((r) => r.transaction_id),
        });
        report.transactions.added += counts.added;
        report.transactions.modified += counts.modified;
        report.transactions.removed += counts.removed;
        report.transactions.skipped += counts.skipped;

        setItemCursor(this.db, itemPk, page.next_cursor);
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }

      // Investments are best-effort: most institutions don't support the
      // product, and a checking-only bank returning PRODUCTS_NOT_SUPPORTED
      // must not fail the transaction sync that already succeeded.
      try {
        report.holdings = await this.syncHoldings(itemPk, token);
      } catch (err) {
        if (!(err instanceof PlaidApiError) || err.errorType !== 'INVALID_REQUEST') {
          logSafe(`investments/holdings/get skipped for item ${itemPk}`, err);
        }
      }

      markItemSynced(this.db, itemPk);
      setItemStatus(this.db, itemPk, 'active');
      report.ok = true;
      report.status = 'active';
      return report;
    } catch (err) {
      const status = err instanceof PlaidApiError && err.needsRelink ? 'login_required' : 'error';
      const code = err instanceof PlaidApiError ? err.errorCode : 'UNKNOWN';
      report.error = (err as Error).message;
      report.status = status;
      setItemStatus(this.db, itemPk, status, { code, message: report.error });
      return report;
    }
  }

  private async syncHoldings(itemPk: number, token: string): Promise<number> {
    const r = await this.request<{
      accounts: PlaidAccount[];
      holdings: {
        account_id: string;
        security_id: string;
        quantity: number | null;
        cost_basis: number | null;
        institution_price: number | null;
        institution_price_as_of: string | null;
        institution_value: number | null;
        iso_currency_code: string | null;
      }[];
      securities: {
        security_id: string;
        name: string | null;
        ticker_symbol: string | null;
        type: string | null;
        close_price: number | null;
        close_price_as_of: string | null;
        iso_currency_code: string | null;
        is_cash_equivalent: boolean | null;
      }[];
    }>('/investments/holdings/get', { access_token: token });

    upsertAccounts(this.db, itemPk, r.accounts.map(toAccountInput));
    upsertSecurities(
      this.db,
      r.securities.map((s) => ({ ...s, is_cash_equivalent: !!s.is_cash_equivalent })),
    );
    return replaceHoldings(
      this.db,
      r.accounts.map((a) => a.account_id),
      r.holdings,
    );
  }

  /** Sync every healthy Item, then write the day's net-worth row. */
  async syncAll(): Promise<{ reports: SyncReport[]; net_worth: unknown }> {
    const reports: SyncReport[] = [];
    for (const item of syncableItems(this.db)) {
      reports.push(await this.syncItem(item.id));
      const fresh = getItem(this.db, item.id);
      if (fresh?.consent_expiration_time === null) {
        try {
          const info = await this.request<{ item: { consent_expiration_time?: string | null } }>('/item/get', {
            access_token: this.accessToken(item),
          });
          setConsentExpiration(this.db, item.id, info.item?.consent_expiration_time ?? null);
        } catch {
          /* consent metadata is advisory; never fail a sync over it */
        }
      }
    }
    return { reports, net_worth: snapshotNetWorth(this.db) };
  }

  /**
   * Institution search — the cheap, definitive answer to "can Plaid actually
   * reach UBS?", which no amount of documentation reading resolves.
   */
  async searchInstitutions(query: string, products: string[] = []): Promise<{ institution_id: string; name: string; products?: string[] }[]> {
    const r = await this.request<{ institutions: { institution_id: string; name: string; products?: string[] }[] }>(
      '/institutions/search',
      {
        query,
        country_codes: ['US'],
        ...(products.length ? { products } : {}),
        options: { include_optional_metadata: true },
      },
    );
    return r.institutions ?? [];
  }

  /* ------------------------------------------------------------ webhook --- */

  /**
   * Verify a Plaid webhook: ES256 JWT in the Plaid-Verification header, whose
   * payload commits to a SHA-256 of the request body.
   *
   * Three checks, all required, none skippable:
   *   1. the signature verifies against Plaid's published key for that `kid`
   *   2. `iat` is within five minutes (replay window)
   *   3. sha256(raw body) matches the payload's request_body_sha256
   *
   * (3) is why the route must hand this the RAW bytes. Re-serializing a parsed
   * JSON body changes the whitespace and the hash will never match — the
   * classic way this check gets "fixed" by disabling it.
   *
   * `alg` is pinned to ES256 rather than read from the header, which closes
   * the alg-confusion attack where an attacker sets alg=none or alg=HS256 and
   * signs with the public key as an HMAC secret.
   */
  async verifyWebhook(rawBody: Buffer, verificationHeader: string | undefined): Promise<boolean> {
    if (!verificationHeader) return false;
    const parts = verificationHeader.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      return false;
    }
    if (header.alg !== 'ES256' || !header.kid) return false;

    let jwk = this.jwkCache.get(header.kid);
    if (!jwk) {
      try {
        const r = await this.request<{ key: Record<string, unknown> }>('/webhook_verification_key/get', {
          key_id: header.kid,
        });
        jwk = r.key;
        this.jwkCache.set(header.kid, jwk);
      } catch (err) {
        logSafe('webhook_verification_key/get failed', err);
        return false;
      }
    }

    let publicKey;
    try {
      publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
    } catch {
      return false;
    }

    const signature = Buffer.from(sigB64, 'base64url');
    // ieee-p1363: JWS packs ES256 signatures as raw r||s, not the DER encoding
    // node:crypto assumes by default. Without this the verify silently fails
    // for every legitimate webhook.
    const signatureOk = cryptoVerify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    if (!signatureOk) return false;

    let payload: { iat?: number; request_body_sha256?: string };
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return false;
    }
    if (typeof payload.iat !== 'number' || Math.abs(Date.now() / 1000 - payload.iat) > 300) return false;

    const expected = Buffer.from(payload.request_body_sha256 ?? '', 'utf8');
    const actual = Buffer.from(createHash('sha256').update(rawBody).digest('hex'), 'utf8');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  /**
   * Act on a verified webhook. Returns what it did, for the audit line.
   *
   * Only two webhook types earn a reaction. SYNC_UPDATES_AVAILABLE means new
   * transactions are waiting, which is the entire reason to have a webhook —
   * it turns "up to 24 hours stale" into "current within a minute". The ERROR
   * and PENDING_EXPIRATION types are how Plaid reports that a link has died,
   * which Cabinet would otherwise only discover on the next nightly sync.
   */
  async handleWebhook(body: {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    error?: { error_code?: string; error_message?: string };
  }): Promise<string> {
    const { webhook_type: type, webhook_code: code, item_id: itemId } = body;
    if (!itemId) return 'ignored: no item_id';
    const item = this.db.prepare('SELECT id FROM plaid_item WHERE item_id = ?').get(itemId) as
      | { id: number }
      | undefined;
    if (!item) return 'ignored: unknown item';

    if (type === 'TRANSACTIONS' && (code === 'SYNC_UPDATES_AVAILABLE' || code === 'DEFAULT_UPDATE')) {
      const r = await this.syncItem(item.id);
      snapshotNetWorth(this.db);
      return `synced item ${item.id}: +${r.transactions.added}/~${r.transactions.modified}/-${r.transactions.removed}`;
    }
    if (type === 'HOLDINGS' && code === 'DEFAULT_UPDATE') {
      const r = await this.syncItem(item.id);
      return `synced holdings for item ${item.id}: ${r.holdings}`;
    }
    if (code === 'ERROR' || code === 'PENDING_EXPIRATION' || code === 'USER_PERMISSION_REVOKED') {
      const status = body.error?.error_code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error';
      setItemStatus(this.db, item.id, code === 'PENDING_EXPIRATION' ? 'login_required' : status, {
        code: body.error?.error_code ?? code,
        message: body.error?.error_message ?? code,
      });
      return `item ${item.id} marked ${status}`;
    }
    return `ignored: ${type}/${code}`;
  }
}

/** Log an operational event. Takes a message and an error — never a payload. */
function logSafe(message: string, err: unknown): void {
  if (err instanceof PlaidApiError) {
    console.error('plaid: %s (%s %s)', message, err.status, err.errorCode ?? 'no-code');
  } else if (err) {
    console.error('plaid: %s: %s', message, err instanceof Error ? err.message : String(err));
  } else {
    console.error('plaid: %s', message);
  }
}
