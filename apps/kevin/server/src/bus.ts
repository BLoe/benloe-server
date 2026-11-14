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
  | { type: 'notification'; id: number; title: string; body: string; link: string | null };

class Bus extends EventEmitter {
  publish(e: BusEvent): void {
    this.emit('event', e);
  }
  subscribe(fn: (e: BusEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
