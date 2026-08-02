/* ============================================================================
   domains/settings.ts + gateway/settingsRoutes.ts

   What is actually at risk here, and why each block exists:

   1. PRECEDENCE. The DB must outrank the environment. If that inverts, the
      settings page becomes a lie detector's worst case — it reports a
      successful save while an invisible env var keeps winning. Every branch of
      the resolution order is asserted explicitly, including the empty-string
      env var, because "" is falsy in JS and a careless `env.X ||` refactor
      would pass the other cases.

   2. LIVENESS. PlaidClient is constructed once at boot and lives for the whole
      process. Its environment and origin must be resolved per access, not
      snapshotted, or a settings edit silently needs a restart. That is tested
      by mutating the setting under a LIVE client instance and re-reading.

   3. THE GUARD. Switching Plaid environments while banks are linked strands
      access tokens that can only be revoked from the environment that issued
      them. The failure shows up later, as INVALID_ACCESS_TOKEN on every
      institution at once, which reads like a bank outage rather than a
      settings change. Both the direct edit and the revert path are covered —
      the revert is the one an implementation forgets.
   ========================================================================== */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { openDb, type CabinetDb } from '../src/db/index.js';
import {
  blockingReason,
  clearSetting,
  getSetting,
  getSpec,
  listSettings,
  normaliseSetting,
  putSetting,
  SettingValidationError,
  SETTING_CATALOG,
} from '../src/domains/settings.js';
import { registerSettingsRoutes } from '../src/gateway/settingsRoutes.js';
import { PlaidClient, normalisePlaidEnv } from '../src/integrations/plaid.js';
import { upsertItem, setItemStatus } from '../src/domains/money.js';
import { envReport } from '../src/domains/credentialCatalog.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-settings-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.db.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------ precedence -- */

describe('settings resolution order', () => {
  it('falls back to the built-in default with no row and no env var', () => {
    expect(getSetting(cabinet.db, 'plaid.env', {})).toBe('sandbox');
    expect(getSetting(cabinet.db, 'public.origin', {})).toBe('https://cabinet.benloe.com');
  });

  it('prefers the environment variable over the default', () => {
    expect(getSetting(cabinet.db, 'plaid.env', { PLAID_ENV: 'production' })).toBe('production');
  });

  it('prefers the DB row over the environment variable', () => {
    putSetting(cabinet.db, 'plaid.env', 'sandbox');
    // The env var says production and loses. This is the whole point of the
    // table: an edit made in the browser must beat a value Ben cannot see.
    expect(getSetting(cabinet.db, 'plaid.env', { PLAID_ENV: 'production' })).toBe('sandbox');
  });

  it('treats a blank environment variable as absent', () => {
    // Guards a real degradation: an empty CABINET_PUBLIC_ORIGIN resolving to ''
    // silently builds the redirect URI '/plaid/oauth' with no scheme or host,
    // which Plaid rejects at the OAuth handoff rather than at save time.
    expect(getSetting(cabinet.db, 'public.origin', { CABINET_PUBLIC_ORIGIN: '   ' })).toBe(
      'https://cabinet.benloe.com',
    );
  });

  it('trims whitespace off an environment value', () => {
    expect(getSetting(cabinet.db, 'plaid.env', { PLAID_ENV: ' production ' })).toBe('production');
  });

  it('returns empty string for an unknown key rather than throwing', () => {
    expect(getSetting(cabinet.db, 'no.such.key', {})).toBe('');
  });

  it('reports which source won, and surfaces the overridden env value', () => {
    putSetting(cabinet.db, 'plaid.env', 'sandbox');
    const view = listSettings(cabinet.db, { PLAID_ENV: 'production' }).find((s) => s.key === 'plaid.env')!;
    expect(view.value).toBe('sandbox');
    expect(view.source).toBe('db');
    // Without this the page cannot tell Ben he is overriding something.
    expect(view.env_value).toBe('production');
    expect(view.updated_at).toBeTruthy();
  });

  it('reports source env and default correctly', () => {
    const fromEnv = listSettings(cabinet.db, { PLAID_ENV: 'production' }).find((s) => s.key === 'plaid.env')!;
    expect(fromEnv.source).toBe('env');
    expect(fromEnv.updated_at).toBeNull();

    const fromDefault = listSettings(cabinet.db, {}).find((s) => s.key === 'plaid.env')!;
    expect(fromDefault.source).toBe('default');
    expect(fromDefault.env_value).toBeNull();
  });

  it('clearSetting reverts to the environment, not to the last stored value', () => {
    putSetting(cabinet.db, 'plaid.env', 'sandbox');
    expect(clearSetting(cabinet.db, 'plaid.env')).toBe(true);
    expect(getSetting(cabinet.db, 'plaid.env', { PLAID_ENV: 'production' })).toBe('production');
    expect(clearSetting(cabinet.db, 'plaid.env')).toBe(false);
  });
});

/* ------------------------------------------------------------ validation -- */

