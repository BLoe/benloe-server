#!/usr/bin/env node
/**
 * Entry point. One pass: find open PRs whose head SHA has not been reviewed,
 * review them, post, record.
 *
 * Concurrency is handled by systemd, not by a lockfile: the unit is
 * Type=oneshot and systemd will not start a second instance of a service that
 * is still running, so a review that outlives its timer interval simply delays
 * the next poll instead of racing it.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAllowedAuthors, selectPulls } from './authors.mjs';
import { addressableMap } from './diff.mjs';
import { buildReviewPost, renderFailureBody } from './format.mjs';
import {
  appLogin,
  dismissStaleApprovals,
  gh,
  installationToken,
  listOpenPulls,
  listPullFiles,
  postReview,
  reviewerCredentials,
} from './github.mjs';
import {
  ensureMirror,
  escapeUntrusted,
  loadPromptTemplate,
  makeWorktree,
  mergeBase,
  removeWorktree,
  renderPrompt,
  runOrchestrator,
} from './review.mjs';
import {
  alreadyReportedFailure,
  loadState,
  markFailureReported,
  markReviewed,
  saveState,
  wasReviewed,
} from './state.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `??` only defaults on undefined, so `Environment=PR_REVIEWER_MAX_PER_RUN=`
 * or any typo yields a string Number() maps to 0 or NaN with no complaint —
 * and `slice(0, NaN)` is `[]`. The reviewer would then review nothing, exit 0,
 * and let systemd report success indefinitely. Fail loudly instead: a
 * misconfigured reviewer must look broken, not idle.
 */
function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  return n;
}

const CONFIG = {
  repo: process.env.PR_REVIEWER_REPO ?? 'BLoe/benloe-server',
  /**
   * The reviewer's OWN bare mirror — never /srv/benloe. That is the live
   * production checkout; a reviewer has no business fetching into it, and the
   * systemd sandbox makes it read-only anyway.
   */
  mirrorDir: process.env.PR_REVIEWER_MIRROR ?? '/var/lib/pr-reviewer/repo.git',
  envFile: process.env.PR_REVIEWER_ENV_FILE ?? '/srv/benloe/.env',
  stateFile: process.env.PR_REVIEWER_STATE ?? '/var/lib/pr-reviewer/state.json',
  worktreeRoot: process.env.PR_REVIEWER_WORKTREES ?? '/var/lib/pr-reviewer/worktrees',
  pluginDir:
    process.env.PR_REVIEWER_PLUGIN_DIR ??
    '/root/.claude/plugins/marketplaces/claude-plugins-official/plugins/pr-review-toolkit',
  model: process.env.PR_REVIEWER_MODEL ?? 'opus',
  /**
   * Reviews per poll. A cap rather than a queue: reviews spend Ben's Claude
   * account rate limit, and five PRs opened at once should not be able to
   * drain it in a single tick. Anything skipped is picked up next poll.
   */
  maxPerRun: numberEnv('PR_REVIEWER_MAX_PER_RUN', 2),
  timeoutMs: numberEnv('PR_REVIEWER_TIMEOUT_MS', 20 * 60_000),
  /** Draft PRs are work in progress; reviewing them is noise, not signal. */
  includeDrafts: process.env.PR_REVIEWER_INCLUDE_DRAFTS === '1',
  /**
   * Comma-separated logins whose PRs get reviewed. See authors.mjs for why
   * this is the primary injection control rather than a content filter.
   */
  allowedAuthors: parseAllowedAuthors(process.env.PR_REVIEWER_ALLOWED_AUTHORS),
  /**
   * Run the full pipeline but print the review instead of posting it, and
   * leave the state ledger untouched. This is how you tune
   * prompts/orchestrator.md without spraying revisions across a real PR.
   */
  dryRun: process.env.PR_REVIEWER_DRY_RUN === '1',
  /**
   * Restrict a run to one PR number. Independent of dryRun: on its own this
   * performs and POSTS a real review of exactly that PR, which is the intended
   * "review this one now" escape hatch — pair it with PR_REVIEWER_DRY_RUN=1
   * when you only want to look.
   */
  onlyPr: process.env.PR_REVIEWER_ONLY_PR ? numberEnv('PR_REVIEWER_ONLY_PR', null) : null,
};

/** How many declined PRs to name before collapsing to a count. */
const DECLINE_SAMPLE = 3;

