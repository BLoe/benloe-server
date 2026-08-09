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
export function makeWorktree(repoDir, root, number, headSha) {
  const dir = join(root, `pr-${number}`);
  rmSync(dir, { recursive: true, force: true });
  git(repoDir, 'worktree', 'prune');
  git(repoDir, 'fetch', 'origin', `pull/${number}/head`, '--quiet');
  git(repoDir, 'worktree', 'add', '--detach', dir, headSha);
  return dir;
}

export function removeWorktree(repoDir, dir) {
  try {
    git(repoDir, 'worktree', 'remove', '--force', dir);
  } catch {
    // A worktree that git has already forgotten still leaves a directory
    // behind; removing it directly is the whole point of the fallback.
    rmSync(dir, { recursive: true, force: true });
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
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stderr.trim()) logger?.(`claude stderr: ${stderr.trim().slice(0, 2000)}`);
      if (code !== 0) return resolve({ ok: false, error: `claude exited ${code}` });
      const parsed = parseResult(stdout);
      resolve(parsed);
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
  return { ok: true, data };
}

export function loadPromptTemplate(dir) {
  return readFileSync(join(dir, 'prompts', 'orchestrator.md'), 'utf8');
}
