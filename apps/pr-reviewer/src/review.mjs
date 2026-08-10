/**
 * Run one review: worktree at the PR head → headless Claude orchestrator →
 * validated findings object.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'important', 'suggestion'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          agent: { type: 'string' },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Below this, a summary carrying zero findings reads as a non-answer rather
 * than a clean review ("Test", "ok", ""). Only consulted when the run found
 * nothing — a short summary alongside real findings is fine.
 */
export const MIN_SUMMARY_CHARS = 20;

/** Ordering used everywhere findings are grouped or counted. */
export const SEVERITIES = ['critical', 'important', 'suggestion'];

/**
 * Neutralise markup in attacker-controlled text.
 *
 * The orchestrator prompt wraps a PR's title, author and body in an
 * <untrusted-pr-metadata> fence and tells the agent that everything inside it
 * is data, not instructions. That fence is only worth anything if the
 * attacker cannot close it: a PR body containing
 * `</untrusted-pr-metadata>` followed by new instructions would otherwise
 * place attacker text OUTSIDE the fence, at operator authority, in front of a
 * root agent whose output is published to a public PR.
 *
 * Escaping every angle bracket — not just the fence tag — is deliberate.
 * Blocklisting the specific tag invites the next variant (whitespace inside
 * the tag, a nested fence, a different tag the prompt later starts using),
 * and the model reads `&lt;` perfectly well.
 */
export function escapeUntrusted(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Substitute template variables. Values are inserted verbatim — callers pass
 * attacker-controlled fields through escapeUntrusted() first (see poll.mjs).
 */
export function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

/** Cap on any single git call. See the timeout rationale in git(). */
export const GIT_TIMEOUT_MS = 10 * 60_000;

/**
 * Git, authenticated as the reviewer's own installation token.
 *
 * The token rides in GIT_CONFIG_* env vars rather than the argv (`-c
 * http.extraheader=...`) so it does not appear in `ps` output. It is
 * short-lived (1 hour) and scoped to this installation. Note it is NOT
 * read-only overall — it carries pull_requests:write, which is what posts the
 * review; what it lacks is contents:write. HTTPS is used rather than the SSH
 * deploy key because that key CAN push, lives in /root/.ssh, and the sandbox
 * deliberately makes that directory inaccessible.
 *
 * Every call is bounded, because these are network-bound and were previously
 * unbounded. A systemd kill runs no catch and no finally, so a hang posted
 * nothing to any PR — the one outcome this app must never produce.
 *
 * NOTE this bounds a single CALL, not a run. Bounding the run is poll.mjs's
 * job (RUN_BUDGET_MS): per-call caps alone do not compose into a run-level
 * guarantee, and claiming otherwise was the bug in the previous version of
 * this comment — 2 reviews x (20min orchestrator + 3 git calls x 10min) can
 * exceed a 50-minute TimeoutStartSec on arithmetic alone.
 */
function git(cwd, token, ...args) {
  const env = { ...process.env };
  // GIT_TRACE / GIT_TRACE_CURL / GIT_CURL_VERBOSE print request headers,
  // including the Authorization header built below, to stderr — which this
  // service carries into the failure comment it posts on a PUBLIC PR. An
  // ambient debug flag must not be able to leak the token.
  for (const k of Object.keys(env)) {
    if (k.startsWith('GIT_TRACE') || k === 'GIT_CURL_VERBOSE') delete env[k];
  }
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
  }).trim();
}

/**
 * A bare mirror the reviewer owns outright, under /var/lib/pr-reviewer.
 *
 * It used to fetch into /srv/benloe and build worktrees there. That is the
 * live production checkout every service deploys from, so the reviewer was
 * mutating production git state (fetching, pruning, adding worktrees) just to
 * read a diff. The sandbox added in the hardening pass then made /srv/benloe
 * read-only and every review died with "cannot open '.git/FETCH_HEAD'" — the
 * config caught a design mistake that was already there.
 *
 * Owning a mirror fixes both: production is never touched, and the sandbox can
 * stay strict because the only writable path is one this service owns.
 */
