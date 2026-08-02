/* ============================================================================
   Plaid — the only module in Cabinet that talks to a bank.

   ## Why this is hand-rolled instead of `npm i plaid`
   The official SDK is a generated axios client that pulls a dependency tree in
   behind it. Cabinet needs nine endpoints. For the one integration in this
   codebase that can read Ben's entire financial history, a smaller and fully
   readable supply chain is worth more than generated types — and it matches
   how integrations/githubApp.ts already mints RS256 JWTs by hand rather than
   taking a JWT library. `fetch` and `node:crypto` are enough.

   ## This module no longer holds credentials (2026-08-02)
   It used to decrypt `plaid-client-id`, `plaid-secret` and every per-item
   access token in-process, and it was the only file permitted to import
   getCredentialSecret. That rule was enforced by a comment, in source this
   agent can edit — which is exactly the class of protection the August audit
   found to be decorative.

   Credentials now live in `cabinet-secrets`, a separate uid with a root-owned
   code tree, and are reached over a unix socket. Cabinet sends "POST
   /transactions/sync for the item whose token is filed under
   plaid-item-<n>"; the broker injects client_id, secret and access_token and
   makes the call. There is no endpoint that returns a secret.

   What that does and does not buy is worth stating exactly, because the
   overstated version is how this rots (docs/SECRETS.md says the same):
   Cabinet can still CAUSE any Plaid call the broker allows — no architecture
   prevents that. What it cannot do is hold, log, transcribe or retain the key
   material, and every use is recorded outside its reach.

   ## The rules this module still holds
   - No request body is ever logged. There is a single `logSafe` helper and it
     takes an endpoint name, never a payload.
   - Errors thrown out of here carry Plaid's error_code and a display message.
     They never carry the request body, and PlaidApiError.toString() is safe to
     put in a response.
   - Every path this file calls must appear in PLAID_PATHS below, which
     test/plaid-broker-contract.test.ts checks against the broker's own
     allowlist. A path the broker refuses is a 403 at runtime; the contract
     test turns that into a failing build instead.

   ## Product scope — the security boundary that matters most
   Cabinet requests `transactions` and (optionally) `investments`. It does not
   request `auth`, which is what returns account and routing numbers, and it
   does not request `transfer`, which is what moves money. This is enforced
   here, at the point where consent is created, because a scope Ben never
   granted cannot be abused by a later bug, a prompt injection, or a confused
   agent. Read access to the money; no ability to touch it.
   ========================================================================== */
import type Database from 'better-sqlite3';
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';
import { SecretsBrokerClient, BrokerTransportError } from './brokerClient.js';
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
 * Every Plaid path this module drives, and whether it carries an item token.
 *
 * This exists to be CHECKED, not to be read. The broker keeps its own
 * allowlist, and a path missing from it is a 403 at runtime — discovered when
 * Ben clicks something, weeks after the code shipped. Exporting the manifest
 * lets test/plaid-broker-contract.test.ts diff it against the broker's source
 * and fail the build instead. That test is the reason two blockers in this
 * migration were found before a line of it ran.
 *
 *   'none'     — never send accessTokenCredential; the broker refuses it
 *   'required' — must send it; the broker refuses the call without one
 *   'optional' — Link update mode sends one, Link create mode does not
 */
export const PLAID_PATHS = {
  '/link/token/create': 'optional',
  '/item/get': 'required',
  '/item/remove': 'required',
  '/transactions/sync': 'required',
  '/investments/holdings/get': 'required',
  '/institutions/get_by_id': 'none',
  '/institutions/search': 'none',
  '/webhook_verification_key/get': 'none',
} as const satisfies Record<string, 'none' | 'required' | 'optional'>;

export type PlaidPath = keyof typeof PLAID_PATHS;

