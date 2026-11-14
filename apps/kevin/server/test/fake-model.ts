// A scripted stand-in for the Anthropic client. Each queued reply is returned
// by the next request (streamed or not); every request's params are recorded.
import { setAnthropicForTests } from '../src/llm.js';

export interface Reply {
  content: Record<string, unknown>[];
  stop_reason?: string;
  usage?: Record<string, unknown>;
  /** Runs before the reply resolves; lets a test act "while the model is working". */
  before?: () => void | Promise<void>;
}

export const text = (t: string) => ({ type: 'text', text: t });
export const thinking = (t: string) => ({ type: 'thinking', thinking: t, signature: 'sig' });
export const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

export class FakeModel {
  queue: Reply[] = [];
  requests: Record<string, any>[] = [];

  constructor() {
    setAnthropicForTests({
      beta: { messages: { stream: (params: Record<string, any>, opts?: { signal?: AbortSignal }) => this.stream(params, opts?.signal) } },
      messages: { create: (params: Record<string, any>) => this.next(params).then((r) => r.message) },
    });
  }

  reply(...replies: Reply[]): this {
    this.queue.push(...replies);
    return this;
  }

  private async next(params: Record<string, any>, signal?: AbortSignal) {
    // Snapshot: the caller keeps mutating its arrays after the request.
    this.requests.push(JSON.parse(JSON.stringify(params)));
    const r = this.queue.shift();
    if (!r) throw new Error(`FakeModel: no reply queued for request ${this.requests.length}`);
    await r.before?.();
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const message = {
      id: `msg_${this.requests.length}`, model: params.model, role: 'assistant', type: 'message',
      content: r.content, stop_reason: r.stop_reason ?? (r.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...r.usage },
    };
    return { reply: r, message };
  }

  private stream(params: Record<string, any>, signal?: AbortSignal) {
    const handlers: ((e: any) => void)[] = [];
    const pending = this.next(params, signal);
    return {
      on: (name: string, fn: (e: any) => void) => {
        if (name === 'streamEvent') handlers.push(fn);
      },
      finalMessage: async () => {
        const { message } = await pending;
        message.content.forEach((b: any, index: number) => {
          const emit = (e: any) => handlers.forEach((h) => h(e));
          emit({ type: 'content_block_start', index, content_block: b.type === 'text' ? { type: 'text', text: '' } : b.type === 'thinking' ? { type: 'thinking', thinking: '' } : b });
          if (b.type === 'text') for (const part of b.text.match(/.{1,7}/gs) ?? []) emit({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
          if (b.type === 'thinking' && b.thinking) emit({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
          emit({ type: 'content_block_stop', index });
        });
        return message;
      },
    };
  }
}
