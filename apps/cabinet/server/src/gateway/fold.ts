import type { TurnEvent } from '../runtime/agent.js';
import type { ApprovalPacket } from '../tiers/approvals.js';

/**
 * Typed message parts (§12.3): the persisted shape of an assistant message
 * and the client's render model. The same fold runs server-side (persistence)
 * and client-side (live rendering), so the two can never disagree.
 */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-run'; toolId: string; name: string; input: unknown; output?: string; isError?: boolean; done: boolean }
  | { type: 'widget'; widgetType: string; data: unknown }
  | { type: 'approval'; packet: ApprovalPacket }
  | { type: 'notice'; level: string; text: string }
  /** A composer image attachment (§ vision spike, 2026-07-11). `id` is the
   *  attachment's filename under the chat-images dir (gateway/attachments.ts)
   *  — fetched on demand via GET /api/attachments/:id, never inlined here. */
  | { type: 'image'; id: string; mediaType: string };

/**
 * The one text-extraction rule for a folded parts array: join every text
 * part's prose, dropping tool-run/notice/widget/approval parts (structured,
 * not prose — embedding a render_widget JSON blob or a tool's raw output
 * would pollute a vector space, not enrich it). Shared by transcript.ts's
 * runAgentCronJob and the conversation-indexing backfill (episodic/index.ts)
 * so there is exactly one definition of "what counts as a message's real
 * text," not two independently-drifting copies. Lives here rather than in
 * gateway/transcript.ts because this module has zero real (non-type-only)
 * runtime imports of its own — importing FROM it can never create a cycle,
 * which mattered for episodic/index.ts pulling it in (episodic already has a
 * type-only edge back from runtime/prompt.ts's LessonRow import; this stays
 * a real value import without turning that into an actual runtime cycle).
 */
export function extractText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .trim();
}

export function foldEvent(parts: MessagePart[], e: TurnEvent | { type: 'widget'; widgetType: string; data: unknown }): MessagePart[] {
  switch (e.type) {
    case 'text-delta': {
      const last = parts.at(-1);
      if (last?.type === 'text') last.text += e.delta;
      else parts.push({ type: 'text', text: e.delta });
      return parts;
    }
    case 'tool-start':
      parts.push({ type: 'tool-run', toolId: e.toolId, name: e.name, input: e.input, done: false });
      return parts;
    case 'tool-end': {
      const run = parts.find((p) => p.type === 'tool-run' && p.toolId === e.toolId && !p.done) as
        | Extract<MessagePart, { type: 'tool-run' }>
        | undefined;
      if (run) {
        run.output = e.output;
        run.isError = e.isError;
        run.done = true;
      }
      return parts;
    }
    case 'widget':
      parts.push({ type: 'widget', widgetType: e.widgetType, data: e.data });
      return parts;
    case 'approval':
      parts.push({ type: 'approval', packet: e.packet });
      return parts;
    case 'notice':
      parts.push({ type: 'notice', level: e.level, text: e.text });
      return parts;
    default:
      return parts;
  }
}