export function ensureMirror(mirrorDir, repo, token) {
  if (existsSync(join(mirrorDir, 'HEAD'))) return mirrorDir;
  // A mirrorDir that exists WITHOUT a HEAD is a wedged state, not a fresh
  // start: renameSync onto a non-empty directory throws ENOTEMPTY, so every
  // future run would fail identically until a human intervened. Clear it —
  // there is nothing in it worth keeping, by definition.
  rmSync(mirrorDir, { recursive: true, force: true });
  // Clone to a scratch path and rename into place. `git clone --mirror`
  // writes HEAD before the object transfer finishes, so a SIGKILL (the 50min
  // TimeoutStartSec), an OOM kill, or a reboot mid-clone would otherwise
  // leave a directory that satisfies the existence check with an incomplete
  // object store — and every later run would take the fast path forever,
  // needing a human with rm -rf. Rename is atomic; a partial scratch dir is
  // just discarded next time.
  const parent = dirname(mirrorDir);
  const scratch = `${mirrorDir}.partial`;
  mkdirSync(parent, { recursive: true });
  rmSync(scratch, { recursive: true, force: true });
  git(parent, token, 'clone', '--mirror', `https://github.com/${repo}.git`, scratch);
  renameSync(scratch, mirrorDir);
  return mirrorDir;
}

/**
 * Check the PR head out into a throwaway worktree of the reviewer's own bare
 * mirror (ensureMirror). Nothing here touches /srv/benloe — that is the live
 * production checkout, and a reviewer that fetched or moved HEAD there would
 * be mutating production to read a diff.
 */
export function makeWorktree(mirrorDir, root, number, headSha, baseRef, token) {
  const dir = join(root, `pr-${number}`);
  rmSync(dir, { recursive: true, force: true });
  git(mirrorDir, token, 'worktree', 'prune');
  // BOTH refs, always. The base is fetched because mergeBase() resolves
  // origin/<base>: a stale remote-tracking ref yields a merge base older than
  // the true one, so the review diff picks up commits already merged into the
  // base and the reviewer reports findings on code this PR never touched —
  // exactly the cry-wolf failure the orchestrator prompt guards against.
  git(mirrorDir, token, 'fetch', 'origin', `pull/${number}/head`, `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`, '--quiet');
  git(mirrorDir, token, 'worktree', 'add', '--detach', dir, headSha);
  return dir;
}

export function removeWorktree(mirrorDir, dir, logger) {
  try {
    git(mirrorDir, null, 'worktree', 'remove', '--force', dir);
    return;
  } catch (e) {
    logger?.(`worktree remove failed for ${dir}, falling back to rm: ${e.message}`);
  }
  try {
    // A worktree that git has already forgotten still leaves a directory
    // behind; removing it directly is the whole point of the fallback.
    rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // Called from a finally, so an unguarded throw here would REPLACE the
    // exception that caused the cleanup and hide the real diagnostic. Leaking
    // a stale directory is recoverable (the next run rmSync's it first); a
    // lost stack trace is not.
    logger?.(`could not remove worktree ${dir}: ${e.message}`);
  }
}

export function mergeBase(dir, baseRef, headSha) {
  return git(dir, null, 'merge-base', `refs/remotes/origin/${baseRef}`, headSha);
}

/**
 * Tools the orchestrator and its subagents may use.
 *
 * An allowlist, not a denylist: the reviewer runs unattended against branches
 * written by agents, so the safe default for anything not named here is
 * "denied". Write, Edit, and every mutating git subcommand are absent on
 * purpose — see the read-only constraint in prompts/orchestrator.md.
 */
export const ALLOWED_TOOLS = [
  'Task',
  'Read',
  'Grep',
  'Glob',
  'TodoWrite',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git status:*)',
  'Bash(git merge-base:*)',
  'Bash(git ls-files:*)',
  'Bash(rg:*)',
  'Bash(ls:*)',
  'Bash(wc:*)',
];

/**
 * The environment the review agent runs in.
 *
 * git() only ever sets GIT_CONFIG_* on a per-call copy, so the token should
 * never be on process.env in the first place — this deletes it anyway. The
 * agent publishes to a public PR, so anything reaching its environment is one
 * `env` away from being quoted there, and "should never" is not a control.
 */
