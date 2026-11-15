// The chat's state, shared by the docked panel, the mobile sheet, and any page
// that wants to open the chat with a message (`openChat`). A small external
// store rather than context: events arrive from outside React.
import { useSyncExternalStore } from 'react';
import { api, ApiError } from './api';
import { subscribe } from './events';
import { prepareUpload } from './image';
import { toast } from './toast';
import { addPending, applyEvent, emptyThread, mergeSnapshot, removePending, type PendingMessage, type ThreadState } from './transcript';
import type { ThreadPayload, ThreadSummary, Upload } from './types';

export interface DraftAttachment {
  key: number;
  name: string;
  state: 'uploading' | 'reading' | 'ready' | 'failed';
  /** 0..1 while uploading */
  progress: number;
  upload?: Upload;
  error?: string;
  /** Object URL for an image thumbnail. */
  preview?: string;
}

export interface ChatState {
  /** Desktop: the docked panel is expanded. Remembered across visits. */
  docked: boolean;
  /** Mobile: the full-screen sheet is up. */
  sheet: boolean;
  view: 'chat' | 'threads';
  /** null is a new chat that has not been created on the server yet. */
  threadId: string | null;
  thread: ThreadState | null;
  loading: boolean;
  loadError: string | null;
  threads: ThreadSummary[] | null;
  draft: string;
  attachments: DraftAttachment[];
  deep: boolean;
  /** Bumped to ask the composer to take focus. */
  focusTick: number;
}

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the preference just does not persist
  }
};

let state: ChatState = {
  docked: stored('kevin.chat.docked') !== '0',
  sheet: false,
  view: 'chat',
  threadId: stored('kevin.chat.thread'),
  thread: null,
  loading: false,
  loadError: null,
  threads: null,
  draft: '',
  attachments: [],
  deep: false,
  focusTick: 0,
};

const subs = new Set<() => void>();
let frame: number | null = null;
function set(patch: Partial<ChatState>): void {
  state = { ...state, ...patch };
  // Streaming can deliver dozens of deltas between paints; render once per frame.
  if (frame !== null) return;
  const flush = () => {
    frame = null;
    subs.forEach((fn) => fn());
  };
  frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => state,
  );
}

export const getChat = (): ChatState => state;

// ---- the page Ben is on (sent with each message) -------------------------------

let page = '/';
export function setPage(path: string): void {
  page = path;
}
export const getPage = (): string => page;

// ---- threads -------------------------------------------------------------------

let fetchSeq = 0;
async function fetchThread(id: string, quiet = false): Promise<void> {
  const mine = ++fetchSeq;
  if (!quiet) set({ loading: true, loadError: null });
  try {
    const payload = await api.get<ThreadPayload>(`/threads/${id}`);
    if (mine !== fetchSeq || state.threadId !== id) return;
    set({ thread: mergeSnapshot(state.thread, payload), loading: false, loadError: null });
  } catch (e) {
    if (mine !== fetchSeq || state.threadId !== id) return;
    if (e instanceof ApiError && e.status === 404) {
      // The remembered thread no longer exists: start fresh.
      store('kevin.chat.thread', null);
      set({ threadId: null, thread: null, loading: false, loadError: null });
      return;
    }
    if (!quiet) set({ loading: false, loadError: e instanceof ApiError ? e.message : 'Could not load this chat.' });
  }
}

export async function loadThreads(): Promise<void> {
  try {
    set({ threads: await api.get<ThreadSummary[]>('/threads') });
  } catch {
    // the list keeps what it had; the next event or focus retries
  }
}

export function selectThread(id: string): void {
  store('kevin.chat.thread', id);
  set({ threadId: id, thread: state.thread?.id === id ? state.thread : null, view: 'chat', focusTick: state.focusTick + 1 });
  void fetchThread(id);
}

export function newChat(): void {
  store('kevin.chat.thread', null);
  fetchSeq++;
  set({ threadId: null, thread: null, loading: false, loadError: null, view: 'chat', focusTick: state.focusTick + 1 });
}

export function showThreads(show = true): void {
  set({ view: show ? 'threads' : 'chat' });
  if (show) void loadThreads();
}

export async function renameThread(id: string, title: string): Promise<void> {
  try {
    await api.patch(`/threads/${id}`, { title });
    if (state.thread?.id === id) set({ thread: { ...state.thread, title: title.trim() || state.thread.title } });
    await loadThreads();
  } catch (e) {
    toast.error('Couldn’t rename the chat', e instanceof Error ? e.message : undefined);
  }
}

