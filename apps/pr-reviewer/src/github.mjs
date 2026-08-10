/**
 * GitHub App REST client — zero dependencies.
 *
 * Auth deliberately goes through the benloe-pr-reviewer GitHub App rather than
 * a personal `gh` token: the App's installation token is minted fresh on every
 * poll from credentials in /srv/benloe/.env, so an unattended timer can never
 * be blocked by a human-expired OAuth token. (The `gh` CLI token on this box
 * was already expired when this was written — exactly the failure mode a
 * scheduled reviewer must not inherit.)
 */
import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = 'https://api.github.com';

/**
 * Parse the subset of /srv/benloe/.env this service needs.
 *
 * Deliberately narrow: it returns ONLY the requested keys, so a bug here can
 * never widen into "the whole secrets file is now in a variable someone logs".
 * Values may be quoted; anything after the first `=` is the value (base64 keys
 * contain no `=` ambiguity but do contain padding `=`, so split-on-first).
 */
export function readEnvKeys(path, keys) {
  const wanted = new Set(keys);
  const out = {};
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`cannot read env file ${path}: ${e.message}`);
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * RS256 JWT for the App itself. `iat` is backdated 60s because GitHub rejects
 * a token whose issued-at is even slightly in the future relative to their
 * clock, and small NTP skew on a VPS is normal.
 */
export function appJwt(appId, privateKeyPem, nowSec) {
  const iat = nowSec - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 540, iss: String(appId) }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${b64url(signer.sign(privateKeyPem))}`;
}

async function gh(token, path, init = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'benloe-pr-reviewer',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * The reviewer's own GitHub App credentials.
 *
 * Deliberately NO fallback to the cabinet-benloe app if these are missing.
 * That app holds contents:write, so a fallback would mean a misconfigured
 * deployment silently upgrading the reviewer from a read-only identity to one
 * that can push to main — privilege escalation by typo, and invisible because
 * everything would keep working. Fail closed and loudly instead.
 *
 * Key names match what is already in /srv/benloe/.env. Note the PR_REVIEWER_
 * prefix is shared with this app's runtime config (PR_REVIEWER_MODEL and
 * friends); that is a namespace collision, not two systems.
 */
export function reviewerCredentials(envFile) {
  const KEYS = {
    appId: 'PR_REVIEWER_APP_ID',
    installationId: 'PR_REVIEWER_INSTALLATION_ID',
    privateKey: 'PR_REVIEWER_PRIVATE_KEY_B64',
  };
  const env = readEnvKeys(envFile, Object.values(KEYS));
  const missing = Object.values(KEYS).filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(', ')} in ${envFile} — the reviewer authenticates as the benloe-pr-reviewer App ` +
        `(pull_requests:write, and deliberately no contents:write) and will not fall back to a write-capable identity`,
    );
  }
  // Buffer.from(x, 'base64') NEVER throws — it silently discards non-alphabet
  // characters and stops at the first padding run. So a wrapped key (GNU
  // `base64` breaks at 76 columns, and readEnvKeys takes one line per key)
  // passes the presence check above, decodes to a truncated DER prefix, and
  // only surfaces much later as an OpenSSL "DECODER routines::unsupported"
  // that names neither the variable nor the file. Validate at the chokepoint,
  // the way integrations/githubApp.ts already does.
  const privateKeyPem = Buffer.from(env[KEYS.privateKey], 'base64').toString('utf8');
  try {
    createPrivateKey(privateKeyPem);
  } catch (e) {
    throw new Error(`${KEYS.privateKey} in ${envFile} is not a valid private key once base64-decoded: ${e.message}`);
  }
  return { appId: env[KEYS.appId], installationId: env[KEYS.installationId], privateKeyPem };
}

export async function installationToken({ appId, installationId, privateKeyPem }) {
  const jwt = appJwt(appId, privateKeyPem, Math.floor(Date.now() / 1000));
  const body = await gh(jwt, `/app/installations/${installationId}/access_tokens`, { method: 'POST' });
  return body.token;
}

export const listOpenPulls = (token, repo) =>
  gh(token, `/repos/${repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`);

/**
 * Every changed file, paginated. GitHub caps per_page at 100 and silently
 * clamps anything larger, so a >100-file PR would otherwise build its
 * addressable-line map from the first 100 only — every later finding would be
 * demoted to the body with no signal that coverage had quietly degraded.
 * GitHub itself stops at 3000 files; the page cap here is the same ceiling.
 */
export async function listPullFiles(token, repo, number) {
  const all = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await gh(token, `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/**
 * Post the review. `event` is APPROVE when the review found nothing blocking
 * and COMMENT otherwise — never REQUEST_CHANGES (see REVIEW_EVENT).
 *
 * Approving is only possible because the reviewer is a SEPARATE identity from
 * the author: GitHub refuses to let an account approve its own pull request,
 * so this would have been impossible while everything ran as cabinet-benloe.
 */
export const postReview = (token, repo, number, body, comments, event = 'COMMENT', commitId) =>
  gh(token, `/repos/${repo}/pulls/${number}/reviews`, {
    method: 'POST',
    body: JSON.stringify({
      event,
      body,
      // Pin the review to the SHA that was actually read. Without commit_id
      // GitHub attaches the review to whatever the PR head is at submission
      // time — and a review takes minutes, so a commit pushed during that
      // window would receive an APPROVE for code no one reviewed. Harmless
      // while every review was a COMMENT; not harmless now that approval is
      // the merge gate.
      ...(commitId ? { commit_id: commitId } : {}),
      ...(comments?.length ? { comments } : {}),
    }),
  });

export { gh };
