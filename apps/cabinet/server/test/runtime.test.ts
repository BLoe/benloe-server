import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { MemoryStore } from '../src/memory/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { route, refusalFallback, MODELS } from '../src/runtime/router.js';
import { TurnQueue } from '../src/runtime/queue.js';
import { assemblePrompt, stablePrefix, VOLATILE_MARKER } from '../src/runtime/prompt.js';
import { AgentRuntime, configureAuth, type TurnEvent, type QueryFn } from '../src/runtime/agent.js';

describe('router', () => {
  it('routes by session kind', () => {
    expect(route({ kind: 'heartbeat' }).model).toBe(MODELS.nano);
    expect(route({ kind: 'user' }).model).toBe(MODELS.default);
    expect(route({ kind: 'cron', deep: true }).model).toBe(MODELS.deep);
    expect(route({ kind: 'cron' }).model).toBe(MODELS.default);
  });

  it('honors per-thread overrides by alias and literal id', () => {
    expect(route({ kind: 'user', override: 'fable' }).model).toBe(MODELS.max);
    expect(route({ kind: 'user', override: 'opus' }).model).toBe(MODELS.deep);
    expect(route({ kind: 'user', override: 'claude-sonnet-5' }).model).toBe('claude-sonnet-5');
  });

  it('fable refuses → opus fallback; others do not fall back', () => {
    expect(refusalFallback(MODELS.max)).toBe(MODELS.deep);
    expect(refusalFallback(MODELS.default)).toBeNull();
  });
});

describe('turn queue', () => {
  it('serializes: never two turns in flight', async () => {
    const q = new TurnQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const mk = (ms: number) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return ms;
    };
    const results = await Promise.all([
      q.submit('cron', mk(30)),
      q.submit('cron', mk(10)),
      q.submit('cron', mk(5)),
    ]);
    expect(maxInFlight).toBe(1);
    expect(results).toEqual([30, 10, 5]);
  });

  it('user turns jump ahead of pending scheduled turns', async () => {
    const q = new TurnQueue();
    const order: string[] = [];
    const mk = (label: string) => async () => {
      order.push(label);
      await new Promise((r) => setTimeout(r, 10));
    };
    const p1 = q.submit('cron', mk('cron-1')); // starts immediately
    const p2 = q.submit('heartbeat', mk('hb'));
    const p3 = q.submit('user', mk('user')); // should overtake hb
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(['cron-1', 'user', 'hb']);
  });

  it('dropPendingScheduled clears stale scheduled work but keeps user turns', async () => {
    const q = new TurnQueue();
    const done: string[] = [];
    const slow = q.submit('cron', async () => {
      await new Promise((r) => setTimeout(r, 30));
      done.push('slow');
    });
    void q.submit('heartbeat', async () => {
      done.push('hb');
    }).catch(() => {});
    const user = q.submit('user', async () => {
      done.push('user');
    });
    expect(q.dropPendingScheduled()).toBe(1);
    await Promise.all([slow, user]);
    expect(done).toEqual(['slow', 'user']);
  });
});

describe('prompt assembly', () => {
  let dir: string;
  let mem: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cabinet-prompt-'));
    mem = new MemoryStore(dir);
    mem.ensureTemplates();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stable prefix is byte-identical across turns at different times', () => {
    const p1 = assemblePrompt(mem, { kind: 'user', now: new Date('2026-07-07T10:00:00Z') });
    const p2 = assemblePrompt(mem, { kind: 'user', now: new Date('2026-07-08T22:13:45Z'), snapshot: 'protein 90g' });
    expect(stablePrefix(p1)).toBe(stablePrefix(p2));
    expect(p1).not.toBe(p2); // volatile differs
  });

  it('datetime never leaks above the volatile marker', () => {
    const p = assemblePrompt(mem, { kind: 'user', now: new Date('2026-03-15T12:00:00Z') });
    expect(stablePrefix(p)).not.toContain('2026-03-15');
    expect(p.slice(p.indexOf(VOLATILE_MARKER))).toContain('2026-03-15');
  });

  it('heartbeat prompt is minimal: identity + checklist only', () => {
    const p = assemblePrompt(mem, { kind: 'heartbeat' });
    expect(p).toContain('HEARTBEAT.md');
    expect(p).not.toContain('PLATFORM.md');
    expect(p.length).toBeLessThan(assemblePrompt(mem, { kind: 'user' }).length);
  });
});

describe('configureAuth (§9.1)', () => {
  it('subscription mode strips the API key and isolates config dir', () => {
    const env: Record<string, string | undefined> = {
      CABINET_CLAUDE_AUTH: 'subscription',
      ANTHROPIC_API_KEY: 'sk-x',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-y',
    };
    expect(configureAuth(env)).toBe('subscription');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-y');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/claude-worker/.cabinet-claude');
  });

  it('api mode strips the oauth token and respects an existing config dir', () => {
    const env: Record<string, string | undefined> = {
      CABINET_CLAUDE_AUTH: 'api',
      ANTHROPIC_API_KEY: 'sk-x',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-y',
      CLAUDE_CONFIG_DIR: '/custom',
    };
    expect(configureAuth(env)).toBe('api');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe('/custom');
  });
});

