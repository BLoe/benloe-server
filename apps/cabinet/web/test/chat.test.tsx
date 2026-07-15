import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage, ChatSummary } from '../src/lib/contracts.js';

const { chatsMock, messagesMock, streamChatMock } = vi.hoisted(() => ({
  chatsMock: vi.fn<() => Promise<{ chats: ChatSummary[] }>>(),
  messagesMock: vi.fn<(chatId: string) => Promise<{ messages: ChatMessage[] }>>(),
  streamChatMock: vi.fn(),
}));

// Stub the data module: keep the real types/exports, swap api.chats + api.messages.
vi.mock('../src/lib/cabinet.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/cabinet.js')>();
  return { ...actual, api: { ...actual.api, chats: chatsMock, messages: messagesMock } };
});

// Stub only streamChat — foldTurn stays real so folded parts match production folding.
vi.mock('../src/lib/chat.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/chat.js')>();
  return { ...actual, streamChat: streamChatMock };
});

import { Chat } from '../src/surfaces/Chat.js';

const CHATS: ChatSummary[] = [
  {
    id: 't-5dd8',
    title: 'Cabinet Systems Status Report',
    model_override: null,
    archived: 0,
    updated_at: '2026-07-07T13:10:00-04:00',
    messages: 6,
    preview: 'Full status check across services and data.',
  },
  {
    id: 't-1a2b',
    title: 'Weight tracker + macro ring',
    model_override: 'opus',
    archived: 0,
    updated_at: '2026-07-05T20:30:00-04:00',
    messages: 14,
    preview: 'Built and deployed the weight tracker.',
  },
];

const MESSAGES: ChatMessage[] = [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'How are the services looking?' }], created_at: '2026-07-07T13:00:00-04:00' },
  {
    id: 'm2',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'All green. Nine services up, backups ran at 05:41, nothing pending.' },
      { type: 'tool-run', toolId: 'x1', name: 'pm2_list', input: { filter: 'all' }, output: '9 online', done: true },
    ],
    created_at: '2026-07-07T13:00:20-04:00',
  },
];

beforeEach(() => {
  chatsMock.mockReset();
  messagesMock.mockReset();
  streamChatMock.mockReset();
  chatsMock.mockResolvedValue({ chats: CHATS });
  messagesMock.mockResolvedValue({ messages: MESSAGES });
});
afterEach(cleanup);

describe('Chat surface', () => {
  it('renders the archive list with title, preview, and message count', async () => {
    render(<Chat />);
    await waitFor(() => expect(chatsMock).toHaveBeenCalled());

    expect(await screen.findByText('Cabinet Systems Status Report')).toBeTruthy();
    expect(screen.getByText('Weight tracker + macro ring')).toBeTruthy();
    expect(screen.getByText('Full status check across services and data.')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
  });

  it('the search box filters the list by title/preview', async () => {
    const user = userEvent.setup();
    render(<Chat />);
    await screen.findByText('Cabinet Systems Status Report');

    await user.type(screen.getByLabelText('Search conversations'), 'weight tracker');

    expect(screen.queryByText('Cabinet Systems Status Report')).toBeNull();
    expect(screen.getByText('Weight tracker + macro ring')).toBeTruthy();
  });

  it('shows voice empty copy when the search matches nothing', async () => {
    const user = userEvent.setup();
    render(<Chat />);
    await screen.findByText('Cabinet Systems Status Report');

    await user.type(screen.getByLabelText('Search conversations'), 'zzz-nonexistent');

    expect(await screen.findByText(/Nothing matches/)).toBeTruthy();
  });

  it('selecting a chat calls api.messages(id) and renders its messages', async () => {
    const user = userEvent.setup();
    render(<Chat />);
    await screen.findByText('Cabinet Systems Status Report');

    await user.click(screen.getByText('Cabinet Systems Status Report'));

    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith('t-5dd8'));
    expect(await screen.findByText('How are the services looking?')).toBeTruthy();
    expect(screen.getByText(/All green\. Nine services up/)).toBeTruthy();
    // tool-run part rendered as a compact card
    expect(screen.getByText('pm2_list')).toBeTruthy();
    expect(screen.getByText('9 online')).toBeTruthy();
  });

  it('a mid-turn network drop (e.g. the server restarting) still leaves the tool call it already ran visible, not wiped (2026-07-15 fix)', async () => {
    const user = userEvent.setup();
    streamChatMock.mockImplementation(async (_chatId: string, _message: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'turn-start', messageId: 'm-live', chatId: 't-5dd8', model: 'claude-sonnet-5' });
      onEvent({ type: 'tool-start', toolId: 'tu-live', name: 'Bash', input: { command: 'ls' } });
      onEvent({ type: 'tool-end', toolId: 'tu-live', output: 'ok', isError: false });
      throw new Error('chat failed: 502');
    });
    render(<Chat />);
    await user.click(await screen.findByText('Cabinet Systems Status Report'));
    await screen.findByText('How are the services looking?');

    await user.type(screen.getByLabelText('Message Cabinet'), 'redeploy yourself');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(streamChatMock).toHaveBeenCalled());
    // The tool call already ran before the connection dropped — the old
    // code's `finally { setLive(null); }` wiped it from view on ANY turn
    // termination (success or error), and only the success path re-added it
    // to `messages` first. Now the error path does too.
    expect(await screen.findByText('Ran: ls')).toBeTruthy();
  });
});
