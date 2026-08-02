/* ============================================================================
   domains/settings.ts + gateway/settingsRoutes.ts

   Rewritten 2026-08-02, when 'plaid.env' left the catalog and this file lost
   the worked example it had been using for almost everything. What replaced it
   matters more than what it looked like before, so the risk model, restated:

   1. PRECEDENCE. The DB must outrank the environment. If that inverts, the
      settings page becomes the worst thing a settings page can be — it reports
      a successful save while an invisible env var keeps winning. Every branch of
      the resolution order is asserted explicitly, including the empty-string
      env var, because "" is falsy in JS and a careless `env.X ||` refactor
      would pass all the other cases.

   2. LIVENESS. PlaidClient is constructed once at boot and lives for the whole
      process, so the origin must be resolved per access rather than snapshotted,
      or a settings edit silently needs a restart. Tested by mutating the setting
      under a LIVE client instance and re-reading.

   3. THE REMOVAL IS ITSELF LOAD-BEARING. 'plaid.env' shipped and was pulled the
      same day: the broker holds the Plaid key pair, a key pair belongs to
      exactly one environment, and a selector here could have chosen 'production'
      while the vault still held sandbox keys. Every call would then fail as an
      authentication error pointing at the credentials rather than at the
      mismatch. So its absence is asserted, not just its removal performed — a
      regression that re-added it would be invisible otherwise, and one real
      database out there already has a leftover row from that morning.

   4. THE ENUM BRANCH survives with no catalog user. It is exercised through a
      synthetic spec rather than deleted, because normaliseSetting takes the spec
      as an argument and the next enum setting should find a tested validator
      rather than an untested one.
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
  type SettingSpec,
} from '../src/domains/settings.js';
import { registerSettingsRoutes } from '../src/gateway/settingsRoutes.js';
import { PlaidClient, normalisePlaidEnv } from '../src/integrations/plaid.js';
import { SecretsBrokerClient } from '../src/integrations/brokerClient.js';
import { upsertItem } from '../src/domains/money.js';
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

const ORIGIN_DEFAULT = 'https://cabinet.benloe.com';

/**
 * A PlaidClient whose broker socket does not exist.
 *
 * Every test below reads only origin-derived values, which never touch the
 * socket — but constructing the client with the default would point it at the
 * real production broker path, and a test that quietly succeeds because a
 * daemon happened to be running on the same box is not a test. An unbindable
 * path makes the isolation explicit.
 */
function offlinePlaid(envOverride: 'sandbox' | 'production' | null = null, origin: string | null = null): PlaidClient {
  return new PlaidClient(
    cabinet.db,
    new SecretsBrokerClient({ socketPath: join(dir, 'no-such-broker.sock'), timeoutMs: 200 }),
    envOverride,
    origin,
  );
}

/* ------------------------------------------------------------ precedence -- */

