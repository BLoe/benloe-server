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
  /**
   * Account rate-limit line (runtime/rateLimits.ts's capacityLine) — per-turn
   * context, and necessarily so: a utilization figure changes every turn, and
   * anything that changes every turn must stay out of systemPrompt. Not just
   * for the prompt cache — SessionSpec keys the session pool on the system
   * prompt's hash, so a volatile value there would spawn a fresh CLI
   * subprocess for every single turn.
   *
   * Populated centrally in AgentRuntime.run(), NOT by individual callers: a
   * per-caller opt-in is how Cabinet previously shipped a fully-built lessons
   * slot that no call site ever populated.
   *
   * Null on most turns by design — see INJECT_FLOOR.
   */
  capacity?: string;
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

/**
 * Late-position operational reminder (2026-08-01, Opus 5 migration).
 *
 * Anthropic's Opus 5 prompting guide is explicit about two things Cabinet was
 * getting wrong on the main loop:
 *   1. "In a long system prompt, pair the instruction with a short reminder
 *      near the end of the prompt." VOICE.md's narration rule sits ~6 memory
 *      files deep in a cache-stable prefix that runs thousands of tokens; by
 *      the time the model reaches Ben's actual message it has been outweighed
 *      by tool schemas and turn data. This block rides at the END of
 *      turnContext, immediately before the user's words.
 *   2. Narration cadence is tuned by DESCRIBING the shape you want, and
 *      positive examples of the wanted style beat prohibitions.
 *
 * Deliberately NOT here: any "double-check your work" / "verify before
 * responding" instruction. Opus 5 self-corrects without being told, and the
 * guide is explicit that such instructions compound into over-verification
 * and wasted tokens.
 *
 * This is register discipline, not personality — the character lives in
 * CHARTER.md / VOICE.md and must keep winning any conflict.
 *
 * LENGTH, 2026-08-10. The clause used to read "desk register stays tight ...
 * counsel register is exempt".
 *
 * The reason it did nothing is sharper than "every turn is counsel", which
 * was the first diagnosis and was wrong about the mechanism. `register`
 * reaches exactly one place — effortForRegister in runtime/agent.ts — and
 * THIS function takes no register parameter. chat.register never enters the
 * prompt at all. So the model was never told which register it was in: it
 * read a rule keyed on a distinction it could not observe, and guessed, every
 * turn. An inert rule fails predictably; an unobservable one fails however
 * the model guesses, and Opus 5's documented default guess is long.
 *
 * That also means fixing the register classifier would not have fixed length:
 * register only sets effort, and Anthropic's guidance is explicit that effort
 * "does not reliably change visible response length". Two mechanisms were
 * assumed to connect and neither does — which is why the fix here is an
 * unconditional rule rather than a better-tuned conditional one.
 *
 * (For the record, the classifier is separately broken: chat.register was
 * `counsel` on 60 of 60 sampled v2 turns and has never once been `desk`.
 * That is a real bug, just not this one's cause.)
 *
 * Measured at the same time: replies p50 3070 chars against Ben's p50 284, a
 * 10.8x ratio, and 19 of 60 turns that were themselves under 160 characters
 * still drew replies with a median of 1303. A one-line message got a
 * 1300-character answer.
 *
 * The rule is now unconditional, and counsel is a WIDENING rather than an
 * exemption. Anthropic's Opus 5 guidance is that this model runs long by
 * default, that effort does not reliably shorten visible output, and that
 * conciseness has to be prompted for explicitly — which is only true if the
 * prompt's conciseness clause can actually fire.
 *
 * The numbers to re-measure after this ships are p50 3070 and the short-turn
 * p50 1303. Fixing the register
 * classifier is deliberately NOT bundled here: it is the riskier change, and
 * with a working floor it becomes tuning rather than load-bearing.
 */
