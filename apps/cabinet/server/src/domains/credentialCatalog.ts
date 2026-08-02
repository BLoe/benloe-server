/* ============================================================================
   The catalog — what credentials Cabinet KNOWS how to use, and what environment
   variables it reads at boot.

   Why this file exists at all: without it, a credentials page is a naked
   key/value editor, and using it correctly requires Ben to already know that
   the Plaid client id must be stored under the exact slug 'plaid-client-id'.
   That is a decision he'd have to guess at, which is precisely the kind of load
   the charter says Cabinet removes rather than creates. So the page renders
   SLOTS — named, described, with a link to where the value comes from — and
   Ben's job is to paste, not to invent.

   THE SECURITY RULE, and it is the whole reason this file is structured the way
   it is: nothing here ever reports a secret VALUE. Credential values are not
   readable from this path at all (there is no decrypt in this module and there
   must never be one). Environment values are reported only when the catalog
   entry is explicitly marked `publicValue: true`, and that flag exists only on
   variables that are configuration rather than secrets — PLAID_ENV is
   'sandbox' or 'production' and knowing which is the point; CABINET_CRED_KEY is
   the master key and reports presence only, forever.

   Default is closed: an env var absent from the catalog reports presence only,
   and a catalog entry that forgets `publicValue` reports presence only. A
   mistake here is a leaked secret, so the mistake has to be the safe one.
   ========================================================================== */

export interface CredentialSlot {
  /** The credential-store key. Must satisfy CREDENTIAL_NAME_RE. */
  name: string;
  /** Group heading in the UI, e.g. 'Plaid'. */
  group: string;
  label: string;
  /** What Cabinet does with it — in outcome terms, not implementation terms. */
  description: string;
  /** Where Ben gets the value. Rendered as help text under the input. */
  where: string;
  /** False for optional integrations; a missing required slot disables its group. */
  required: boolean;
}

/**
 * Known slots. Adding an integration means adding a row here — that is the
 * intended way to extend the page, and it keeps the UI and the code that reads
 * the credential from drifting apart.
 */
export const CREDENTIAL_CATALOG: CredentialSlot[] = [
  {
    name: 'plaid-client-id',
    group: 'Plaid',
    label: 'Client ID',
    description: 'Identifies this Cabinet install to Plaid. Needed before any bank can be linked.',
    where: 'Plaid Dashboard → Developers → Keys → client_id',
    required: true,
  },
  {
    name: 'plaid-secret',
    group: 'Plaid',
    label: 'Secret',
    description:
      'The API secret for the environment set in PLAID_ENV. Sandbox and Production have different secrets — ' +
      'storing the wrong one fails at the first API call, not at save time.',
    where: 'Plaid Dashboard → Developers → Keys → the row matching your environment',
    required: true,
  },
];

/**
 * Per-bank access tokens are stored under generated names (plaid-item-<hash>)
 * and must never be rendered as editable slots — they are machine-managed, and
 * a hand-edited one silently breaks that bank's sync. The page lists them
 * read-only under their own heading instead.
 */
export const MANAGED_CREDENTIAL_PREFIXES = ['plaid-item-'];

export function isManagedCredential(name: string): boolean {
  return MANAGED_CREDENTIAL_PREFIXES.some((p) => name.startsWith(p));
}

export interface EnvVarSpec {
  name: string;
  label: string;
  description: string;
  /**
   * True ONLY for values that are configuration, not secrets. Governs whether
   * the value is sent to the browser at all. Omit and it defaults to closed.
   */
  publicValue?: boolean;
  /**
   * True when Cabinet is degraded without it. False for variables that have a
   * working default or belong to an optional integration — those render quiet
   * rather than as a warning, so the page doesn't cry wolf about a feature Ben
   * isn't using and train him to ignore the section that matters.
   */
  required?: boolean;
  /**
   * True for variables that are deliberately DELETED from process.env at boot
   * (gateway/app.ts scrubs CABINET_CRED_KEY, integrations/githubApp.ts scrubs
   * the GitHub private key) so the agent's Bash tool can't print them.
   *
   * These cannot be probed by reading the environment — by the time anything
   * asks, the variable is correctly gone. Probing anyway would report the
   * healthy state as "not set", which is the worst possible failure for a
   * diagnostic page: it sends you hunting for a problem that doesn't exist.
   * The caller supplies the real answer from the resolved artifact instead.
   */
  scrubbedAtBoot?: boolean;
  /**
   * Why this one can't be managed from the page. Every entry has a reason and
   * the page shows it, because "you can't edit this" without a reason reads as
   * a missing feature rather than a deliberate boundary.
   */
  reason: string;
  /**
   * The app_setting key that now owns this value (migration 019). When set, the
   * variable is a LEGACY FALLBACK: a DB row wins over it, so an entry that is
   * still present in .env may not be the value actually in force.
   *
   * This field is why these entries stay listed at all after becoming editable.
   * Deleting them from the catalog would be tidier and worse — the .env line
   * does not disappear when the setting is created, and an operator reading
   * .env would have no way to learn it has been overridden. Listing the
   * variable and naming its successor is what makes the precedence discoverable
   * from either direction.
   */
  supersededBy?: string;
}

