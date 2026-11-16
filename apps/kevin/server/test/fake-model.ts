// A scripted stand-in for the Anthropic client. Each queued reply is returned
// by the next request (streamed or not); every request's params are recorded.
import { setAnthropicForTests } from '../src/llm.js';

export interface Reply {
  content: Record<string, unknown>[];
  stop_reason?: string;
  usage?: Record<string, unknown>;
  /** Runs before the reply resolves; lets a test act "while the model is working". */
  before?: () => void | Promise<void>;
  /**
   * A streamed reply that breaks off: the content arrives, then the stream fails with this error and
   * there is no final message. As with the real API, the usage seen so far has the prompt's tokens
   * and almost no output tokens.
   */
  breaksWith?: Error;
}

export const text = (t: string) => ({ type: 'text', text: t });
export const thinking = (t: string) => ({ type: 'thinking', thinking: t, signature: 'sig' });
export const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

export class FakeModel {
  queue: Reply[] = [];
  requests: Record<string, any>[] = [];
  /** When set and it returns a reply, that reply answers the request instead of the next queued one. */
  route: ((params: Record<string, any>) => Reply | undefined) | null = null;

  constructor() {
    const stream = (params: Record<string, any>, opts?: { signal?: AbortSignal }) => this.stream(params, opts?.signal);
    setAnthropicForTests({
      beta: { messages: { stream } },
      messages: { stream, create: (params: Record<string, any>) => this.next(params, undefined, () => undefined).then((r) => r.message) },
    });
  }

  reply(...replies: Reply[]): this {
    this.queue.push(...replies);
    return this;
  }

  /** `started` is called with the message as it stands once the API has begun to answer (the SDK's currentMessage). */
  private async next(params: Record<string, any>, signal: AbortSignal | undefined, started: (partial: Record<string, any>) => void) {
    // Snapshot: the caller keeps mutating its arrays after the request.
    this.requests.push(JSON.parse(JSON.stringify(params)));
    const r = this.route?.(params) ?? this.queue.shift();
    if (!r) throw new Error(`FakeModel: no reply queued for request ${this.requests.length}`);
    const message = {
      id: `msg_${this.requests.length}`, model: params.model, role: 'assistant', type: 'message',
      content: r.content, stop_reason: r.stop_reason ?? (r.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...r.usage },
    };
    started({ ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 1 } });
    await r.before?.();
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { reply: r, message };
  }

  private stream(params: Record<string, any>, signal?: AbortSignal) {
    const handlers: ((e: any) => void)[] = [];
    let current: Record<string, any> | undefined;
    const pending = this.next(params, signal, (partial) => (current = partial));
    // The caller may never ask for the final message; an unobserved failure here is not the test's concern.
    pending.catch(() => undefined);
    return {
      get currentMessage() {
        return current;
      },
      on: (name: string, fn: (e: any) => void) => {
        if (name === 'streamEvent') handlers.push(fn);
      },
      finalMessage: async () => {
        const { message, reply } = await pending;
        message.content.forEach((b: any, index: number) => {
          const emit = (e: any) => handlers.forEach((h) => h(e));
          emit({ type: 'content_block_start', index, content_block: b.type === 'text' ? { type: 'text', text: '' } : b.type === 'thinking' ? { type: 'thinking', thinking: '' } : b });
          if (b.type === 'text') for (const part of b.text.match(/.{1,7}/gs) ?? []) emit({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
          if (b.type === 'thinking' && b.thinking) emit({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
          if (b.type === 'tool_use') emit({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input ?? {}) } });
          emit({ type: 'content_block_stop', index });
        });
        if (reply.breaksWith) throw reply.breaksWith;
        return message;
      },
    };
  }
}
