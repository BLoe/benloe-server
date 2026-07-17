import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, hasDraft, loadDraft, saveDraft } from '../src/lib/draft.js';

afterEach(() => localStorage.clear());

describe('draft', () => {
  it('round-trips a saved draft, keyed separately per chat id', () => {
    expect(loadDraft('c1')).toBeNull();
    saveDraft('c1', '<p>hello</p>');
    expect(loadDraft('c1')).toBe('<p>hello</p>');
    expect(loadDraft('c2')).toBeNull(); // a different chat never sees c1's draft
  });

  it('saving blank/whitespace-only content clears any existing draft', () => {
    saveDraft('c1', '<p>hello</p>');
    saveDraft('c1', '   ');
    expect(loadDraft('c1')).toBeNull();
  });

  it('clearDraft removes a saved draft outright', () => {
    saveDraft('c1', 'hi');
    clearDraft('c1');
    expect(loadDraft('c1')).toBeNull();
  });

  it('hasDraft reflects presence/absence (2026-07-17, backs the rail pencil badge)', () => {
    expect(hasDraft('c1')).toBe(false);
    saveDraft('c1', 'hi');
    expect(hasDraft('c1')).toBe(true);
    clearDraft('c1');
    expect(hasDraft('c1')).toBe(false);
  });

  it('fires a cabinet:draft window event on save and clear, so other mounted trees can react (2026-07-17)', () => {
    const onEvent = vi.fn();
    window.addEventListener('cabinet:draft', onEvent);
    saveDraft('c1', 'hi');
    clearDraft('c1');
    window.removeEventListener('cabinet:draft', onEvent);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});
