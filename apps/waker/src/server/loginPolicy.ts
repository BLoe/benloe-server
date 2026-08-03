/**
 * Who may connect a Sleeper account on this server.
 *
 * This is a public page that asks for a Sleeper password, so the set of people
 * allowed to use that form is a security boundary, not a preference. Kept pure
 * and tested for that reason.
 *
 * Sleeper usernames are case-insensitive handles; both sides are lowercased
 * before comparison, and entries are matched exactly — no prefixes, no globs.
 */

export interface LoginPolicy {
  /** Master switch. When false nobody may connect, allowlist or not. */
  enabled: boolean;
  /** Allowed usernames. Empty means everybody (subject to `enabled`). */
  allow: string[];
}

/** Parse the comma-separated SLEEPER_LOGIN_ALLOW value. */
export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function mayConnectSleeper(username: string, policy: LoginPolicy): boolean {
  if (!policy.enabled) return false;
  if (!policy.allow.length) return true;

  const name = username.trim().toLowerCase();
  if (!name) return false;
  return policy.allow.includes(name);
}
