// The one stream of things the UI should know about. Every open browser tab
// holds an SSE connection to /api/events and receives all of these; there is
// one user, so there is no per-user routing.
import { EventEmitter } from 'node:events';

export type UiItem =
  | { type: 'text'; text: string }
  /** A progress note Kevin wrote between tool calls. */
  | { type: 'status'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown; state: 'running' | 'ok' | 'error' | 'denied'; preview?: string; ms?: number };

export type BusEvent =
  | { type: 'turn_start'; threadId: string; turnId: number; user: unknown }
  | { type: 'text_delta'; threadId: string; turnId: number; text: string }
  | { type: 'status_delta'; threadId: string; turnId: number; text: string }
  | { type: 'block_stop'; threadId: string; turnId: number }
  | { type: 'tool'; threadId: string; turnId: number; item: Extract<UiItem, { type: 'tool' }> }
  | { type: 'confirm_request'; threadId: string; turnId: number; confirmId: string; tool: string; summary: string }
  | { type: 'confirm_resolved'; threadId: string; confirmId: string; approved: boolean }
  | { type: 'user_folded'; threadId: string; turnId: number; text: string }
  | { type: 'turn_end'; threadId: string; turnId: number; status: string; costUsd: number; error?: string }
  | { type: 'thread_updated'; threadId: string; title?: string }
  /** A typed write touched these domains; pages showing them should refetch. */
  | { type: 'data_changed'; domains: string[] }
  | { type: 'notification'; id: number; at: string; title: string; body: string; link: string | null; source: string | null };

class Bus extends EventEmitter {
  publish(e: BusEvent): void {
    this.emit('event', e);
  }
  /** A listener that throws is logged and skipped: one broken connection must not fail the turn that published. */
  subscribe(fn: (e: BusEvent) => void): () => void {
    const guarded = (e: BusEvent) => {
      try {
        fn(e);
      } catch (err) {
        console.error(`event listener failed on ${e.type}`, err);
      }
    };
    this.on('event', guarded);
    return () => this.off('event', guarded);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