/**
 * Wall clock after which this run starts no further reviews.
 *
 * This — not the per-call git timeout — is what keeps systemd from killing
 * the process. A SIGKILL at TimeoutStartSec runs no catch and no finally, so
 * every in-flight review dies without posting anything, which is the one
 * outcome this app must never produce. Per-call caps do not compose into a
 * run-level bound: 2 reviews x (20min orchestrator + several 10min git calls)
 * exceeds the unit's 50 minutes on arithmetic alone.
 *
 * A review already started is allowed to finish; only the decision to begin
 * ANOTHER is gated. Anything not started is picked up on the next tick, which
 * is 5 minutes away.
 */
const RUN_BUDGET_MS = numberEnv('PR_REVIEWER_RUN_BUDGET_MS', 25 * 60_000);

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

/**
 * Report a failed review on the PR itself, once per distinct failure.
 *
 * Every way a review can fail funnels through here — a returned {ok:false} and
 * any thrown error alike. Logging to a file on the VPS is not reporting: from
 * the PR's side, a reviewer that crashed silently is indistinguishable from
 * one that found nothing, and that is the single outcome this tool must never
 * fake. The SHA is deliberately NOT marked reviewed, so the next poll retries.
 */
async function reportFailure(token, pr, head, error, state) {
  log(`PR #${pr.number} — review failed: ${String(error).split('\n')[0]}`);
  if (CONFIG.dryRun) {
    console.log(renderFailureBody(String(error), head));
    return;
  }
  if (alreadyReportedFailure(state, head, error)) {
    log(`PR #${pr.number} — same failure already reported for this SHA, not reposting`);
    return;
  }
  try {
    // Deliberately UNPINNED. A failure comment is about the run, not about
    // the code, and pinning it to a sha that no longer exists after a
    // force-push makes GitHub reject the post — turning a reported failure
    // into a log-only one, which is the exact outcome this function exists to
    // prevent. The sha is named in the body instead.
    await postReview(token, CONFIG.repo, pr.number, renderFailureBody(String(error), head), []);
    markFailureReported(state, head, error);
    saveState(CONFIG.stateFile, state);
  } catch (e) {
    // If GitHub itself is the thing that is broken there is nowhere left to
    // report to; the log is the last resort, not the first.
    log(`PR #${pr.number} — could not post failure comment: ${e.message}`);
  }
}

/** Our own bot login, resolved once per run; null if the lookup failed. */
let botLogin = null;

