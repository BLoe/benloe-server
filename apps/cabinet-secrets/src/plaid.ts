/**
 * The Plaid capability.
 *
 * This is the module that makes the whole split worth building. Cabinet still
 * owns every bit of Plaid BUSINESS logic — which items to sync, how to fold
 * transactions into its own tables, when to run. What it no longer owns is the
 * credential material. It sends "POST /transactions/sync with this cursor, for
 * the item whose token is filed under plaid-item-3"; the broker fills in
 * client_id, secret and access_token from its own database and makes the call.
 *
 * The reason this is a proxy and not a `getSecret(name)` RPC is worth stating
 * plainly, because `getSecret` would have been a tenth of the code:
 *
 *   An agent that can read a secret can exfiltrate it — paste it in a
 *   transcript, send it off-box, keep it after its access is revoked. An agent
 *   that can only ask for a secret to be USED can do exactly the operations
 *   this file allows, only while it is allowed to, and every one of them is
 *   logged. That is the difference between hiding a key and bounding a
 *   capability, and only the second survives the agent being wrong.
 *
 * ALLOWLIST, not denylist. Plaid's API includes endpoints that would hand back
 * material we are trying to contain — /item/public_token/exchange returns an
 * access_token, for instance. Those are handled here (the token is stored, and
 * only its NAME is returned) rather than proxied blindly. A path that is not
 * listed is refused, so a new Plaid endpoint is unreachable until someone
 * decides how it should behave.
 */
import type Database from 'better-sqlite3';
import type { AuditFn } from './audit.js';
import { decryptSecret, putCredential } from './store.js';

export const CLIENT_ID_CRED = 'plaid-client-id';
export const SECRET_CRED = 'plaid-secret';

/**
 * Endpoints Cabinet may drive through the broker.
 *
 * Chosen so Cabinet can do everything it does today. Notably absent:
 *  - /item/public_token/exchange — returns an access_token. Special-cased below.
 *  - /item/access_token/invalidate — rotates a token, i.e. returns a new one.
 *    Add it the same way exchange is handled if it is ever needed.
 */
const ALLOWED_PATHS = new Set([
  '/link/token/create',
  '/item/get',
  '/item/remove',
  '/accounts/get',
  '/accounts/balance/get',
  '/transactions/sync',
  '/transactions/get',
  '/investments/holdings/get',
  '/investments/transactions/get',
  '/institutions/search',
  '/institutions/get_by_id',
  '/liabilities/get',
]);

/** Paths that take an item access_token. Others must NOT have one injected. */
const NEEDS_ACCESS_TOKEN = new Set([
  '/item/get',
  '/item/remove',
  '/accounts/get',
  '/accounts/balance/get',
  '/transactions/sync',
  '/transactions/get',
  '/investments/holdings/get',
  '/investments/transactions/get',
  '/liabilities/get',
]);

export class PlaidNotConfiguredError extends Error {}
export class PlaidPathRefusedError extends Error {}

export interface PlaidProxyDeps {
  db: Database.Database;
  key: Buffer | null;
  audit: AuditFn;
  /** 'sandbox' | 'production'. Injectable so tests never touch the network. */
  environment: string;
  fetchImpl?: typeof fetch;
}

export interface ProxyRequest {
  path: string;
  body?: Record<string, unknown>;
  /** Credential NAME holding this item's access_token. Never the token itself. */
  accessTokenCredential?: string;
}

export interface ProxyResult {
  status: number;
  /** Plaid's response body, verbatim. Contains no Cabinet credential material:
   *  client_id/secret are request-side only, and token-returning endpoints are
   *  not in ALLOWED_PATHS. */
  body: unknown;
}

function baseUrl(environment: string): string {
  return environment === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
}

function apiCreds(deps: PlaidProxyDeps): { client_id: string; secret: string } | null {
  const client_id = decryptSecret(deps.db, deps.key, CLIENT_ID_CRED);
  const secret = decryptSecret(deps.db, deps.key, SECRET_CRED);
  if (!client_id || !secret) return null;
  return { client_id, secret };
}

export function plaidConfigured(deps: PlaidProxyDeps): boolean {
  if (!deps.key) return false;
  try {
    return !!apiCreds(deps);
  } catch {
    return false;
  }
}

/**
 * Perform one allowlisted Plaid call with credentials filled in here.
 *
 * Throwing rather than returning an error shape for refusals is deliberate:
 * a refused path is a programming error in the caller, not a runtime condition
 * it should branch on.
 */
