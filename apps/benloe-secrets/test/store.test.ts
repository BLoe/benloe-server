import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import {
  deleteSet,
  listSets,
  listVersions,
  loadKey,
  migrate,
  parseEnv,
  readAllSets,
  readSet,
  saveSet,
  SecretAuthError,
  SecretKeyError,
  MAX_DOCUMENT_BYTES,
  SET_NAME_RE,
  SHARED_SET,
} from '../src/store.js';

function db() {
  const d = new Database(':memory:');
  migrate(d);
  return d;
}
const KEY = randomBytes(32);

type Row = { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer };
const rowOf = (d: Database.Database, name: string, version: number) =>
  d
    .prepare('SELECT ciphertext, iv, auth_tag FROM secret_set WHERE name = ? AND version = ?')
    .get(name, version) as Row;

describe('parseEnv', () => {
  it('keeps everything after the first = so base64 padding survives', () => {
    const p = parseEnv('K=aGVsbG8gd29ybGQ=\n');
    expect(p.get('K')).toBe('aGVsbG8gd29ybGQ=');
  });

  it('keeps inner = in a value, not just trailing padding', () => {
    expect(parseEnv('DSN=postgres://u:p@h/db?a=1&b=2').get('DSN')).toBe('postgres://u:p@h/db?a=1&b=2');
  });

  it('skips comments, blanks and malformed keys', () => {
    const p = parseEnv('# note\n\nA=1\n2BAD=x\nno_equals\nB=2');
    expect([...p.keys()]).toEqual(['A', 'B']);
  });

  it('strips matched surrounding quotes only', () => {
    const p = parseEnv(`A="q"\nB='q'\nC="mismatch'\nD=un"quoted`);
    expect(p.get('A')).toBe('q');
    expect(p.get('B')).toBe('q');
    expect(p.get('C')).toBe(`"mismatch'`);
    expect(p.get('D')).toBe('un"quoted');
  });

  it('lets a later duplicate win, matching dotenv', () => {
    expect(parseEnv('A=1\nA=2').get('A')).toBe('2');
  });
});

describe('set names', () => {
  it('accepts the names apps actually use and rejects anything path-shaped', () => {
    for (const ok of ['shared', 'cabinet', 'fantasy-hawk', 'a', 'app3']) {
      expect(SET_NAME_RE.test(ok)).toBe(true);
    }
    for (const bad of ['', 'Cabinet', '3app', '-lead', 'has_underscore', '../etc', 'a/b', 'a'.repeat(41)]) {
      expect(SET_NAME_RE.test(bad)).toBe(false);
    }
  });

  it('refuses an invalid name at every entry point rather than creating it', () => {
    const d = db();
    expect(() => saveSet(d, KEY, '../etc', 'A=1', null)).toThrow(/Invalid set name/);
    expect(() => readSet(d, KEY, 'BAD')).toThrow(/Invalid set name/);
    expect(() => listVersions(d, 'BAD')).toThrow(/Invalid set name/);
    expect(() => deleteSet(d, 'BAD')).toThrow(/Invalid set name/);
  });
});

