/* ============================================================================
   Plaid Link — the drop-in the bank login actually runs inside.

   Loaded from Plaid's CDN at the moment it's needed rather than bundled: it
   is a third-party script that must be served from Plaid's own origin (their
   OAuth flow and their institution allow-list both depend on it), and it has
   no npm package worth taking a dependency on. `window.Plaid` is typed here,
   minimally and locally, instead of pulling in @types for it.

   Everything in this module is idempotent. Link gets opened from two places —
   the Money surface, and the OAuth landing page a bank redirects back to —
   and the second of those runs on a fresh page load where the script may or
   may not already be in the document.
   ========================================================================== */

const SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

/** What Link hands back on success. Only the fields Cabinet reads are named. */
export interface PlaidLinkMetadata {
  institution?: { name?: string | null; institution_id?: string | null } | null;
  accounts?: { id?: string; name?: string | null; mask?: string | null; type?: string | null; subtype?: string | null }[];
  link_session_id?: string;
}

/** What Link hands back on exit — `error` is null when Ben simply closed it. */
export interface PlaidLinkExitError {
  error_type?: string;
  error_code?: string;
  display_message?: string | null;
  error_message?: string;
}
export interface PlaidLinkExitMetadata {
  institution?: { name?: string | null; institution_id?: string | null } | null;
  status?: string | null;
  link_session_id?: string;
  request_id?: string;
}

export interface PlaidHandler {
  open(): void;
  exit(opts?: { force?: boolean }): void;
  destroy(): void;
}

interface PlaidCreateConfig {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
  onExit?: (error: PlaidLinkExitError | null, metadata: PlaidLinkExitMetadata) => void;
  onEvent?: (eventName: string, metadata: Record<string, unknown>) => void;
  receivedRedirectUri?: string;
}

interface PlaidFactory {
  create(config: PlaidCreateConfig): PlaidHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidFactory;
  }
}

/** In flight or resolved — a second caller joins the first load instead of
 *  injecting a competing <script>. */
let loading: Promise<PlaidFactory> | null = null;

/**
 * Inject the Link script once and resolve with `window.Plaid`.
 *
 * Resolves immediately if it's already there (a re-render, or a page that
 * loaded it earlier in the session). Rejects — rather than hanging — if the
 * CDN is unreachable, which is the difference between "Link failed to load"
 * on screen and a button that silently does nothing forever.
 */
export function loadPlaid(): Promise<PlaidFactory> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (loading) return loading;

  loading = new Promise<PlaidFactory>((resolve, reject) => {
    const done = () => {
      if (window.Plaid) resolve(window.Plaid);
      else reject(new Error('Plaid Link loaded but did not register itself.'));
    };
    const die = () => {
      // Drop the memo so a later attempt can retry rather than inheriting
      // a permanently-rejected promise.
      loading = null;
      reject(new Error("Couldn't load Plaid Link. Check the network and try again."));
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', die);
      return;
    }

    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.addEventListener('load', done);
    el.addEventListener('error', die);
    document.head.appendChild(el);
  });

  return loading;
}

export interface OpenPlaidLinkOptions {
  /** A link token from POST /api/plaid/link-token. Update mode uses the same call with an item_id. */
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
  onExit?: (error: PlaidLinkExitError | null, metadata: PlaidLinkExitMetadata) => void;
  /**
   * Set to `window.location.href` when resuming after an OAuth bank redirected
   * the browser back. Link reads the `oauth_state_id` out of it and picks the
   * session back up; without it, the flow restarts from zero.
   */
  receivedRedirectUri?: string;
}

/**
 * Load Link if needed, create a handler, and open it. Resolves with the
 * handler so the caller can `destroy()` it on unmount.
 */
export async function openPlaidLink(opts: OpenPlaidLinkOptions): Promise<PlaidHandler> {
  const Plaid = await loadPlaid();
  const handler = Plaid.create({
    token: opts.token,
    onSuccess: opts.onSuccess,
    ...(opts.onExit ? { onExit: opts.onExit } : {}),
    ...(opts.receivedRedirectUri ? { receivedRedirectUri: opts.receivedRedirectUri } : {}),
  });
  handler.open();
  return handler;
}

/* ---------------------------------------------------------------------------
   The OAuth handoff.

   An OAuth institution (Bank of America among them) navigates the whole tab
   to the bank and then back to redirect_uri — this app is torn down and
   rebuilt in between, so the link token cannot live in React state. It goes
   to localStorage before Link opens and is cleared the moment the flow ends,
   either way. A stale token here is worse than none: it would make the
   landing page try to resume a session that has already been consumed.
   --------------------------------------------------------------------------- */
export const LINK_TOKEN_KEY = 'cabinet.plaid.link_token';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode / blocked storage — the non-OAuth flow still works
  }
}

export function stashLinkToken(token: string): void {
  try {
    storage()?.setItem(LINK_TOKEN_KEY, token);
  } catch {
    /* quota or blocked — nothing to do but continue */
  }
}

export function readLinkToken(): string | null {
  try {
    return storage()?.getItem(LINK_TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function clearLinkToken(): void {
  try {
    storage()?.removeItem(LINK_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
