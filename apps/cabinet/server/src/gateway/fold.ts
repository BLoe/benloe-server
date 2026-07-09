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
  | { type: 'notice'; level: string; text: string };

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
