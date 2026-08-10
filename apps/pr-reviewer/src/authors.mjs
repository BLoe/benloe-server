/**
 * Which PR authors this reviewer will spend an agent on.
 *
 * This repository is PUBLIC, so anyone can open a pull request, and a PR's
 * title, body, and diff all reach the prompt of an agent whose output is
 * published back to that same public PR. Opus 5 is the most injection-robust
 * model measured (IPI: 2.0% attacker success within 15 attempts, vs 5.5% for
 * Opus 4.8 and 20.0% for GPT-5.6 Sol) — but "robust" is a rate, and this
 * reviewer is unattended, runs every five minutes, and gives an attacker
 * unlimited free retries. At ~0.13% per attempt, a few hundred junk PRs is a
 * coin flip.
 *
 * So the control is not a better filter on the content; it is refusing to look
 * at content from strangers at all. Attempts capped at zero beats attempts
 * made less likely to succeed. The prompt fence and the systemd sandbox stay
 * regardless — a PR from a trusted author still contains a diff written by an
 * agent that reads web pages and email.
 */

/** Logins allowed by default: Ben, and Cabinet's own unattended runtime. */
export const DEFAULT_ALLOWED_AUTHORS = ['BLoe', 'cabinet-benloe[bot]'];

/**
 * GitHub logins are case-insensitive, and the `[bot]` suffix is easy to omit
 * by hand, so both are normalised away before comparison. Empty entries (a
 * trailing comma, a blank env var) are dropped rather than becoming a rule
 * that matches the empty author.
 */
const normalize = (login) => String(login ?? '').trim().toLowerCase().replace(/\[bot\]$/, '');

export function parseAllowedAuthors(raw) {
  if (raw === undefined || raw.trim() === '') return DEFAULT_ALLOWED_AUTHORS;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // An env var set to nothing but separators is far more likely a deployment
  // mistake than an intent to review nothing, but silently substituting the
  // default would hide it. Fail loudly — see numberEnv in poll.mjs.
  if (list.length === 0) throw new Error('PR_REVIEWER_ALLOWED_AUTHORS was set but contained no logins');
  return list;
}

/**
 * Fail closed: an author that is absent, empty, or unrecognised is NOT
 * allowed. A PR with no `user` (deleted account) must not fall through to a
 * review.
 */
export function isAllowedAuthor(login, allowed) {
  const who = normalize(login);
  if (!who) return false;
  return allowed.some((a) => normalize(a) === who);
}
