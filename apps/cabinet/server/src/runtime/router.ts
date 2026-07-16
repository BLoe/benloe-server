/** Model routing (§9.2). Exact IDs verified against the live API (Appendix B). */

export type Route = 'nano' | 'default' | 'deep' | 'max';

export const MODELS: Record<Route, string> = {
  nano: 'claude-haiku-4-5',
  default: 'claude-sonnet-5',
  deep: 'claude-opus-4-8',
  max: 'claude-fable-5',
};

export const EFFORT: Record<Route, 'low' | 'medium' | 'high' | 'xhigh'> = {
  nano: 'low',
  default: 'high',
  deep: 'xhigh',
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
 * Main user loop: Sonnet 5 at xhigh thinking. (Ran on Fable/max while
 * stabilizing the architecture/UI; moved to Sonnet 5 — still xhigh effort —
 * for everyday cost/latency. — Ben, 2026-07-16)
 *
 * Route is 'default' (Sonnet) but effort is pinned separately so the shared
 * 'default' tier — used by per-chat overrides and the fallback below — keeps
 * its own 'high' effort.
 */
const USER_TURN_ROUTE: Route = 'default';
const USER_TURN_EFFORT: (typeof EFFORT)[Route] = 'xhigh';

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

/** Fable 5 refusals fall back to Opus 4.8 (§9.2 / §14). */
export function refusalFallback(model: string): string | null {
  return model === MODELS.max ? MODELS.deep : null;
}