async function reviewOne(token, pr, template, state) {
  const started = Date.now();
  const head = pr.head.sha;
  log(`PR #${pr.number} "${pr.title}" @ ${head.slice(0, 8)} — reviewing`);

  let dir;
  try {
    // Inside the try, so a clone failure is REPORTED on the PR rather than
    // exiting main() silently. By this point the token is valid, so the
    // reviewer is fully able to comment and simply wouldn't — the exact
    // outcome CLAUDE.md says it must never produce. Cheap after the first
    // call: it is an existence check.
    ensureMirror(CONFIG.mirrorDir, CONFIG.repo, token);
    dir = makeWorktree(CONFIG.mirrorDir, CONFIG.worktreeRoot, pr.number, head, pr.base.ref, token);
    const base = mergeBase(dir, pr.base.ref, head);
    const prompt = renderPrompt(template, {
      NUMBER: pr.number,
      REPO: CONFIG.repo,
      // Attacker-controlled on a public repo, even with the author allowlist:
      // these three fields are the ones a PR author writes freely.
      TITLE: escapeUntrusted(pr.title),
      AUTHOR: escapeUntrusted(pr.user?.login ?? 'unknown'),
      BASE: pr.base.ref,
      HEAD_SHA: head,
      MERGE_BASE: base,
      BODY: escapeUntrusted(pr.body ?? '').slice(0, 8000) || '_(no description provided)_',
    });

    const result = await runOrchestrator({
      cwd: dir,
      prompt,
      pluginDir: CONFIG.pluginDir,
      model: CONFIG.model,
      timeoutMs: CONFIG.timeoutMs,
      logger: log,
    });

    if (!result.ok) {
      await reportFailure(token, pr, head, result.error, state);
      return;
    }
    if (result.rejected?.length) {
      // Not fatal — the valid findings still ship — but never silent: a
      // malformed finding means the model drifted from the schema, and that
      // is worth seeing in the log rather than inferring from a short review.
      log(`PR #${pr.number} — dropped ${result.rejected.length} malformed finding(s)`);
    }

    // The head can move during the minutes a review takes. Everything below
    // is about the sha we READ: the review is pinned to it, but the inline
    // anchors come from listPullFiles, which always describes the CURRENT
    // head — mismatched anchors make GitHub 422 the entire review, losing it.
    // Rather than reconcile two commits, abandon: the new head is unreviewed,
    // so the next tick picks it up five minutes later and reviews what is
    // actually there. This narrows the window rather than closing it — a push
    // landing between this probe and the post still races — but it removes
    // the common case at no cost.
    // A dry run posts nothing, so there is nothing to go stale — and probing
    // would make `PR_REVIEWER_DRY_RUN=1` unable to re-render an old sha,
    // which is the entire point of that mode.
    //
    // A transient GitHub error here must not discard a completed review, so
    // the probe fails OPEN: if we cannot tell whether the head moved, post.
    // The worst case is the 422 this check exists to avoid, which is visible;
    // the alternative silently throws away minutes of finished work.
    let fresh = null;
    if (!CONFIG.dryRun) {
      try {
        fresh = await gh(token, `/repos/${CONFIG.repo}/pulls/${pr.number}`);
      } catch (e) {
        log(`PR #${pr.number} — could not re-check head (${e.message}); posting anyway`);
      }
    }
    if (fresh && fresh.head.sha !== head) {
      log(`PR #${pr.number} — head moved ${head.slice(0, 8)} → ${fresh.head.sha.slice(0, 8)} during review; discarding, next tick will re-review`);
      // A prior APPROVE pinned to the sha we just reviewed is now stale: the
      // head has moved past it and this run posts nothing. Leaving it means
      // the gate reads green for code no review covers. Withdrawn on the same
      // best-effort terms as the post-review path.
      if (botLogin) {
        try {
          await dismissStaleApprovals(token, CONFIG.repo, pr.number, botLogin, fresh.head.sha, log);
        } catch (e) {
          log(`PR #${pr.number} — could not dismiss stale approvals after head move: ${e.message}`);
        }
      }
      return;
    }

    const files = await listPullFiles(token, CONFIG.repo, pr.number);
    const post = buildReviewPost({
      summary: result.data.summary,
      strengths: result.data.strengths,
      findings: result.data.findings,
      rejectedCount: result.rejected?.length ?? 0,
      addressableLines: addressableMap(files),
      headSha: head,
      durationMs: Date.now() - started,
    });

    if (CONFIG.dryRun) {
      console.log(`\n===== DRY RUN: would post ${post.event} for PR #${pr.number} =====\n${post.body}`);
      for (const c of post.comments) console.log(`\n--- inline ${c.path}:${c.line} ---\n${c.body}`);
    } else {
      await postReview(token, CONFIG.repo, pr.number, post.body, post.comments, post.event, post.commitId);
      // The review is posted. Everything after this point is cleanup, and
      // NOTHING here may throw: an exception would reach reviewOne's catch,
      // report a successful review as a failure, and skip markReviewed — so
      // the next tick would post the whole review a second time.
      // dismissStaleApprovals guards each dismissal individually but its
      // listReviews call was unguarded, which is exactly that path.
      if (post.event !== 'APPROVE' && botLogin) {
        try {
          await dismissStaleApprovals(token, CONFIG.repo, pr.number, botLogin, head, log);
        } catch (e) {
          // A surviving stale approval is visible on the PR and recoverable
          // next tick; a duplicated review is neither.
          log(`PR #${pr.number} — could not dismiss stale approvals: ${e.message}`);
        }
      }
      markReviewed(state, head);
      try {
        saveState(CONFIG.stateFile, state);
      } catch (e) {
        // Same rule as the dismissal above, and it was left unguarded one
        // line below the comment stating it: a throw here reports a posted
        // review as a failure AND loses the ledger write, so the next tick
        // posts the whole review again. An unwritten ledger entry costs one
        // duplicate review at worst; a throw costs one guaranteed duplicate
        // plus a false failure comment.
        log(`PR #${pr.number} — review posted but ledger write failed: ${e.message}`);
      }
    }
    log(
      `PR #${pr.number} — ${CONFIG.dryRun ? 'dry run' : 'posted'} ${post.event} (${result.data.findings.length} findings, ${post.comments.length} inline) in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  } finally {
    if (dir) removeWorktree(CONFIG.mirrorDir, dir, log);
  }
}

async function main() {
  const creds = reviewerCredentials(CONFIG.envFile);
  const token = await installationToken(creds);
  try {
    botLogin = await appLogin(creds);
  } catch (e) {
    // Degrades to "cannot dismiss stale approvals", which is logged at the
    // point it matters rather than failing the whole run.
    log(`could not resolve own bot login (${e.message}); stale approvals will not be dismissed`);
  }

  const state = loadState(CONFIG.stateFile);
  const template = loadPromptTemplate(APP_DIR);
  const pulls = await listOpenPulls(token, CONFIG.repo);

  const { reviewable, skipped, declined } = selectPulls(pulls, {
    allowedAuthors: CONFIG.allowedAuthors,
    includeDrafts: CONFIG.includeDrafts,
    onlyPr: CONFIG.onlyPr,
    dryRun: CONFIG.dryRun,
    isReviewed: (sha) => wasReviewed(state, sha),
  });

  // Allowlist declines are reported every tick — "the reviewer ignored my PR"
  // and "the reviewer is broken" must not look the same. The size of that set
  // is chosen by whoever opens PRs on a public repo and the timer fires 288
  // times a day into an unrotated log, so it collapses to a count plus a
  // sample. Routine skips (draft, onlyPr, already-reviewed) are summarised
  // separately: they are expected, but the claim that nothing is dropped
  // silently has to be true of them too.
  if (declined.length > 0) {
    const sample = declined.slice(0, DECLINE_SAMPLE).map((d) => `#${d.pr.number} (${d.reason})`);
    const more = declined.length > DECLINE_SAMPLE ? `, +${declined.length - DECLINE_SAMPLE} more` : '';
    log(`declined ${declined.length} of ${pulls.length} open: ${sample.join(', ')}${more}`);
  }

  const routine = skipped.filter((s) => s.kind === 'routine');
  if (routine.length > 0) {
    const byReason = new Map();
    for (const s of routine) byReason.set(s.reason.replace(/ at [0-9a-f]{8}$/, ''), (byReason.get(s.reason.replace(/ at [0-9a-f]{8}$/, '')) ?? 0) + 1);
    log(`skipped ${routine.length}: ${[...byReason].map(([r, n]) => `${n} ${r}`).join(', ')}`);
  }

  if (reviewable.length === 0) {
    // Name the declined count here too. Otherwise a typo'd allowlist that
    // declines everything prints the same line as a healthy idle tick, and
    // CLAUDE.md's rule is that a misconfigured reviewer must look broken
    // rather than idle.
    const why = declined.length > 0 ? `, ${declined.length} declined by allowlist` : '';
    log(`no reviewable PRs (${pulls.length} open${why})`);
    return;
  }
  log(`${reviewable.length} reviewable of ${pulls.length} open; reviewing up to ${CONFIG.maxPerRun}`);

  const runStarted = Date.now();
  for (const pr of reviewable.slice(0, CONFIG.maxPerRun)) {
    const elapsed = Date.now() - runStarted;
    if (elapsed > RUN_BUDGET_MS) {
      log(`run budget spent (${Math.round(elapsed / 60000)}m); deferring PR #${pr.number} to the next tick`);
      break;
    }
    try {
      await reviewOne(token, pr, template, state);
    } catch (e) {
      // One bad PR must not stop the others, and must not be silent — on the
      // PR, not just in a log nobody is watching.
      log(`PR #${pr.number} — ERROR ${e.stack ?? e.message}`);
      await reportFailure(token, pr, pr.head.sha, e.message ?? String(e), state);
    }
  }
}

/**
 * Only run when executed directly, never on import.
 *
 * This module used to self-invoke unconditionally, which made it impossible
 * to import from a test — so nothing covered the wiring here, and on
 * 2026-08-10 a missing export in github.mjs shipped with a fully green suite
 * and took the reviewer down until the next log was read. `node --check`
 * cannot catch it either: the syntax is fine, the binding simply is not
 * there. Importing the module is what proves its imports resolve.
 */
export const isDirectRun = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    log(`FATAL ${e.stack ?? e.message}`);
    process.exit(1);
  });
}

export { CONFIG, main, reviewOne };
