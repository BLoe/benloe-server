/**
 * Step 3 (2026-07-16, token-cost work w/ benji): deterministic HEAD+TAIL
 * truncation shared by two call sites — the PostToolUse hook in agent.ts
 * (built-in Bash/Read results) and Cabinet's own MCP tool result wrapper
 * (mcp/cabinet-server.ts's `ok()`). Deliberately NOT a Haiku summary call:
 * this runs synchronously in the tool-result pipeline for every tool call,
 * so it has to be cheap, deterministic, and side-effect-free.
 *
 * Why this exists (see Step 0/1 diagnostics, same investigation): Step 1's
 * native auto-compaction handles the ACROSS-TURN growth problem generically
 * — old tool results get compressed away once the session crosses the
 * compact threshold. This handles the WITHIN-A-TURN gap compaction can't:
 * a big Bash/Read output at step 10 of a 100-step turn gets re-read on every
 * subsequent step before the turn has grown enough to trip compaction at
 * all. Measured contribution is modest (tool results were ~13% of context in
 * the Step 0 breakdown) but it's real and free to fix.
 *
 * Preserves model agency: the elision marker states the original size and
 * exactly how to retrieve the omitted middle (grep/head/tail/a bounded
 * re-read) instead of leaving the model to guess — or silently hallucinate —
 * what was cut.
 *
 * Budget (benji's spec, 2026-07-16): pass anything under ~2,000 tokens
 * through untouched; anything larger gets head ~6KB + tail ~2KB. The
 * chars-per-token ratio (~4) is the same estimate used throughout this
 * investigation (ctx-diag reports tokens; source only sees chars).
 */
export const UNTOUCHED_CHAR_BUDGET = 8_000; // ~2,000 tokens
export const HEAD_CHARS = 6_000; // ~1,500 tokens
export const TAIL_CHARS = 2_000; // ~500 tokens

export interface TruncateResult {
  text: string;
  wasTruncated: boolean;
  originalChars: number;
}

/**
 * `label` names the thing being truncated in the marker text (e.g. "Bash
 * output", "file read", "tool result") — purely cosmetic, no behavior
 * depends on it.
 */
export function truncateForModel(text: string, label = 'output'): TruncateResult {
  const originalChars = text.length;
  if (originalChars <= UNTOUCHED_CHAR_BUDGET) {
    return { text, wasTruncated: false, originalChars };
  }
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  const elidedChars = originalChars - HEAD_CHARS - TAIL_CHARS;
  const marker =
    `\n\n[...CABINET TRUNCATED THIS ${label}: showing the first ${HEAD_CHARS.toLocaleString()} + last ${TAIL_CHARS.toLocaleString()} ` +
    `chars. ${elidedChars.toLocaleString()} chars (~${Math.round(elidedChars / 4).toLocaleString()} tokens) omitted from the middle. ` +
    `Original size: ${originalChars.toLocaleString()} chars (~${Math.round(originalChars / 4).toLocaleString()} tokens). ` +
    `To see the omitted part, re-run NARROWER instead of assuming what's there — grep for a specific string, pipe through ` +
    `head/tail/sed -n 'A,Bp', or re-read with a bounded line range/offset...]\n\n`;
  return { text: `${head}${marker}${tail}`, wasTruncated: true, originalChars };
}
