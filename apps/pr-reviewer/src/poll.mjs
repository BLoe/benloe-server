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

import { addressableMap, partitionFindings } from './diff.mjs';
import { inlineComment, renderFailureBody, renderReviewBody } from './format.mjs';
import { installationToken, listOpenPulls, listPullFiles, postReview, readEnvKeys } from './github.mjs';
import { loadPromptTemplate, makeWorktree, mergeBase, removeWorktree, renderPrompt, runOrchestrator } from './review.mjs';
import { loadState, markReviewed, saveState, wasReviewed } from './state.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  repo: process.env.PR_REVIEWER_REPO ?? 'BLoe/benloe-server',
  repoDir: process.env.PR_REVIEWER_REPO_DIR ?? '/srv/benloe',
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
  maxPerRun: Number(process.env.PR_REVIEWER_MAX_PER_RUN ?? 2),
  timeoutMs: Number(process.env.PR_REVIEWER_TIMEOUT_MS ?? 20 * 60_000),
  /** Draft PRs are work in progress; reviewing them is noise, not signal. */
  includeDrafts: process.env.PR_REVIEWER_INCLUDE_DRAFTS === '1',
  /**
   * Run the full pipeline but print the review instead of posting it, and
   * leave the state ledger untouched. This is how you tune
   * prompts/orchestrator.md without spraying revisions across a real PR.
   */
  dryRun: process.env.PR_REVIEWER_DRY_RUN === '1',
  /** Restrict a run to one PR number. Only useful alongside a dry run. */
  onlyPr: process.env.PR_REVIEWER_ONLY_PR ? Number(process.env.PR_REVIEWER_ONLY_PR) : null,
};

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

async function reviewOne(token, pr, template, state) {
  const started = Date.now();
  const head = pr.head.sha;
  log(`PR #${pr.number} "${pr.title}" @ ${head.slice(0, 8)} — reviewing`);

  let dir;
  try {
    dir = makeWorktree(CONFIG.repoDir, CONFIG.worktreeRoot, pr.number, head);
    const base = mergeBase(dir, pr.base.ref, head);
    const prompt = renderPrompt(template, {
      NUMBER: pr.number,
      REPO: CONFIG.repo,
      TITLE: pr.title,
      AUTHOR: pr.user?.login ?? 'unknown',
      BASE: pr.base.ref,
      HEAD_SHA: head,
      MERGE_BASE: base,
      BODY: (pr.body ?? '').slice(0, 8000) || '_(no description provided)_',
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
      // Post the failure rather than staying quiet. A reviewer that fails
      // silently is indistinguishable from one that found nothing, and the
      // SHA is deliberately NOT marked reviewed so the next poll retries.
      log(`PR #${pr.number} — review failed: ${result.error}`);
      if (CONFIG.dryRun) console.log(renderFailureBody(result.error, head));
      else await postReview(token, CONFIG.repo, pr.number, renderFailureBody(result.error, head), []);
      return;
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
    if (dir) removeWorktree(CONFIG.repoDir, dir);
  }
}

async function main() {
  const env = readEnvKeys(CONFIG.envFile, [
    'GITHUB_APP_ID',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_APP_PRIVATE_KEY_B64',
  ]);
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY_B64) {
    throw new Error(`GITHUB_APP_{ID,INSTALLATION_ID,PRIVATE_KEY_B64} missing from ${CONFIG.envFile}`);
  }
  const token = await installationToken({
    appId: env.GITHUB_APP_ID,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
    privateKeyPem: Buffer.from(env.GITHUB_APP_PRIVATE_KEY_B64, 'base64').toString('utf8'),
  });

  const state = loadState(CONFIG.stateFile);
  const template = loadPromptTemplate(APP_DIR);
  const pulls = await listOpenPulls(token, CONFIG.repo);

  const pending = pulls.filter((pr) => {
    if (CONFIG.onlyPr !== null && pr.number !== CONFIG.onlyPr) return false;
    if (pr.draft && !CONFIG.includeDrafts) return false;
    // A dry run deliberately ignores the ledger — the point is to re-review
    // the same SHA repeatedly while tuning the orchestrator prompt.
    return CONFIG.dryRun || !wasReviewed(state, pr.head.sha);
  });

  if (pending.length === 0) {
    log(`no unreviewed PRs (${pulls.length} open)`);
    return;
  }
  log(`${pending.length} unreviewed of ${pulls.length} open; reviewing up to ${CONFIG.maxPerRun}`);

  for (const pr of pending.slice(0, CONFIG.maxPerRun)) {
    try {
      await reviewOne(token, pr, template, state);
    } catch (e) {
      // One bad PR must not stop the others, and must not be silent.
      log(`PR #${pr.number} — ERROR ${e.stack ?? e.message}`);
    }
  }
}

main().catch((e) => {
  log(`FATAL ${e.stack ?? e.message}`);
  process.exit(1);
});

export { CONFIG };
