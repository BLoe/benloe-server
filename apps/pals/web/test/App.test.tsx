import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { encodeSse } from '../../server/src/gateway/sse.js';
import App from '../src/App.jsx';

/**
 * App-level orchestration tests (jsdom). These cover the wiring the pure
 * reducer can't: the auth gate, and — the regression that shipped — sending
 * a message when no thread exists yet.
 */

const OWNER = { email: 'below413@gmail.com' };

interface MockOpts {
  authStatus?: number;
  threads?: unknown[];
  onChat?: (body: { threadId: string; text: string }) => string; // returns SSE wire
  onCreateThread?: () => string;
}

function mockFetch(opts: MockOpts = {}) {
  const created: string[] = [];
  const chats: { threadId: string; text: string }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const authed = () => (opts.authStatus ?? 200);

    if (url.endsWith('/api/threads') && method === 'GET') {
      if (authed() !== 200) return new Response('no', { status: authed() });
      return Response.json({ threads: opts.threads ?? [] });
    }
    if (url.endsWith('/api/threads') && method === 'POST') {
      const id = opts.onCreateThread?.() ?? `t-${created.length + 1}`;
      created.push(id);
      return Response.json({ id }, { status: 201 });
    }
    if (url.endsWith('/api/healthz')) return Response.json({ ok: true, authMode: 'subscription', queueDepth: 0, pendingApprovals: 0, db: true, embedder: true });
    if (url.endsWith('/api/approvals')) return Response.json({ approvals: [] });
    if (url.includes('/messages')) return Response.json({ messages: [] });
    if (url.endsWith('/api/events')) return new Response(new ReadableStream(), { status: 200 });
    if (url.endsWith('/api/chat') && method === 'POST') {
      const body = JSON.parse(String(init!.body)) as { threadId: string; text: string };
      chats.push(body);
      const wire =
        opts.onChat?.(body) ??
        [
          encodeSse({ event: 'turn-start', data: { type: 'turn-start', messageId: 'm1', threadId: body.threadId, model: 'claude-sonnet-5' } }),
          encodeSse({ event: 'text-delta', data: { type: 'text-delta', delta: 'Got it.' } }),
          encodeSse({ event: 'turn-end', data: { type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' } }),
        ].join('');
      return new Response(wire, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.endsWith('/api/interrupt')) return Response.json({ interrupted: true });
    return new Response('unhandled', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, created, chats };
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('auth gate', () => {
  it('shows the login splash when the gateway returns 401', async () => {
    mockFetch({ authStatus: 401 });
    render(<App />);
    expect(await screen.findByText(/Sign in with your magic link/i)).toBeTruthy();
    expect(screen.queryByLabelText('message input')).toBeNull();
  });

  it('shows the composer once authenticated', async () => {
    mockFetch({ authStatus: 200, threads: [] });
    render(<App />);
    expect(await screen.findByLabelText('message input')).toBeTruthy();
  });
});

describe('send with no thread (regression)', () => {
  it('creates a thread and sends on the FIRST message when none exist', async () => {
    const { created, chats } = mockFetch({ threads: [] });
    const user = userEvent.setup();
    render(<App />);

    const box = await screen.findByLabelText('message input');
    await user.type(box, 'log two eggs');
    await user.keyboard('{Enter}');

    // A thread was created lazily, and the chat was sent to it.
    await waitFor(() => expect(created).toHaveLength(1));
    await waitFor(() => expect(chats).toHaveLength(1));
    expect(chats[0]!.threadId).toBe(created[0]);
    expect(chats[0]!.text).toBe('log two eggs');
    // User's message and the streamed reply are on screen.
    expect(await screen.findByText('log two eggs')).toBeTruthy();
    expect(await screen.findByText('Got it.')).toBeTruthy();
  });

  it('the Send button also works from a fresh install', async () => {
    const { created, chats } = mockFetch({ threads: [] });
    const user = userEvent.setup();
    render(<App />);

    const box = await screen.findByLabelText('message input');
    await user.type(box, 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(chats).toHaveLength(1));
    expect(created).toHaveLength(1);
  });

  it('reuses the existing thread instead of creating a new one when one is active', async () => {
    const { created, chats } = mockFetch({ threads: [{ id: 'existing', title: 'main', model_override: null, archived: 0, updated_at: 'x', messages: 2 }] });
    const user = userEvent.setup();
    render(<App />);

    const box = await screen.findByLabelText('message input');
    await user.type(box, 'second message');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(chats).toHaveLength(1));
    expect(chats[0]!.threadId).toBe('existing');
    expect(created).toHaveLength(0); // no new thread
  });

  it('does nothing on empty input (button stays disabled, Enter is a no-op)', async () => {
    const { chats } = mockFetch({ threads: [] });
    const user = userEvent.setup();
    render(<App />);
    const box = await screen.findByLabelText('message input');
    box.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /send/i })).toHaveProperty('disabled', true);
    expect(chats).toHaveLength(0);
  });

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const { chats } = mockFetch({ threads: [] });
    const user = userEvent.setup();
    render(<App />);
    const box = (await screen.findByLabelText('message input')) as HTMLTextAreaElement;
    await user.type(box, 'line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(box, 'line two');
    expect(box.value).toBe('line one\nline two');
    expect(chats).toHaveLength(0);
  });
});
