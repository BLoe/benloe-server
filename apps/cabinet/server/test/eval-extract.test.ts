import { describe, expect, it } from 'vitest';

import { hasLabels, pairTurns, partsToText, stratify } from '../eval/extract.mjs';

/**
 * Every fixture here is INVENTED. The real corpus is Ben's health, money and
 * mood; this repo is public. Comments, tests and fixtures are published
 * documents (docs/CLAUDE.md, "Personal data can leak through CODE") — the
 * 2026-08-02 near-miss was real lab values used as illustrative examples.
 */
const BEN = 'below413@gmail.com';
const msg = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  chat_id: 'c1',
  role: 'user',
  author: BEN,
  parts: JSON.stringify([{ type: 'text', text: 'hello' }]),
  created_at: '2026-08-01T00:00:00Z',
  register: 'desk',
  title: 'A chat',
  ...over,
});

describe('partsToText', () => {
  it('concatenates text blocks and ignores everything else', () => {
    const parts = JSON.stringify([
      { type: 'text', text: 'first' },
      { type: 'image', url: 'x' },
      { type: 'text', text: 'second' },
    ]);
    expect(partsToText(parts)).toBe('first\nsecond');
  });

  it('returns empty string for malformed or non-array parts rather than throwing', () => {
    // A single corrupt row must not abort a 40-turn extraction.
    expect(partsToText('not json')).toBe('');
    expect(partsToText('{"type":"text"}')).toBe('');
    expect(partsToText(JSON.stringify([{ type: 'text' }]))).toBe('');
  });
});

describe('pairTurns', () => {
  it("keeps only Ben's turns, not heartbeat or peer-agent turns", () => {
    // The corpus is ~70% machine turns; including them would make every
    // conclusion drawn from the sample wrong.
    const rows = [
      msg({ id: 'ben', author: BEN }),
      msg({ id: 'heartbeat', author: null }),
      msg({ id: 'peer', author: 'benji@agents.benloe.com' }),
    ];
    expect(pairTurns(rows).map((p) => p.prompt.id)).toEqual(['ben']);
  });

  it('pairs a turn with the next assistant message in the same chat', () => {
    const rows = [
      msg({ id: 'q' }),
      msg({ id: 'other-chat', chat_id: 'c2', role: 'assistant', author: null }),
      msg({ id: 'a', role: 'assistant', author: null }),
    ];
    const [pair] = pairTurns(rows);
    expect(pair.reply?.id).toBe('a');
  });

  it('keeps a turn that was never answered, with a null reply', () => {
    // An abandoned or crashed turn is itself a finding — dropping it would
    // hide exactly the failures worth studying.
    const rows = [msg({ id: 'q1' }), msg({ id: 'q2' })];
    const pairs = pairTurns(rows);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].reply).toBeNull();
  });

  it('does not attach a reply that came after Ben spoke again', () => {
    const rows = [msg({ id: 'q1' }), msg({ id: 'q2' }), msg({ id: 'a', role: 'assistant', author: null })];
    const pairs = pairTurns(rows);
    expect(pairs[0].reply).toBeNull();
    expect(pairs[1].reply?.id).toBe('a');
  });
});

describe('stratify', () => {
  const pairsFor = (chat: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ prompt: msg({ id: `${chat}-${i}`, chat_id: chat }), reply: null }));

  it('spreads across chats instead of draining the longest one', () => {
    // A naive slice would describe one week of one conversation.
    const pairs = [...pairsFor('long', 20), ...pairsFor('short', 2)];
    const sample = stratify(pairs, 6);
    const chats = sample.map((p) => p.prompt.chat_id);
    expect(chats.filter((c) => c === 'short')).toHaveLength(2);
    expect(chats.filter((c) => c === 'long')).toHaveLength(4);
  });

  it('is deterministic, so a finding can be traced back to its turn', () => {
    const pairs = [...pairsFor('a', 5), ...pairsFor('b', 5)];
    expect(stratify(pairs, 7).map((p) => p.prompt.id)).toEqual(stratify(pairs, 7).map((p) => p.prompt.id));
  });

  it('returns everything when the corpus is smaller than the limit', () => {
    expect(stratify(pairsFor('a', 3), 40)).toHaveLength(3);
  });

  it('terminates when every chat is exhausted', () => {
    expect(stratify(pairsFor('a', 2), 1000)).toHaveLength(2);
  });
});

describe('the architecture cutoff', () => {
  it('excludes turns from before the current prompt architecture', () => {
    // Findings from a superseded architecture describe a system that no
    // longer exists. The first labelling pass learned this the hard way: 22
    // of 40 sampled turns predated the v2 stack, and its headline finding
    // described behaviour already fixed.
    const rows = [
      msg({ id: 'old', created_at: '2026-07-15T00:00:00Z' }),
      msg({ id: 'new', created_at: '2026-08-05T00:00:00Z' }),
    ];
    expect(pairTurns(rows, '2026-08-01').map((p) => p.prompt.id)).toEqual(['new']);
  });

  it('includes everything when the cutoff is explicitly cleared', () => {
    const rows = [msg({ id: 'old', created_at: '2026-07-15T00:00:00Z' })];
    expect(pairTurns(rows, '').map((p) => p.prompt.id)).toEqual(['old']);
  });

  it('does not let an excluded turn steal the reply belonging to a later one', () => {
    const rows = [
      msg({ id: 'old', created_at: '2026-07-15T00:00:00Z' }),
      msg({ id: 'new', created_at: '2026-08-05T00:00:00Z' }),
      msg({ id: 'reply', role: 'assistant', author: null, created_at: '2026-08-05T00:01:00Z' }),
    ];
    const pairs = pairTurns(rows, '2026-08-01');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reply?.id).toBe('reply');
  });
});

describe('reply pairing against non-Ben user rows', () => {
  it('does not treat a peer-agent turn as Ben speaking again', () => {
    // benji and the heartbeat both write role='user'. Treating those as "Ben
    // spoke again" recorded an answered turn as unanswered, inventing crashed
    // turns that never happened.
    const rows = [
      msg({ id: 'q' }),
      msg({ id: 'peer', author: 'benji@agents.benloe.com' }),
      msg({ id: 'a', role: 'assistant', author: null }),
    ];
    const [pair] = pairTurns(rows, '');
    expect(pair.reply?.id).toBe('a');
  });

  it('still stops at Ben speaking again', () => {
    const rows = [msg({ id: 'q1' }), msg({ id: 'q2' }), msg({ id: 'a', role: 'assistant', author: null })];
    const pairs = pairTurns(rows, '');
    expect(pairs[0].reply).toBeNull();
    expect(pairs[1].reply?.id).toBe('a');
  });
});

describe('hasLabels', () => {
  it('detects labels and notes so a labelled file is never overwritten', () => {
    const read = (content: string) => () => content;
    expect(hasLabels('x', read('') as never)).toBe(false);
    expect(hasLabels('x', read(JSON.stringify({ labels: [], note: '' })) as never)).toBe(false);
    expect(hasLabels('x', read(JSON.stringify({ labels: ['overclaim'], note: '' })) as never)).toBe(true);
    expect(hasLabels('x', read(JSON.stringify({ labels: [], note: 'a note' })) as never)).toBe(true);
  });

  it('treats an unreadable or malformed file as unlabelled rather than throwing', () => {
    expect(
      hasLabels('x', (() => {
        throw new Error('ENOENT');
      }) as never),
    ).toBe(false);
    expect(hasLabels('x', (() => 'not json') as never)).toBe(false);
  });
});
