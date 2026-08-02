/**
 * AI player brief.
 *
 * Takes everything the app knows about a player — league history, projections,
 * game log, and the merged news feed — hands it to Claude with web search
 * enabled so it can fill gaps and check recency, and gets back a short analyst
 * read.
 *
 * Two things matter here beyond the call itself:
 *   - It costs real money per player, so results are cached on disk.
 *   - It is a summary of other people's reporting, so the response carries the
 *     sources it used and the UI labels it as generated.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NewsItem } from '../lib/news.js';

export interface BriefInput {
  playerName: string;
  position: string | null;
  nflTeam: string | null;
  season: string;
  leagueName: string;
  scoring: string;
  injuryStatus?: string | null;
  projection?: { points: number; games: number | null } | null;
  totals?: { points: number; games: number; average: number; best: number } | null;
  ownedBy?: string | null;
  history?: string[];
  news: NewsItem[];
}

export interface Brief {
  /** Two or three sentences: where this player stands right now. */
  summary: string;
  /** Short bullets a manager would act on. */
  points: string[];
  /** Anything flagged as a risk — injury, committee, schedule. */
  watch: string[];
  sources: string[];
  generatedAt: number;
  model: string;
}

const MODEL = 'claude-opus-5';

const SYSTEM = `You are a fantasy football analyst writing a short brief for one manager about one player.

Ground every claim in the material you are given or in what you find with web search. If the supplied
material and the web disagree, prefer the more recent and say so. Never invent statistics, injuries,
depth-chart positions, or transactions — if something is unknown, leave it out rather than guessing.

Write plainly, for someone who already follows fantasy football. No hype, no filler, no restating the
player's name and team back at them. Prefer specifics (snap share, target volume, a stated timeline)
over adjectives. If the recent news genuinely says nothing that changes how a manager should think
about this player, say that instead of manufacturing significance.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: "Two or three sentences on where this player stands for the season in question.",
    },
    points: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to four short, concrete takeaways a manager would act on.',
    },
    watch: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to three risks or things to monitor. Empty if there are none worth naming.',
    },
    sources: {
      type: 'array',
      items: { type: 'string' },
      description: 'Outlets or sites the claims came from, e.g. "RotoWire", "ESPN".',
    },
  },
  required: ['summary', 'points', 'watch', 'sources'],
  additionalProperties: false,
} as const;

function buildPrompt(input: BriefInput): string {
  const lines: string[] = [];
  lines.push(`Player: ${input.playerName}${input.position ? ` (${input.position})` : ''}`);
  lines.push(`NFL team: ${input.nflTeam ?? 'free agent'}`);
  lines.push(`Season of interest: ${input.season}`);
  lines.push(`Fantasy league: ${input.leagueName}, ${input.scoring} scoring`);
  if (input.injuryStatus) lines.push(`Injury designation on file: ${input.injuryStatus}`);
  if (input.ownedBy) lines.push(`Rostered by: ${input.ownedBy}`);

  if (input.projection) {
    lines.push(
      `Projection: ${input.projection.points} points` +
        (input.projection.games ? ` over ${input.projection.games} games` : '')
    );
  }
  if (input.totals?.games) {
    lines.push(
      `Actual last season: ${input.totals.points} points in ${input.totals.games} games ` +
        `(${input.totals.average}/game, best ${input.totals.best})`
    );
  }
  if (input.history?.length) {
    lines.push(`\nMoves in this league:\n${input.history.map((h) => `- ${h}`).join('\n')}`);
  }

  if (input.news.length) {
    lines.push('\nRecent coverage gathered by the app:');
    for (const n of input.news.slice(0, 12)) {
      const when = n.published ? new Date(n.published).toISOString().slice(0, 10) : 'undated';
      lines.push(`\n[${n.source}, ${when}] ${n.title}`);
      if (n.body) lines.push(n.body.slice(0, 1200));
    }
  } else {
    lines.push('\nThe app found no recent coverage for this player.');
  }

  lines.push(
    `\nUse web search to check whether anything more recent or more important is missing, ` +
      `particularly injuries, depth-chart changes, and trades. Then write the brief.`
  );
  return lines.join('\n');
}

export class BriefService {
  private client: Anthropic;
  private inFlight = new Map<string, Promise<Brief>>();

  constructor(
    apiKey: string,
    private cacheDir: string,
    private ttlMs = 12 * 60 * 60_000
  ) {
    this.client = new Anthropic({ apiKey });
  }

  private path(key: string) {
    return join(this.cacheDir, `brief-${key}.json`);
  }

  async cached(key: string): Promise<Brief | null> {
    try {
      const raw = JSON.parse(await readFile(this.path(key), 'utf8')) as Brief;
      if (Date.now() - raw.generatedAt < this.ttlMs) return raw;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Generate a brief, or return the cached one.
   *
   * Concurrent requests for the same player share one call — without this, a
   * page open in two tabs pays twice.
   */
  async get(key: string, input: BriefInput, force = false): Promise<Brief> {
    if (!force) {
      const hit = await this.cached(key);
      if (hit) return hit;
    }

    const running = this.inFlight.get(key);
    if (running) return running;

    const task = this.generate(input)
      .then(async (brief) => {
        await mkdir(this.cacheDir, { recursive: true }).catch(() => {});
        await writeFile(this.path(key), JSON.stringify(brief)).catch(() => {});
        return brief;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return task;
  }

  private async generate(input: BriefInput): Promise<Brief> {
    // Streaming: web search plus a long prompt can run well past a plain
    // request's timeout window.
    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: buildPrompt(input) }],
    } as any);

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new Error('Claude declined to write this brief.');
    }

    // With a json_schema format the answer is the concatenated text blocks;
    // search results and citations arrive as their own blocks and are skipped.
    const text = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Claude returned an unreadable brief.');
    }

    return {
      summary: String(parsed.summary ?? '').trim(),
      points: (parsed.points ?? []).map((x: unknown) => String(x)).slice(0, 4),
      watch: (parsed.watch ?? []).map((x: unknown) => String(x)).slice(0, 3),
      sources: [...new Set<string>((parsed.sources ?? []).map((x: unknown) => String(x)))].slice(0, 8),
      generatedAt: Date.now(),
      model: message.model,
    };
  }
}
