import { describe, expect, it } from 'vitest';
import { byLabel, logLine, previewText, profileInput, roughWords, wordCount } from './profile';

describe('profile helpers', () => {
  it('names who wrote something', () => {
    expect(byLabel('ben')).toBe('you');
    expect(byLabel('kevin')).toBe('Kevin');
    expect(byLabel('import')).toBe('an import');
    expect(byLabel('other')).toBe('other');
  });

  it('previews markdown as plain words', () => {
    expect(previewText('## Family\n\n- **Sam**, partner since 2015\n- [Mom](https://x.test) lives in *Ohio*\n\n> a quote\n\n1. first')).toBe('Family Sam, partner since 2015 Mom lives in Ohio a quote first');
    expect(previewText('| A | B |\n|---|---|\n| 1 | 2 |')).toBe('A B 1 2');
    expect(previewText('text\n```\ncode block\n```\nmore `inline`')).toBe('text more inline');
    expect(previewText('')).toBe('');
  });

  it('cuts a long preview at a word and marks it', () => {
    const out = previewText('word '.repeat(100), 30);
    expect(out).toBe('word word word word word word…');
  });

  it('counts words and rounds the total', () => {
    expect(wordCount('  one two\nthree ')).toBe(3);
    expect(wordCount('   ')).toBe(0);
    expect(roughWords([{ body: 'just four words here' }])).toBe('4 words');
    expect(roughWords([{ body: 'one' }])).toBe('1 word');
    expect(roughWords([{ body: 'w '.repeat(430) }])).toBe('about 450 words');
    expect(roughWords([{ body: 'w '.repeat(3000) }, { body: 'w '.repeat(2240) }])).toBe('about 5,200 words');
  });

  it('sends only what changed, addressing an existing section by key', () => {
    const s = { key: 'family', title: 'Family', body: 'Sam is my partner.' };
    expect(profileInput(null, ' Work ', ' I build things. ')).toEqual({ section: 'Work', body: 'I build things.' });
    expect(profileInput(s, 'Family', 'Sam is my partner.\n')).toBeNull();
    expect(profileInput(s, 'Family', 'Sam is my partner. We have a dog.')).toEqual({ section: 'family', body: 'Sam is my partner. We have a dog.' });
    expect(profileInput(s, 'Family and friends', 'Sam is my partner.')).toEqual({ section: 'family', title: 'Family and friends' });
    expect(profileInput(s, 'People', 'New text')).toEqual({ section: 'family', body: 'New text', title: 'People' });
  });

  it('keeps profile text out of the log list', () => {
    expect(logLine('profile_update {"section":"Family","body":"Sam is my partner and we')).toBe('About you: updated “Family”');
    expect(logLine('profile_update {"section":"Health history","append":"Knee surgery in 2019"}')).toBe('About you: added to “Health history”');
    expect(logLine('profile_update {"section":"work","delete":true}')).toBe('About you: deleted “work”');
    expect(logLine('profile_update {"sec')).toBe('About you: updated');
    expect(logLine('remember {"text":"likes tea"}')).toBe('remember {"text":"likes tea"}');
  });
});