describe('setting validation', () => {
  const plaidEnvSpec = getSpec('plaid.env')!;
  const originSpec = getSpec('public.origin')!;

  it('accepts the enum members and rejects everything else', () => {
    expect(normaliseSetting(plaidEnvSpec, ' production ')).toBe('production');
    expect(() => normaliseSetting(plaidEnvSpec, 'development')).toThrow(SettingValidationError);
    expect(() => normaliseSetting(plaidEnvSpec, 'PRODUCTION')).toThrow(SettingValidationError);
    expect(() => normaliseSetting(plaidEnvSpec, '')).toThrow(SettingValidationError);
  });

  it('normalises an origin and strips a trailing slash', () => {
    expect(normaliseSetting(originSpec, 'https://cabinet.benloe.com/')).toBe('https://cabinet.benloe.com');
  });

  it('rejects an origin carrying a path, query or fragment', () => {
    // The realistic mistake: pasting the address bar while sitting on the page
    // that contains this control. It would produce a redirect_uri of
    // '.../credentials/plaid/oauth' and fail at the bank, far from the cause.
    for (const bad of [
      'https://cabinet.benloe.com/credentials',
      'https://cabinet.benloe.com/?a=1',
      'https://cabinet.benloe.com/#x',
    ]) {
      expect(() => normaliseSetting(originSpec, bad)).toThrow(SettingValidationError);
    }
  });

  it('rejects a non-URL and a non-http scheme', () => {
    expect(() => normaliseSetting(originSpec, 'cabinet.benloe.com')).toThrow(SettingValidationError);
    expect(() => normaliseSetting(originSpec, 'ftp://cabinet.benloe.com')).toThrow(SettingValidationError);
  });

  it('every catalog entry has a default that survives its own validator', () => {
    // A default that its own validator would reject is a landmine: it works
    // until the first time someone saves the value already on screen.
    for (const spec of SETTING_CATALOG) {
      expect(() => normaliseSetting(spec, spec.default)).not.toThrow();
    }
  });
});

/* ------------------------------------------------- the plaid.env guard ---- */

describe('plaid environment guard', () => {
  it('allows the change with no linked items', () => {
    expect(blockingReason(cabinet.db, 'plaid.env', 'production')).toBeNull();
  });

  it('blocks the change while a live item exists', () => {
    upsertItem(cabinet.db, { item_id: 'item-1', institution_name: 'Bank of America' });
    const reason = blockingReason(cabinet.db, 'plaid.env', 'production');
    expect(reason).toMatch(/linked/i);
    expect(reason).toMatch(/unlink/i);
  });

  it('allows a no-op save even with items linked', () => {
    upsertItem(cabinet.db, { item_id: 'item-1' });
    // Saving the value already in force must not be refused — the page will do
    // exactly that whenever some other field on the form is edited.
    expect(blockingReason(cabinet.db, 'plaid.env', 'sandbox')).toBeNull();
  });

  it('ignores revoked items', () => {
    const item = upsertItem(cabinet.db, { item_id: 'item-1' });
    setItemStatus(cabinet.db, item.id, 'revoked');
    expect(blockingReason(cabinet.db, 'plaid.env', 'production')).toBeNull();
  });

  it('does not guard unrelated keys', () => {
    upsertItem(cabinet.db, { item_id: 'item-1' });
    expect(blockingReason(cabinet.db, 'public.origin', 'https://example.com')).toBeNull();
  });
});

/* ------------------------------------------- PlaidClient reads live -------- */

describe('PlaidClient resolves settings per access', () => {
  it('picks up an environment change without being reconstructed', () => {
    const plaid = new PlaidClient(cabinet.db, null);
    expect(plaid.environment).toBe('sandbox');

    putSetting(cabinet.db, 'plaid.env', 'production');
    // Same instance. If this fails, every settings edit needs a restart, which
    // is the chore the whole feature exists to delete.
    expect(plaid.environment).toBe('production');
  });

  it('picks up an origin change in both derived URLs', () => {
    const plaid = new PlaidClient(cabinet.db, null);
    expect(plaid.redirectUri).toBe('https://cabinet.benloe.com/plaid/oauth');

    putSetting(cabinet.db, 'public.origin', 'https://cab.example.com');
    expect(plaid.redirectUri).toBe('https://cab.example.com/plaid/oauth');
    expect(plaid.webhookUrl).toBe('https://cab.example.com/api/plaid/webhook');
  });

  it('honours explicit constructor overrides over the settings store', () => {
    putSetting(cabinet.db, 'plaid.env', 'production');
    const plaid = new PlaidClient(cabinet.db, null, 'sandbox', 'https://fixed.example.com');
    expect(plaid.environment).toBe('sandbox');
    expect(plaid.redirectUri).toBe('https://fixed.example.com/plaid/oauth');
  });

  it('normalisePlaidEnv fails closed on anything unrecognised', () => {
    expect(normalisePlaidEnv('production')).toBe('production');
    expect(normalisePlaidEnv('PRODUCTION')).toBe('production');
    expect(normalisePlaidEnv('development')).toBe('sandbox');
    expect(normalisePlaidEnv(null)).toBe('sandbox');
    expect(normalisePlaidEnv(undefined)).toBe('sandbox');
  });

  it('a stored garbage value still cannot reach a real bank', () => {
    // The route validates writes, but this asserts the last line of defence:
    // a value written by any other path must not build production.plaid.com.
    putSetting(cabinet.db, 'plaid.env', 'PRODUCTON');
    expect(new PlaidClient(cabinet.db, null).environment).toBe('sandbox');
  });
});

