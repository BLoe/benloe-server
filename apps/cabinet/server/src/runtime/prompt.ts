import type { MemoryStore } from '../memory/index.js';
import type { LessonRow } from '../episodic/index.js';

/** Who Cabinet is speaking with this turn (identity attribution). */
export interface Interlocutor {
  name: string;
  role: string; // "user" | "admin" | "agent"
  isOwner: boolean;
}

export interface PromptInput {
  kind: 'user' | 'heartbeat' | 'cron';
  /** domains/*.md files relevant to the active topic — per-turn context, NOT the system prompt (topic selection varies per turn, so it can't live in the cached prefix). */
  domainFiles?: string[];
  /** Recalled lessons for this turn — per-turn context. */
  lessons?: Pick<LessonRow, 'text' | 'domain'>[];
  /** Deterministic snapshot from query_db — per-turn context. */
  snapshot?: string;
  /**
   * Profile-completeness gap (domains/profile.ts's profileGap()) — per-turn
   * context, mentorship Phase B. Non-null only when Ben's structured profile
   * is missing something; the caller (gateway/app.ts's /api/chat) is also
   * expected to set domainFiles: ['ONBOARDING.md'] alongside this so the
   * interview discipline loads in the same turn the gap is surfaced.
   */
  profileGap?: string;
  /** Who this turn's message is from (user turns only) — per-turn context. */
  interlocutor?: Interlocutor;
  now?: Date;
}

export interface AssembledPrompt {
  /**
   * Passed as options.systemPrompt. MUST be byte-identical across turns
   * (barring an actual memory-file edit) for the Agent SDK's prompt cache
   * to hit. Nothing time-varying belongs here — no datetime, interlocutor,
   * lessons, snapshot, or topic-selected domain files.
   */
  systemPrompt: string;
  /**
   * Everything that varies per turn, meant to be prepended to the turn's
   * message instead of glued into the system prompt.
   */
  turnContext: string;
}

/** A line telling Cabinet who it's talking to, and how to stand with them. */
export function interlocutorLine(who: Interlocutor): string {
  if (who.isOwner) {
    return `You are speaking with ${who.name} — your principal, the person you serve. This is Ben.`;
  }
  if (who.role === 'agent') {
    return (
      `You are speaking with ${who.name} — an AI agent Ben has authorized to work with you as a trusted peer, ` +
      `with his full confidence and access to his data and this system. Engage as an equal working partner, ` +
      `NOT as your principal: ${who.name} is a colleague (and may be here to review, mentor, or help change the ` +
      `system on Ben's behalf), so collaborate candidly, push back when you disagree, and take their guidance seriously.`
    );
  }
  return `You are speaking with ${who.name}, another benloe.com user — be helpful and courteous.`;
}

/**
 * Split system prompt / per-turn context (§9.3). options.systemPrompt must
 * be byte-identical across turns so the Agent SDK's prompt cache actually
 * hits — verified 2026-07-09 via token_usage: before this fix, the whole
 * assembled string (identity core AND per-turn volatile data, including a
 * millisecond-precision timestamp) was glued into one string and passed as
 * systemPrompt, so cache_write recurred at near-full size every turn instead
 * of collapsing to a cache_read after the first. Everything time-varying —
 * datetime, session kind, interlocutor, recalled lessons, today's snapshot,
 * and topic-selected domain files (these were "stable" only in the sense of
 * never being *marked* volatile, but topic selection varies per turn just
 * like the clock does) — now lives in turnContext and gets prepended to the
 * turn's message instead. Heartbeats get a minimal system prompt.
 */
export function assemblePrompt(mem: MemoryStore, input: PromptInput): AssembledPrompt {
  const systemPrompt =
    input.kind === 'heartbeat'
      ? [
          `<memory file="IDENTITY.md">\n${mem.read('IDENTITY.md')}\n</memory>`,
          `<memory file="HEARTBEAT.md">\n${mem.read('HEARTBEAT.md')}\n</memory>`,
        ].join('\n\n')
      : mem.promptCore();

  const now = input.now ?? new Date();
  const context: string[] = [
    `Current datetime: ${now.toISOString()} (America/New_York for all user-facing times).`,
    `Session kind: ${input.kind}.`,
  ];
  if (input.interlocutor) context.push(interlocutorLine(input.interlocutor));
  if (input.lessons?.length) {
    context.push('Recalled lessons (situational, apply with judgment):');
    for (const l of input.lessons) context.push(`- [${l.domain ?? 'general'}] ${l.text}`);
  }
  if (input.snapshot) context.push(`Today snapshot:\n${input.snapshot}`);
  if (input.profileGap) context.push(`Profile completeness check: ${input.profileGap}`);
  for (const f of input.domainFiles ?? []) {
    try {
      context.push(`<memory file="${f}">\n${mem.read(f)}\n</memory>`);
    } catch {
      /* missing domain file is fine */
    }
  }

  return { systemPrompt, turnContext: context.join('\n\n') };
}
