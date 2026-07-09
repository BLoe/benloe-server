import type Database from 'better-sqlite3';
import { applyPromotions, classifyToolUse, parsePromotions, type Classification, type TierPolicy, DEFAULT_POLICY } from './classify.js';
import type { ApprovalQueue, ApprovalPacket } from './approvals.js';

export interface GateContext {
  threadId: string | null;
  sessionKind: 'user' | 'heartbeat' | 'cron';
  /** Latest STANDING_ORDERS.md content, read at turn start. */
  standingOrders: string;
}

export type GateResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export interface GateEvents {
  onNotify?(toolName: string, c: Classification, input: Record<string, unknown>): void;
  onApprovalRequested?(packet: ApprovalPacket): void;
}

const TIER_DENY_MESSAGES: Record<number, string> = {
  0: 'Blocked (Tier 0): this action is structurally unavailable to Cabinet.',
  1: 'Human-only (Tier 1): Cabinet may draft or recommend this, but Ben must execute it himself.',
};

/**
 * The canUseTool gate (§6). Validated behavior (Appendix B): the callback is
 * only consulted for tools NOT bare-listed in allowedTools, it may block
 * arbitrarily long, and deny prevents execution. Audit coverage for the
 * echo-grade auto-approved class comes from the PreToolUse hook, not here.
 */
export function buildGate(opts: {
  db: Database.Database;
  approvals: ApprovalQueue;
  policy?: TierPolicy;
  events?: GateEvents;
  /**
   * 'full' (production default, §autonomy): Cabinet executes every action it
   * decides on; the classifier still runs, but only to label the audit trail —
   * nothing is gated or approval-blocked. Safety is recoverability (audit log +
   * backups) plus the SDK-level HARD_DENIES floor and filesystem permissions,
   * NOT pre-approval. 'tiered': the original 5-tier gate (kept for the classifier
   * test bench and as an opt-in stricter mode).
   */
  autonomy?: 'full' | 'tiered';
}) {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const autonomy = opts.autonomy ?? 'tiered';

  const audit = (toolName: string, c: Classification, decision: string, ctx: GateContext, args: unknown) => {
    opts.db
      .prepare(
        'INSERT INTO action_audit (tool, tier, args, decision, thread_id, session_kind, result) VALUES (?,?,?,?,?,?,?)',
      )
      .run(toolName, c.tier, JSON.stringify(args).slice(0, 4000), decision, ctx.threadId, ctx.sessionKind, c.reason);
  };

  return async function gate(
    toolName: string,
    input: Record<string, unknown>,
    ctx: GateContext,
  ): Promise<GateResult> {
    const promotions = parsePromotions(ctx.standingOrders);
    const c = applyPromotions(classifyToolUse(toolName, input, policy), promotions);

    // Autonomous mode: run everything, record what it was. The only hard floor
    // is upstream (SDK HARD_DENIES + unix perms) — the gate never blocks here.
    if (autonomy === 'full') {
      audit(toolName, c, 'autonomous', ctx, input);
      return { behavior: 'allow', updatedInput: input };
    }

    if (c.tier === 0 || c.tier === 1) {
      audit(toolName, c, 'denied', ctx, input);
      return { behavior: 'deny', message: `${TIER_DENY_MESSAGES[c.tier]} (${c.reason})` };
    }

    if (c.tier === 4) {
      audit(toolName, c, 'allowed', ctx, input);
      return { behavior: 'allow', updatedInput: input };
    }

    if (c.tier === 3) {
      audit(toolName, c, 'allowed-notify', ctx, input);
      opts.events?.onNotify?.(toolName, c, input);
      return { behavior: 'allow', updatedInput: input };
    }

    // Tier 2 — approve-before. Scheduled sessions never sit on an approval;
    // they defer the action to a user-visible packet and move on.
    const payload = JSON.stringify(input, null, 1).slice(0, 8000);
    const { decision, packet } = opts.approvals.enqueue({
      tier: 2,
      action: `${toolName}:${c.actionClass}`,
      payload,
      reasoning: c.reason,
      confidence: null,
      reversibility: null,
      threadId: ctx.threadId,
      ttlMs: ctx.sessionKind === 'user' ? undefined : 1000, // non-interactive: fail fast, packet remains visible
    });
    opts.events?.onApprovalRequested?.(packet);
    const d = await decision;
    if (d.approved) {
      audit(toolName, c, 'approved', ctx, input);
      const updatedInput = d.editedPayload ? (JSON.parse(d.editedPayload) as Record<string, unknown>) : input;
      return { behavior: 'allow', updatedInput };
    }
    audit(toolName, c, 'denied-approval', ctx, input);
    return { behavior: 'deny', message: d.message ?? 'Owner denied this action.' };
  };
}
