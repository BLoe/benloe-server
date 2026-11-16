// The Anthropic client, the price table, and the one place usage is recorded.
// Every request Kevin makes goes through record(), so month-to-date spend is
// a SUM over one table.
import Anthropic from '@anthropic-ai/sdk';
import { type DB, getSetting, nowIso } from './db.js';
import { config } from './config.js';

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  client ??= new Anthropic({ maxRetries: 3 });
  return client;
}
/** Tests swap in a fake. */
export function setAnthropicForTests(fake: unknown): void {
  client = fake as Anthropic;
}

interface Price {
  input: number; output: number; cacheRead: number; write5m: number; write1h: number;
}
// $ per million tokens. Source: Anthropic pricing as of 2026-11. Haiku 5.5 has
// a second rate card above 100K prompt tokens, handled in costOf().
const PRICES: Record<string, Price> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, write5m: 2.5, write1h: 4 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, write5m: 0.125, write1h: 0.2 },
};
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

export interface UsageNumbers {
  input: number; output: number; cacheRead: number; write5m: number; write1h: number; webSearches: number;
}

export function usageOf(u: Anthropic.Usage | Anthropic.Beta.BetaUsage | null | undefined): UsageNumbers {
  const cc = (u as { cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null } | undefined)
    ?.cache_creation;
  const totalWrite = u?.cache_creation_input_tokens ?? 0;
  const w1h = cc?.ephemeral_1h_input_tokens ?? 0;
  const w5m = cc ? (cc.ephemeral_5m_input_tokens ?? 0) : totalWrite;
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    write5m: w5m,
    write1h: w1h,
    webSearches: (u as { server_tool_use?: { web_search_requests?: number } | null } | undefined)?.server_tool_use?.web_search_requests ?? 0,
  };
}

export function costOf(model: string, n: UsageNumbers): number {
  // An unknown model is priced as the most expensive one we use, so a typo
  // overstates spend instead of hiding it.
  let p = PRICES[model] ?? PRICES['claude-opus-5-5']!;
  if (model === 'claude-haiku-5-5' && n.input + n.cacheRead + n.write5m + n.write1h > 100_000) {
    p = { input: 0.5, output: 2.5, cacheRead: 0.05, write5m: 0.625, write1h: 1 };
  }
  return (
    (n.input * p.input + n.output * p.output + n.cacheRead * p.cacheRead + n.write5m * p.write5m + n.write1h * p.write1h) / 1e6 +
    n.webSearches * WEB_SEARCH_USD
  );
}

export interface UsageTag {
  purpose: 'turn' | 'title' | 'summary' | 'compaction' | 'vision' | 'research' | 'memory';
  threadId?: string | null;
  turnId?: number | null;
  jobKey?: string | null;
}

/** Records one response's usage; returns its cost in dollars. */
export function record(db: DB, tag: UsageTag, model: string, usage: Anthropic.Usage | Anthropic.Beta.BetaUsage | null | undefined): number {
  const n = usageOf(usage);
  const cost = costOf(model, n);
  db.prepare(
    `INSERT INTO usage (at, purpose, thread_id, turn_id, job_key, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, web_searches, cost_usd)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(nowIso(), tag.purpose, tag.threadId ?? null, tag.turnId ?? null, tag.jobKey ?? null, model,
    n.input, n.output, n.cacheRead, n.write5m, n.write1h, n.webSearches, cost);
  if (tag.turnId) db.prepare('UPDATE turns SET cost_usd = cost_usd + ? WHERE id = ?').run(cost, tag.turnId);
  return cost;
}

/** Start of the current month in Ben's timezone, as a UTC ISO string. */
export function monthStartIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  // Midnight local on the 1st: find the UTC instant whose local rendering is y-m-01 00:00.
  const guess = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const local = new Date(new Date(guess).toLocaleString('en-US', { timeZone: config.timezone }));
  const utc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess + (utc.getTime() - local.getTime())).toISOString();
}

export interface Spend {
  monthUsd: number; capUsd: number; remainingUsd: number; blocked: boolean;
}
export function spend(db: DB): Spend {
  const monthUsd = (db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage WHERE at >= ?').get(monthStartIso()) as { s: number }).s;
  const capUsd = getSetting(db, 'monthly_cap_usd', config.defaultMonthlyCapUsd);
  return { monthUsd, capUsd, remainingUsd: Math.max(0, capUsd - monthUsd), blocked: monthUsd >= capUsd };
}

/** The model declined. Asking again with the same input gets the same answer, so callers do not retry it. */
export class RefusalError extends Error {
  constructor() {
    super('The model declined this request.');
    this.name = 'RefusalError';
  }
}

/** A one-shot text completion on the small model. Used for titles, summaries, extraction. */
export async function small(db: DB, tag: UsageTag, system: string, user: string | Anthropic.ContentBlockParam[], maxTokens = 2000): Promise<string> {
  const res = await anthropic().messages.create({
    model: config.models.small,
    max_tokens: maxTokens,
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  record(db, tag, config.models.small, res.usage);
  if (res.stop_reason === 'refusal') throw new RefusalError();
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
}
