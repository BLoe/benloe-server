// The one HTTP client. Every request goes through here so the CSRF header and
// the signed-out case are handled once.
import type { Upload } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * The session is gone. A full reload makes the server answer the page request
 * with its redirect to the sign-in page. Guarded so a server that keeps
 * answering 401 cannot spin the tab.
 */
function signedOut(): void {
  try {
    const last = Number(sessionStorage.getItem('kevin.reloadedAt') ?? 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem('kevin.reloadedAt', String(Date.now()));
  } catch {
    // private mode: reload anyway
  }
  location.reload();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Kevin': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Can’t reach Kevin. Check your connection.', 0);
  }
  if (res.status === 401) {
    signedOut();
    throw new ApiError('Signed out. Reloading…', 401);
  }
  const UNREADABLE = Symbol('unreadable');
  const data = (await res.json().catch(() => UNREADABLE)) as { error?: string } | null | typeof UNREADABLE;
  if (!res.ok) throw new ApiError((data !== UNREADABLE && data?.error) || `Request failed (${res.status})`, res.status);
  // A success that is not JSON (a page from something in between) is not an answer: never treat it as empty data.
  if (data === UNREADABLE) throw new ApiError('Kevin answered with something unexpected. Try reloading.', res.status);
  return data as T;
}

export function query(params?: Record<string, string | number | boolean | null | undefined>): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    q.set(k, v === true ? '1' : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Uploads one file as the raw request body. XHR rather than fetch because it
 * reports upload progress; the server then reads the file (text extraction)
 * before it answers, which `onProgress(1)` marks the start of.
 */
function upload(file: Blob, filename: string, onProgress?: (fraction: number) => void): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?filename=${encodeURIComponent(filename)}`);
    xhr.setRequestHeader('X-Kevin', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.upload.onload = () => onProgress?.(1);
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', 0));
    xhr.onload = () => {
      if (xhr.status === 401) {
        signedOut();
        return reject(new ApiError('Signed out. Reloading…', 401));
      }
      const data = xhr.response as (Upload & { error?: string }) | null;
      if (xhr.status === 413) return reject(new ApiError('That file is over 25 MB.', 413));
      if (xhr.status >= 400 || !data) return reject(new ApiError(data?.error ?? `Upload failed (${xhr.status})`, xhr.status));
      resolve(data);
    };
    xhr.send(file);
  });
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  upload,
  /** URL of an uploaded file, for <img src> and links. */
  attachmentUrl: (id: number) => `/api/attachments/${id}/raw`,
};
