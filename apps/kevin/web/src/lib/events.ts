// One EventSource for the whole app. Chat, page refresh and the notification
// bell all listen here.
import { api } from './api';
import type { AppEvent, BusEvent } from './types';

type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let dropped = false;
let retry: ReturnType<typeof setTimeout> | null = null;

function emit(e: AppEvent): void {
  for (const fn of [...listeners]) fn(e);
}

function connect(): void {
  if (source || typeof EventSource === 'undefined') return;
  const es = new EventSource('/api/events');
  source = es;
  es.onopen = () => {
    // Anything published while the stream was down is gone: tell listeners to refetch.
    if (dropped) emit({ type: 'reconnected' });
    dropped = false;
  };
  es.onmessage = (m) => {
    try {
      emit(JSON.parse(m.data as string) as BusEvent);
    } catch {
      // a malformed frame is not worth breaking the stream over
    }
  };
  es.onerror = () => {
    dropped = true;
    // The browser retries a dropped connection itself. It gives up for good
    // on an HTTP error (a 401 once the session expires), so take over then.
    if (es.readyState !== EventSource.CLOSED) return;
    es.close();
    source = null;
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => {
      // A signed-out session reloads the page from inside the api client.
      api.get('/me').then(connect, connect);
    }, 3000);
  };
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  connect();
  return () => {
    listeners.delete(fn);
  };
}

/** For tests and for local, optimistic notifications of change. */
export const publishLocal = emit;