export const TURN_DISCIPLINE = `<turn-discipline>
Before your first tool call, say in one short line what you're about to do —
always, even when the work is obvious and even when you intend to call several
tools. Silence followed by a wall of tool results is the single worst failure
mode of this interface: Ben cannot see tool calls in flight, so a turn that
goes straight to tools is indistinguishable from a frozen one.

While working, drop another short line whenever something material changes: a
phase finishes, a result surprises you, you change direction, or you're moving
to verification. Not a play-by-play — updates that carry information.

When you finish, lead with the outcome. The first sentence answers "what
happened" or "what did you find"; supporting detail comes after it.

RIGHT: "Pulling the last two weeks of weigh-ins." → [tools] → "Trend's 277.1,
third week in the band. Two flat days both landed on skipped-snack days."
WRONG: [six tool calls, no text] → a wall of results.

Length: match the reply to what was actually asked. A one-line message gets a
short answer — a few sentences, often less. Answer the question, then stop;
do not append the adjacent things Ben did not ask about, and do not restate
what you just did once the outcome line has said it.

Counsel turns (goals, plans, reflection, anything about what Ben should want)
earn more room — there the conversation IS the work, and depth is the point.
That is a widening of this rule, not an exemption from it: even in counsel,
length has to be doing something. Where VOICE.md says length limits are
"suspended" in counsel, read it as this widening; it does not license a reply
whose length is not carrying weight.

RIGHT: "Weight?" → "278.4. Trend 277.1, third week in the band."
WRONG: "Weight?" → the number, plus the week's trend, plus tonight's dinner,
plus a nudge about the 3:30 snack.

Deliver what was asked, at the scope intended. Make routine judgment calls
yourself. If the request seems mistaken or a better approach exists, say so in
a sentence and continue rather than quietly widening or narrowing the task.

Your own plumbing is not news. When a tool, database, or connection of yours
misbehaves, report the CONSEQUENCE to Ben, not the mechanism — what you could
not do, and what that means for him. Then get on with the part that still
works. He is not on call for this system.
RIGHT: "I can't write that to your log right now — I'll queue it and confirm
once it lands. Meanwhile, here's the number you asked for."
WRONG: "MCP tools aren't loaded in this session, going to the database
directly." / "My tool server dropped its connection mid-session."
This is not permission to hide a failure. Silence about something that
affected the answer is worse than the narration it replaces: if a result is
missing, stale, or unverified, say so plainly and say what it costs.
</turn-discipline>`;

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
/**
 * Ben's wall-clock time, pre-formatted.
 *
 * This used to emit `now.toISOString()` (UTC) alongside a note that
 * America/New_York was the user-facing zone, which left the agent to do the
 * offset in its head every turn. On 2026-08-01 it did not: it read `21:34Z`
 * as 9:34pm, told Ben it was "past nine" when it was 5:34pm, and then
 * confabulated a two-hour lab-reading session to justify the gap. Wrong time
 * doesn't stay a wrong time — it becomes wrong reasoning about the day.
 * So the offset is computed here, once, correctly, and DST comes free.
 */
const BEN_TZ = 'America/New_York';
function localStamp(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BEN_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

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
    `Current datetime: ${localStamp(now)}. This IS Ben's wall-clock time — use it directly, never shift it.`,
    `(UTC reference only, do not quote to Ben: ${now.toISOString()})`,
    `Session kind: ${input.kind}.`,
  ];
  // Early, deliberately low-salience position: capacity is operational
  // background, and it must not compete with TURN_DISCIPLINE for the slot
  // immediately before Ben's message. It only appears at all when the number
  // is high enough to matter (rateLimits.ts INJECT_FLOOR).
  if (input.capacity) context.push(input.capacity);
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

  // Last block in turnContext, so it lands immediately before Ben's message —
  // the highest-salience position available. Heartbeats are machine-facing
  // and have no one to narrate to, so they skip it.
  if (input.kind !== 'heartbeat') context.push(TURN_DISCIPLINE);

  return { systemPrompt, turnContext: context.join('\n\n') };
}
