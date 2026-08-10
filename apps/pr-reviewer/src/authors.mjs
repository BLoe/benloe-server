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
 * GitHub logins are case-insensitive, so case is normalised away.
 *
 * The `[bot]` suffix is deliberately NOT stripped. An earlier version removed
 * it from both sides of the comparison to be forgiving about a hand-typed env
 * var — but the same leniency then applied to the incoming author, collapsing
 * `cabinet-benloe[bot]` and `cabinet-benloe` into one match key. Those are two
 * different GitHub principals: the first is a bot actor, the second an
 * ordinary account. Whether the un-suffixed name is reserved is GitHub's
 * business, not an assumption this allowlist should rest on, and this is the
 * one check the entire injection design depends on. Write the suffix exactly.
 */
const normalize = (login) => String(login ?? '').trim().toLowerCase();

/**
 * Three branches, stated because they are easy to get backwards:
 * - unset or all whitespace → DEFAULT_ALLOWED_AUTHORS (a WIDER list, not an
 *   empty one; `PR_REVIEWER_ALLOWED_AUTHORS=""` does not review nobody)
 * - entries that trim to empty (a trailing comma) → dropped
 * - separators only, no logins at all → throws
 */
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

/**
 * Split a PR list into the ones this reviewer will look at and the ones it
 * skips, each with a reason.
 *
 * EVERY skip carries a reason, not just the allowlist one. The earlier version
 * returned only `declined` and left the three routine branches as bare
 * `continue`s — its docs were correctly scoped to declines, so this is a
 * behaviour gap rather than a doc/code mismatch. The gap still mattered: a PR
 * dropped for being a draft, or for a stale ledger entry, looked from the
 * outside exactly like one the reviewer never saw. `kind` separates the
 * security-relevant branch from the routine ones because they deserve
 * different log volume, not different honesty.
 *
 * Pulled out of poll.mjs deliberately. The property that actually matters —
 * a stranger's PR never reaches the orchestrator — used to live inside
 * main(), which self-invokes on import and so could not be imported by a
 * test. Deleting the check left the whole suite green. It also let the
 * allowlist predicate be written out twice, once for the log and once for the
 * filter, which is one edit away from the two disagreeing.
 */
export function selectPulls(pulls, { allowedAuthors, includeDrafts, onlyPr, dryRun, isReviewed }) {
  const reviewable = [];
  const skipped = [];
  for (const pr of pulls) {
    if (!isAllowedAuthor(pr.user?.login, allowedAuthors)) {
      skipped.push({ pr, kind: 'declined', reason: `author ${pr.user?.login ?? '(none)'} not in allowlist` });
      continue;
    }
    if (onlyPr !== null && onlyPr !== undefined && pr.number !== onlyPr) {
      skipped.push({ pr, kind: 'routine', reason: `not the PR named by PR_REVIEWER_ONLY_PR (${onlyPr})` });
      continue;
    }
    if (pr.draft && !includeDrafts) {
      skipped.push({ pr, kind: 'routine', reason: 'draft' });
      continue;
    }
    // A dry run ignores the ledger on purpose — the point is to re-review the
    // same SHA repeatedly while tuning the orchestrator prompt.
    if (!dryRun && isReviewed(pr.head.sha)) {
      skipped.push({ pr, kind: 'routine', reason: `already reviewed at ${pr.head.sha.slice(0, 8)}` });
      continue;
    }
    reviewable.push(pr);
  }
  return { reviewable, skipped, declined: skipped.filter((s) => s.kind === 'declined') };
}