export async function archiveThread(id: string): Promise<void> {
  try {
    await api.patch(`/threads/${id}`, { archived: true });
    if (state.threadId === id) newChat();
    await loadThreads();
    toast.success('Chat archived');
  } catch (e) {
    toast.error('Couldn’t archive the chat', e instanceof Error ? e.message : undefined);
  }
}

// ---- opening and closing --------------------------------------------------------

export interface OpenChatOptions {
  /** Text placed in the composer for Ben to edit and send. */
  prefill?: string;
  /** Text sent straight away. */
  send?: string;
  /** Already-uploaded files to go with `send` (or to sit in the composer with `prefill`). */
  attachments?: Upload[];
  /** Open this thread. */
  threadId?: string;
  /** Start a new chat instead of continuing the open one. */
  newThread?: boolean;
}

/**
 * Opens the chat (the docked panel on desktop, the sheet on a phone) from
 * anywhere. With `send` the message goes at once; with `prefill` it waits in
 * the composer.
 */
export function openChat(opts: OpenChatOptions = {}): void {
  if (opts.threadId && opts.threadId !== state.threadId) selectThread(opts.threadId);
  else if (opts.newThread) newChat();
  if (!state.docked) store('kevin.chat.docked', '1');
  pushSheetEntry();
  set({ docked: true, sheet: true, view: 'chat', focusTick: state.focusTick + 1 });
  const uploads = (opts.attachments ?? []).map((u): DraftAttachment => ({ key: nextKey++, name: u.filename, state: 'ready', progress: 1, upload: u }));
  if (opts.send !== undefined) {
    void sendMessage(opts.send, uploads);
  } else if (opts.prefill !== undefined || uploads.length) {
    set({ draft: opts.prefill ?? state.draft, attachments: [...state.attachments, ...uploads] });
  }
}

// On a phone the sheet gets its own history entry, so the Back gesture
// closes the chat instead of leaving the page underneath it.
const SHEET_ENTRY = 'kevinChatSheet';
const onSheetEntry = (): boolean => (history.state as { [SHEET_ENTRY]?: boolean } | null)?.[SHEET_ENTRY] === true;
const isPhone = (): boolean => !window.matchMedia('(min-width: 64rem)').matches;

function pushSheetEntry(): void {
  if (state.sheet || !isPhone() || onSheetEntry()) return;
  history.pushState({ [SHEET_ENTRY]: true }, '');
}

export function closeChat(): void {
  // Leaving through the entry lets popstate do the closing, and keeps Back and the close button the same thing.
  if (state.sheet && onSheetEntry()) history.back();
  else set({ sheet: false });
}

/**
 * For a link tapped inside the chat: closes the sheet so the page shows, and
 * says whether the navigation should replace the sheet's history entry.
 */
export function leaveSheetForLink(): { replace: boolean } {
  const replace = state.sheet && onSheetEntry();
  set({ sheet: false });
  return { replace };
}

export function setDocked(docked: boolean): void {
  store('kevin.chat.docked', docked ? '1' : '0');
  set({ docked });
}

// ---- composing -------------------------------------------------------------------

export const setDraft = (draft: string): void => set({ draft });
export const setDeep = (deep: boolean): void => set({ deep });

let nextKey = 1;
const patchAttachment = (key: number, patch: Partial<DraftAttachment>): void =>
  set({ attachments: state.attachments.map((a) => (a.key === key ? { ...a, ...patch } : a)) });

export function addFiles(files: Iterable<File>): void {
  for (const file of files) {
    if (state.attachments.length >= 10) {
      toast.error('Ten files at most per message');
      break;
    }
    const key = nextKey++;
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
    set({ attachments: [...state.attachments, { key, name: file.name || 'photo.jpg', state: 'uploading', progress: 0, preview }] });
    void (async () => {
      try {
        const { blob, filename } = await prepareUpload(file);
        const upload = await api.upload(blob, filename, (p) => patchAttachment(key, p >= 1 ? { state: 'reading', progress: 1 } : { progress: p }));
        patchAttachment(key, { state: 'ready', upload, name: upload.filename });
      } catch (e) {
        patchAttachment(key, { state: 'failed', error: e instanceof Error ? e.message : 'Upload failed' });
      }
    })();
  }
}