// ---------------------------------------------------------------------------
// runTurn against a scripted fake SDK: event translation, session persistence,
// usage recording, refusal fallback.
// ---------------------------------------------------------------------------
describe('AgentRuntime.run (fake SDK)', () => {
  let dir: string;
  let cabinet: CabinetDb;
  let mem: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cabinet-rt-'));
    cabinet = openDb(join(dir, 'cabinet.db'));
    mem = new MemoryStore(join(dir, 'memory'));
    mem.ensureTemplates();
    cabinet.db.prepare("INSERT INTO thread (id, kind) VALUES ('t1','user')").run();
  });

  afterEach(() => {
    cabinet.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function scriptedQuery(script: (opts: any) => Record<string, any>[]): QueryFn {
    return ((args: any) => {
      const messages = script(args.options);
      return (async function* () {
        for (const m of messages) yield m;
      })();
    }) as unknown as QueryFn;
  }

  const happyScript = (model: string) => [
    { type: 'system', subtype: 'init', session_id: 'sess-123', model },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file.txt', is_error: false }] } },
    {
      type: 'result', subtype: 'success', result: 'Hello',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 },
      total_cost_usd: 0.001,
    },
  ];

  function mkRuntime(queryFn: QueryFn) {
    return new AgentRuntime({
      db: cabinet.db,
      memory: mem,
      approvals: new ApprovalQueue(cabinet.db),
      queryFn,
      cwd: dir,
      dataDir: dir,
    });
  }

  it('translates the stream, persists the session id, and records usage', async () => {
    let seenOptions: any;
    const rt = mkRuntime(
      scriptedQuery((opts) => {
        seenOptions = opts;
        return happyScript(opts.model);
      }),
    );
    const events: TurnEvent[] = [];
    const res = await rt.run({ threadId: 't1', prompt: 'hi', kind: 'user', onEvent: (e) => events.push(e) });

    expect(res).toEqual({ stopReason: 'success', sessionId: 'sess-123' });
    expect(events.map((e) => e.type)).toEqual([
      'turn-start', 'text-delta', 'text-delta', 'tool-start', 'tool-end', 'turn-end',
    ]);
    // Appendix B invariants baked into the options:
    expect(seenOptions.allowedTools).toEqual([]); // no gated tools bare-listed
    expect(seenOptions.settingSources).toEqual([]);
    expect(typeof seenOptions.canUseTool).toBe('function');
    expect(seenOptions.hooks.PreToolUse).toBeTruthy();
    // session persisted
    const row = cabinet.db.prepare("SELECT sdk_session_id FROM thread WHERE id='t1'").get() as any;
    expect(row.sdk_session_id).toBe('sess-123');
    // usage recorded
    const usage = cabinet.db.prepare('SELECT model, input_tokens, cost_usd FROM token_usage').get() as any;
    expect(usage).toMatchObject({ input_tokens: 10, cost_usd: 0.001 });
  });

  it('resumes user turns with the stored session id, not scheduled turns', async () => {
    cabinet.db.prepare("UPDATE thread SET sdk_session_id = 'prev-sess' WHERE id='t1'").run();
    const resumes: (string | undefined)[] = [];
    const rt = mkRuntime(
      scriptedQuery((opts) => {
        resumes.push(opts.resume);
        return happyScript(opts.model);
      }),
    );
    await rt.run({ threadId: 't1', prompt: 'a', kind: 'user', onEvent: () => {} });
    await rt.run({ threadId: 't1', prompt: 'b', kind: 'heartbeat', onEvent: () => {} });
    expect(resumes).toEqual(['prev-sess', undefined]);
  });

  it('falls back to opus when fable refuses', async () => {
    cabinet.db.prepare("UPDATE thread SET model_override = 'fable' WHERE id='t1'").run();
    const modelsSeen: string[] = [];
    const rt = mkRuntime(
      scriptedQuery((opts) => {
        modelsSeen.push(opts.model);
        if (opts.model === 'claude-fable-5') {
          return [
            { type: 'system', subtype: 'init', session_id: 's1', model: opts.model },
            { type: 'result', subtype: 'error_refusal', result: 'refusal: declined by safety classifier', usage: {} },
          ];
        }
        return happyScript(opts.model);
      }),
    );
    const events: TurnEvent[] = [];
    const res = await rt.run({ threadId: 't1', prompt: 'build it', kind: 'user', onEvent: (e) => events.push(e) });
    expect(modelsSeen).toEqual(['claude-fable-5', 'claude-opus-4-8']);
    expect(res.stopReason).toBe('success');
    expect(events.some((e) => e.type === 'notice')).toBe(true);
  });

  it('surfaces stream errors as error events and rejects', async () => {
    const rt = mkRuntime((() => {
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's', model: 'x' };
        throw new Error('boom 529');
      })();
    }) as unknown as QueryFn);
    const events: TurnEvent[] = [];
    await expect(
      rt.run({ threadId: 't1', prompt: 'x', kind: 'user', onEvent: (e) => events.push(e) }),
    ).rejects.toThrow('boom 529');
    expect(events.at(-1)).toMatchObject({ type: 'error', retryable: true });
  });
});
