// The rule this whole service exists to enforce, made mechanical.
//
// Cabinet's original credential module carried the same rule as a comment
// ("reviewer's tripwire: any diff that imports getCredentialSecret into
// src/gateway/** is wrong on its face"). That comment was correct and was
// never violated — but a rule that lives only in prose is exactly what Cabinet
// got caught on twice in two days: a claim written in a doc that the system
// did not enforce. So it is a test.
//
// If someone adds a "just for debugging" decrypt route to the broker or the
// dashboard, this fails before it ships.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');

/**
 * Comments are stripped before scanning. The first version of this test failed
 * on broker.ts because that file's header *describes* the rule — which is
 * exactly the kind of false positive that gets a safety test deleted rather
 * than fixed. What matters is whether the identifier is reachable in CODE.
 */
const code = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('secret egress', () => {
  it('only src/plaid.ts may use the decrypt path', () => {
    const offenders = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts') && f !== 'store.ts' && f !== 'plaid.ts')
      .filter((f) => /\bdecryptSecret\b/.test(code(f)));
    expect(offenders, 'these modules use decryptSecret and must not').toEqual([]);
  });

  it('the outward-facing modules never use verifyCredential either', () => {
    // verifyCredential decrypts internally; exposing it over HTTP would turn
    // the broker into a secret oracle (guess-and-check).
    for (const f of ['broker.ts', 'dashboard.ts', 'page.ts']) {
      expect(code(f), `${f} must not use verifyCredential`).not.toMatch(/\bverifyCredential\b/);
    }
  });

  it('no route path in the broker or dashboard mentions a secret-returning shape', () => {
    for (const f of ['broker.ts', 'dashboard.ts']) {
      const src = read(f);
      // Catches /secret, /reveal, /decrypt as ROUTE paths, not the word in prose.
      const routes = [...src.matchAll(/app\.(get|post|put|delete)\(\s*'([^']+)'/g)].map((m) => m[2]!);
      const bad = routes.filter((r) => /secret|reveal|decrypt|plaintext/i.test(r));
      expect(bad, `${f} declares a secret-shaped route`).toEqual([]);
    }
  });

  it('the dashboard page never renders a credential value field', () => {
    const page = read('page.ts');
    // The table shows "sealed"; if a value column ever renders c.secret or
    // similar, this catches it.
    expect(page).not.toMatch(/c\.(secret|ciphertext|value)\b/);
    expect(page).toMatch(/sealed/);
  });
});
