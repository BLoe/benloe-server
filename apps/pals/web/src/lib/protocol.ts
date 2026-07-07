/**
 * Single source of truth: the client re-exports the SERVER's SSE parser and
 * part-folding logic (§12.2/§12.3). If the wire or the fold changes, both
 * ends change in the same commit or the server test suite fails.
 */
export { createSseParser, type SseEvent } from '@server/gateway/sse';
export { foldEvent, type MessagePart } from '@server/gateway/fold';
export type { TurnEvent } from '@server/runtime/agent';
