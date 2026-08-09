/**
 * GitHub App REST client — zero dependencies.
 *
 * Auth deliberately goes through the cabinet-benloe GitHub App rather than a
 * personal `gh` token: the App's installation token is minted fresh on every
 * poll from credentials in /srv/benloe/.env, so an unattended timer can never
 * be blocked by a human-expired OAuth token. (The `gh` CLI token on this box
 * was already expired when this was written — exactly the failure mode a
 * scheduled reviewer must not inherit.)
 */
import { createSign } from 'node:crypto';
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

export async function installationToken({ appId, installationId, privateKeyPem }) {
  const jwt = appJwt(appId, privateKeyPem, Math.floor(Date.now() / 1000));
  const body = await gh(jwt, `/app/installations/${installationId}/access_tokens`, { method: 'POST' });
  return body.token;
}

export const listOpenPulls = (token, repo) =>
  gh(token, `/repos/${repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`);

export const listPullFiles = (token, repo, number) =>
  gh(token, `/repos/${repo}/pulls/${number}/files?per_page=300`);

/**
 * Post the review. `event: 'COMMENT'` on purpose — a scheduled reviewer must
 * never be able to block a merge on its own judgment. It reports; Ben decides.
 */
export const postReview = (token, repo, number, body, comments) =>
  gh(token, `/repos/${repo}/pulls/${number}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ event: 'COMMENT', body, ...(comments?.length ? { comments } : {}) }),
  });

export { gh };
