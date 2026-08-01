/**
 * Register detection: DESK vs COUNSEL (2026-08-01).
 *
 * VOICE.md already names the two registers Cabinet speaks in. This turns that
 * into a routing decision, because they want opposite things from the model:
 *
 *   DESK    — logging, quick lookups, execution. "278.4." "had eggs." "what's
 *             for dinner." Ben wants the answer now; depth buys nothing.
 *   COUNSEL — goals, plans, reflection, anything about what Ben should want.
 *             The conversation IS the work. Depth is the whole point.
 *
 * Running both at `high` effort is why logging a weight costs the same wall
 * clock as planning a week. Effort is explicitly the recommended control for
 * latency, and lower effort also means fewer tool calls per turn — which the
 * perf data says is where the time actually goes.
 *
 * ## Two deliberate design constraints
 *
 * 1. STICKY, not per-turn. Effort is a request-level setting and changing it
 *    mid-conversation invalidates the prompt cache; cache_read is Cabinet's
 *    single largest token line. It would also change the SessionSpec and so
 *    respawn the CLI subprocess (~3s) — paying latency to save latency. So
 *    the register lives on the chat row and only moves when the evidence is
 *    unambiguous. A chat settles into a mode and stays there.
 *
 * 2. NARROW, and biased toward counsel. Misrouting counsel to desk makes
 *    Cabinet shallow exactly where Ben needs it deep — the failure that turns
 *    an advisor back into a data-entry robot. Misrouting desk to counsel just
 *    costs a few seconds. So desk has to be affirmatively recognized;
 *    everything unrecognized stays counsel.
 *
 * No model call: this runs before the turn, and a classifier round trip would
 * spend the latency it exists to save.
 */

export type Register = 'desk' | 'counsel';

/**
 * Words that mean Ben is asking Cabinet to think WITH him rather than do
 * something for him. Any one of these forces counsel regardless of shape —
 * they are the "this matters" signal, and they outrank every desk cue below.
 */
const COUNSEL_MARKERS =
  /\b(plan|planning|goal|goals|strategy|why|should i|help me think|figure out|worried|struggling|stuck|advice|decide|deciding|review|reflect|feel|feeling|felt|thinking about|not sure|talk about|walk me through|what do you think|make sense|instead|trade-?off|priorit)/i;

/**
 * Affirmative desk shapes. Ordered roughly by how often they show up in a
 * real day of logging.
 */
const DESK_PATTERNS: RegExp[] = [
  // A bare number or measurement: "278.4", "278.4 lb", "8 hours", "6/10"
  /^\s*\d+(\.\d+)?\s*(lb|lbs|kg|g|oz|cal|kcal|mg|min|mins|minutes|hr|hrs|hours|%|\/\s*10)?\s*$/i,
  // Logging verbs, imperative and up front
  /^\s*(log|logged|logging|add|added|ate|eat|had|drank|drink|weighed|weigh|track|record|note|done|finished|completed|skipped|took)\b/i,
  // Quick factual lookups about stored data
  /^\s*(what'?s|whats|how much|how many|how long|when'?s|whens|when is|show|list|check|status of)\b.{0,60}$/i,
  // Confirmations and one-word replies
  /^\s*(yes|yep|yeah|no|nope|ok|okay|k|sure|done|thanks|ty|got it|sounds good|confirmed|correct)\b[\s.!]*$/i,
];

/** Long messages are counsel by shape — nobody writes 400 characters to log a meal. */
const DESK_MAX_CHARS = 160;

/**
 * The register a single message reads as, with a confidence. `null` means the
 * message carries no strong signal either way — used by the sticky logic
 * below to leave the chat's current register alone rather than flap it.
 */
export function classifyMessage(text: string): { register: Register; confident: boolean } | null {
  const t = text.trim();
  if (!t) return null;

  // Counsel markers win outright, at any length. "should i" in a six-word
  // message is still a question about what Ben should want.
  if (COUNSEL_MARKERS.test(t)) return { register: 'counsel', confident: true };

  if (t.length > DESK_MAX_CHARS) return { register: 'counsel', confident: true };

  // Multiple sentences or a paragraph break: Ben is explaining, not logging.
  if (/\n\s*\n/.test(t) || (t.match(/[.!?]\s+\S/g) ?? []).length >= 2) {
    return { register: 'counsel', confident: true };
  }

  for (const p of DESK_PATTERNS) {
    if (p.test(t)) return { register: 'desk', confident: true };
  }

  // Short, no counsel marker, no recognized desk shape. Genuinely ambiguous —
  // say so rather than guessing, and let the chat's existing register hold.
  return null;
}

/**
 * Consecutive desk-shaped messages required before a chat actually switches to
 * desk. Asymmetric on purpose, and the asymmetry is the whole mechanism:
 *
 * - Entering desk is EXPENSIVE to get wrong (Cabinet goes shallow in a
 *   conversation that needed depth) and cheap to delay, so it takes evidence.
 * - Leaving desk is cheap to get wrong (a few extra seconds) and expensive to
 *   delay, so one counsel signal is enough.
 *
 * Measured 2026-08-01: switching on every unambiguous message flipped the
 * register on all three turns of a real session ("Morning. 279.2." → counsel,
 * "278.8" → desk, "help me think about…" → counsel), which changed the
 * SessionSpec each time and respawned the CLI subprocess each time. The
 * optimization was paying its own cost three times over. Requiring a streak
 * is what makes a logging chat settle instead of oscillate.
 */
const DESK_STREAK_REQUIRED = 2;

export interface RegisterState {
  register: Register | null;
  deskStreak: number;
}

/**
 * The chat's register after this message. Sticky by construction: an
 * unrecognized message never changes anything, a chat with no register yet
 * starts at counsel (the safe default), and entering desk needs a streak.
 */
export function nextRegister(state: RegisterState, text: string): RegisterState {
  const read = classifyMessage(text);
  if (!read) return { register: state.register ?? 'counsel', deskStreak: state.deskStreak };

  if (read.register === 'counsel') {
    // One counsel signal ends a desk run outright, streak reset. Ben asking a
    // real question mid-logging-session is exactly when depth has to come back.
    return { register: 'counsel', deskStreak: 0 };
  }

  const deskStreak = state.deskStreak + 1;
  return {
    register: deskStreak >= DESK_STREAK_REQUIRED ? 'desk' : (state.register ?? 'counsel'),
    deskStreak,
  };
}

/**
 * Effort per register. Desk sits at 'medium' rather than 'low': Cabinet's
 * desk turns still call real tools (log_food resolves a meal into macros,
 * query_db answers "what's my trend"), and `low` is documented as best for
 * short scoped tasks with checklists. 'medium' is the documented balanced
 * point for tool-using agentic work — the drop-in for the average workflow —
 * and it is a step down from 'high', which is the whole point.
 *
 * Deliberately env-overridable: this is the first setting to sweep once
 * there's a week of perf_span data to sweep it against, and re-tuning it
 * should not need a deploy.
 */
export function effortForRegister(register: Register, base: string): string {
  if (register !== 'desk') return base;
  return process.env.CABINET_DESK_EFFORT || 'medium';
}