describe('saveSet / readSet', () => {
  it('round-trips a set', () => {
    const d = db();
    saveSet(d, KEY, 'cabinet', 'A=1\nB=2\n', 'ben@example.com');
    expect(readSet(d, KEY, 'cabinet')).toBe('A=1\nB=2\n');
  });

  it('returns null for a set that does not exist and for a version that does not', () => {
    const d = db();
    expect(readSet(d, KEY, 'cabinet')).toBeNull();
    saveSet(d, KEY, 'cabinet', 'A=1', null);
    expect(readSet(d, KEY, 'cabinet', 9)).toBeNull();
  });

  it('versions each set independently', () => {
    const d = db();
    saveSet(d, KEY, 'cabinet', 'A=1', null);
    saveSet(d, KEY, 'cabinet', 'A=2', null);
    const kb = saveSet(d, KEY, 'kickball', 'A=1', null);
    // Saving cabinet twice must not push kickball's first save to v3.
    expect(kb.version).toBe(1);
    expect(listVersions(d, 'cabinet').map((v) => v.version)).toEqual([2, 1]);
  });

  it('keeps history readable across saves', () => {
    const d = db();
    saveSet(d, KEY, 'cabinet', 'A=old', null);
    saveSet(d, KEY, 'cabinet', 'A=new', null);
    expect(readSet(d, KEY, 'cabinet', 1)).toBe('A=old');
    expect(readSet(d, KEY, 'cabinet', 2)).toBe('A=new');
    expect(readSet(d, KEY, 'cabinet')).toBe('A=new');
  });

  it('records key count, byte length and author without storing content in metadata', () => {
    const d = db();
    const meta = saveSet(d, KEY, 'cabinet', 'A=1\n# c\nB=2', 'ben@example.com');
    expect(meta.name).toBe('cabinet');
    expect(meta.key_count).toBe(2);
    expect(meta.byte_length).toBe(Buffer.byteLength('A=1\n# c\nB=2'));
    expect(meta.updated_by).toBe('ben@example.com');
    expect(meta.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(JSON.stringify(meta)).not.toContain('A=1');
  });

  it('refuses a document over the size limit', () => {
    const d = db();
    expect(() => saveSet(d, KEY, 'cabinet', 'x'.repeat(MAX_DOCUMENT_BYTES + 1), null)).toThrow(/limit/);
    expect(listSets(d)).toEqual([]);
  });

  it('throws without a key rather than storing plaintext', () => {
    expect(() => saveSet(db(), null, 'cabinet', 'A=1', null)).toThrow(SecretKeyError);
  });

  it('fails authentication under the wrong key rather than returning garbage', () => {
    const d = db();
    saveSet(d, KEY, 'cabinet', 'A=1', null);
    expect(() => readSet(d, randomBytes(32), 'cabinet')).toThrow(SecretAuthError);
  });

  it('refuses a ciphertext moved between sets', () => {
    // The point of binding the set NAME into the AAD: someone with write access
    // to the database but not the key must not be able to lift cabinet's row
    // into kickball's set and have it render into kickball's env file.
    const d = db();
    saveSet(d, KEY, 'cabinet', 'MAILGUN_API_KEY=secret', null);
    saveSet(d, KEY, 'kickball', 'A=1', null);
    const stolen = rowOf(d, 'cabinet', 1);
    // Same version number in both sets, so the name is the only thing differing.
    d.prepare('UPDATE secret_set SET ciphertext=?, iv=?, auth_tag=? WHERE name=? AND version=1').run(
      stolen.ciphertext,
      stolen.iv,
      stolen.auth_tag,
      'kickball',
    );
    expect(() => readSet(d, KEY, 'kickball')).toThrow(SecretAuthError);
  });

  it('refuses a ciphertext rolled back to an older version', () => {
    // The version half of the same binding: copying v1 over v2 to undo a
    // credential rotation must not authenticate.
    const d = db();
    saveSet(d, KEY, 'cabinet', 'TOKEN=old', null);
    saveSet(d, KEY, 'cabinet', 'TOKEN=rotated', null);
    const old = rowOf(d, 'cabinet', 1);
    d.prepare('UPDATE secret_set SET ciphertext=?, iv=?, auth_tag=? WHERE name=? AND version=2').run(
      old.ciphertext,
      old.iv,
      old.auth_tag,
      'cabinet',
    );
    expect(() => readSet(d, KEY, 'cabinet', 2)).toThrow(SecretAuthError);
  });

  it('reports a truncated auth tag as an auth failure, not a crypto crash', () => {
    const d = db();
    saveSet(d, KEY, 'cabinet', 'A=1', null);
    d.prepare('UPDATE secret_set SET auth_tag=? WHERE name=? AND version=1').run(randomBytes(8), 'cabinet');
    expect(() => readSet(d, KEY, 'cabinet')).toThrow(SecretAuthError);
  });
});

describe('listSets', () => {
  it('returns the newest version of each set, name ascending', () => {
    const d = db();
    saveSet(d, KEY, 'kickball', 'A=1', null);
    saveSet(d, KEY, 'cabinet', 'A=1', null);
    saveSet(d, KEY, 'cabinet', 'A=1\nB=2', null);
    saveSet(d, KEY, SHARED_SET, 'JWT_SECRET=x', null);
    expect(listSets(d).map((s) => [s.name, s.version, s.key_count])).toEqual([
      ['cabinet', 2, 2],
      ['kickball', 1, 1],
      ['shared', 1, 1],
    ]);
  });
});

describe('readAllSets', () => {
  it('returns the current text of every set, shared included', () => {
    const d = db();
    saveSet(d, KEY, SHARED_SET, 'JWT_SECRET=x', null);
    saveSet(d, KEY, 'cabinet', 'A=old', null);
    saveSet(d, KEY, 'cabinet', 'A=new', null);
    const all = readAllSets(d, KEY);
    expect([...all.keys()].sort()).toEqual(['cabinet', 'shared']);
    expect(all.get('cabinet')).toBe('A=new');
  });

  it('is empty on a fresh database rather than throwing', () => {
    expect(readAllSets(db(), KEY).size).toBe(0);
  });
});

describe('deleteSet', () => {
  it('removes every version of one set and leaves the others alone', () => {
    const d = db();
    saveSet(d, KEY, 'cabinet', 'A=1', null);
    saveSet(d, KEY, 'cabinet', 'A=2', null);
    saveSet(d, KEY, 'kickball', 'A=1', null);
    expect(deleteSet(d, 'cabinet')).toBe(true);
    expect(listVersions(d, 'cabinet')).toEqual([]);
    expect(listSets(d).map((s) => s.name)).toEqual(['kickball']);
  });

  it('reports false when there was nothing to delete', () => {
    expect(deleteSet(db(), 'cabinet')).toBe(false);
  });

  it('lets a deleted name be recreated from v1', () => {
    const d = db();
    saveSet(d, KEY, 'cabinet', 'A=1', null);
    deleteSet(d, 'cabinet');
    expect(saveSet(d, KEY, 'cabinet', 'A=2', null).version).toBe(1);
    expect(readSet(d, KEY, 'cabinet')).toBe('A=2');
  });
});

describe('loadKey', () => {
  it('returns null when the file is absent', () => {
    expect(
      loadKey(() => {
        throw new Error('ENOENT');
      }, '/nope'),
    ).toBeNull();
  });

  it('throws on a short key, naming only its length', () => {
    const short = randomBytes(16).toString('base64');
    try {
      loadKey(() => short, '/k');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretKeyError);
      expect((err as Error).message).toContain('16');
      expect((err as Error).message).not.toContain(short);
    }
  });

  it('accepts a valid 32-byte key', () => {
    expect(loadKey(() => KEY.toString('base64'), '/k')?.length).toBe(32);
  });
});
