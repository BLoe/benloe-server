/**
 * Shared fetch for third-party sources.
 *
 * Every upstream here is somebody else's server that owes us nothing. The rule
 * throughout Waker is that a slow or broken source degrades a panel, never the
 * page — so everything gets a hard timeout, and callers are expected to catch.
 */

/**
 * Some of these hosts serve a different page (or nothing) to an obvious bot.
 * A normal browser string is the honest thing here: we are one person's
 * dashboard reading pages a browser would render anyway, at a rate far below a
 * human clicking around.
 */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

async function req(url: string, timeoutMs: number, accept: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept },
      signal: ctl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new SourceError(`${res.status} ${res.statusText}`, res.status, url);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  return (await req(url, timeoutMs, 'application/json')).json() as Promise<T>;
}

export async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  return (await req(url, timeoutMs, 'text/html,application/xhtml+xml')).text();
}

/** Run a fetch and fall back rather than throw. For panels that may be empty. */
export async function settle<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
