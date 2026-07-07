import { describe, expect, it } from 'vitest';
import { addUserMessage, applyEvent, emptyThread, loadHistory } from '../src/lib/threadStore.js';
import { createSseParser, encodeSse } from '../../server/src/gateway/sse.js';
import type { SseEvent } from '../src/lib/protocol.js';

// A recorded turn, exactly as the gateway emits it (same encoder module).
const recordedTurn: SseEvent[] = [
  { event: 'turn-start', data: { type: 'turn-start', messageId: 'm-9', threadId: 't1', model: 'claude-sonnet-5' } },
  { event: 'text-delta', data: { type: 'text-delta', delta: 'Deploying' } },
  { event: 'tool-start', data: { type: 'tool-start', toolId: 'tu1', name: 'Bash', input: { command: 'npm run build' } } },
  { event: 'notice', data: { type: 'notice', level: 'info', text: 'Tier 3 — Bash: build/test toolchain' } },
  { event: 'tool-end', data: { type: 'tool-end', toolId: 'tu1', output: 'built in 2.1s', isError: false } },
  { event: 'widget', data: { type: 'widget', widgetType: 'diff', data: { files: 2 } } },
  { event: 'text-delta', data: { type: 'text-delta', delta: ' — done.' } },
  { event: 'turn-end', data: { type: 'turn-end', usage: { output_tokens: 40 }, sessionId: 's1', stopReason: 'success' } },
];

describe('threadStore.applyEvent', () => {
  it('folds a full recorded turn into one assistant message with ordered parts', () => {
    let state = addUserMessage(emptyThread(), 'deploy it', 'local-1');
    for (const e of recordedTurn) state = applyEvent(state, e);
    expect(state.status).toBe('idle');
    expect(state.model).toBe('claude-sonnet-5');
    expect(state.messages).toHaveLength(2);
    const assistant = state.messages[1]!;
    expect(assistant.streaming).toBe(false);
    expect(assistant.parts.map((p) => p.type)).toEqual(['text', 'tool-run', 'notice', 'widget', 'text']);
    expect(assistant.parts[0]).toEqual({ type: 'text', text: 'Deploying' });
    expect(assistant.parts[1]).toMatchObject({ output: 'built in 2.1s', done: true });
  });

  it('immutability: applying an event returns new state without mutating prior snapshots', () => {
    let s1 = addUserMessage(emptyThread(), 'x', 'l1');
    s1 = applyEvent(s1, recordedTurn[0]!);
    const s2 = applyEvent(s1, recordedTurn[1]!);
    const s3 = applyEvent(s2, { event: 'text-delta', data: { type: 'text-delta', delta: '!!' } });
    expect(s2.messages[1]!.parts).toEqual([{ type: 'text', text: 'Deploying' }]);
    expect(s3.messages[1]!.parts).toEqual([{ type: 'text', text: 'Deploying!!' }]);
    expect(s2).not.toBe(s3);
  });

  it('stream error marks the thread errored and stops streaming', () => {
    let state = addUserMessage(emptyThread(), 'x', 'l1');
    state = applyEvent(state, recordedTurn[0]!);
    state = applyEvent(state, { event: 'error', data: { type: 'error', message: 'boom', retryable: true } });
    expect(state.status).toBe('error');
    expect(state.error).toBe('boom');
    expect(state.messages[1]!.streaming).toBe(false);
  });

  it('part events with no active stream are ignored (late/out-of-order safety)', () => {
    const state = applyEvent(emptyThread(), recordedTurn[1]!);
    expect(state.messages).toHaveLength(0);
  });

  it('loadHistory maps persisted rows into render-ready messages', () => {
    const state = loadHistory(emptyThread(), [
      { id: 'a', role: 'user', parts: [{ type: 'text', text: 'hi' }], created_at: '2026-07-07' },
      { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'hello' }], created_at: '2026-07-07' },
    ]);
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('client/server protocol parity', () => {
  it('the client parses exactly what the server encoder produced (chunk-fuzzed)', () => {
    const wire = recordedTurn.map((e, i) => encodeSse({ ...e, id: String(i) })).join('');
    const out: SseEvent[] = [];
    const parse = createSseParser((e) => out.push(e));
    for (let pos = 0; pos < wire.length; pos += 3) parse(wire.slice(pos, pos + 3));
    expect(out).toHaveLength(recordedTurn.length);
    let state = addUserMessage(emptyThread(), 'go', 'l1');
    for (const e of out) state = applyEvent(state, e);
    expect(state.status).toBe('idle');
    expect(state.messages[1]!.parts).toHaveLength(5);
  });
});
