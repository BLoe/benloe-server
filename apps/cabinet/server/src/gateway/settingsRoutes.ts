/* ============================================================================
   HTTP surface for non-secret application settings — mounted behind buildApp's
   owner auth wall alongside /api/credentials.

   Deliberately a separate file from credentialRoutes.ts even though both render
   onto the same page. That file's entire charter is "secrets go in and never
   come out", and this one's is the exact inverse: every value here is readable,
   echoed back, and safe in a log. Sharing a module would mean one set of
   reviewers holding two opposite rules in their head, and the failure mode of
   getting them confused is a leaked secret. The split keeps each file's rule
   absolute.

   The invariant, restated because it is the only thing protecting that split:
   NOTHING routed through here may be secret. If a future value needs hiding it
   is a `credential` row and it goes through the other file.
   ========================================================================== */
import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import {
  blockingReason,
  clearSetting,
  getSpec,
  listSettings,
  normaliseSetting,
  putSetting,
  SettingValidationError,
} from '../domains/settings.js';

export interface SettingsRouteDeps {
  db: Database.Database;
}

export function registerSettingsRoutes(app: Express, deps: SettingsRouteDeps): void {
  const { db } = deps;

  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json({ settings: listSettings(db) });
  });

  app.put('/api/settings/:key', (req: Request, res: Response) => {
    const key = String(req.params.key ?? '');
    const spec = getSpec(key);
    // Unknown keys are rejected rather than stored. The table would happily
    // accept them, and then the settings page would never show them again —
    // an invisible write is worse than a refusal.
    if (!spec) return res.status(404).json({ error: `Unknown setting: ${key}` });

    const raw = (req.body ?? {}).value;
    if (typeof raw !== 'string') return res.status(400).json({ error: 'Body must be { value: string }' });

    let value: string;
    try {
      value = normaliseSetting(spec, raw);
    } catch (err) {
      if (err instanceof SettingValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }

    const blocked = blockingReason(db, key, value);
    if (blocked) return res.status(409).json({ error: blocked });

    putSetting(db, key, value);
    // Echo the resolved view rather than the submitted value: normalisation may
    // have changed it (a trailing slash stripped, an origin's default port
    // dropped), and showing Ben what was actually stored is how he finds out.
    const stored = listSettings(db).find((s) => s.key === key);
    return res.json({ setting: stored });
  });

  /**
   * Revert to the environment variable or the built-in default. Distinct from
   * PUTting the old value back, which would leave a DB row that keeps
   * outranking the environment forever.
   */
  app.delete('/api/settings/:key', (req: Request, res: Response) => {
    const key = String(req.params.key ?? '');
    const spec = getSpec(key);
    if (!spec) return res.status(404).json({ error: `Unknown setting: ${key}` });

    // The guard applies to clearing too. Reverting to the environment is still a
    // value change, and it can flip Plaid's environment out from under linked
    // banks exactly as a direct edit would.
    const settings = listSettings(db);
    const current = settings.find((s) => s.key === key);
    if (current?.source === 'db') {
      const reverted = spec.envVar ? (current.env_value ?? spec.default) : spec.default;
      const blocked = blockingReason(db, key, reverted);
      if (blocked) return res.status(409).json({ error: blocked });
    }

    clearSetting(db, key);
    const stored = listSettings(db).find((s) => s.key === key);
    return res.json({ setting: stored });
  });
}