/**
 * Environment variables worth surfacing. This is deliberately NOT every var the
 * server reads — it is the ones whose absence produces a confusing symptom
 * somewhere else, so the page can answer "why is this integration dead?"
 * without a shell.
 */
export const ENV_CATALOG: EnvVarSpec[] = [
  {
    name: 'CABINET_CRED_KEY',
    label: 'Credential encryption key',
    description:
      'The AES-256 key that encrypts everything on this page. Without it the store still lists names but ' +
      'cannot encrypt or decrypt anything.',
    required: true,
    scrubbedAtBoot: true,
    reason:
      'This is the bootstrap secret — the one value that cannot be stored in the store it unlocks. It lives in ' +
      '/srv/benloe/.env, which is root-owned and which Cabinet can neither read nor write by design.',
  },
  {
    name: 'PLAID_ENV',
    label: 'Plaid environment',
    description: "'sandbox' for fake test banks, 'production' for real ones. Defaults to sandbox when unset.",
    publicValue: true,
    supersededBy: 'plaid.env',
    reason: 'Superseded by the Plaid environment setting below, which takes precedence over this variable.',
  },
  {
    name: 'CABINET_PUBLIC_ORIGIN',
    label: 'Public origin',
    description: 'Base URL used to build the Plaid OAuth redirect and webhook URLs. Must match what Plaid has on file.',
    publicValue: true,
    supersededBy: 'public.origin',
    reason: 'Superseded by the public origin setting below, which takes precedence over this variable.',
  },
  {
    name: 'CABINET_VAPID_PUBLIC_KEY',
    label: 'Web-push public key',
    description: 'Without it, push notifications silently do nothing — no error, just no pings.',
    publicValue: true,
    reason: 'Public half of a keypair whose private half is in /srv/benloe/.env.',
  },
  {
    name: 'CABINET_VAPID_PRIVATE_KEY',
    label: 'Web-push private key',
    description: 'Signs push notifications. Presence only — the value is never sent anywhere.',
    reason: 'Secret, and paired with the public key above; rotating one without the other breaks push.',
  },
  {
    name: 'GITHUB_APP_ID',
    label: 'GitHub App ID',
    description: 'Lets Cabinet open PRs and read issues on the server repo.',
    publicValue: true,
    reason: 'Injected by root PM2 from /srv/benloe/.env alongside the private key.',
  },
  {
    name: 'GITHUB_APP_PRIVATE_KEY_B64',
    label: 'GitHub App private key',
    description: 'Scrubbed from the process environment at boot after a token is minted from it.',
    scrubbedAtBoot: true,
    reason: 'Secret, and root-injected. Presence is inferred from the token it produced, not from the variable.',
  },
];

export interface EnvVarReport {
  name: string;
  label: string;
  description: string;
  reason: string;
  /** False = absence is fine (a default applies, or the integration is unused). */
  required: boolean;
  set: boolean;
  /** True when `set` came from a resolved artifact because the var was scrubbed. */
  scrubbed: boolean;
  /** The value — non-null ONLY for entries explicitly marked publicValue. */
  value: string | null;
  /** app_setting key that outranks this variable, when one exists. */
  supersededBy: string | null;
}

/**
 * Build the env section of the credentials payload.
 *
 * Reports presence for everything and a value for almost nothing.
 *
 * `resolved` supplies presence for the scrubbed vars, from whatever the boot
 * actually produced (a loaded key buffer, a minted token) rather than from the
 * variable that was deliberately deleted. A scrubbed var with no entry in
 * `resolved` reports `set: false` — unknown reads as absent, which errs toward
 * "check your config" rather than toward a false all-clear.
 */
export function envReport(
  env: NodeJS.ProcessEnv = process.env,
  resolved: Record<string, boolean> = {},
): EnvVarReport[] {
  return ENV_CATALOG.map((spec) => {
    const raw = env[spec.name];
    const scrubbed = spec.scrubbedAtBoot === true;
    return {
      name: spec.name,
      label: spec.label,
      description: spec.description,
      reason: spec.reason,
      required: spec.required === true,
      set: scrubbed ? resolved[spec.name] === true : typeof raw === 'string' && raw.length > 0,
      scrubbed,
      // An empty string is "set to nothing" — a different, more confusing state
      // than unset — so it survives as an empty value rather than becoming null.
      value: !scrubbed && spec.publicValue === true && typeof raw === 'string' ? raw : null,
      supersededBy: spec.supersededBy ?? null,
    };
  });
}
