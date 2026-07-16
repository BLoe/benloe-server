import { describe, expect, it } from 'vitest';
import {
  truncateForModel,
  UNTOUCHED_CHAR_BUDGET,
  HEAD_CHARS,
  TAIL_CHARS,
} from '../src/runtime/toolTruncate.js';

describe('truncateForModel (Step 3, 2026-07-16: deterministic HEAD+TAIL tool-result truncation)', () => {
  it('passes text at or under the untouched budget through byte-for-byte', () => {
    const text = 'x'.repeat(UNTOUCHED_CHAR_BUDGET);
    const result = truncateForModel(text);
    expect(result.wasTruncated).toBe(false);
    expect(result.text).toBe(text);
    expect(result.originalChars).toBe(UNTOUCHED_CHAR_BUDGET);
  });

  it('truncates text over the budget to head + marker + tail', () => {
    const head = 'HEAD'.repeat(HEAD_CHARS / 4);
    const middle = 'MIDDLE_SHOULD_BE_ELIDED'.repeat(1000);
    const tail = 'TAIL'.repeat(TAIL_CHARS / 4);
    const text = head + middle + tail;
    const result = truncateForModel(text, 'Bash output');

    expect(result.wasTruncated).toBe(true);
    expect(result.originalChars).toBe(text.length);
    // Preserves the real head and real tail verbatim.
    expect(result.text.startsWith(head)).toBe(true);
    expect(result.text.endsWith(tail)).toBe(true);
    // The elided middle must not appear in the output at all.
    expect(result.text).not.toContain('MIDDLE_SHOULD_BE_ELIDED');
    // The marker must be model-recoverable: state what happened, the
    // original size, and how to get the rest — not just "truncated".
    expect(result.text).toContain('CABINET TRUNCATED THIS Bash output');
    expect(result.text).toContain(`${text.length.toLocaleString()} chars`);
    expect(result.text.toLowerCase()).toMatch(/grep|head|tail|line range/);
  });

  it('never grows the output beyond head + marker + tail regardless of input size', () => {
    const huge = 'A'.repeat(1_000_000);
    const result = truncateForModel(huge);
    // Generous upper bound: head + tail + a marker that's at most a few
    // hundred chars of fixed text plus a handful of formatted numbers.
    expect(result.text.length).toBeLessThan(HEAD_CHARS + TAIL_CHARS + 600);
  });
});
