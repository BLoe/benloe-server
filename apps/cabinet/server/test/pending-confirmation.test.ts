import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { applyPendingDeployConfirmation, schedulePendingDeployConfirmationWatch } from '../src/deploy/pendingConfirmation.js';

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
    const count = cabinet.db.prepare("SELECT count(*) AS n FROM chat WHERE id='sys-deploy'").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('posts a confirmation into a user-kind sys-deploy chat and acks the status file', () => {
    writeStatus();
    expect(applyPendingDeployConfirmation(cabinet.db, dir, 'abc123')).toBe(true);

    const chat = cabinet.db.prepare("SELECT kind FROM chat WHERE id='sys-deploy'").get() as { kind: string };
    expect(chat.kind).toBe('user');

    const msg = cabinet.db.prepare("SELECT parts FROM message WHERE chat_id='sys-deploy'").get() as { parts: string };
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
    const count = cabinet.db.prepare("SELECT count(*) AS n FROM message WHERE chat_id='sys-deploy'").get() as {
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

describe('schedulePendingDeployConfirmationWatch', () => {
  // Guards against the exact production bug this wrapper closes: the watcher
  // can only confirm a match by polling THIS process's own /healthz, so
  // last-deploy.json is written strictly AFTER this process has already
  // booted — a one-shot check at import time finds nothing every time. The
  // scheduled poll is what actually catches the marker once it lands late.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts once the marker appears mid-poll instead of only checking once at boot', () => {
    schedulePendingDeployConfirmationWatch(cabinet.db, dir, 'abc123', { pollMs: 10, timeoutMs: 500 });

    vi.advanceTimersByTime(25); // a couple of ticks with no marker yet — must not crash or wedge
    expect(cabinet.db.prepare("SELECT count(*) AS n FROM chat WHERE id='sys-deploy'").get()).toEqual({ n: 0 });

    writeStatus({ targetSha: 'abc123' }); // watcher writes it late, as it does in production
    vi.advanceTimersByTime(30); // next tick(s) should pick it up

    const count = cabinet.db.prepare("SELECT count(*) AS n FROM message WHERE chat_id='sys-deploy'").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
    const status = JSON.parse(readFileSync(join(dir, 'last-deploy.json'), 'utf8')) as { acked: boolean };
    expect(status.acked).toBe(true);
  });

  it('stops polling after the timeout — a marker appearing later is not retroactively posted', () => {
    schedulePendingDeployConfirmationWatch(cabinet.db, dir, 'abc123', { pollMs: 10, timeoutMs: 50 });
    vi.advanceTimersByTime(80); // past the deadline — interval should have self-cleared

    writeStatus({ targetSha: 'abc123' });
    vi.advanceTimersByTime(200); // nothing left running to notice

    const count = cabinet.db.prepare("SELECT count(*) AS n FROM message WHERE chat_id='sys-deploy'").get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  it('never posts at all when the sha never matches within the window', () => {
    schedulePendingDeployConfirmationWatch(cabinet.db, dir, 'abc123', { pollMs: 10, timeoutMs: 50 });
    writeStatus({ targetSha: 'some-other-sha' });
    vi.advanceTimersByTime(200);

    const count = cabinet.db.prepare("SELECT count(*) AS n FROM chat WHERE id='sys-deploy'").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
