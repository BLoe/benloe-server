import { describe, expect, it } from 'vitest';
import {
  agentName,
  buildRenderRuns,
  dayLabel,
  fullStamp,
  htmlToMarkdown,
  parseServerDate,
  relativeTime,
  summarizeToolCall,
} from '../src/surfaces/Chat.js';
import type { ChatMessage } from '../src/lib/contracts.js';

// Pure-logic coverage for the chat-UX pass (§ changes 2 + 3). These helpers
// are plain functions with no rendering dependency, so they get regression
// coverage independent of the heavier @testing-library/react harness (see
// chat.test.tsx for the component-level tests — the harness itself is fine
// as of the NODE_ENV=development vitest pin, 2026-07-16).

describe('parseServerDate', () => {
  it('reads a SQLite datetime(\'now\') string (space-separated, no zone) as UTC, not the runner\'s local zone', () => {
    const d = parseServerDate('2026-07-11 17:19:56');
    expect(d.toISOString()).toBe('2026-07-11T17:19:56.000Z');
  });

  it('passes an already-zoned ISO string straight through', () => {
    const d = parseServerDate('2026-07-11T17:19:56.123Z');
    expect(d.toISOString()).toBe('2026-07-11T17:19:56.123Z');
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 6, 11, 12, 0, 0); // Jul 11, 2026, local

  it('labels the same calendar day "Today"', () => {
    expect(dayLabel(new Date(2026, 6, 11, 8, 0, 0), now)).toBe('Today');
  });
  it('labels the previous calendar day "Yesterday"', () => {
    expect(dayLabel(new Date(2026, 6, 10, 23, 59, 0), now)).toBe('Yesterday');
  });
  it('labels anything older as "Mon D"', () => {
    expect(dayLabel(new Date(2026, 6, 9, 8, 0, 0), now)).toBe('Jul 9');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-11T17:20:00.000Z');

  it('"just now" under a minute', () => {
    expect(relativeTime(new Date('2026-07-11T17:19:45.000Z'), now)).toBe('just now');
  });
  it('"Nm ago" under an hour', () => {
    expect(relativeTime(new Date('2026-07-11T17:03:00.000Z'), now)).toBe('17m ago');
  });
  it('falls back to a 12-hour clock time past an hour', () => {
    expect(relativeTime(new Date('2026-07-11T14:05:00.000Z'), now)).toBe('2:05 PM');
    expect(relativeTime(new Date('2026-07-11T00:05:00.000Z'), now)).toBe('12:05 AM');
  });
});

describe('fullStamp', () => {
  it('renders full precision for the hover title', () => {
    expect(fullStamp('2026-07-09 08:05:00')).toBe('Jul 9, 2026 · 08:05');
  });
});

describe('agentName', () => {
  it('extracts and capitalizes an agent principal\'s local name', () => {
    expect(agentName('benji@agents.benloe.com')).toBe('Benji');
  });
  it('is null for the owner or an unrelated address', () => {
    expect(agentName('below413@gmail.com')).toBeNull();
    expect(agentName(null)).toBeNull();
    expect(agentName(undefined)).toBeNull();
  });
});

function msg(id: string, role: ChatMessage['role'], created_at: string, author: string | null = null): ChatMessage {
  return { id, role, author, parts: [{ type: 'text', text: id }], created_at };
}

describe('buildRenderRuns (change 3: metadata grouping)', () => {
  const now = new Date('2026-07-11T18:00:00.000Z');

  it('groups consecutive same-sender messages on the same day into one run', () => {
    const runs = buildRenderRuns(
      [msg('a', 'user', '2026-07-11 17:00:00'), msg('b', 'user', '2026-07-11 17:00:05'), msg('c', 'assistant', '2026-07-11 17:00:10')],
      null,
      now,
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]!.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(runs[1]!.entries.map((e) => e.id)).toEqual(['c']);
  });

  it('breaks the run when the sender changes back and forth (no accidental merge across a middle message)', () => {
    const runs = buildRenderRuns(
      [msg('a', 'user', '2026-07-11 17:00:00'), msg('b', 'assistant', '2026-07-11 17:00:05'), msg('c', 'user', '2026-07-11 17:00:10')],
      null,
      now,
    );
    expect(runs.map((r) => r.entries.map((e) => e.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('breaks a run across a calendar-day boundary even when the same sender keeps talking, and flags exactly one divider', () => {
    const runs = buildRenderRuns(
      [msg('a', 'user', '2026-07-10 23:58:00'), msg('b', 'user', '2026-07-11 00:02:00')],
      null,
      now,
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]!.dividerLabel).toBeTruthy();
    expect(runs[1]!.dividerLabel).toBeTruthy();
    expect(runs[0]!.dividerLabel).not.toBe(runs[1]!.dividerLabel);
  });

  it('the very first run always carries a divider', () => {
    const runs = buildRenderRuns([msg('a', 'user', '2026-07-11 17:00:00')], null, now);
    expect(runs[0]!.dividerLabel).toBe('Today');
  });

  it('groups two different agent authors as distinct senders even though both are role=user', () => {
    const runs = buildRenderRuns(
      [msg('a', 'user', '2026-07-11 17:00:00', 'benji@agents.benloe.com'), msg('b', 'user', '2026-07-11 17:00:05', 'below413@gmail.com')],
      null,
      now,
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]!.who).toBe('Benji');
    expect(runs[0]!.fromAgent).toBe(true);
    expect(runs[1]!.who).toBe('You');
    expect(runs[1]!.fromAgent).toBe(false);
  });

  it('appends the live streaming parts as a trailing entry on the assistant run, flagged isLive', () => {
    const runs = buildRenderRuns(
      [msg('a', 'user', '2026-07-11 17:00:00')],
      [{ type: 'text', text: 'partial…' }],
      now,
    );
    expect(runs).toHaveLength(2);
    const liveRun = runs[1]!;
    expect(liveRun.role).toBe('assistant');
    expect(liveRun.entries[0]!.isLive).toBe(true);
  });
});

describe('summarizeToolCall (change 2: human-facing tool calls)', () => {
  it('formats a bespoke cabinet tool from its mcp__cabinet__-prefixed name', () => {
    expect(summarizeToolCall('mcp__cabinet__upsert_goal', { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' })).toBe(
      'Saved goal: protein — 180g',
    );
  });

  it('formats plan_meal with an ad-hoc description', () => {
    expect(summarizeToolCall('mcp__cabinet__plan_meal', { localDay: '2026-07-12', meal: 'dinner', adHocDescription: 'grilled salmon' })).toBe(
      'Planned dinner on 2026-07-12: grilled salmon',
    );
  });

  it('formats a built-in Bash call', () => {
    expect(summarizeToolCall('Bash', { command: 'pm2 restart cabinet-api' })).toBe('Ran: pm2 restart cabinet-api');
  });

  it('falls back to a generic humanized line for a tool with no bespoke formatter', () => {
    expect(summarizeToolCall('mcp__cabinet__list_grocery_list', {})).toBe('Checked the grocery list'); // has a formatter
    expect(summarizeToolCall('mcp__cabinet__some_future_tool', { x: 1 })).toBe('Ran some future tool'); // no formatter — fallback
  });

  it('never throws on missing/malformed input — falls back to the generic line', () => {
    expect(() => summarizeToolCall('mcp__cabinet__upsert_goal', undefined)).not.toThrow();
    expect(summarizeToolCall('mcp__cabinet__upsert_goal', undefined)).toContain('Saved goal');
  });
});

describe('htmlToMarkdown (the rich composer -> markdown at send time)', () => {
  const fromHtml = (html: string): string => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return htmlToMarkdown(div);
  };

  it('bold via <b> or <strong>', () => {
    expect(fromHtml('hello <b>world</b>')).toBe('hello **world**');
    expect(fromHtml('hello <strong>world</strong>')).toBe('hello **world**');
  });

  it('italic via <i> or <em>', () => {
    expect(fromHtml('<i>hi</i> there')).toBe('_hi_ there');
    expect(fromHtml('<em>hi</em> there')).toBe('_hi_ there');
  });

  it('underline via <u> rides as raw <u> (matches MD_SCHEMA\'s allowlisted tag)', () => {
    expect(fromHtml('<u>under</u>')).toBe('<u>under</u>');
  });

  it('strikethrough via <strike>, <s>, or <del> (execCommand output varies by browser)', () => {
    expect(fromHtml('<strike>gone</strike>')).toBe('~~gone~~');
    expect(fromHtml('<s>gone</s>')).toBe('~~gone~~');
    expect(fromHtml('<del>gone</del>')).toBe('~~gone~~');
  });

  it('nested formatting composes in DOM order', () => {
    expect(fromHtml('<b><i>both</i></b>')).toBe('**_both_**');
  });

  it('a link keeps its href', () => {
    expect(fromHtml('<a href="https://x.com">x</a>')).toBe('[x](https://x.com)');
  });

  it('bulleted and numbered lists', () => {
    expect(fromHtml('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');
    expect(fromHtml('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
  });

  it('a <br> (Shift+Enter) becomes a real newline', () => {
    expect(fromHtml('line1<br>line2')).toBe('line1\nline2');
  });

  it('plain text passes through untouched', () => {
    expect(fromHtml('just plain text')).toBe('just plain text');
  });

  it('an empty composer serializes to an empty string', () => {
    expect(fromHtml('')).toBe('');
  });
});