describe('settings resolution order', () => {
  it('falls back to the built-in default with no row and no env var', () => {
    expect(getSetting(cabinet.db, 'public.origin', {})).toBe(ORIGIN_DEFAULT);
  });

  it('prefers the environment variable over the default', () => {
    expect(getSetting(cabinet.db, 'public.origin', { CABINET_PUBLIC_ORIGIN: 'https://env.example.com' })).toBe(
      'https://env.example.com',
    );
  });

  it('prefers the DB row over the environment variable', () => {
    putSetting(cabinet.db, 'public.origin', 'https://db.example.com');
    // The env var says something else and loses. This is the whole point of the
    // table: an edit made in the browser must beat a value Ben cannot see.
    expect(getSetting(cabinet.db, 'public.origin', { CABINET_PUBLIC_ORIGIN: 'https://env.example.com' })).toBe(
      'https://db.example.com',
    );
  });

  it('treats a blank environment variable as absent', () => {
    // Guards a real degradation: an empty CABINET_PUBLIC_ORIGIN resolving to ''
    // silently builds the redirect URI '/plaid/oauth' with no scheme or host,
    // which Plaid rejects at the OAuth handoff rather than at save time.
    expect(getSetting(cabinet.db, 'public.origin', { CABINET_PUBLIC_ORIGIN: '   ' })).toBe(ORIGIN_DEFAULT);
    expect(getSetting(cabinet.db, 'public.origin', { CABINET_PUBLIC_ORIGIN: '' })).toBe(ORIGIN_DEFAULT);
  });

  it('trims whitespace off an environment value', () => {
    expect(getSetting(cabinet.db, 'public.origin', { CABINET_PUBLIC_ORIGIN: ' https://env.example.com ' })).toBe(
      'https://env.example.com',
    );
  });

  it('returns empty string for an unknown key rather than throwing', () => {
    expect(getSetting(cabinet.db, 'no.such.key', {})).toBe('');
  });

  it('reports which source won, and surfaces the overridden env value', () => {
    putSetting(cabinet.db, 'public.origin', 'https://db.example.com');
    const view = listSettings(cabinet.db, { CABINET_PUBLIC_ORIGIN: 'https://env.example.com' }).find(
      (s) => s.key === 'public.origin',
    )!;
    expect(view.value).toBe('https://db.example.com');
    expect(view.source).toBe('db');
    // Without this the page cannot tell Ben he is overriding something.
    expect(view.env_value).toBe('https://env.example.com');
    expect(view.updated_at).toBeTruthy();
  });

  it('reports source env and default correctly', () => {
    const fromEnv = listSettings(cabinet.db, { CABINET_PUBLIC_ORIGIN: 'https://env.example.com' }).find(
      (s) => s.key === 'public.origin',
    )!;
    expect(fromEnv.source).toBe('env');
    expect(fromEnv.value).toBe('https://env.example.com');
    expect(fromEnv.updated_at).toBeNull();

    const fromDefault = listSettings(cabinet.db, {}).find((s) => s.key === 'public.origin')!;
    expect(fromDefault.source).toBe('default');
    expect(fromDefault.value).toBe(ORIGIN_DEFAULT);
    expect(fromDefault.env_value).toBeNull();
  });

  it('clearSetting reverts to the environment, not to the last stored value', () => {
    putSetting(cabinet.db, 'public.origin', 'https://db.example.com');
    expect(clearSetting(cabinet.db, 'public.origin')).toBe(true);
    expect(getSetting(cabinet.db, 'public.origin', { CABINET_PUBLIC_ORIGIN: 'https://env.example.com' })).toBe(
      'https://env.example.com',
    );
    expect(clearSetting(cabinet.db, 'public.origin')).toBe(false);
  });
});

/* ------------------------------------------------------------ validation -- */

