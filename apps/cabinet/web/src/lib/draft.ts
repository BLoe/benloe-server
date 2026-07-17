/**
 * Per-chat composer drafts (Ben's request, 2026-07-17): type a message,
 * navigate away — even close the tab — and it's still sitting in the box
 * next time that chat is opened. The composer is an uncontrolled
 * contentEditable (see Chat.tsx), so what's persisted is its live innerHTML
 * (not plain text) — round-tripping through the same element that produced
 * it, so restoring it via `el.innerHTML =` carries no injection risk.
 *
 * localStorage, not the server: a draft is scratch space, never sent until
 * Enter — no reason to make it a network round trip or give it a row in the
 * DB. Wrapped in try/catch throughout: private-browsing/quota exceptions
 * must never break typing.
 */
const PREFIX = 'cabinet:draft:';

/** The rail's chat list (a separately-mounted component from the composer
 *  that writes these) badges rows with a pencil icon when they have a saved
 *  draft — it listens for this to know when to re-check, since it has no
 *  other way to hear about a write happening elsewhere in the tree. */
function notify(chatId: string): void {
  try {
    window.dispatchEvent(new CustomEvent('cabinet:draft', { detail: { chatId } }));
  } catch {
    /* no window, or CustomEvent unsupported — the rail just won't live-update */
  }
}

export function loadDraft(chatId: string): string | null {
  try {
    return localStorage.getItem(PREFIX + chatId);
  } catch {
    return null;
  }
}

export function hasDraft(chatId: string): boolean {
  return !!loadDraft(chatId);
}

export function saveDraft(chatId: string, html: string): void {
  try {
    if (html.trim()) localStorage.setItem(PREFIX + chatId, html);
    else localStorage.removeItem(PREFIX + chatId);
  } catch {
    /* quota/private-browsing — the draft just won't survive, not fatal */
  }
  notify(chatId);
}

export function clearDraft(chatId: string): void {
  try {
    localStorage.removeItem(PREFIX + chatId);
  } catch {
    /* nothing to do */
  }
  notify(chatId);
}
