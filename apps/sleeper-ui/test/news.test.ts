import { describe, it, expect } from 'vitest';
import {
  mapOutlook,
  mapSleeperNews,
  mergeNews,
  normaliseName,
  prettySource,
  type NewsItem,
} from '../src/lib/news.js';

const item = (over: Partial<NewsItem> = {}): NewsItem => ({
  source: 'RotoWire',
  provider: 'sleeper',
  title: 'Player expected to start Sunday',
  body: 'A write-up.',
  url: 'https://example.com/1',
  published: 1_700_000_000_000,
  kind: 'news',
  ...over,
});

describe('normaliseName', () => {
  it('ignores punctuation, so "A.J. Brown" matches "AJ Brown"', () => {
    expect(normaliseName('A.J. Brown')).toBe(normaliseName('AJ Brown'));
  });

  it('ignores generational suffixes', () => {
    expect(normaliseName('Odell Beckham Jr.')).toBe('odell beckham');
    expect(normaliseName('Marvin Harrison Jr')).toBe(normaliseName('Marvin Harrison'));
    expect(normaliseName('Robert Griffin III')).toBe('robert griffin');
  });

  it('collapses whitespace and case', () => {
    expect(normaliseName('  JUSTIN   jefferson ')).toBe('justin jefferson');
  });

  it('survives an empty string', () => {
    expect(normaliseName('')).toBe('');
  });
});

describe('prettySource', () => {
  it('spells known outlets the way they spell themselves', () => {
    expect(prettySource('rotowire')).toBe('RotoWire');
    expect(prettySource('fantasy_pros')).toBe('FantasyPros');
    expect(prettySource('nfl')).toBe('NFL.com');
  });

  it('falls back to a readable version of an unknown key', () => {
    expect(prettySource('some_wire_service')).toBe('some wire service');
  });

  it('treats a missing source as Sleeper, which is where it came from', () => {
    expect(prettySource(null)).toBe('Sleeper');
    expect(prettySource(undefined)).toBe('Sleeper');
  });
});

describe('mapSleeperNews', () => {
  it('pulls title and body out of the metadata blob', () => {
    const [n] = mapSleeperNews([
      {
        source: 'rotowire',
        published: 123,
        metadata: { title: 'Cleared to practice', description: 'Full participant.', url: 'u' },
      },
    ]);
    expect(n).toMatchObject({
      source: 'RotoWire',
      title: 'Cleared to practice',
      body: 'Full participant.',
      url: 'u',
      kind: 'news',
    });
  });

  it('drops items with neither a headline nor a body', () => {
    expect(mapSleeperNews([{ source: 'rotowire', metadata: {} }])).toHaveLength(0);
  });

  it('handles a null feed', () => {
    expect(mapSleeperNews(null as any)).toEqual([]);
  });
});

describe('mapOutlook', () => {
  it('turns the prose blob into a dated outlook card', () => {
    const o = mapOutlook({ source: 'rotowire', published: 5, metadata: { description: 'Prose.' } }, '2026');
    expect(o).toMatchObject({ kind: 'outlook', title: '2026 season outlook', body: 'Prose.' });
  });

  it('returns nothing when there is no prose', () => {
    expect(mapOutlook({ metadata: {} }, '2026')).toBeNull();
    expect(mapOutlook(null, '2026')).toBeNull();
  });
});

describe('mergeNews', () => {
  it('sorts news newest first', () => {
    const merged = mergeNews([
      item({ title: 'Older story about the depth chart', published: 100 }),
      item({ title: 'Newer story about a hamstring', published: 900 }),
    ]);
    expect(merged.map((m) => m.published)).toEqual([900, 100]);
  });

  it('collapses the same story syndicated by several outlets', () => {
    const merged = mergeNews([
      item({ source: 'RotoWire', body: null }),
      item({ source: 'ESPN', published: 1_700_000_100_000 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('RotoWire · ESPN');
  });

  it('keeps the copy that actually has a write-up', () => {
    const merged = mergeNews([
      item({ source: 'ESPN', body: null, url: null }),
      item({ source: 'RotoWire', body: 'The details.', url: 'https://example.com/2' }),
    ]);
    expect(merged[0].body).toBe('The details.');
    expect(merged[0].url).toBe('https://example.com/2');
  });

  it('takes the most recent timestamp when folding duplicates', () => {
    const merged = mergeNews([item({ published: 100 }), item({ source: 'ESPN', published: 900 })]);
    expect(merged[0].published).toBe(900);
  });

  it('does not fold two genuinely different stories together', () => {
    const merged = mergeNews([
      item({ title: 'Ruled out with a hamstring strain' }),
      item({ title: 'Signs a four-year extension with Buffalo' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('puts outlooks below the news timeline regardless of date', () => {
    const merged = mergeNews([
      item({ kind: 'outlook', title: '2026 season outlook', published: 9_000_000_000_000 }),
      item({ title: 'Practised in full on Wednesday', published: 1 }),
    ]);
    expect(merged.map((m) => m.kind)).toEqual(['news', 'outlook']);
  });

  it('honours the limit', () => {
    // Distinct words, not numbers — the dedupe key strips digits on purpose, so
    // "story 1" and "story 2" are deliberately the same story to it.
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ');
    const many = words.flatMap((a) =>
      words.slice(0, 2).map((b) => item({ title: `${a} ${b} report from camp`, published: 1 }))
    );
    expect(many.length).toBeGreaterThan(20);
    expect(mergeNews(many, 20)).toHaveLength(20);
  });

  it('returns nothing for nothing', () => {
    expect(mergeNews([])).toEqual([]);
  });

  it('treats undated items as oldest rather than dropping them', () => {
    const merged = mergeNews([
      item({ title: 'Undated note about the backfield', published: null }),
      item({ title: 'Dated note about the passing game', published: 500 }),
    ]);
    expect(merged[0].published).toBe(500);
    expect(merged).toHaveLength(2);
  });
});
