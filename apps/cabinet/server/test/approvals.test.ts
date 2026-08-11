import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';

/**
 * Replaces the approvals half of the old tiers.test.ts, which was deleted with
 * the tier classifier and gate it mostly covered.
 *
 * The queue survived that cut because it is not a permission gate: nothing
 * routes actions into it automatically any more. It is reached only when
 * Cabinet explicitly decides to ask — the enqueue_approval tool — which makes
 * it a way to hand Ben a decision, not a way to withhold one from the agent.
 */
describe('ApprovalQueue', () => {
  let dir: string;
  let cabinet: CabinetDb;
  let approvals: ApprovalQueue;

  const packet = (over: Record<string, unknown> = {}) => ({
    tier: 2,
    action: 'deploy',
    payload: JSON.stringify({ sha: 'abc123' }),
    reasoning: 'the build is green',
    confidence: 0.9,
    reversibility: 'revertible',
    chatId: 'c1',
    ...over,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cabinet-approvals-'));
    cabinet = openDb(join(dir, 'cabinet.db'));
    approvals = new ApprovalQueue(cabinet.db);
  });

  afterEach(() => {
    cabinet.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists the packet and announces it, so a closed tab does not lose it', () => {
    // Both halves matter: the event drives the live UI, the row is what a tab
    // opened five minutes later reads.
    let announced: { id: string } | null = null;
    approvals.on('approval', (p: { id: string }) => (announced = p));

    const { id } = approvals.enqueue(packet());

    expect(announced).not.toBeNull();
    expect(approvals.pending().map((p) => p.id)).toEqual([id]);
  });

  it('resolves the waiting promise when Ben approves', async () => {
    const { id, decision } = approvals.enqueue(packet());
    expect(approvals.decide(id, true)).toBe(true);
    await expect(decision).resolves.toMatchObject({ approved: true });
    expect(approvals.pending()).toEqual([]);
  });

  it('resolves as denied, carrying the message back to the caller', async () => {
    const { id, decision } = approvals.enqueue(packet());
    approvals.decide(id, false, undefined, 'not tonight');
    await expect(decision).resolves.toMatchObject({ approved: false, message: 'not tonight' });
  });

  it('refuses a second decision on the same packet', () => {
    const { id } = approvals.enqueue(packet());
    expect(approvals.decide(id, true)).toBe(true);
    expect(approvals.decide(id, false)).toBe(false);
  });

  it('refuses a decision on an id that was never enqueued', () => {
    expect(approvals.decide('no-such-id', true)).toBe(false);
  });

  it('expires on its own rather than leaving a caller waiting forever', async () => {
    const { decision } = approvals.enqueue(packet({ ttlMs: 5 }));
    await expect(decision).resolves.toMatchObject({ approved: false });
  });

  it('sweeps packets that expired while the process was down', () => {
    // Boot-time recovery: the in-memory timer died with the old process, so
    // the row would otherwise sit pending forever.
    const { id } = approvals.enqueue(packet());
    cabinet.db.prepare("UPDATE approval SET expires_at = datetime('now','-1 hour') WHERE id = ?").run(id);
    expect(approvals.expireOverdue()).toBe(1);
    expect(approvals.pending()).toEqual([]);
  });
});
