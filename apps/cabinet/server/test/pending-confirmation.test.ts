import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { applyPendingDeployConfirmation } from '../src/deploy/pendingConfirmation.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-deploy-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

function writeStatus(overrides: Record<string, unknown> = {}) {
  writeFileSync(
    join(dir, 'last-deploy.json'),
    JSON.stringify({
      targetSha: 'abc123',
      confirmedSha: 'abc123',
      ok: true,
      ts: '2026-07-11T00:00:00.000Z',
      attempts: 1,
      commitSubject: 'test commit',
      acked: false,
      ...overrides,
    }),
  );
}

describe('applyPendingDeployConfirmation', () => {
  it('no-ops when no status file exists', () => {
    expect(applyPendingDeployConfirmation(cabinet.db, dir, 'abc123')).toBe(false);
  });

  it('no-ops when the live sha does not match targetSha', () => {
    writeStatus();
    expect(applyPendingDeployConfirmation(cabinet.db, dir, 'different-sha')).toBe(false);
    const count = cabinet.db.prepare("SELECT count(*) AS n FROM thread WHERE id='sys-deploy'").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('posts a confirmation into a user-kind sys-deploy thread and acks the status file', () => {
    writeStatus();
    expect(applyPendingDeployConfirmation(cabinet.db, dir, 'abc123')).toBe(true);

    const thread = cabinet.db.prepare("SELECT kind FROM thread WHERE id='sys-deploy'").get() as { kind: string };
    expect(thread.kind).toBe('user');

    const msg = cabinet.db.prepare("SELECT parts FROM message WHERE thread_id='sys-deploy'").get() as { parts: string };
    const parts = JSON.parse(msg.parts) as { text: string }[];
    expect(parts[0].text).toContain('abc123');
    expect(parts[0].text).toContain('test commit');

    const status = JSON.parse(readFileSync(join(dir, 'last-deploy.json'), 'utf8')) as { acked: boolean };
    expect(status.acked).toBe(true);
  });

  it('does not double-post once acked', () => {
    writeStatus();
    applyPendingDeployConfirmation(cabinet.db, dir, 'abc123');
    expect(applyPendingDeployConfirmation(cabinet.db, dir, 'abc123')).toBe(false);
    const count = cabinet.db.prepare("SELECT count(*) AS n FROM message WHERE thread_id='sys-deploy'").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it('fires on sha match even when the watcher recorded ok:false (decoupled from watcher verdict)', () => {
    writeStatus({ ok: false, confirmedSha: null });
    expect(applyPendingDeployConfirmation(cabinet.db, dir, 'abc123')).toBe(true);
  });

  it('does not crash on an unreadable/corrupt status file', () => {
    writeFileSync(join(dir, 'last-deploy.json'), 'not json');
    expect(applyPendingDeployConfirmation(cabinet.db, dir, 'abc123')).toBe(false);
  });
});
