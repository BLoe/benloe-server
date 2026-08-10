/**
 * Run one review: worktree at the PR head → headless Claude orchestrator →
 * validated findings object.
 */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/**
 * Check the PR head out into a throwaway worktree.
 *
 * A worktree rather than a branch checkout in the monorepo itself: the live
 * checkout at /srv/benloe is what the running services are deployed from, and
 * a reviewer that moves its HEAD would be editing production to read a diff.
 */
export function makeWorktree(repoDir, root, number, headSha, baseRef) {
  const dir = join(root, `pr-${number}`);
  rmSync(dir, { recursive: true, force: true });
  git(repoDir, 'worktree', 'prune');
  // BOTH refs, always. The base is fetched because mergeBase() resolves
  // origin/<base>: a stale remote-tracking ref yields a merge base older than
  // the true one, so the review diff picks up commits already merged into the
  // base and the reviewer reports findings on code this PR never touched —
  // exactly the cry-wolf failure the orchestrator prompt guards against.
  git(repoDir, 'fetch', 'origin', `pull/${number}/head`, baseRef, '--quiet');
  git(repoDir, 'worktree', 'add', '--detach', dir, headSha);
  return dir;
}

export function removeWorktree(repoDir, dir, logger) {
  try {
    git(repoDir, 'worktree', 'remove', '--force', dir);
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
  return git(dir, 'merge-base', `origin/${baseRef}`, headSha);
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
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'pr-reviewer' },
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
