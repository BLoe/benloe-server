// The test-user shortcut makes every request the owner's and skips the Origin comparison. It must be
// dead in production whatever the environment says. This file loads the real modules with
// NODE_ENV=production to check exactly that.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

let app: Server | null = null;
afterEach(() => {
  app?.close();
  app = null;
  vi.unstubAllEnvs();
  vi.resetModules();
});
afterAll(() => vi.resetModules());

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { config } = await import('../src/config.js');
  const { createKevin } = await import('../src/kevin.js');
  const { createHttp } = await import('../src/http.js');
  const kevin = await createKevin({ dbPath: ':memory:', domains: [] });
  app = createServer(createHttp(kevin));
  const base = await new Promise<string>((resolve) => app!.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(app!.address() as AddressInfo).port}`)));
  return { config, base, kevin };
}

describe('the test-user shortcut', () => {
  it('is ignored in production: an unauthenticated request is turned away even with KEVIN_TEST_USER set', async () => {
    // No auth service is reachable at this address, so nobody can be the owner.
    const { config, base, kevin } = await load({ NODE_ENV: 'production', KEVIN_TEST_USER: 'ben', AUTH_SERVICE_URL: 'http://127.0.0.1:9' });
    expect(config.production).toBe(true);
    expect(config.testUser).toBe('');
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
    expect((await fetch(`${base}/api/me`, { headers: { Cookie: 'token=anything' } })).status).toBe(401);
    const write = await fetch(`${base}/api/act/settings_update`, { method: 'POST', headers: { 'X-Kevin': '1', 'Content-Type': 'application/json' }, body: '{"monthly_cap_usd":999}' });
    expect(write.status).toBe(401);
    expect(kevin.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'monthly_cap_usd'").get()).toEqual({ n: 0 });
    const page = await fetch(`${base}/`, { redirect: 'manual' });
    expect(page.status).toBe(302);
  });

  it('works outside production, which is the only reason the first test means anything', async () => {
    const { config, base } = await load({ NODE_ENV: 'development', KEVIN_TEST_USER: 'ben' });
    expect(config.testUser).toBe('ben');
    expect((await fetch(`${base}/api/me`)).status).toBe(200);
  });
});
