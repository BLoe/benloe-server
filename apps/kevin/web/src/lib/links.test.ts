import { describe, expect, it } from 'vitest';
import { isAppPath, remarkAppLinks, splitPaths } from './links';

const paths = (text: string) => splitPaths(text).flatMap((p) => (typeof p === 'string' ? [] : [p.path]));

describe('splitPaths', () => {
  it('finds the app\'s own routes in prose', () => {
    expect(splitPaths('I set it up at /s/car-maintenance and added two records.')).toEqual(['I set it up at ', { path: '/s/car-maintenance' }, ' and added two records.']);
    expect(paths('See /pantry, /jobs or /settings?tab=memory. Also (/money) and /chat/0b7e6f1c-9d1e-4c57-8a56-1d2f3a4b5c6d')).toEqual(['/pantry', '/jobs', '/settings?tab=memory', '/money', '/chat/0b7e6f1c-9d1e-4c57-8a56-1d2f3a4b5c6d']);
    expect(paths('/spaces')).toEqual(['/spaces']);
    expect(paths('It is on /taxes.')).toEqual(['/taxes']);
  });

  it('returns text without paths unchanged', () => {
    expect(splitPaths('Nothing to link here.')).toEqual(['Nothing to link here.']);
    expect(splitPaths('')).toEqual(['']);
  });

  it('leaves URLs, file paths and unknown routes alone', () => {
    for (const text of [
      'https://example.com/pantry',
      'example.com/s/car',
      'look in /var/lib/kevin/documents',
      'open ~/documents',
      'the file notes/jobs',
      '/pantry/items.csv',
      '/money.txt',
      '/pantryful',
      '/admin and /etc/passwd',
      'and/or /S/Upper',
      '50/s/60',
      '/chat/abc',
    ]) {
      expect(paths(text), text).toEqual([]);
    }
  });

  it('recognises a whole string that is a path', () => {
    expect(isAppPath('/s/portugal-trip')).toBe(true);
    expect(isAppPath('/workouts')).toBe(true);
    expect(isAppPath('/s/portugal-trip now')).toBe(false);
    expect(isAppPath('/etc')).toBe(false);
  });
});

describe('remarkAppLinks', () => {
  const text = (value: string) => ({ type: 'text', value });
  const run = (children: unknown[]) => {
    const tree = { type: 'root', children: [{ type: 'paragraph', children }] };
    remarkAppLinks()(tree);
    return (tree.children[0] as { children: { type: string; url?: string; value?: string }[] }).children;
  };

  it('links paths in text and in inline code', () => {
    expect(run([text('Go to /pantry now')]).map((n) => n.url ?? n.value)).toEqual(['Go to ', '/pantry', ' now']);
    const [code] = run([{ type: 'inlineCode', value: '/s/reading-list' }]);
    expect(code).toMatchObject({ type: 'link', url: '/s/reading-list' });
  });

  it('does not touch existing links, code blocks or other inline code', () => {
    const link = { type: 'link', url: 'https://x.test', children: [text('/pantry')] };
    expect(run([link])).toEqual([link]);
    expect(run([{ type: 'inlineCode', value: 'cd /jobs' }])[0]).toMatchObject({ type: 'inlineCode' });
    const tree = { type: 'root', children: [{ type: 'code', value: '/pantry' }] };
    remarkAppLinks()(tree);
    expect(tree.children[0]).toEqual({ type: 'code', value: '/pantry' });
  });

  it('reaches text nested in emphasis and lists', () => {
    const out = run([{ type: 'strong', children: [text('see /jobs')] }]) as unknown as { children: { url?: string }[] }[];
    expect(out[0]!.children[1]).toMatchObject({ url: '/jobs' });
  });
});
