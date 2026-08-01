import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { PushService, pushConfigFromEnv } from '../src/push/index.js';
import { generateVapidKeys } from '../src/push/webpush.js';

let dir: string;
let cabinet: CabinetDb;
const keys = generateVapidKeys();
const CONFIG = { keys, subject: 'mailto:below413@gmail.com' };

/** A valid subscription: the RFC 8291 example's user-agent key material. */
const SUB = {
  endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/device-a',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-push-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const r = handler(String(url), init as RequestInit);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body ?? '' };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('PushService', () => {
  it('sends one encrypted request per device, with the VAPID and content-encoding headers push services require', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 201 }));
    const svc = new PushService(cabinet.db, CONFIG, impl);
    svc.subscribe({ ...SUB, label: 'iPhone · Safari' });
    svc.subscribe({ ...SUB, endpoint: SUB.endpoint.replace('device-a', 'device-b'), label: 'Mac · Chrome' });

    const result = await svc.send({ kind: 'ping-afternoon-snack', title: 'Protein snack', body: '3:30.' });

    expect(result).toEqual({ sent: 2, failed: 0, pruned: 0 });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const h = c.init.headers as Record<string, string>;
      expect(h.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
      expect(h['Content-Encoding']).toBe('aes128gcm');
      expect(h['Content-Type']).toBe('application/octet-stream');
      expect(h.TTL).toBe('3600');
      // The body must be ciphertext, not the plaintext payload.
      const body = c.init.body as unknown as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('utf8')).not.toContain('Protein snack');
      expect(body.length).toBeGreaterThan(86); // header(21) + key(65) + tag
    }
  });

  it('re-subscribing the same browser refreshes rather than duplicating', () => {
    const svc = new PushService(cabinet.db, CONFIG);
    svc.subscribe({ ...SUB, label: 'iPhone' });
    svc.subscribe({ ...SUB, auth: 'AAAAAAAAAAAAAAAAAAAAAA', label: null });
    const list = svc.list();
    expect(list).toHaveLength(1);
    // A null label must not erase the one already on file.
    expect(list[0].label).toBe('iPhone');
  });

  it('prunes an endpoint the push service says is gone, and keeps one that merely failed', async () => {
    const { impl } = fakeFetch((url) =>
      url.endsWith('device-a') ? { status: 410, body: 'gone' } : { status: 500, body: 'oops' },
    );
    const svc = new PushService(cabinet.db, CONFIG, impl);
    svc.subscribe(SUB);
    svc.subscribe({ ...SUB, endpoint: SUB.endpoint.replace('device-a', 'device-b') });

    const result = await svc.send({ kind: 'test', title: 'x', body: 'y' });
    expect(result).toEqual({ sent: 0, failed: 1, pruned: 1 });

    const rows = svc.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toContain('device-b');
    // A flaky night must not cost Ben the subscription — it's counted, not cut.
    expect(rows[0].failures).toBe(1);
  });

  it('never throws — a missed ping must not take down the job that sent it', async () => {
    const impl = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const svc = new PushService(cabinet.db, CONFIG, impl);
    svc.subscribe(SUB);
    await expect(svc.send({ kind: 'briefing', title: 'Morning', body: '…' })).resolves.toEqual({
      sent: 0,
      failed: 1,
      pruned: 0,
    });
  });

  it('records every attempt, including the ones with nowhere to go', async () => {
    const svc = new PushService(cabinet.db, CONFIG);
    await svc.send({ kind: 'ping-wind-down', title: 'Wind-down', body: 'Screens off.' });
    const row = cabinet.db.prepare('SELECT kind, sent, failed, error FROM push_delivery').get() as {
      kind: string;
      sent: number;
      failed: number;
      error: string;
    };
    expect(row.kind).toBe('ping-wind-down');
    expect(row.sent).toBe(0);
    expect(row.error).toMatch(/no subscriptions/);
  });

  it('is a no-op with a clear reason when VAPID keys are absent', async () => {
    const svc = new PushService(cabinet.db, null);
    expect(svc.configured).toBe(false);
    expect(svc.publicKey).toBeNull();
    await svc.send({ kind: 'test', title: 'x', body: 'y' });
    const row = cabinet.db.prepare('SELECT error FROM push_delivery').get() as { error: string };
    expect(row.error).toMatch(/not configured/);
  });

  it('reads config from the environment, and treats a half-configured server as unconfigured', () => {
    expect(pushConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(pushConfigFromEnv({ CABINET_VAPID_PUBLIC_KEY: 'a' } as never)).toBeNull();
    const cfg = pushConfigFromEnv({
      CABINET_VAPID_PUBLIC_KEY: keys.publicKey,
      CABINET_VAPID_PRIVATE_KEY: keys.privateKey,
      CABINET_OWNER_EMAIL: 'below413@gmail.com',
    } as never);
    expect(cfg?.subject).toBe('mailto:below413@gmail.com');
  });
});
