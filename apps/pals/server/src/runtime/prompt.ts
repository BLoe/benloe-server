import type { MemoryStore } from '../memory/index.js';
import type { LessonRow } from '../episodic/index.js';

export const VOLATILE_MARKER = '\n\n---\n<!-- volatile: nothing above this line may vary per turn -->\n';

export interface PromptInput {
  kind: 'user' | 'heartbeat' | 'cron';
  /** domains/*.md files relevant to the active topic (layer 4). */
  domainFiles?: string[];
  /** Recalled lessons for this turn (layer 5, volatile). */
  lessons?: Pick<LessonRow, 'text' | 'domain'>[];
  /** Deterministic snapshot from query_db (layer 6, volatile). */
  snapshot?: string;
  now?: Date;
}

/**
 * Layered system prompt (§9.3): stable → volatile so the cached prefix
 * survives across turns. Layers 1–4 must be byte-identical between turns
 * unless a memory file actually changed; everything time-varying lives
 * strictly below VOLATILE_MARKER. Heartbeats get a minimal prompt.
 */
export function assemblePrompt(mem: MemoryStore, input: PromptInput): string {
  const now = input.now ?? new Date();
  const volatile: string[] = [
    `Current datetime: ${now.toISOString()} (America/New_York for all user-facing times).`,
    `Session kind: ${input.kind}.`,
  ];
  if (input.lessons?.length) {
    volatile.push('Recalled lessons (situational, apply with judgment):');
    for (const l of input.lessons) volatile.push(`- [${l.domain ?? 'general'}] ${l.text}`);
  }
  if (input.snapshot) volatile.push(`Today snapshot:\n${input.snapshot}`);

  if (input.kind === 'heartbeat') {
    // Minimal stable prefix: identity + checklist only (§9.3).
    const stable = [
      `<memory file="IDENTITY.md">\n${mem.read('IDENTITY.md')}\n</memory>`,
      `<memory file="HEARTBEAT.md">\n${mem.read('HEARTBEAT.md')}\n</memory>`,
    ].join('\n\n');
    return stable + VOLATILE_MARKER + volatile.join('\n');
  }

  const stableParts = [mem.promptCore()];
  for (const f of input.domainFiles ?? []) {
    try {
      stableParts.push(`<memory file="${f}">\n${mem.read(f)}\n</memory>`);
    } catch {
      /* missing domain file is fine */
    }
  }
  return stableParts.join('\n\n') + VOLATILE_MARKER + volatile.join('\n');
}

/** The cacheable prefix: everything up to and including the marker. */
export function stablePrefix(prompt: string): string {
  const i = prompt.indexOf(VOLATILE_MARKER);
  return i === -1 ? prompt : prompt.slice(0, i + VOLATILE_MARKER.length);
}
