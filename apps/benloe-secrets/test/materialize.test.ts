import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialize } from '../src/materialize.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'benloe-secrets-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A miniature of the real store: one shared set and two apps, where cabinet
 * holds a key kickball must never see and kickball overrides a shared default.
 */
const SETS = new Map<string, string>([
  ['shared', '# comment\nJWT_SECRET=shared-jwt\nAUTH_SERVICE_URL=https://auth.benloe.com'],
  ['cabinet', 'MAILGUN_API_KEY=mg-live-secret\nCABINET_KEY_B64=eHg='],
  ['kickball', 'KICKBALL_DB=/srv/benloe/data/kickball.db\nAUTH_SERVICE_URL=http://127.0.0.1:3002'],
]);

const read = (name: string) => readFileSync(join(dir, `${name}.env`), 'utf8');

describe('materialize', () => {
  it('writes one file per set', () => {
    materialize(SETS, dir);
    expect(readdirSync(dir).sort()).toEqual(['cabinet.env', 'kickball.env']);
  });

  it('never writes shared as its own file — it has no consumer', () => {
    materialize(SETS, dir);
    expect(() => statSync(join(dir, 'shared.env'))).toThrow();
  });

  it('gives every app the shared keys', () => {
    materialize(SETS, dir);
    expect(read('cabinet')).toContain('JWT_SECRET=shared-jwt');
    expect(read('kickball')).toContain('JWT_SECRET=shared-jwt');
  });

  it("lets an app's own key override a shared key of the same name", () => {
    materialize(SETS, dir);
    expect(read('kickball')).toContain('AUTH_SERVICE_URL=http://127.0.0.1:3002');
    expect(read('kickball')).not.toContain('https://auth.benloe.com');
    // The override is local: cabinet still gets the shared default.
    expect(read('cabinet')).toContain('AUTH_SERVICE_URL=https://auth.benloe.com');
  });

  it("keeps one app's keys out of another app's file", () => {
    // This is the whole security property. kickball handles the least
    // trustworthy input on the box; the Mailgun key lives in cabinet's set, so
    // kickball's file cannot contain it no matter what kickball's code does.
    materialize(SETS, dir);
    expect(read('kickball')).not.toContain('MAILGUN_API_KEY');
    expect(read('kickball')).not.toContain('mg-live-secret');
    expect(read('cabinet')).not.toContain('KICKBALL_DB');
  });

  it('preserves base64 padding in values', () => {
    materialize(SETS, dir);
    expect(read('cabinet')).toContain('CABINET_KEY_B64=eHg=');
  });

  it('starts every file with the do-not-edit header', () => {
    materialize(SETS, dir);
    expect(read('cabinet').split('\n')[0]).toBe(
      '# Rendered by benloe-secrets. Do not edit — edits are lost on the next save.',
    );
  });

  it('writes files unreadable to other uids', () => {
    materialize(SETS, dir);
    expect(statSync(join(dir, 'cabinet.env')).mode & 0o777).toBe(0o400);
    expect(statSync(join(dir, 'kickball.env')).mode & 0o777).toBe(0o400);
  });

  it('leaves no temp file behind', () => {
    materialize(SETS, dir);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('replaces prior content rather than appending', () => {
    materialize(new Map([['app', 'A=1\nB=2']]), dir);
    materialize(new Map([['app', 'A=9']]), dir);
    const out = read('app');
    expect(out).toContain('A=9');
    expect(out).not.toContain('B=2');
    // Rewriting over a read-only file must still succeed, since the target is
    // 0400 from the previous run and only the rename touches it.
    expect(statSync(join(dir, 'app.env')).mode & 0o777).toBe(0o400);
  });

  it('reports the key count of each file it wrote', () => {
    const { written } = materialize(SETS, dir);
    // 2 shared + 2 own
    expect(written[join(dir, 'cabinet.env')]).toBe(4);
    // 2 shared + 2 own, one of which overrides a shared key
    expect(written[join(dir, 'kickball.env')]).toBe(3);
    expect(written[join(dir, 'shared.env')]).toBeUndefined();
  });

  it('reports the effective key names of each set', () => {
    const { effective } = materialize(SETS, dir);
    expect(effective.kickball).toEqual(['AUTH_SERVICE_URL', 'JWT_SECRET', 'KICKBALL_DB']);
    expect(effective.cabinet).toEqual([
      'AUTH_SERVICE_URL',
      'CABINET_KEY_B64',
      'JWT_SECRET',
      'MAILGUN_API_KEY',
    ]);
    expect(effective.shared).toBeUndefined();
    // The listing must describe the file that was actually written, not the
    // input, or it would be useless for auditing what an app can see.
    for (const [name, keys] of Object.entries(effective)) {
      const written = [...parsedKeys(read(name))].sort();
      expect(keys).toEqual(written);
    }
  });

  it('handles a store with no shared set at all', () => {
    materialize(new Map([['solo', 'X=1']]), dir);
    expect(read('solo')).toContain('X=1');
  });

  it('writes an empty set as a header-only file', () => {
    const { written } = materialize(new Map([['empty', '']]), dir);
    expect(written[join(dir, 'empty.env')]).toBe(0);
    expect(read('empty').trim()).toBe(
      '# Rendered by benloe-secrets. Do not edit — edits are lost on the next save.',
    );
  });
});

/** Key names of a rendered file, independent of store.parseEnv. */
function parsedKeys(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.slice(0, l.indexOf('=')));
}
