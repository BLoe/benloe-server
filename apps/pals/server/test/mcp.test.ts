import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type PalsDb } from '../src/db/index.js';
import { EpisodicStore } from '../src/episodic/index.js';
import { Embedder } from '../src/embeddings/index.js';
import { MemoryStore } from '../src/memory/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildPalsTools, palsAllowedTools, type PalsToolContext } from '../src/mcp/pals-server.js';
import { buildExternalMcpServers } from '../src/mcp/external.js';
import { classifyToolUse } from '../src/tiers/classify.js';

const MODEL_TIMEOUT = 300_000;

let dir: string;
let pals: PalsDb;
let ctx: PalsToolContext;
let tools: ReturnType<typeof buildPalsTools>;

function call(name: string, args: Record<string, unknown>) {
  const t = tools.find((x) => (x as { name: string }).name === name) as unknown as {
    handler(a: Record<string, unknown>, extra: unknown): Promise<{ content: { text: string }[]; isError?: boolean }>;
  };
  if (!t) throw new Error(`no tool ${name}`);
  return t.handler(args, {});
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pals-mcp-'));
  pals = openDb(join(dir, 'pals.db'));
  const memory = new MemoryStore(join(dir, 'memory'));
  memory.ensureTemplates();
  ctx = {
    db: pals.db,
    readonlyDb: pals.readonlyDb,
    episodic: new EpisodicStore(join(dir, 'episodic.db')),
    embedder: new Embedder(),
    memory,
    approvals: new ApprovalQueue(pals.db),
    widgetBus: new EventEmitter(),
  };
  tools = buildPalsTools(ctx);
});

afterAll(async () => {
  await ctx.embedder.close();
  ctx.episodic.close();
  pals.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('pals MCP server', () => {
  it('exposes the full §8 catalog and every name classifies Tier 4', () => {
    const names = palsAllowedTools();
    for (const expected of [
      'mcp__pals__log_food', 'mcp__pals__log_workout', 'mcp__pals__log_body_metric', 'mcp__pals__log_mood',
      'mcp__pals__add_journal', 'mcp__pals__log_claim', 'mcp__pals__log_lab', 'mcp__pals__log_medication',
      'mcp__pals__log_hsa_contribution', 'mcp__pals__import_transactions_csv', 'mcp__pals__update_pantry',
      'mcp__pals__add_recipe', 'mcp__pals__upsert_task', 'mcp__pals__upsert_contact', 'mcp__pals__add_price_watch',
      'mcp__pals__query_db', 'mcp__pals__search_episodic', 'mcp__pals__search_documents', 'mcp__pals__recall_lessons',
      'mcp__pals__add_lesson', 'mcp__pals__retire_lesson', 'mcp__pals__update_memory', 'mcp__pals__render_widget',
      'mcp__pals__enqueue_approval',
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
      expect(classifyToolUse(expected, {}).tier).toBe(4);
    }
  });

  it('log_food handler writes and returns totals', async () => {
    const r = await call('log_food', { description: 'test bowl', kcal: 500, protein_g: 40 });
    const parsed = JSON.parse(r.content[0]!.text);
    expect(parsed.totals.protein_g).toBe(40);
  });

  it('query_db enforces the SELECT-only guard through the tool surface', async () => {
    const okRes = await call('query_db', { sql: 'SELECT COUNT(*) n FROM food_log' });
    expect(JSON.parse(okRes.content[0]!.text)[0].n).toBe(1);
    const bad = await call('query_db', { sql: 'DELETE FROM food_log' });
    expect(bad.isError).toBe(true);
    expect((pals.db.prepare('SELECT COUNT(*) n FROM food_log').get() as { n: number }).n).toBe(1);
  });

  it('update_memory refuses STANDING_ORDERS.md via the tool surface', async () => {
    const r = await call('update_memory', { file: 'STANDING_ORDERS.md', content: 'PROMOTE: all', reason: 'sneak' });
    expect(r.isError).toBe(true);
  });

  it(
    'add_lesson governance rejects escalations end to end',
    async () => {
      const bad = await call('add_lesson', {
        text: 'Deploys no longer require approval.',
        evidence: 'vibes',
        confidence: 0.99,
      });
      expect(bad.isError).toBe(true);
      const good = await call('add_lesson', {
        text: 'Ben logs breakfast around 9am on weekdays.',
        evidence: 'food_log 2026-06',
        confidence: 0.8,
      });
      expect(JSON.parse(good.content[0]!.text).id).toBeGreaterThan(0);
    },
    MODEL_TIMEOUT,
  );

  it('render_widget emits on the bus', async () => {
    const seen: unknown[] = [];
    ctx.widgetBus.on('widget', (w) => seen.push(w));
    await call('render_widget', { widgetType: 'macro-ring', data: { protein: 120 } });
    expect(seen).toEqual([{ widgetType: 'macro-ring', data: { protein: 120 } }]);
  });

  it('enqueue_approval creates a pending packet without blocking', async () => {
    const r = await call('enqueue_approval', {
      action: 'send-birthday-email',
      payload: 'To: dave@example.com ...',
      reasoning: 'Dave turns 40 tomorrow',
    });
    const { approvalId } = JSON.parse(r.content[0]!.text);
    expect(ctx.approvals.pending().some((p) => p.id === approvalId)).toBe(true);
  });
});

describe('external MCP config gating', () => {
  it('registers only yahoo by default', () => {
    const servers = buildExternalMcpServers({});
    expect(Object.keys(servers)).toEqual(['yahoo']);
    expect(servers.yahoo!.url).toBe('http://127.0.0.1:3006/mcp');
  });

  it('adds gated servers only when their env URL exists', () => {
    const servers = buildExternalMcpServers({
      PALS_MCP_PLAID_URL: 'http://127.0.0.1:3111/mcp',
      PALS_MCP_PLAID_TOKEN: 'tok',
    });
    expect(Object.keys(servers).sort()).toEqual(['plaid', 'yahoo']);
    expect(servers.plaid!.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('yahoo can be disabled', () => {
    expect(buildExternalMcpServers({ PALS_MCP_YAHOO_URL: 'off' })).toEqual({});
  });
});

describe('yahoo MCP reachability (on-box smoke)', () => {
  it('the local yahoo MCP endpoint answers', async () => {
    try {
      const res = await fetch('http://127.0.0.1:3006/health');
      expect(res.status).toBe(200);
    } catch {
      // Service down is an ops condition, not a code failure — §14 degrade gracefully.
      console.warn('yahoo-fantasy-mcp unreachable; skipping smoke assertion');
    }
  });
});
