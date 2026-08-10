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
import { addressableMap, partitionFindings } from './diff.mjs';
import { inlineComment, renderFailureBody, renderReviewBody } from './format.mjs';
import { installationToken, listOpenPulls, listPullFiles, postReview, reviewerCredentials } from './github.mjs';
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
    await postReview(token, CONFIG.repo, pr.number, renderFailureBody(String(error), head), []);
    markFailureReported(state, head, error);
    saveState(CONFIG.stateFile, state);
  } catch (e) {
    // If GitHub itself is the thing that is broken there is nowhere left to
    // report to; the log is the last resort, not the first.
    log(`PR #${pr.number} — could not post failure comment: ${e.message}`);
  }
}

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

    const files = await listPullFiles(token, CONFIG.repo, pr.number);
    const { inline, body } = partitionFindings(result.data.findings, addressableMap(files));
    const reviewBody = renderReviewBody({
      summary: result.data.summary,
      strengths: result.data.strengths,
      bodyFindings: body,
      inlineFindings: inline,
      headSha: head,
      durationMs: Date.now() - started,
    });

    if (CONFIG.dryRun) {
      console.log(`\n===== DRY RUN: review body for PR #${pr.number} =====\n${reviewBody}`);
      for (const c of inline.map(inlineComment)) console.log(`\n--- inline ${c.path}:${c.line} ---\n${c.body}`);
    } else {
      await postReview(token, CONFIG.repo, pr.number, reviewBody, inline.map(inlineComment));
      markReviewed(state, head);
      saveState(CONFIG.stateFile, state);
    }
    log(
      `PR #${pr.number} — ${CONFIG.dryRun ? 'dry run' : 'posted'} (${result.data.findings.length} findings, ${inline.length} inline) in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  } finally {
    if (dir) removeWorktree(CONFIG.mirrorDir, dir, log);
  }
}

async function main() {
  const token = await installationToken(reviewerCredentials(CONFIG.envFile));

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

main().catch((e) => {
  log(`FATAL ${e.stack ?? e.message}`);
  process.exit(1);
});

export { CONFIG };
