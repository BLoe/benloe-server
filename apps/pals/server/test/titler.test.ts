import { describe, expect, it, vi } from 'vitest';
import { buildTitlePrompt, generateTitle, sanitizeTitle } from '../src/runtime/titler.js';
import type { QueryFn } from '../src/runtime/agent.js';

describe('sanitizeTitle', () => {
  it('returns null for empty / missing input', () => {
    expect(sanitizeTitle(undefined)).toBeNull();
    expect(sanitizeTitle('')).toBeNull();
    expect(sanitizeTitle('   \n  ')).toBeNull();
  });

  it('keeps a clean short title as-is', () => {
    expect(sanitizeTitle('Deploy the weight tracker')).toBe('Deploy the weight tracker');
  });

  it('takes only the first non-empty line', () => {
    expect(sanitizeTitle('\nBudget planning\nHere is why I chose that.')).toBe('Budget planning');
  });

  it('strips surrounding quotes and backticks (straight and smart)', () => {
    expect(sanitizeTitle('"Fantasy draft strategy"')).toBe('Fantasy draft strategy');
    expect(sanitizeTitle('“Fantasy draft strategy”')).toBe('Fantasy draft strategy');
    expect(sanitizeTitle('`git rebase help`')).toBe('git rebase help');
  });

  it('drops a leading "Title:" / list-marker prefix', () => {
    expect(sanitizeTitle('Title: Caddy config review')).toBe('Caddy config review');
    expect(sanitizeTitle('- Caddy config review')).toBe('Caddy config review');
    expect(sanitizeTitle('1. Caddy config review')).toBe('Caddy config review');
  });

  it('trims trailing punctuation and collapses whitespace', () => {
    expect(sanitizeTitle('Morning   briefing.')).toBe('Morning briefing');
  });

  it('caps overly long titles at a word boundary with an ellipsis', () => {
    const long = 'Reviewing the entire deployment pipeline and hardening the reverse proxy configuration thoroughly';
    const out = sanitizeTitle(long)!;
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('  ');
  });
});

describe('buildTitlePrompt', () => {
  it('includes both sides of the exchange when present', () => {
    const p = buildTitlePrompt('help me deploy', 'Sure, here is how');
    expect(p).toContain('User: help me deploy');
    expect(p).toContain('Assistant: Sure, here is how');
    expect(p.trimEnd().endsWith('Title:')).toBe(true);
  });

  it('omits the assistant line when there is no reply text', () => {
    const p = buildTitlePrompt('help me deploy', '');
    expect(p).toContain('User: help me deploy');
    expect(p).not.toContain('Assistant:');
  });
});

/** Build a fake SDK query that emits a scripted set of messages. */
function fakeQuery(messages: Record<string, unknown>[]): QueryFn {
  return ((_opts: unknown) =>
    (async function* () {
      for (const m of messages) yield m;
    })()) as unknown as QueryFn;
}

describe('generateTitle', () => {
  it('extracts and sanitises the title from assistant text blocks', async () => {
    const q = fakeQuery([
      { type: 'assistant', message: { content: [{ type: 'text', text: '"Deploy the weight tracker"' }] } },
      { type: 'result', subtype: 'success', result: 'ignored' },
    ]);
    expect(await generateTitle(q, { userText: 'deploy it', assistantText: 'ok' })).toBe('Deploy the weight tracker');
  });

  it('falls back to the result string when no assistant text block is present', async () => {
    const q = fakeQuery([{ type: 'result', subtype: 'success', result: 'Caddy config review' }]);
    expect(await generateTitle(q, { userText: 'x', assistantText: 'y' })).toBe('Caddy config review');
  });

  it('returns null when the model produced nothing usable', async () => {
    const q = fakeQuery([{ type: 'result', subtype: 'success', result: '   ' }]);
    expect(await generateTitle(q, { userText: 'x', assistantText: 'y' })).toBeNull();
  });

  it('never throws — a failing query collapses to null', async () => {
    const boom = (() => {
      throw new Error('subprocess died');
    }) as unknown as QueryFn;
    expect(await generateTitle(boom, { userText: 'x', assistantText: 'y' })).toBeNull();
  });
});
