/* ============================================================================
   THE CONTRACT TEST — the other half of the seam.

   broker-client.test.ts proves Cabinet can talk to a broker-shaped thing.
   This proves the thing on the other end will actually accept what Cabinet
   says. Those are different failures, and only the second one is silent:
   a path Cabinet calls that the broker does not allowlist compiles fine, ships
   fine, passes every unit test on both sides, and then returns 403 the first
   time Ben clicks the button that needs it.

   That is the exact shape of the pending-turn bug (PLATFORM.md): two correct
   halves, no test across the join, three weeks in production.

   So this test reads the broker's REAL source — it is in this monorepo, one
   directory over — and diffs its allowlist against the manifest in
   integrations/plaid.ts. Parsing another module's source is normally a bad
   idea; here it is the point. The alternative is duplicating the allowlist on
   this side, which is not a check, it is a second copy to drift.

   Cabinet cannot edit the broker (root-owned tree, deliberately). So when this
   test finds a mismatch, the output has to be something Ben can act on
   directly, not "expected true to be false".
   ========================================================================== */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PLAID_PATHS } from '../src/integrations/plaid.js';

const BROKER_SOURCE = join(import.meta.dirname, '../../../cabinet-secrets/src/plaid.ts');

/**
 * Paths the broker does not support YET, with the reason and the consequence.
 *
 * This is a tripwire, not an excuse list. The assertions below check that each
 * of these is STILL blocked — so the moment Ben widens the broker's allowlist,
 * this file goes red and tells whoever is reading to delete the entry and the
 * workaround that goes with it. A prose TODO would have gone stale silently;
 * PLATFORM.md has the scar tissue from exactly that ("a rule that lives only in
 * a comment").
 */
const BLOCKED_ON_BROKER: Record<string, { needs: string; costsUs: string }> = {
  '/webhook_verification_key/get': {
    needs: "add to ALLOWED_PATHS (no access token — it's a public key fetch)",
    costsUs:
      'verifyWebhook cannot fetch Plaid’s JWK, so every webhook fails verification and is rejected. ' +
      'Degrades safely: nightly scheduled sync is unaffected, we lose same-day transaction nudges.',
  },
};

/**
 * Paths whose token handling the broker cannot express yet.
 *
 * /link/token/create takes an access_token ONLY in Link update mode (repairing
 * a consent that hit ITEM_LOGIN_REQUIRED) and must NOT have one in create mode.
 * The broker's two-set model — ALLOWED_PATHS and NEEDS_ACCESS_TOKEN — has no
 * way to say "optional": listing it refuses create mode, omitting it refuses
 * update mode. It needs a third set.
 */
const NEEDS_OPTIONAL_TOKEN_SUPPORT = ['/link/token/create'];

function parseSet(source: string, name: string): Set<string> {
  const block = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  if (!block?.[1]) throw new Error(`could not find ${name} in the broker source — its shape changed`);
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]!));
}

describe('PlaidClient ↔ cabinet-secrets broker contract', () => {
  it('can read the broker source it is being checked against', () => {
    // If this fails, every assertion below is vacuous. Fail loudly rather than
    // skipping — a contract test that quietly stops checking is worse than no
    // contract test, because it still reads as coverage.
    expect(existsSync(BROKER_SOURCE), `broker source not found at ${BROKER_SOURCE}`).toBe(true);
  });

  const source = existsSync(BROKER_SOURCE) ? readFileSync(BROKER_SOURCE, 'utf8') : '';
  const allowed = source ? parseSet(source, 'ALLOWED_PATHS') : new Set<string>();
  const needsToken = source ? parseSet(source, 'NEEDS_ACCESS_TOKEN') : new Set<string>();

  it('parsed a plausible allowlist rather than an empty regex match', () => {
    expect(allowed.size).toBeGreaterThan(5);
    expect(needsToken.size).toBeGreaterThan(3);
    expect(allowed.has('/transactions/sync')).toBe(true);
  });

  it('never allowlists a path that would hand back credential material', () => {
    // The broker special-cases these so the token is retained, not returned.
    // If one ever appears in ALLOWED_PATHS it would be proxied verbatim and its
    // access_token would come straight back to this process.
    expect(allowed.has('/item/public_token/exchange')).toBe(false);
    expect(allowed.has('/item/access_token/invalidate')).toBe(false);
  });

  for (const [path, mode] of Object.entries(PLAID_PATHS)) {
    const blocked = BLOCKED_ON_BROKER[path];

    if (blocked) {
      it(`BLOCKED: ${path} is still refused by the broker`, () => {
        expect(
          allowed.has(path),
          `\n  The broker now allows ${path}.\n` +
            `  → delete its entry from BLOCKED_ON_BROKER in this file,\n` +
            `  → and re-check the degraded path it forced: ${blocked.costsUs}\n`,
        ).toBe(false);
      });
      continue;
    }

    it(`${path} is allowlisted by the broker`, () => {
      expect(
        allowed.has(path),
        `\n  PlaidClient calls ${path} but the broker refuses it (403 at runtime).\n` +
          `  → add '${path}' to ALLOWED_PATHS in apps/cabinet-secrets/src/plaid.ts\n` +
          `  → that tree is root-owned, so this needs Ben.\n`,
      ).toBe(true);
    });

    if (mode === 'required') {
      it(`${path} accepts an item access token`, () => {
        expect(
          needsToken.has(path),
          `\n  PlaidClient sends accessTokenCredential for ${path}, but the broker\n` +
            `  does not list it in NEEDS_ACCESS_TOKEN, so it throws PlaidPathRefusedError.\n`,
        ).toBe(true);
      });
    }

    if (mode === 'none') {
      it(`${path} is never sent an access token`, () => {
        expect(
          needsToken.has(path),
          `\n  The broker requires an accessTokenCredential for ${path}, but PlaidClient\n` +
            `  sends none — every call will 503. Either the manifest or the broker is wrong.\n`,
        ).toBe(false);
      });
    }
  }

  for (const path of NEEDS_OPTIONAL_TOKEN_SUPPORT) {
    it(`BLOCKED: ${path} still has no optional-token support in the broker`, () => {
      // Today the broker is all-or-nothing, and BOTH answers break a real flow.
      // This asserts the current state so the day it changes is the day this
      // test tells someone to wire update mode back up.
      const hasThirdSet = /OPTIONAL_ACCESS_TOKEN|optionalAccessToken/.test(source);
      expect(
        hasThirdSet,
        `\n  The broker grew optional-access-token support.\n` +
          `  → remove ${path} from NEEDS_OPTIONAL_TOKEN_SUPPORT here,\n` +
          `  → and delete the update-mode guard in createLinkToken.\n`,
      ).toBe(false);
      expect(needsToken.has(path)).toBe(false); // create mode still works
      expect(allowed.has(path)).toBe(true);
    });
  }

  it('the manifest lists every path the client actually calls', () => {
    // Guards the manifest itself against drift: a new this.request('/foo') that
    // nobody added to PLAID_PATHS would otherwise be checked by nothing at all.
    const clientSource = readFileSync(join(import.meta.dirname, '../src/integrations/plaid.ts'), 'utf8');
    const called = new Set(
      [...clientSource.matchAll(/this\.request<[^>]*>\(\s*\n?\s*'([^']+)'|this\.request\(\s*'([^']+)'/g)].map(
        (m) => (m[1] ?? m[2])!,
      ),
    );
    expect(called.size).toBeGreaterThan(4);
    for (const path of called) {
      expect(Object.keys(PLAID_PATHS), `${path} is called but missing from PLAID_PATHS`).toContain(path);
    }
  });
});