/* ------------------------------------------------------------ env report -- */

describe('envReport supersession', () => {
  it('marks the two superseded variables and leaves the rest alone', () => {
    const report = envReport({}, {});
    const byName = new Map(report.map((r) => [r.name, r]));
    expect(byName.get('PLAID_ENV')!.supersededBy).toBe('plaid.env');
    expect(byName.get('CABINET_PUBLIC_ORIGIN')!.supersededBy).toBe('public.origin');
    expect(byName.get('CABINET_CRED_KEY')!.supersededBy).toBeNull();
  });

  it('every supersededBy names a real setting', () => {
    for (const entry of envReport({}, {})) {
      if (entry.supersededBy) expect(getSpec(entry.supersededBy)).not.toBeNull();
    }
  });

  it('CABINET_CRED_KEY is never superseded — it cannot live in the DB', () => {
    // A regression here would mean the master key had been given a settings
    // row, i.e. stored in plaintext in the database it encrypts.
    const key = envReport({}, {}).find((e) => e.name === 'CABINET_CRED_KEY')!;
    expect(key.supersededBy).toBeNull();
    expect(key.value).toBeNull();
    expect(SETTING_CATALOG.some((s) => s.envVar === 'CABINET_CRED_KEY')).toBe(false);
  });
});

/* ---------------------------------------------------------------- routes -- */

describe('settings routes', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    registerSettingsRoutes(app, { db: cabinet.db });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('lists every catalog entry', async () => {
    const body = (await (await fetch(`${base}/api/settings`)).json()) as { settings: { key: string }[] };
    expect(body.settings.map((s) => s.key).sort()).toEqual(SETTING_CATALOG.map((s) => s.key).sort());
  });

  it('saves a value and echoes back what was actually stored', async () => {
    const res = await fetch(`${base}/api/settings/public.origin`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'https://cab.example.com/' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setting: { value: string; source: string } };
    // Trailing slash gone. Echoing the submitted value instead of the stored
    // one would hide the normalisation from the person who needs to see it.
    expect(body.setting.value).toBe('https://cab.example.com');
    expect(body.setting.source).toBe('db');
  });

  it('rejects an invalid value with the human-readable reason', async () => {
    const res = await fetch(`${base}/api/settings/plaid.env`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'development' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/sandbox, production/);
  });

  it('rejects a non-string body and an unknown key', async () => {
    const bad = await fetch(`${base}/api/settings/plaid.env`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 42 }),
    });
    expect(bad.status).toBe(400);

    const unknown = await fetch(`${base}/api/settings/nope`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x' }),
    });
    expect(unknown.status).toBe(404);
    // The unknown key must not have been quietly written.
    expect(cabinet.db.prepare('SELECT COUNT(*) AS n FROM app_setting').get()).toEqual({ n: 0 });
  });

  it('409s on an environment switch with banks linked', async () => {
    upsertItem(cabinet.db, { item_id: 'item-1', institution_name: 'Bank of America' });
    const res = await fetch(`${base}/api/settings/plaid.env`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'production' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Bank|linked/i);
    expect(getSetting(cabinet.db, 'plaid.env', {})).toBe('sandbox');
  });

  it('DELETE stops overriding and falls back', async () => {
    putSetting(cabinet.db, 'public.origin', 'https://cab.example.com');
    const res = await fetch(`${base}/api/settings/public.origin`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setting: { value: string; source: string } };
    expect(body.setting.source).toBe('default');
    expect(body.setting.value).toBe('https://cabinet.benloe.com');
  });

  it('DELETE is guarded too', async () => {
    // Overriding to sandbox while the environment says production, then
    // clearing, is an environment SWITCH wearing a revert's clothes. The guard
    // has to see through that or the 409 is trivially bypassable.
    process.env.PLAID_ENV = 'production';
    try {
      putSetting(cabinet.db, 'plaid.env', 'sandbox');
      upsertItem(cabinet.db, { item_id: 'item-1' });
      const res = await fetch(`${base}/api/settings/plaid.env`, { method: 'DELETE' });
      expect(res.status).toBe(409);
      expect(getSetting(cabinet.db, 'plaid.env', {})).toBe('sandbox');
    } finally {
      delete process.env.PLAID_ENV;
    }
  });
});