describe('setting validation', () => {
  const originSpec = getSpec('public.origin')!;

  /**
   * Synthetic on purpose. The enum branch of normaliseSetting has had no
   * catalog user since 'plaid.env' was removed, and the choice was between
   * deleting the branch or testing it without one. Testing won: the function
   * takes the spec as a parameter, so exercising it costs four lines, and the
   * alternative is that the next enum setting lands on a validator nothing has
   * run since the day it was written.
   */
  const enumSpec: SettingSpec = {
    key: 'test.enum',
    group: 'Test',
    label: 'Test enum',
    description: 'Not in the catalog. Exists to keep the enum branch covered.',
    type: 'enum',
    options: ['alpha', 'beta'],
    default: 'alpha',
  };

  it('accepts the enum members and rejects everything else', () => {
    expect(normaliseSetting(enumSpec, ' beta ')).toBe('beta');
    expect(() => normaliseSetting(enumSpec, 'gamma')).toThrow(SettingValidationError);
    // Case-sensitive on purpose: an enum value reaches an API or a config file
    // verbatim, and a silent lowercase here would be a second normalisation
    // rule nobody declared.
    expect(() => normaliseSetting(enumSpec, 'BETA')).toThrow(SettingValidationError);
    expect(() => normaliseSetting(enumSpec, '')).toThrow(SettingValidationError);
  });

  it('names the allowed values in the refusal', () => {
    // The message goes on screen. "Invalid value" would make Ben go read source.
    expect(() => normaliseSetting(enumSpec, 'gamma')).toThrow(/alpha, beta/);
  });

  it('normalises an origin and strips a trailing slash', () => {
    expect(normaliseSetting(originSpec, 'https://cabinet.benloe.com/')).toBe(ORIGIN_DEFAULT);
  });

  it('rejects an origin carrying a path, query or fragment', () => {
    // The realistic mistake: pasting the address bar while sitting on the page
    // that contains this control. It would produce a redirect_uri of
    // '.../settings/plaid/oauth' and fail at the bank, far from the cause.
    for (const bad of [
      'https://cabinet.benloe.com/settings',
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

  it('every enum entry lists the options its validator needs', () => {
    // An enum spec with no `options` rejects everything, including its own
    // default — which the test above would catch, but only for the default.
    for (const spec of SETTING_CATALOG) {
      if (spec.type === 'enum') expect(spec.options?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------- the plaid.env removal ------- */

describe('plaid.env stays out of this catalog', () => {
  /*
   * Not a tidiness assertion. Two owners for one value is the exact failure the
   * `source` field on this page exists to expose one level up, and here it would
   * be unexposable: Cabinet cannot see the broker's keys, so a mismatch between
   * a setting saying 'production' and a vault holding sandbox keys surfaces only
   * as an authentication error against the credentials. Re-adding this control
   * is a plausible future mistake — it looks like a feature — so it gets a test
   * rather than a comment.
   */
  it('has no environment selector and no PLAID_ENV-backed setting', () => {
    expect(getSpec('plaid.env')).toBeNull();
    expect(SETTING_CATALOG.some((s) => s.envVar === 'PLAID_ENV')).toBe(false);
  });

  it('a leftover plaid.env row from the morning it shipped cannot steer anything', () => {
    // Real databases have this row. It must be inert, not merely unreachable
    // from the UI: getSetting resolves unknown keys to '' and PlaidClient must
    // take its environment from the broker regardless of what is stored here.
    putSetting(cabinet.db, 'plaid.env', 'production');
    expect(getSetting(cabinet.db, 'plaid.env', {})).toBe('production');
    // ...and nobody asks. The client's environment still comes from the broker,
    // which for an offline client is the pessimistic default.
    expect(offlinePlaid().environment).toBe('sandbox');
    expect(listSettings(cabinet.db, {}).some((s) => s.key === 'plaid.env')).toBe(false);
  });
});

/* ------------------------------------------------------ the guard hook ----- */

describe('blockingReason is an inert hook', () => {
  /*
   * Kept rather than deleted when its only rule left with 'plaid.env'. These
   * tests exist so the hook's inertness is a stated fact: a leftover rule that
   * refused a save for a reason nobody could see would be a very quiet bug, and
   * both routes (PUT and DELETE) still route through it.
   */
  it('permits every catalog entry at its own default, with banks linked', () => {
    upsertItem(cabinet.db, { item_id: 'item-1', institution_name: 'Test Credit Union' });
    for (const spec of SETTING_CATALOG) {
      expect(blockingReason(cabinet.db, spec.key, spec.default)).toBeNull();
    }
  });

  it('permits an origin change with banks linked', () => {
    upsertItem(cabinet.db, { item_id: 'item-1' });
    expect(blockingReason(cabinet.db, 'public.origin', 'https://cab.example.com')).toBeNull();
  });
});

/* ------------------------------------------- PlaidClient reads live -------- */

describe('PlaidClient resolves settings per access', () => {
  it('picks up an origin change in both derived URLs', () => {
    const plaid = offlinePlaid();
    expect(plaid.redirectUri).toBe(`${ORIGIN_DEFAULT}/plaid/oauth`);

    putSetting(cabinet.db, 'public.origin', 'https://cab.example.com');
    // Same instance. If this fails, every settings edit needs a restart, which
    // is the chore the whole feature exists to delete.
    expect(plaid.redirectUri).toBe('https://cab.example.com/plaid/oauth');
    expect(plaid.webhookUrl).toBe('https://cab.example.com/api/plaid/webhook');
  });

  it('honours an explicit origin override over the settings store', () => {
    putSetting(cabinet.db, 'public.origin', 'https://db.example.com');
    expect(offlinePlaid(null, 'https://fixed.example.com').redirectUri).toBe('https://fixed.example.com/plaid/oauth');
  });

  it('normalisePlaidEnv fails closed on anything unrecognised', () => {
    // The broker reports the environment now, but this is still the last line
    // of defence: a garbled value from any source must not name a real bank.
    expect(normalisePlaidEnv('production')).toBe('production');
    expect(normalisePlaidEnv('PRODUCTION')).toBe('production');
    expect(normalisePlaidEnv(' production ')).toBe('production');
    expect(normalisePlaidEnv('PRODUCTON')).toBe('sandbox');
    expect(normalisePlaidEnv('development')).toBe('sandbox');
    expect(normalisePlaidEnv(null)).toBe('sandbox');
    expect(normalisePlaidEnv(undefined)).toBe('sandbox');
  });
});

/* ------------------------------------------------------------ env report -- */

describe('envReport supersession', () => {
  it('marks the one superseded variable and leaves the rest alone', () => {
    const byName = new Map(envReport({}, {}).map((r) => [r.name, r]));
    expect(byName.get('CABINET_PUBLIC_ORIGIN')!.supersededBy).toBe('public.origin');
    // PLAID_ENV was briefly superseded by a Cabinet setting and is not any more.
    // It is not unmanaged — it moved OUT of this process to cabinet-secrets, and
    // the reason text is what says so on the page.
    expect(byName.get('PLAID_ENV')!.supersededBy).toBeNull();
    expect(byName.get('PLAID_ENV')!.reason).toMatch(/cabinet-secrets/i);
    expect(byName.get('CABINET_CRED_KEY')!.supersededBy).toBeNull();
  });

  it('every supersededBy names a real setting', () => {
    for (const entry of envReport({}, {})) {
      if (entry.supersededBy) expect(getSpec(entry.supersededBy)).not.toBeNull();
    }
  });

  it('CABINET_CRED_KEY is never superseded — it cannot live in the DB', () => {
    // A regression here would mean the retired master key had been given a
    // settings row, i.e. stored in plaintext in the database it once encrypted.
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

  const put = (key: string, value: unknown) =>
    fetch(`${base}/api/settings/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    });

  it('lists every catalog entry', async () => {
    const body = (await (await fetch(`${base}/api/settings`)).json()) as { settings: { key: string }[] };
    expect(body.settings.map((s) => s.key).sort()).toEqual(SETTING_CATALOG.map((s) => s.key).sort());
  });

  it('saves a value and echoes back what was actually stored', async () => {
    const res = await put('public.origin', 'https://cab.example.com/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setting: { value: string; source: string } };
    // Echoing the NORMALISED value, not the submitted one: the trailing slash is
    // gone, and the page must render what is in force rather than what was typed.
    expect(body.setting.value).toBe('https://cab.example.com');
    expect(body.setting.source).toBe('db');
    expect(getSetting(cabinet.db, 'public.origin', {})).toBe('https://cab.example.com');
  });

  it('rejects an invalid value with the human-readable reason', async () => {
    const res = await put('public.origin', 'not-a-url');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/full URL/i);
    // And nothing was written on the way to the refusal.
    expect(cabinet.db.prepare('SELECT COUNT(*) AS n FROM app_setting').get()).toEqual({ n: 0 });
  });

  it('rejects a non-string body and an unknown key', async () => {
    expect((await put('public.origin', 42)).status).toBe(400);

    const unknown = await put('no.such.key', 'x');
    expect(unknown.status).toBe(404);
    // The unknown key must not have been quietly written.
    expect(cabinet.db.prepare('SELECT COUNT(*) AS n FROM app_setting').get()).toEqual({ n: 0 });
  });

  it('404s on plaid.env rather than storing an orphan row', async () => {
    // The control is gone from the UI, but a stale browser tab, a bookmarked
    // request or an old script would still aim at this path. Accepting it would
    // write a row that no code reads and that looks authoritative in the DB.
    const res = await put('plaid.env', 'production');
    expect(res.status).toBe(404);
    expect(cabinet.db.prepare('SELECT COUNT(*) AS n FROM app_setting').get()).toEqual({ n: 0 });
  });

  it('DELETE stops overriding and falls back', async () => {
    putSetting(cabinet.db, 'public.origin', 'https://cab.example.com');
    const res = await fetch(`${base}/api/settings/public.origin`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setting: { value: string; source: string } };
    expect(body.setting.source).toBe('default');
    expect(body.setting.value).toBe(ORIGIN_DEFAULT);
  });

  it('a linked bank no longer blocks either write path', async () => {
    // The 409 that used to live here belonged to the Plaid environment switch.
    // With that setting gone, a linked item is irrelevant to every remaining
    // key, and a guard that outlived its rule would refuse saves for a reason
    // the page could not explain.
    upsertItem(cabinet.db, { item_id: 'item-1', institution_name: 'Test Credit Union' });
    expect((await put('public.origin', 'https://cab.example.com')).status).toBe(200);
    expect((await fetch(`${base}/api/settings/public.origin`, { method: 'DELETE' })).status).toBe(200);
  });
});