export function agentEnv(base = process.env) {
  const env = { ...base, CLAUDE_CODE_ENTRYPOINT: 'pr-reviewer' };
  for (const k of Object.keys(env)) {
    if (k.startsWith('GIT_CONFIG')) delete env[k];
  }
  return env;
}

/**
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string}>}
 * Never throws for a review that simply went badly — a failed review must not
 * take the poller down with it, or one malformed PR blocks every later one.
 */
export function runOrchestrator({ cwd, prompt, pluginDir, model, timeoutMs, logger }) {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(FINDINGS_SCHEMA),
    '--plugin-dir',
    pluginDir,
    '--model',
    model,
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    ALLOWED_TOOLS.join(' '),
    '--no-session-persistence',
  ];

  return new Promise((resolve) => {
    const child = spawn('claude', args, {
      cwd,
      env: agentEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `orchestrator exceeded ${Math.round(timeoutMs / 60000)}m timeout` });
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `spawn failed: ${e.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const tail = stderr.trim().slice(-1200);
      if (tail) logger?.(`claude stderr: ${tail}`);
      if (code !== 0) {
        // `code` is null when the process died from a signal, so report the
        // signal instead of the useless "exited null" — and carry the stderr
        // into the error itself, because the failure comment posted to the PR
        // is the only place most people will ever see it.
        const how = signal ? `killed by ${signal}` : `exited ${code}`;
        return resolve({ ok: false, error: `claude ${how}${tail ? `\n\n${tail}` : ''}` });
      }
      resolve(parseResult(stdout));
    });
  });
}

/**
 * Pull the structured object out of `--output-format json`.
 *
 * The `result` field is a JSON *string* under --json-schema, so this is two
 * parses deep. Both are attempted defensively: a schema-validated response is
 * the norm, but a CLI-level error (auth, rate limit) also arrives as valid
 * outer JSON with an error-shaped payload, and that must read as a failed
 * review rather than an empty successful one.
 */
export function parseResult(stdout) {
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    return { ok: false, error: `unparseable CLI output: ${stdout.slice(0, 300)}` };
  }
  if (outer.is_error) return { ok: false, error: `CLI reported error: ${String(outer.result).slice(0, 400)}` };
  const raw = outer.result;
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: `result was not JSON: ${raw.slice(0, 300)}` };
    }
  }
  if (!data || typeof data !== 'object' || typeof data.summary !== 'string' || !Array.isArray(data.findings)) {
    return { ok: false, error: 'result did not match the findings schema' };
  }
  // A vacuous summary is only a problem when it would produce an APPROVE.
  // The previous version discarded ANY short-summary run — including one that
  // found real critical findings, which is strictly worse than the bug it
  // fixed. Guard the auto-approve path only: no findings AND nothing
  // meaningful said means the run reviewed nothing, so retry rather than
  // report a clean bill of health.
  if (data.findings.length === 0 && data.summary.trim().length < MIN_SUMMARY_CHARS) {
    return {
      ok: false,
      error: `orchestrator returned no findings and no real summary (${JSON.stringify(data.summary.slice(0, 60))})`,
    };
  }
  // Re-validate every finding rather than trusting the constrained decoder.
  // FINDINGS_SCHEMA is enforced by the CLI, but this is the only boundary
  // between model output and the renderer, and a finding with a bad severity
  // renders into no section at all — it would be silently dropped while still
  // being counted, which is the worst possible failure for a review tool.
  const findings = [];
  const rejected = [];
  for (const f of data.findings) {
    if (
      f &&
      typeof f === 'object' &&
      SEVERITIES.includes(f.severity) &&
      typeof f.title === 'string' &&
      f.title.length > 0 &&
      typeof f.detail === 'string' &&
      (f.file === undefined || typeof f.file === 'string') &&
      (f.line === undefined || Number.isInteger(f.line)) &&
      (f.agent === undefined || typeof f.agent === 'string')
    ) {
      findings.push(f);
    } else {
      rejected.push(f);
    }
  }
  return { ok: true, data: { ...data, findings }, rejected };
}

export function loadPromptTemplate(dir) {
  return readFileSync(join(dir, 'prompts', 'orchestrator.md'), 'utf8');
}
