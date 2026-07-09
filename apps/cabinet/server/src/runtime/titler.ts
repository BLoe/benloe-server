/**
 * Conversation auto-titling (§9.2 nano route). A thread starts "untitled";
 * after its first exchange we spend one cheap Haiku call to name it. The call
 * is deliberately tool-less and single-turn — it reads the opening exchange and
 * returns a short label, nothing more.
 *
 * Hand-rolled per Ben's dependency philosophy: the SDK gives us the model call,
 * everything around it (prompt shaping, extraction, sanitising) is ours with
 * tests.
 */
import type { QueryFn } from './agent.js';
import { MODELS } from './router.js';

const MAX_LEN = 60;
const TITLE_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = [
  'You name conversations for a sidebar. Given the opening exchange, reply with a',
  'short, specific title of 2 to 6 words that captures the topic.',
  'Rules: Title Case-ish is fine, but no surrounding quotes, no trailing',
  'punctuation, no "Title:" prefix, no emoji, and never more than 8 words.',
  'Reply with the title only — nothing else.',
].join(' ');

/**
 * Reduce a model's raw reply to a clean sidebar label, or null if there is
 * nothing usable. Pure and total — the whole quality bar lives here, so it is
 * where the tests concentrate.
 */
export function sanitizeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // First non-empty line only — models sometimes add a chatty second line.
  let s = raw.replace(/\r/g, '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  // Drop a leading "Title:" / "Name:" style prefix.
  s = s.replace(/^(?:title|name|conversation)\s*[:\-–]\s*/i, '');
  // Drop leading list markers ("- ", "1. ", "* ").
  s = s.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
  // Strip one layer of surrounding quotes/backticks (straight or smart).
  s = s.replace(/^["'`“”‘’]+/, '').replace(/["'`“”‘’]+$/, '');
  // Collapse internal whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  // Trim trailing sentence punctuation.
  s = s.replace(/[.:;,\s]+$/, '').trim();
  if (!s) return null;
  // Cap length at a word boundary so the sidebar never overflows.
  if (s.length > MAX_LEN) {
    const cut = s.slice(0, MAX_LEN);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim().replace(/[.:;,\s]+$/, '') + '…';
  }
  return s || null;
}

/** Fold the opening exchange into the compact prompt the titler sees. */
export function buildTitlePrompt(userText: string, assistantText: string): string {
  const user = userText.trim().slice(0, 1500);
  const assistant = assistantText.trim().slice(0, 1500);
  return assistant
    ? `User: ${user}\n\nAssistant: ${assistant}\n\nTitle:`
    : `User: ${user}\n\nTitle:`;
}

/**
 * One-shot, tool-less Haiku call that names a conversation. Returns null on any
 * failure, timeout, or empty result — titling must never break the chat turn
 * that triggered it, so every error path collapses to "leave it untitled".
 */
export async function generateTitle(
  queryFn: QueryFn,
  input: { userText: string; assistantText: string },
): Promise<string | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TITLE_TIMEOUT_MS);
  try {
    const q = queryFn({
      prompt: buildTitlePrompt(input.userText, input.assistantText),
      options: {
        model: MODELS.nano,
        effort: 'low',
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 1,
        settingSources: [],
        allowedTools: [],
        // No mcpServers, no resume — a clean, stateless completion. Deny any
        // tool the model might still reach for.
        canUseTool: async () => ({ behavior: 'deny' as const, message: 'titling is text-only' }),
        abortController: abort,
      },
    } as Parameters<QueryFn>[0]);

    let text = '';
    let resultText = '';
    for await (const msg of q as AsyncIterable<Record<string, any>>) {
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text') text += block.text;
        }
      } else if (msg.type === 'result') {
        if (typeof msg.result === 'string') resultText = msg.result;
      }
    }
    return sanitizeTitle(text || resultText);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