export async function plaidRequest(deps: PlaidProxyDeps, req: ProxyRequest): Promise<ProxyResult> {
  const path = req.path;
  if (!ALLOWED_PATHS.has(path)) {
    deps.audit({ via: 'broker', action: 'plaid.request', path, ok: false, error: 'path not allowlisted' });
    throw new PlaidPathRefusedError(`Plaid path '${path}' is not allowlisted by the broker.`);
  }

  const creds = apiCreds(deps);
  if (!creds) {
    deps.audit({ via: 'broker', action: 'plaid.request', path, ok: false, error: 'not configured' });
    throw new PlaidNotConfiguredError(
      `Plaid is not configured: store '${CLIENT_ID_CRED}' and '${SECRET_CRED}' in the secrets dashboard first.`,
    );
  }

  const used = [CLIENT_ID_CRED, SECRET_CRED];
  const body: Record<string, unknown> = { ...creds, ...(req.body ?? {}) };

  // An access_token may only ever arrive by NAME, resolved here. If a caller
  // passes a literal access_token in the body we drop it: accepting one would
  // mean Cabinet had a token to pass, which is precisely the state this design
  // exists to prevent, and silently honouring it would hide that regression.
  if ('access_token' in body) {
    delete body.access_token;
  }
  if (req.accessTokenCredential) {
    if (!NEEDS_ACCESS_TOKEN.has(path)) {
      throw new PlaidPathRefusedError(`Plaid path '${path}' does not take an access token.`);
    }
    const token = decryptSecret(deps.db, deps.key, req.accessTokenCredential);
    if (!token) {
      deps.audit({
        via: 'broker',
        action: 'plaid.request',
        path,
        credentials: [req.accessTokenCredential],
        ok: false,
        error: 'access token credential missing',
      });
      throw new PlaidNotConfiguredError(`No stored access token named '${req.accessTokenCredential}'.`);
    }
    body.access_token = token;
    used.push(req.accessTokenCredential);
  } else if (NEEDS_ACCESS_TOKEN.has(path)) {
    throw new PlaidNotConfiguredError(`Plaid path '${path}' requires accessTokenCredential.`);
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${baseUrl(deps.environment)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // The message may not include the request body — it holds the secret.
    deps.audit({ via: 'broker', action: 'plaid.request', path, credentials: used, ok: false, error: 'network' });
    throw new Error(`Plaid ${path} unreachable: ${(err as Error).message}`);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is an outage or a proxy page. Don't echo it — unbounded
    // and could contain anything.
    parsed = { error_type: 'BROKER', error_code: 'NON_JSON_RESPONSE', error_message: `Plaid ${path} returned non-JSON` };
  }

  deps.audit({ via: 'broker', action: 'plaid.request', path, credentials: used, ok: res.ok });
  return { status: res.status, body: parsed };
}

/**
 * Exchange a Link public_token for an access_token, and KEEP the token.
 *
 * Not a plain proxy, because the upstream response contains the access_token
 * itself. The broker stores it under a caller-chosen credential name and hands
 * back only that name plus the item_id. Cabinet gets everything it needs to
 * file the item in its own tables, and never sees the token it will later ask
 * the broker to use.
 */
export async function plaidExchangePublicToken(
  deps: PlaidProxyDeps,
  publicToken: string,
  credentialName: string,
): Promise<{ item_id: string; accessTokenCredential: string }> {
  const creds = apiCreds(deps);
  if (!creds) throw new PlaidNotConfiguredError('Plaid is not configured.');

  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(`${baseUrl(deps.environment)}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...creds, public_token: publicToken }),
  });
  const text = await res.text();
  let parsed: { access_token?: string; item_id?: string; error_message?: string } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* handled below */
  }
  if (!res.ok || !parsed.access_token || !parsed.item_id) {
    deps.audit({ via: 'broker', action: 'plaid.exchange', ok: false, error: `status ${res.status}` });
    throw new Error(`Plaid token exchange failed (${res.status})${parsed.error_message ? `: ${parsed.error_message}` : ''}`);
  }

  putCredential(deps.db, deps.key, {
    name: credentialName,
    provider: 'plaid',
    description: `Plaid access token for item ${parsed.item_id}`,
    secret: parsed.access_token,
  });
  deps.audit({ via: 'broker', action: 'plaid.exchange', credentials: [credentialName], ok: true });

  // Note what is returned, and what is not.
  return { item_id: parsed.item_id, accessTokenCredential: credentialName };
}
