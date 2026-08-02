/* ============================================================================
   Editable, NON-SECRET application settings.

   The dividing line this module enforces, and it is the whole design:

     credential  → encrypted, write-only over HTTP, never rendered back.
     app_setting → plaintext, fully readable, editable from the browser.

   A value belongs here only if it would be harmless printed on the settings
   page, in a log line, and in a screenshot Ben pastes into a chat. Everything
   else is a `credential` row. There is deliberately no `is_secret` flag —
   see migration 019 for why adding one would be a mistake rather than a
   feature.

   ## Resolution order
   DB row → environment variable → built-in default.

   The DB outranks the environment on purpose. The alternative is the worst bug
   a settings page can have: an edit that reports success and does nothing
   because an invisible env var wins. `listSettings` reports which source won,
   so the page can show "set here, overriding the environment" instead of
   leaving Ben to guess.
   ========================================================================== */
import type Database from 'better-sqlite3';

export type SettingType = 'enum' | 'origin' | 'text';

export interface SettingSpec {
  key: string;
  group: string;
  label: string;
  /** What it does, in outcome terms. Rendered under the control. */
  description: string;
  type: SettingType;
  /** Allowed values for `enum`. Ignored otherwise. */
  options?: string[];
  /** Used when neither the DB nor the environment supplies a value. */
  default: string;
  /** Legacy environment variable consulted before the default. */
  envVar?: string;
  /**
   * True when the running process reads this once at boot. The page says so
   * rather than letting a change look applied when it isn't — and Cabinet can
   * restart itself, so this is a prompt to act, not an apology.
   */
  restartRequired?: boolean;
}

export const SETTING_CATALOG: SettingSpec[] = [
  {
    key: 'plaid.env',
    group: 'Plaid',
    label: 'Environment',
    description:
      "Which Plaid environment to call. 'sandbox' uses fake test banks and fake data; 'production' connects real " +
      'accounts. The Client ID and Secret are environment-specific — the sandbox pair will not authenticate against ' +
      'production, and vice versa.',
    type: 'enum',
    options: ['sandbox', 'production'],
    default: 'sandbox',
    envVar: 'PLAID_ENV',
  },
  {
    key: 'public.origin',
    group: 'Plaid',
    label: 'Public origin',
    description:
      'Base URL Cabinet is reachable at. Used to build the Plaid OAuth redirect and webhook URLs, both of which must ' +
      "match what is registered in Plaid's dashboard character-for-character.",
    type: 'origin',
    default: 'https://cabinet.benloe.com',
    envVar: 'CABINET_PUBLIC_ORIGIN',
  },
];

export function getSpec(key: string): SettingSpec | null {
  return SETTING_CATALOG.find((s) => s.key === key) ?? null;
}

export type SettingSource = 'db' | 'env' | 'default';

export interface SettingView extends SettingSpec {
  value: string;
  source: SettingSource;
  updated_at: string | null;
  /** The environment value, when one exists and the DB is overriding it. */
  env_value: string | null;
}

/**
 * Resolve one setting. Returns the built-in default for an unknown key rather
 * than throwing, because callers are read paths on request-handling hot code
 * and a typo should degrade to the documented default, not 500 the page.
 */
export function getSetting(db: Database.Database, key: string, env: NodeJS.ProcessEnv = process.env): string {
  const spec = getSpec(key);
  const row = db.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as { value: string } | undefined;
  if (row) return row.value;
  if (spec?.envVar) {
    const raw = env[spec.envVar];
    // An env var set to the empty string is treated as absent. A blank origin
    // or a blank environment name is never a meaningful configuration, and
    // falling through to the default beats building 'https:///plaid/oauth'.
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  return spec?.default ?? '';
}

export function listSettings(db: Database.Database, env: NodeJS.ProcessEnv = process.env): SettingView[] {
  const rows = new Map(
    (db.prepare('SELECT key, value, updated_at FROM app_setting').all() as
      { key: string; value: string; updated_at: string }[]).map((r) => [r.key, r]),
  );
  return SETTING_CATALOG.map((spec) => {
    const row = rows.get(spec.key);
    const envRaw = spec.envVar ? env[spec.envVar] : undefined;
    const envValue = typeof envRaw === 'string' && envRaw.trim().length > 0 ? envRaw.trim() : null;
    const source: SettingSource = row ? 'db' : envValue !== null ? 'env' : 'default';
    return {
      ...spec,
      value: row ? row.value : (envValue ?? spec.default),
      source,
      updated_at: row?.updated_at ?? null,
      env_value: envValue,
    };
  });
}

export class SettingValidationError extends Error {}

/**
 * Normalise and validate a candidate value. Throws SettingValidationError with
 * a message written for Ben, not for a log.
 */
export function normaliseSetting(spec: SettingSpec, raw: string): string {
  const value = raw.trim();
  if (value.length === 0) throw new SettingValidationError(`${spec.label} cannot be empty.`);

  if (spec.type === 'enum') {
    const allowed = spec.options ?? [];
    if (!allowed.includes(value)) {
      throw new SettingValidationError(`${spec.label} must be one of: ${allowed.join(', ')}.`);
    }
    return value;
  }

  if (spec.type === 'origin') {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new SettingValidationError(`${spec.label} must be a full URL, e.g. https://cabinet.benloe.com`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new SettingValidationError(`${spec.label} must be an http or https URL.`);
    }
    // An ORIGIN is scheme + host + port and nothing else. A trailing path is
    // the failure that actually happens here — someone pastes the URL from
    // their address bar while sitting on /credentials — and it produces a
    // redirect_uri of ".../credentials/plaid/oauth", which Plaid rejects at
    // the OAuth handoff with an error that names neither this setting nor
    // this page. Reject it at the point of entry, where the cause is obvious.
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new SettingValidationError(
        `${spec.label} must be an origin with no path — use ${url.protocol}//${url.host}`,
      );
    }
    return url.origin;
  }

  return value;
}

/**
 * Rules that depend on the rest of the database rather than on the value
 * alone. Returns a human-readable refusal, or null to allow.
 */
export function blockingReason(db: Database.Database, key: string, value: string): string | null {
  if (key !== 'plaid.env') return null;

  const current = getSetting(db, key);
  if (current === value) return null;

  // Plaid access tokens are environment-scoped. Flipping this while banks are
  // linked does not fail here — it fails at the next sync, as
  // INVALID_ACCESS_TOKEN against every institution at once, which reads like
  // the banks all revoked consent simultaneously rather than like a settings
  // change. The tokens would also be unrecoverable: they can only be revoked
  // through the environment that issued them, so switching back afterwards is
  // the only way to clean them up, and nothing on screen would suggest that.
  const linked = db
    .prepare("SELECT COUNT(*) AS n FROM plaid_item WHERE status != 'revoked'")
    .get() as { n: number };
  if (linked.n > 0) {
    return (
      `Cannot switch to '${value}' while ${linked.n} account connection${linked.n === 1 ? ' is' : 's are'} linked — ` +
      'their access tokens only work in the environment that issued them. Unlink first, then switch.'
    );
  }
  return null;
}

/** Write a validated setting. Callers must have run normaliseSetting first. */
export function putSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_setting (key, value, updated_at) VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run({ key, value });
}

/**
 * Drop the DB row so the value falls back to the environment or the default.
 * This is the only way to un-override, and it exists because "set it back to
 * what it was" is not the same operation as "stop overriding" — the first
 * leaves a row that keeps winning over a future .env change.
 */
export function clearSetting(db: Database.Database, key: string): boolean {
  return db.prepare('DELETE FROM app_setting WHERE key = ?').run(key).changes > 0;
}
