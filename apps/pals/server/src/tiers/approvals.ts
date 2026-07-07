import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface ApprovalPacket {
  id: string;
  tier: number;
  action: string;
  payload: string; // exact command / diff / message body — what will actually run
  reasoning: string;
  confidence: number | null;
  reversibility: string | null;
  threadId: string | null;
  expiresAt: string;
}

export interface ApprovalDecision {
  approved: boolean;
  editedPayload?: string;
  message?: string;
}

interface Waiter {
  resolve(d: ApprovalDecision): void;
  timer: NodeJS.Timeout;
}

/**
 * Tier-2 approve-before queue (§6). enqueue() persists a packet, emits it for
 * the UI, and returns a promise that resolves when Ben decides — or expires
 * to a deny. Decisions survive restarts via the approval table; in-flight
 * waits do not (a restarted turn re-asks).
 */
export class ApprovalQueue extends EventEmitter {
  private waiters = new Map<string, Waiter>();

  constructor(
    private db: Database.Database,
    private defaultTtlMs = 24 * 60 * 60 * 1000,
  ) {
    super();
  }

  enqueue(
    packet: Omit<ApprovalPacket, 'id' | 'expiresAt'> & { ttlMs?: number },
  ): { id: string; decision: Promise<ApprovalDecision> } {
    const id = randomUUID();
    const ttl = packet.ttlMs ?? this.defaultTtlMs;
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    this.db
      .prepare(
        `INSERT INTO approval (id, tier, action, payload, reasoning, confidence, reversibility, thread_id, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, packet.tier, packet.action, packet.payload, packet.reasoning, packet.confidence, packet.reversibility, packet.threadId, expiresAt);

    const decision = new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => this.settle(id, 'expired', { approved: false, message: 'approval expired' }), ttl);
      timer.unref();
      this.waiters.set(id, { resolve, timer });
    });

    this.emit('approval', { ...packet, id, expiresAt } satisfies ApprovalPacket);
    return { id, decision };
  }

  decide(id: string, approved: boolean, editedPayload?: string, message?: string): boolean {
    const row = this.db.prepare("SELECT status FROM approval WHERE id = ?").get(id) as { status: string } | undefined;
    if (!row || row.status !== 'pending') return false;
    return this.settle(id, approved ? 'approved' : 'denied', {
      approved,
      editedPayload,
      message: message ?? (approved ? undefined : 'Owner denied this action.'),
    });
  }

  private settle(id: string, status: 'approved' | 'denied' | 'expired', decision: ApprovalDecision): boolean {
    const res = this.db
      .prepare("UPDATE approval SET status = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .run(status, id);
    if (res.changes === 0) return false;
    const waiter = this.waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(id);
      waiter.resolve(decision);
    }
    this.emit('decided', { id, status });
    return true;
  }

  pending(): ApprovalPacket[] {
    return this.db
      .prepare(
        `SELECT id, tier, action, payload, reasoning, confidence, reversibility,
                thread_id AS threadId, expires_at AS expiresAt
         FROM approval WHERE status = 'pending' ORDER BY created_at`,
      )
      .all() as ApprovalPacket[];
  }

  /** Maintenance sweep: expire overdue rows that have no in-memory waiter (e.g. after restart). */
  expireOverdue(): number {
    const rows = this.db
      .prepare("SELECT id FROM approval WHERE status = 'pending' AND expires_at < datetime('now')")
      .all() as { id: string }[];
    for (const { id } of rows) this.settle(id, 'expired', { approved: false, message: 'approval expired' });
    return rows.length;
  }
}
