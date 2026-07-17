import { afterEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '../src/lib/draft.js';

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
});
