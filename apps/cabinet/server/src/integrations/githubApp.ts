// GitHub App integration (server-to-server) — mints short-lived installation
// tokens so the agent's shell can drive `gh`/the GitHub API without ever
// seeing the app's private key.
//
// Privilege design (mirrors §13.2's spirit): the root PM2 daemon injects
// GITHUB_APP_PRIVATE_KEY_B64 from /srv/benloe/.env into THIS process's env
// (see ecosystem.config.js). The Claude Agent SDK's bash tool snapshots
// process.env verbatim for every agent shell, so the very first thing this
// module does — configured or not — is delete the key from process.env and
// hold it in module memory only. What agent shells inherit is GH_TOKEN /
// GITHUB_TOKEN: a 1-hour installation token scoped to exactly the repos and
// permissions the app was granted, refreshed on a timer so a long-lived
// process never hands out a stale one.
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

/** Refresh well inside the 60-minute token lifetime so a shell spawned just
 *  before refresh still holds a token with ≥15 minutes left. */
const REFRESH_MS = 45 * 60 * 1000;

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString('base64url');
}

/** RS256 app JWT, good for 9 minutes (GitHub caps at 10; 60s clock-drift
 *  backdate per their docs). No JWT dependency — node:crypto suffices. */
function appJwt(appId: string, key: KeyObject): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Read + scrub credentials, then keep process.env.GH_TOKEN/GITHUB_TOKEN
 * populated with a fresh installation token for the life of the process.
 * No-ops (with one log line) when the app isn't configured, so dev/test
 * environments without the env vars behave exactly as before.
 */
export function startGithubAppTokenLoop(): void {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const keyB64 = process.env.GITHUB_APP_PRIVATE_KEY_B64;
  // Scrub unconditionally and immediately — before any early return, before
  // any agent session can snapshot the env.
  delete process.env.GITHUB_APP_PRIVATE_KEY_B64;

  if (!appId || !installationId || !keyB64) {
    console.log('github-app: not configured (GITHUB_APP_* env absent), skipping');
    return;
  }

  let key: KeyObject;
  try {
    key = createPrivateKey(Buffer.from(keyB64, 'base64'));
  } catch (e) {
    console.error('github-app: private key did not parse — check GITHUB_APP_PRIVATE_KEY_B64', e);
    return;
  }

  const mint = async (): Promise<void> => {
    try {
      const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${appJwt(appId, key)}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'cabinet-benloe',
        },
      });
      if (!res.ok) {
        console.error(`github-app: token mint failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return;
      }
      const body = (await res.json()) as { token?: string; expires_at?: string };
      if (!body.token) {
        console.error('github-app: mint response had no token');
        return;
      }
      // GH_TOKEN is what `gh` prefers for github.com; GITHUB_TOKEN covers the
      // long tail of tools that only look for the classic name.
      process.env.GH_TOKEN = body.token;
      process.env.GITHUB_TOKEN = body.token;
      console.log(`github-app: installation token minted, expires ${body.expires_at ?? 'unknown'}`);
    } catch (e) {
      // Transient network failure: keep the previous (possibly still-valid)
      // token in place; the next tick retries.
      console.error('github-app: mint error', e);
    }
  };

  void mint();
  setInterval(() => void mint(), REFRESH_MS).unref();
}