export function removeAttachment(key: number): void {
  const a = state.attachments.find((x) => x.key === key);
  if (a?.preview) URL.revokeObjectURL(a.preview);
  set({ attachments: state.attachments.filter((x) => x.key !== key) });
}

/** Uploads one file outside the composer (Home's "Snap fridge photo"). */
export async function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<Upload> {
  const { blob, filename } = await prepareUpload(file);
  return api.upload(blob, filename, onProgress);
}

/** Why the composer cannot send right now, or null when it can. */
export function sendBlocker(s: ChatState): string | null {
  if (s.attachments.some((a) => a.state === 'uploading' || a.state === 'reading')) return 'Waiting for the upload to finish.';
  const ready = s.attachments.some((a) => a.state === 'ready');
  if (!s.draft.trim() && !ready) return '';
  return null;
}

/** Sends the composer's contents. */
export function sendDraft(): void {
  if (sendBlocker(state) !== null) return;
  const text = state.draft;
  const attachments = state.attachments.filter((a) => a.state === 'ready');
  for (const a of state.attachments) if (a.preview) URL.revokeObjectURL(a.preview);
  set({ draft: '', attachments: [] });
  void sendMessage(text, attachments);
}

async function sendMessage(text: string, attachments: DraftAttachment[]): Promise<void> {
  const deep = state.deep;
  const pending: PendingMessage = {
    text: text.trim(),
    attachments: attachments.flatMap((a) => (a.upload ? [{ id: a.upload.id, filename: a.upload.filename, mime: a.upload.mime }] : [])),
  };
  let id = state.threadId;
  try {
    if (!id) {
      // A new chat exists on the server only once it has a first message.
      const created = await api.post<ThreadSummary>('/threads');
      id = created.id;
      store('kevin.chat.thread', id);
      fetchSeq++;
      set({ threadId: id, thread: emptyThread(id, created.title), loading: false, loadError: null });
    } else if (!state.thread || state.thread.id !== id) {
      set({ thread: emptyThread(id) });
    }
    set({ thread: addPending(state.thread!, pending), deep: false });
    await api.post(`/threads/${id}/messages`, { text: pending.text, attachments: pending.attachments.map((a) => a.id), page, deep });
  } catch (e) {
    if (state.thread && state.thread.id === id) set({ thread: removePending(state.thread, pending) });
    // Give the words back rather than losing them.
    set({ draft: state.draft || text, attachments: [...attachments, ...state.attachments] });
    toast.error('Message not sent', e instanceof Error ? e.message : undefined);
  }
}

export async function stopTurn(): Promise<void> {
  if (!state.threadId) return;
  try {
    await api.post(`/threads/${state.threadId}/stop`);
  } catch (e) {
    toast.error('Couldn’t stop', e instanceof Error ? e.message : undefined);
  }
}

export async function answerConfirm(confirmId: string, approved: boolean): Promise<void> {
  if (!state.threadId) return;
  try {
    const r = await api.post<{ ok: boolean }>(`/threads/${state.threadId}/confirm`, { confirmId, approved });
    if (!r.ok && state.thread) {
      // Already answered or timed out on the server.
      set({ thread: { ...state.thread, confirms: state.thread.confirms.filter((c) => c.confirmId !== confirmId) } });
      toast.info('That request had already expired');
    }
  } catch (e) {
    toast.error('Couldn’t send your answer', e instanceof Error ? e.message : undefined);
  }
}

// ---- wiring ------------------------------------------------------------------------

let started = false;
/** Called once from the shell: listens to the stream and loads the remembered thread. */
export function startChat(): void {
  if (started) return;
  started = true;
  subscribe((e) => {
    if (e.type === 'reconnected') {
      if (state.threadId) void fetchThread(state.threadId, true);
      void loadThreads();
      return;
    }
    if (!('threadId' in e)) return;
    if (state.thread && e.threadId === state.thread.id) {
      set({ thread: applyEvent(state.thread, e) });
      // The stored turn is the authority once it ends (cost, trimmed items).
      if (e.type === 'turn_end') void fetchThread(e.threadId, true);
    }
    if (e.type === 'turn_start' || e.type === 'turn_end' || e.type === 'thread_updated') void loadThreads();
  });
  const onFocus = () => {
    if (document.visibilityState !== 'visible') return;
    if (state.threadId) void fetchThread(state.threadId, true);
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('popstate', () => {
    if (state.sheet && !onSheetEntry()) set({ sheet: false });
  });
  if (state.threadId) void fetchThread(state.threadId);
  void loadThreads();
}
