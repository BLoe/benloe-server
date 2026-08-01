/** Model routing (§9.2). Exact IDs verified against the live API (Appendix B). */

export type Route = 'nano' | 'default' | 'deep' | 'max';

export const MODELS: Record<Route, string> = {
  nano: 'claude-haiku-4-5',
  default: 'claude-sonnet-5',
  deep: 'claude-opus-5',
  max: 'claude-fable-5',
};

/**
 * Effort per route. 'deep' is Opus 5 and deliberately sits at 'high' — the
 * API default — not 'xhigh': Anthropic's Opus 5 guidance is to start at the
 * default and treat low/medium as the primary cost/latency control, stepping
 * up to xhigh only for demanding coding/agentic work where evals show it pays.
 * Opus 5 at 'high' is both cheaper and faster than the Sonnet-5-at-'xhigh'
 * this replaced, and effort is a request-level setting that invalidates the
 * prompt cache when it changes mid-conversation, so it stays constant.
 */
export const EFFORT: Record<Route, 'low' | 'medium' | 'high' | 'xhigh'> = {
  nano: 'low',
  default: 'high',
  deep: 'high',
  max: 'xhigh',
};

export interface RouteInput {
  kind: 'user' | 'heartbeat' | 'cron';
  /** Per-chat override: 'nano'|'default'|'deep'|'max' or a literal model id. */
  override?: string | null;
  /** Cron jobs may request the deep route (weekly review). */
  deep?: boolean;
}

/**
 * Main user loop: Opus 5 at 'high' effort (2026-08-01, Ben's call).
 *
 * History: Fable/max while stabilizing the architecture → Sonnet 5 at xhigh
 * for everyday cost/latency (2026-07-16) → Opus 5. The reason is the job, not
 * the benchmark: Cabinet is a chief advisor that reasons about Ben's life,
 * pushes back, and holds a plan across weeks — not a data-entry worker. That
 * warrants the frontier model on the main loop.
 *
 * This is NOT a straight cost increase over the Sonnet-5-at-xhigh it replaces:
 * Opus 5 at 'high' spends far fewer thinking tokens per step, and the
 * dominant cost line in Cabinet's token_usage is cache_read across long
 * multi-step turns, which shrinks with the step count.
 *
 * Route is pinned separately from effort so the shared 'deep' tier — used by
 * per-chat overrides and the cron weekly review — keeps its own value if this
 * one is retuned.
 */
const USER_TURN_ROUTE: Route = 'deep';
const USER_TURN_EFFORT: (typeof EFFORT)[Route] = 'high';

export function route(input: RouteInput): { model: string; route: Route; effort: (typeof EFFORT)[Route] } {
  if (input.override) {
    const key = input.override.toLowerCase();
    const alias: Record<string, Route> = {
      nano: 'nano', haiku: 'nano',
      default: 'default', sonnet: 'default',
      deep: 'deep', opus: 'deep',
      max: 'max', fable: 'max',
    };
    const r = alias[key];
    if (r) return { model: MODELS[r], route: r, effort: EFFORT[r] };
    if (key.startsWith('claude-')) {
      // explicit model id: effort follows the closest tier
      const r2: Route = key.includes('haiku') ? 'nano' : key.includes('fable') ? 'max' : key.includes('opus') ? 'deep' : 'default';
      return { model: input.override, route: r2, effort: EFFORT[r2] };
    }
  }
  if (input.kind === 'heartbeat') return { model: MODELS.nano, route: 'nano', effort: EFFORT.nano };
  if (input.kind === 'cron' && input.deep) return { model: MODELS.deep, route: 'deep', effort: EFFORT.deep };
  if (input.kind === 'user') return { model: MODELS[USER_TURN_ROUTE], route: USER_TURN_ROUTE, effort: USER_TURN_EFFORT };
  return { model: MODELS.default, route: 'default', effort: EFFORT.default };
}

/** Fable 5 refusals fall back to the deep route (Opus 5) (§9.2 / §14). */
export function refusalFallback(model: string): string | null {
  return model === MODELS.max ? MODELS.deep : null;
}
