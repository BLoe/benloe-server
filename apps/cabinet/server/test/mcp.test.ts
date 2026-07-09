import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { EpisodicStore } from '../src/episodic/index.js';
import { Embedder } from '../src/embeddings/index.js';
import { MemoryStore } from '../src/memory/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildCabinetTools, cabinetAllowedTools, type CabinetToolContext } from '../src/mcp/cabinet-server.js';
import { buildExternalMcpServers } from '../src/mcp/external.js';
import { classifyToolUse } from '../src/tiers/classify.js';

const MODEL_TIMEOUT = 300_000;

let dir: string;
let cabinet: CabinetDb;
let ctx: CabinetToolContext;
let tools: ReturnType<typeof buildCabinetTools>;

function call(name: string, args: Record<string, unknown>) {
  const t = tools.find((x) => (x as { name: string }).name === name) as unknown as {
    handler(a: Record<string, unknown>, extra: unknown): Promise<{ content: { text: string }[]; isError?: boolean }>;
  };
  if (!t) throw new Error(`no tool ${name}`);
  return t.handler(args, {});
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-mcp-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  const memory = new MemoryStore(join(dir, 'memory'));
  memory.ensureTemplates();
  ctx = {
    db: cabinet.db,
    readonlyDb: cabinet.readonlyDb,
    episodic: new EpisodicStore(join(dir, 'episodic.db')),
    embedder: new Embedder(),
    memory,
    approvals: new ApprovalQueue(cabinet.db),
    widgetBus: new EventEmitter(),
  };
  tools = buildCabinetTools(ctx);
});

afterAll(async () => {
  await ctx.embedder.close();
  ctx.episodic.close();
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('cabinet MCP server', () => {
  it('exposes the full §8 catalog and every name classifies Tier 4', () => {
    const names = cabinetAllowedTools();
    for (const expected of [
      'mcp__cabinet__log_food', 'mcp__cabinet__log_workout', 'mcp__cabinet__log_body_metric', 'mcp__cabinet__log_mood',
      'mcp__cabinet__add_journal', 'mcp__cabinet__log_claim', 'mcp__cabinet__log_lab', 'mcp__cabinet__log_medication',
      'mcp__cabinet__log_hsa_contribution', 'mcp__cabinet__import_transactions_csv', 'mcp__cabinet__update_pantry',
      'mcp__cabinet__add_recipe', 'mcp__cabinet__upsert_task', 'mcp__cabinet__upsert_contact', 'mcp__cabinet__add_price_watch',
      'mcp__cabinet__query_db', 'mcp__cabinet__search_episodic', 'mcp__cabinet__search_documents', 'mcp__cabinet__recall_lessons',
      'mcp__cabinet__add_lesson', 'mcp__cabinet__retire_lesson', 'mcp__cabinet__list_promotable_lessons', 'mcp__cabinet__promote_lesson',
      'mcp__cabinet__update_memory', 'mcp__cabinet__render_widget', 'mcp__cabinet__enqueue_approval',
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
      expect(classifyToolUse(expected, {}).tier).toBe(4);
    }
  });

  it('list_promotable_lessons / promote_lesson: an aged+durable lesson is listed, promotion excludes it from further listing', async () => {
    const added = await call('add_lesson', {
      text: 'Test-only: mcp-layer promotion tool check.',
      evidence: 'seeded for tool-layer test',
      confidence: 0.9,
    });
    const { id } = JSON.parse(added.content[0]!.text);
    ctx.episodic.db.prepare("UPDATE lesson SET created_at = datetime('now', '-8 days'), times_applied = 5 WHERE id = ?").run(id);

    const listed = JSON.parse((await call('list_promotable_lessons', {})).content[0]!.text) as { id: number }[];
    expect(listed.some((l) => l.id === id)).toBe(true);

    const promoted = JSON.parse((await call('promote_lesson', { id })).content[0]!.text);
    expect(promoted).toEqual({ id, status: 'promoted' });

    const listedAfter = JSON.parse((await call('list_promotable_lessons', {})).content[0]!.text) as { id: number }[];
    expect(listedAfter.some((l) => l.id === id)).toBe(false);
  });

  it('log_food handler writes and returns totals', async () => {
    const r = await call('log_food', { description: 'test bowl', kcal: 500, protein_g: 40 });
    const parsed = JSON.parse(r.content[0]!.text);
    expect(parsed.totals.protein_g).toBe(40);
  });

  it('add_journal: an embed failure is logged, not swallowed, and the write still succeeds with embedded=0', async () => {
    const original = ctx.embedder;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ctx.embedder = { embed: async () => { throw new Error('embedding process exited (code 1)'); } } as unknown as Embedder;
    try {
      const r = await call('add_journal', { body: 'a note that will fail to embed' });
      const { id } = JSON.parse(r.content[0]!.text);
      expect(r.isError).toBeUndefined(); // the journal write itself isn't lost when embedding fails
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`add_journal: embed failed for journal_entry id=${id}`));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('embedding process exited (code 1)'));
      const row = cabinet.db.prepare('SELECT embedded FROM journal_entry WHERE id = ?').get(id) as { embedded: number };
      expect(row.embedded).toBe(0);
    } finally {
      ctx.embedder = original;
      warn.mockRestore();
    }
  });

  it('query_db enforces the SELECT-only guard through the tool surface', async () => {
    const okRes = await call('query_db', { sql: 'SELECT COUNT(*) n FROM food_log' });
    expect(JSON.parse(okRes.content[0]!.text)[0].n).toBe(1);
    const bad = await call('query_db', { sql: 'DELETE FROM food_log' });
    expect(bad.isError).toBe(true);
    expect((cabinet.db.prepare('SELECT COUNT(*) n FROM food_log').get() as { n: number }).n).toBe(1);
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
      CABINET_MCP_PLAID_URL: 'http://127.0.0.1:3111/mcp',
      CABINET_MCP_PLAID_TOKEN: 'tok',
    });
    expect(Object.keys(servers).sort()).toEqual(['plaid', 'yahoo']);
    expect(servers.plaid!.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('yahoo can be disabled', () => {
    expect(buildExternalMcpServers({ CABINET_MCP_YAHOO_URL: 'off' })).toEqual({});
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