/**
 * Per-Item credential name.
 *
 * RANDOM, not derived — and the change from a hash of item_id is forced by the
 * broker's shape rather than chosen. The broker's exchange takes the credential
 * name as INPUT and returns item_id as OUTPUT, deliberately: it never hands
 * back the token, so it must be told where to file it before it has anything to
 * file. There is therefore nothing item-specific to derive a name from at the
 * moment the name is needed.
 *
 * The two derivable candidates were both worse. institution_id is available
 * from Link's onSuccess metadata, but Ben's BofA checking and BofA credit card
 * can be two Items under one institution_id, so the second link would silently
 * overwrite the first's token — a collision that breaks a working item with no
 * error. And a browser-supplied value deciding which credential row gets
 * overwritten is a poor thing to trust regardless.
 *
 * What determinism used to buy — a re-link rotating in place rather than
 * stranding a live token — is now handled by reconciliation in
 * exchangePublicToken, which detects a superseded credential and names it, and
 * by the plaid_item row remaining the only pointer. Note that Cabinet cannot
 * delete a broker credential at all (there is no such endpoint by design), so
 * an orphan is cleaned up by Ben in the dashboard either way; determinism would
 * not have avoided that.
 */
export function newItemCredentialName(): string {
  return `plaid-item-${randomBytes(16).toString('hex')}`;
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

/** Where Ben manages Plaid credentials. Cabinet cannot store them (docs/SECRETS.md). */
export const SECRETS_DASHBOARD = 'https://secrets.benloe.com';

/**
 * Pull the broker's short `{error}` string out of a reply, defensively.
 *
 * The broker writes these itself and never echoes an upstream body into one
 * (see its `fail()`), so they are safe to surface. A body that is any other
 * shape gets a fixed string rather than a JSON.stringify — the reason is the
 * whole point of the seam: an unbounded body from a socket that is not the
 * broker must never be pasted into an error that lands in a log or a chat.
 */
function brokerError(body: unknown): string {
  const msg = (body as { error?: unknown } | null)?.error;
  return typeof msg === 'string' && msg.length <= 300 ? msg : 'no detail';
}

/**
 * The credential NAME for an item — everything Cabinet is allowed to know
 * about its access token, and everything the broker needs.
 *
 * This replaces the old `accessToken(item)`, and the diff is the migration in
 * miniature: that method decrypted and returned a live bearer token, this one
 * returns a string that is useless to anyone who is not on the other side of
 * the broker socket.
 */
function itemCredential(item: PlaidItemRow): string {
  if (!item.token_credential) {
    throw new PlaidNotConfiguredError(`Item ${item.id} has no stored access token — re-link it.`);
  }
  return item.token_credential;
}

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

/**
 * What the broker last said about itself.
 *
 * `state` separates the three answers that all render as "Plaid isn't working"
 * but need different people to fix them:
 *   'ready'        — credentials stored; calls will go through
 *   'unconfigured' — broker healthy, Ben hasn't pasted his keys yet
 *   'unreachable'  — socket gone or unreadable; an ops fault, not a setup step
 *   'unknown'      — never successfully polled (cold start)
 */
export interface PlaidStatus {
  state: 'ready' | 'unconfigured' | 'unreachable' | 'unknown';
  environment: PlaidEnv;
  /** Populated for 'unreachable'. Names a system, never a secret. */
  detail: string | null;
  checkedAt: number | null;
}

export class PlaidClient {
  private jwkCache = new Map<string, Record<string, unknown>>();
  private readonly broker: SecretsBrokerClient;

  /**
   * The status cache — the reason configured() can stay synchronous.
   *
   * configured() is called from routes, MCP tools and the scheduler, all of
   * which treat "is Plaid set up" as a cheap local question. Making it async
   * would push an await through three layers of unrelated code for a value that
   * changes when Ben pastes a credential, i.e. approximately never.
   *
   * So: a TTL cache, refreshed in the background, never blocking. The cost is
   * that configured() can be up to STATUS_TTL_MS stale, and that is the right
   * trade because both stale answers are self-correcting. A false 'ready'
   * produces a 503 from the broker on the next real call, which surfaces the
   * true state at the point of use. A false 'unconfigured' clears within the
   * TTL. Neither can corrupt data, and index.ts primes the cache at boot so the
   * cold-start window is one socket round-trip.
   */
  private status: PlaidStatus = { state: 'unknown', environment: 'sandbox', detail: null, checkedAt: null };
  private inflightStatus: Promise<PlaidStatus> | null = null;
  private static readonly STATUS_TTL_MS = 30_000;

  /**
   * `originOverride` defaults to null, meaning "resolve from settings on every
   * access". It is NOT snapshotted at construction, and that is the point: one
   * PlaidClient is built at boot in index.ts and lives for the life of the
   * process, so a constructor-frozen origin would mean every edit on the
   * settings page silently required a restart to take effect. A settings page
   * whose changes do nothing until you remember to restart is the same chore
   * this whole exercise exists to delete, just moved to a different screen.
   *
   * `envOverride` exists only for tests. In production the environment belongs
   * to the broker — see the getter below.
   */
  constructor(
    private readonly db: Database.Database,
    broker?: SecretsBrokerClient,
    private readonly envOverride: PlaidEnv | null = null,
    private readonly originOverride: string | null = null,
  ) {
    this.broker = broker ?? new SecretsBrokerClient();
  }

  /**
   * Which Plaid environment calls actually land in — reported BY the broker,
   * not chosen here.
   *
   * This was a Cabinet setting until today, and removing it is a consequence of
   * the credential split rather than a tidy-up. The broker holds the
   * client_id/secret pair, and a Plaid key pair belongs to exactly one
   * environment. If Cabinet could flip to 'production' while the broker still
   * held sandbox keys, every call would fail with an authentication error
   * pointing at the credentials rather than at the mismatch. Two owners for one
   * value is precisely the failure the settings page's `source` field was built
   * to expose, one level up.
   *
   * Changing environment is now: paste production keys in the dashboard, change
   * the broker's own config. Both are Ben's, both are outside this process.
   */
  get environment(): PlaidEnv {
    return this.envOverride ?? this.status.environment;
  }

  /* -------------------------------------------------------- broker status --- */

  /** The full cached picture, for routes and the settings UI. */
  plaidStatus(): PlaidStatus {
    if (this.isStatusStale()) void this.refreshStatus();
    return { ...this.status };
  }

  private isStatusStale(): boolean {
    return this.status.checkedAt === null || Date.now() - this.status.checkedAt > PlaidClient.STATUS_TTL_MS;
  }

  /**
   * Poll /v1/plaid/status and update the cache.
   *
   * Deduplicated via `inflightStatus`: configured() fires this from every
   * caller that finds a stale cache, and at boot that can be a route, an MCP
   * tool and a scheduler tick within the same millisecond. Without the latch
   * they would open three sockets to answer one question.
   *
   * Awaited by index.ts at boot to prime the cache; everywhere else it runs
   * detached and this method never throws.
   */
  async refreshStatus(): Promise<PlaidStatus> {
    if (this.inflightStatus) return this.inflightStatus;
    this.inflightStatus = (async (): Promise<PlaidStatus> => {
      try {
        const reply = await this.broker.get<{ configured?: boolean; environment?: string }>('/v1/plaid/status');
        if (reply.status !== 200 || typeof reply.body?.configured !== 'boolean') {
          this.status = {
            state: 'unreachable',
            environment: this.status.environment,
            detail: `broker /v1/plaid/status answered ${reply.status}`,
            checkedAt: Date.now(),
          };
        } else {
          this.status = {
            state: reply.body.configured ? 'ready' : 'unconfigured',
            environment: normalisePlaidEnv(reply.body.environment),
            detail: null,
            checkedAt: Date.now(),
          };
        }
      } catch (err) {
        // Keep the last known environment. Losing the socket tells us nothing
        // new about which Plaid environment the broker is configured for, and
        // silently reverting to 'sandbox' would misreport it during an outage.
        this.status = {
          state: 'unreachable',
          environment: this.status.environment,
          detail: err instanceof BrokerTransportError ? err.message : 'broker status check failed',
          checkedAt: Date.now(),
        };
      } finally {
        this.inflightStatus = null;
      }
      return this.status;
    })();
    return this.inflightStatus;
  }

  /** Public origin, for redirect_uri and the webhook. */
  get origin(): string {
    return this.originOverride ?? getSetting(this.db, 'public.origin');
  }

  // `base` is gone: Cabinet no longer builds a Plaid URL. The broker does,
  // from its own environment, which is the only place the credentials that
  // match that environment exist.

  /** The Link redirect landing page, and the URI that must be allow-listed in Plaid's dashboard. */
  get redirectUri(): string {
    return `${this.origin}/plaid/oauth`;
  }

  get webhookUrl(): string {
    return `${this.origin}/api/plaid/webhook`;
  }

  /**
   * True when the broker has both halves of the API credential.
   *
   * Synchronous by design (see the status cache above). Used by routes and the
   * UI to render "not configured yet" instead of throwing — an unconfigured
   * integration is a normal state, not an error.
   *
   * A broker we cannot reach reads as NOT configured, because every caller of
   * this uses it to decide whether to attempt a call, and attempting one
   * against a dead socket helps nobody. The distinction is not lost: it is in
   * plaidStatus().state, which is what the UI shows, so Ben sees "the secrets
   * service is down" rather than "add your Plaid keys" — advice that would send
   * him to re-paste credentials that were never the problem.
   */
  configured(): boolean {
    if (this.isStatusStale()) void this.refreshStatus();
    return this.status.state === 'ready';
  }

  /**
   * One Plaid call, made BY THE BROKER on Cabinet's behalf.
   *
   * The shape to keep in mind: the broker returns HTTP 200 with a body of
   * `{status, body}` whenever it successfully reached Plaid — including when
   * Plaid itself returned a 400. Plaid's status is INSIDE the envelope. So
   * there are two failure axes stacked here, and collapsing them was the
   * easiest mistake available:
   *
   *   broker transport   → socket missing / unreadable / silent
   *   broker refusal     → 403 (path not allowlisted) / 503 (no credentials)
   *   Plaid's own answer → the inner status, translated exactly as before
   *
   * Everything downstream of this method — needsRelink, the ITEM_LOGIN_REQUIRED
   * branch in syncItem, the INVALID_REQUEST check — reads PlaidApiError fields,
   * so the inner translation has to stay byte-for-byte compatible with the old
   * direct-fetch version. It does.
   */
  private async request<T>(
    path: PlaidPath,
    body: Record<string, unknown> = {},
    accessTokenCredential?: string,
  ): Promise<T> {
    let reply: { status: number; body: unknown };
    try {
      reply = await this.broker.post<unknown>('/v1/plaid/request', {
        path,
        body,
        ...(accessTokenCredential ? { accessTokenCredential } : {}),
      });
    } catch (err) {
      const kind = err instanceof BrokerTransportError ? err.kind : 'unreachable';
      // errorType 'BROKER' on every broker-origin failure, so ONE predicate in
      // the route layer catches all of them; the specific fault lives in the
      // code. Splitting it the other way round (kind as the type) is what made
      // gateway/plaidRoutes.ts mistake a dead socket for a Plaid outage and
      // answer 502 with a raw diagnostic string.
      //
      // 'BROKER_UNREACHABLE' rather than 'NETWORK' so a log line distinguishes
      // "our secrets service is down" from "Plaid is down" — identical from the
      // UI, entirely different fixes.
      throw new PlaidApiError(0, `BROKER_${kind.toUpperCase()}`, 'BROKER', null, (err as Error).message);
    }

    // ---- the broker's own answer, before Plaid's ----
    if (reply.status === 503) {
      throw new PlaidNotConfiguredError(
        `Plaid is not configured: store '${CLIENT_ID_CRED}' and '${SECRET_CRED}' at ${SECRETS_DASHBOARD}.`,
      );
    }
    if (reply.status === 403) {
      // The broker refused the path or the token combination. This is a
      // programming error in Cabinet, not a runtime condition, and it is what
      // test/plaid-broker-contract.test.ts exists to prevent reaching prod.
      throw new PlaidApiError(403, 'BROKER_REFUSED', 'BROKER', null, `Broker refused Plaid ${path}: ${brokerError(reply.body)}`);
    }
    if (reply.status !== 200) {
      throw new PlaidApiError(reply.status, 'BROKER_ERROR', 'BROKER', null, `Broker error on Plaid ${path}: ${brokerError(reply.body)}`);
    }

    const env = reply.body as { status?: unknown; body?: unknown };
    if (typeof env?.status !== 'number') {
      throw new PlaidApiError(0, 'BROKER_ERROR', 'BROKER', null, `Broker returned an unrecognised envelope for Plaid ${path}.`);
    }

    // ---- Plaid's answer, translated exactly as the direct client did ----
    if (env.status < 200 || env.status >= 300) {
      const e = (env.body ?? {}) as {
        error_code?: string;
        error_type?: string;
        display_message?: string;
        error_message?: string;
      };
      throw new PlaidApiError(
        env.status,
        e.error_code ?? null,
        e.error_type ?? null,
        e.display_message ?? null,
        e.error_message ? `Plaid ${path}: ${e.error_message}` : `Plaid ${path} failed (${env.status})`,
      );
    }
    return env.body as T;
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
    let updateModeCredential: string | undefined;
    if (opts.itemPk) {
      const item = getItem(this.db, opts.itemPk);
      if (!item) throw new Error(`No linked institution with id ${opts.itemPk}`);
      updateModeCredential = itemCredential(item);
      // Update mode is BLOCKED on the broker today, and failing here with a
      // sentence Ben can act on beats letting it reach the socket and come
      // back as a bare 403 from a service he didn't know was involved.
      //
      // The broker models token handling as two sets: allowlisted, and
      // requires-a-token. /link/token/create needs a third — it takes a token
      // in update mode and must not have one in create mode — so listing it
      // breaks new links and omitting it breaks repairs. Omitting it is the
      // right way round (new links matter more), which is where it sits.
      //
      // test/plaid-broker-contract.test.ts asserts this is still true and goes
      // red the day the broker grows optional-token support, which is the
      // signal to delete this block.
      throw new PlaidNotConfiguredError(
        'Link update mode (repairing an existing bank connection) is not available yet: the secrets broker ' +
          'has no way to mark an access token as optional on /link/token/create. Until it does, repair a ' +
          'broken connection by removing the institution and linking it again.',
      );
    } else {
      body.products = ['transactions'];
      body.optional_products = ['investments'];
      // Two years is the maximum initial pull and costs nothing extra. A
      // longer history makes the first month of analysis immediately useful
      // instead of waiting for data to accumulate.
      body.transactions = { days_requested: 730 };
    }
    const r = await this.request<{ link_token: string }>('/link/token/create', body, updateModeCredential);
    return r.link_token;
  }

  /**
   * Exchange the browser's public_token for a permanent access token and record
   * the Item.
   *
   * THE TOKEN NEVER ENTERS THIS PROCESS. The broker performs the exchange,
   * files the access token under the name we chose, and returns that name plus
   * the item_id. Compare the old version: it fetched the token, held it in a
   * local, passed it to three subsequent calls, and encrypted it here.
   *
   * The old ordering comment — "write the Item row first so a failed seal
   * leaves a visible row rather than an unrecorded live token" — no longer
   * applies, and its disappearance is a real improvement rather than an
   * oversight. The token is sealed by the broker as an inseparable part of the
   * exchange, so the window where a live token existed with nothing recording
   * it has been closed rather than merely narrowed. If the write below fails,
   * the token is already safely filed under a name the broker's own dashboard
   * lists, which is recoverable; nothing is stranded.
   */
  async exchangePublicToken(publicToken: string): Promise<PlaidItemRow> {
    const credName = newItemCredentialName();
    let ex: { item_id: string; accessTokenCredential: string };
    try {
      const reply = await this.broker.post<{ item_id?: string; accessTokenCredential?: string; error?: string }>(
        '/v1/plaid/exchange',
        { publicToken, credentialName: credName },
      );
      if (reply.status === 503) {
        throw new PlaidNotConfiguredError(
          `Plaid is not configured: store '${CLIENT_ID_CRED}' and '${SECRET_CRED}' at ${SECRETS_DASHBOARD}.`,
        );
      }
      if (reply.status !== 200 || !reply.body?.item_id || !reply.body?.accessTokenCredential) {
        throw new PlaidApiError(
          reply.status,
          'EXCHANGE_FAILED',
          'BROKER',
          null,
          `Plaid token exchange failed: ${brokerError(reply.body)}`,
        );
      }
      ex = { item_id: reply.body.item_id, accessTokenCredential: reply.body.accessTokenCredential };
    } catch (err) {
      if (err instanceof PlaidApiError || err instanceof PlaidNotConfiguredError) throw err;
      const kind = err instanceof BrokerTransportError ? err.kind : 'unreachable';
      throw new PlaidApiError(0, `BROKER_${kind.toUpperCase()}`, 'BROKER', null, (err as Error).message);
    }

    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      // Now by credential NAME — the token we would have passed here is the
      // thing we no longer have.
      const info = await this.request<{ item: { institution_id?: string | null } }>(
        '/item/get',
        {},
        ex.accessTokenCredential,
      );
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

    // Reconciliation: re-linking an existing bank produces the same item_id but
    // a NEW credential name, because the name had to be chosen before the
    // exchange told us which item this was (see newItemCredentialName). The old
    // credential is now unreferenced. Cabinet cannot delete a broker credential
    // — there is deliberately no such endpoint — so the honest move is to name
    // it in the log so it can be deleted in the dashboard. Silence here would
    // leave a live bearer token that nothing points at and nobody knows about,
    // which is the exact failure the old deterministic naming was avoiding.
    const superseded = item.token_credential;
    setItemCredential(this.db, item.id, ex.accessTokenCredential);
    if (superseded && superseded !== ex.accessTokenCredential) {
      logSafe(
        `re-link of item ${item.id} superseded credential '${superseded}' — it is now unreferenced and ` +
          `should be deleted at ${SECRETS_DASHBOARD}`,
        null,
      );
    }
    return getItem(this.db, item.id)!;
  }

  /** Revoke at Plaid, then delete locally. Order matters: a local delete first would strand a live token. */
  async removeItem(itemPk: number): Promise<void> {
    const item = getItem(this.db, itemPk);
    if (!item) return;
    try {
      await this.request('/item/remove', {}, itemCredential(item));
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
    // The item's credential NAME, not its token. Resolving this can still
    // fail — an item row with no credential is a half-finished link — so the
    // NO_TOKEN branch survives the migration unchanged.
    let credential: string;
    try {
      credential = itemCredential(item);
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
        }>('/transactions/sync', { ...(cursor ? { cursor } : {}), count: 500 }, credential);

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
        report.holdings = await this.syncHoldings(itemPk, credential);
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

  private async syncHoldings(itemPk: number, credential: string): Promise<number> {
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
    }>('/investments/holdings/get', {}, credential);

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
          const info = await this.request<{ item: { consent_expiration_time?: string | null } }>(
            '/item/get',
            {},
            itemCredential(item),
          );
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
    return verifyPlaidSignature(rawBody, verificationHeader, (kid) => this.webhookVerificationKey(kid));
  }

  /**
   * Fetch (and cache) Plaid's public JWK for a `kid`.
   *
   * Returns null rather than throwing so the caller fails CLOSED. Today this
   * always returns null in production: the broker does not allowlist
   * /webhook_verification_key/get, so every webhook is rejected and Cabinet
   * falls back to the nightly scheduled sync. That is a degradation, not a
   * vulnerability — see test/plaid-broker-contract.test.ts, which fails the day
   * the broker allows the path and tells whoever reads it to re-check this.
   */
  private async webhookVerificationKey(kid: string): Promise<Record<string, unknown> | null> {
    const cached = this.jwkCache.get(kid);
    if (cached) return cached;
    try {
      const r = await this.request<{ key: Record<string, unknown> }>('/webhook_verification_key/get', {
        key_id: kid,
      });
      this.jwkCache.set(kid, r.key);
      return r.key;
    } catch (err) {
      logSafe('webhook_verification_key/get failed', err);
      return null;
    }
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


/**
 * The webhook signature check itself, as a pure function of (body, header, key).
 *
 * Extracted from the method deliberately, and the reason is a testing hazard
 * worth naming. This is the only authentication on a route that sits outside
 * the auth wall, and the broker currently refuses the key fetch — so every test
 * that drove it through the class would now get `false` from the MISSING KEY,
 * never reaching the crypto at all. Every rejection assertion would still pass,
 * the "accepts a valid webhook" case would be impossible to write, and the alg
 * pinning could regress to `return false` with a fully green suite. A key
 * resolver as a parameter keeps the security-critical path directly testable
 * regardless of what the broker allows this week.
 */
export async function verifyPlaidSignature(
  rawBody: Buffer,
  verificationHeader: string | undefined,
  resolveKey: (kid: string) => Promise<Record<string, unknown> | null>,
): Promise<boolean> {
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

    const jwk = await resolveKey(header.kid);
    if (!jwk) return false;

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