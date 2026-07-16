import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { MemoryStore } from '../src/memory/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { route, refusalFallback, MODELS } from '../src/runtime/router.js';
import { TurnQueue } from '../src/runtime/queue.js';
import { assemblePrompt } from '../src/runtime/prompt.js';
import { AgentRuntime, configureAuth, classifyStop, MAX_AUTO_CONTINUATIONS, AGENTS, type TurnEvent, type QueryFn } from '../src/runtime/agent.js';

describe('router', () => {
  it('routes by session kind', () => {
    expect(route({ kind: 'heartbeat' }).model).toBe(MODELS.nano);
    // Main user loop: Sonnet 5 (default route) at xhigh effort — see router.ts.
    const userRoute = route({ kind: 'user' });
    expect(userRoute.model).toBe(MODELS.default);
    expect(userRoute.route).toBe('default');
    expect(userRoute.effort).toBe('xhigh');
    expect(route({ kind: 'cron', deep: true }).model).toBe(MODELS.deep);
    expect(route({ kind: 'cron' }).model).toBe(MODELS.default);
  });

  it('honors per-chat overrides by alias and literal id', () => {
    expect(route({ kind: 'user', override: 'fable' }).model).toBe(MODELS.max);
    expect(route({ kind: 'user', override: 'opus' }).model).toBe(MODELS.deep);
    expect(route({ kind: 'user', override: 'claude-sonnet-5' }).model).toBe('claude-sonnet-5');
  });

  it('fable refuses → opus fallback; others do not fall back', () => {
    expect(refusalFallback(MODELS.max)).toBe(MODELS.deep);
    expect(refusalFallback(MODELS.default)).toBeNull();
  });
});

describe('classifyStop (build 3: continuation-on-limit)', () => {
  it('classifies a maxTurns cutoff distinctly from a clean finish', () => {
    expect(classifyStop('error_max_turns')).toBe('max_turns_cutoff');
    expect(classifyStop('success')).toBe('clean');
    expect(classifyStop('error_during_execution')).toBe('clean');
    expect(classifyStop(null)).toBe('clean');
    expect(classifyStop(undefined)).toBe('clean');
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

  it('systemPrompt is byte-identical across turns at different times and interlocutors', () => {
    const p1 = assemblePrompt(mem, { kind: 'user', now: new Date('2026-07-07T10:00:00Z') });
    const p2 = assemblePrompt(mem, {
      kind: 'user',
      now: new Date('2026-07-08T22:13:45Z'),
      snapshot: 'protein 90g',
      interlocutor: { name: 'Benji', role: 'agent', isOwner: false },
    });
    expect(p1.systemPrompt).toBe(p2.systemPrompt);
    expect(p1.turnContext).not.toBe(p2.turnContext); // per-turn context does differ
  });

  it('datetime and interlocutor never leak into systemPrompt — they live in turnContext', () => {
    const p = assemblePrompt(mem, {
      kind: 'user',
      now: new Date('2026-03-15T12:00:00Z'),
      interlocutor: { name: 'Benji', role: 'agent', isOwner: false },
    });
    expect(p.systemPrompt).not.toContain('2026-03-15');
    expect(p.systemPrompt).not.toContain('Benji');
    expect(p.turnContext).toContain('2026-03-15');
    expect(p.turnContext).toContain('Benji');
  });

  it('domain files move into turnContext, not systemPrompt — topic selection must not bust cache', () => {
    mem.update('domains/nutrition.md', '# nutrition notes', 'seed for test');
    mem.update('domains/training.md', '# training notes', 'seed for test');
    const p1 = assemblePrompt(mem, { kind: 'user', domainFiles: ['domains/nutrition.md'] });
    const p2 = assemblePrompt(mem, { kind: 'user', domainFiles: ['domains/training.md'] });
    expect(p1.systemPrompt).not.toContain('nutrition notes');
    expect(p1.turnContext).toContain('nutrition notes');
    // systemPrompt is identical even though the topic (and thus domainFiles) changed.
    expect(p1.systemPrompt).toBe(p2.systemPrompt);
  });

  it('heartbeat systemPrompt is minimal: identity + checklist only', () => {
    const p = assemblePrompt(mem, { kind: 'heartbeat' });
    expect(p.systemPrompt).toContain('HEARTBEAT.md');
    expect(p.systemPrompt).not.toContain('PLATFORM.md');
    expect(p.systemPrompt.length).toBeLessThan(assemblePrompt(mem, { kind: 'user' }).systemPrompt.length);
  });

  it('profileGap lands in turnContext, not systemPrompt (mentorship Phase B) — same cache-stability rule as everything else per-turn', () => {
    const p1 = assemblePrompt(mem, { kind: 'user' });
    const p2 = assemblePrompt(mem, { kind: 'user', profileGap: 'still need: dietary constraints' });
    expect(p2.turnContext).toContain('still need: dietary constraints');
    expect(p2.systemPrompt).not.toContain('still need');
    expect(p1.systemPrompt).toBe(p2.systemPrompt);
  });

  it('ONBOARDING.md loads into turnContext only when the caller sets domainFiles for it — mirrors how gateway/app.ts pairs profileGap with domainFiles: ["ONBOARDING.md"]', () => {
    const withGap = assemblePrompt(mem, { kind: 'user', profileGap: 'still need: goals', domainFiles: ['ONBOARDING.md'] });
    expect(withGap.turnContext).toContain('ONBOARDING.md');
    expect(withGap.turnContext).toContain('bright-line test'); // real seed content, not just the filename tag

    const withoutGap = assemblePrompt(mem, { kind: 'user' });
    expect(withoutGap.turnContext).not.toContain('ONBOARDING.md');
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
    cabinet.db.prepare("INSERT INTO chat (id, kind) VALUES ('t1','user')").run();
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
    const res = await rt.run({ chatId: 't1', prompt: 'hi', kind: 'user', onEvent: (e) => events.push(e) });

    expect(res).toEqual({ stopReason: 'success', sessionId: 'sess-123' });
    expect(events.map((e) => e.type)).toEqual([
      'turn-start', 'text-delta', 'text-delta', 'tool-start', 'tool-end', 'turn-end',
    ]);
    // Appendix B invariants baked into the options:
    expect(seenOptions.allowedTools).toEqual([]); // no gated tools bare-listed
    expect(seenOptions.settingSources).toEqual([]);
    expect(typeof seenOptions.canUseTool).toBe('function');
    expect(seenOptions.hooks.PreToolUse).toBeTruthy();
    // Track 3.1: subagents are wired in, and design-reviewer is read-only.
    expect(seenOptions.agents).toBe(AGENTS);
    const reviewer = seenOptions.agents['design-reviewer'];
    expect(reviewer.model).toBe('sonnet');
    expect(reviewer.effort).toBe('high');
    expect(reviewer.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(reviewer.tools).not.toContain('Edit');
    expect(reviewer.tools).not.toContain('Write');
    expect(reviewer.tools).not.toContain('Bash');
    // session persisted
    const row = cabinet.db.prepare("SELECT sdk_session_id FROM chat WHERE id='t1'").get() as any;
    expect(row.sdk_session_id).toBe('sess-123');
    // usage recorded
    const usage = cabinet.db.prepare('SELECT model, input_tokens, cost_usd FROM token_usage').get() as any;
    expect(usage).toMatchObject({ input_tokens: 10, cost_usd: 0.001 });
  });

  it('systemPrompt is byte-stable across turns; per-turn context is wrapped into the message, not the system prompt', async () => {
    const seen: { systemPrompt: string; prompt: string }[] = [];
    const queryFn = ((args: any) => {
      seen.push({ systemPrompt: args.options.systemPrompt, prompt: args.prompt });
      const messages = happyScript(args.options.model);
      return (async function* () {
        for (const m of messages) yield m;
      })();
    }) as unknown as QueryFn;
    const rt = mkRuntime(queryFn);

    await rt.run({
      chatId: 't1', prompt: 'first', kind: 'user', onEvent: () => {},
      promptInput: { now: new Date('2026-01-01T00:00:00Z') },
    });
    await rt.run({
      chatId: 't1', prompt: 'second', kind: 'user', onEvent: () => {},
      promptInput: { now: new Date('2026-06-01T00:00:00Z') },
    });

    expect(seen).toHaveLength(2);
    // The core invariant: byte-identical systemPrompt across turns.
    expect(seen[0].systemPrompt).toBe(seen[1].systemPrompt);
    expect(seen[0].systemPrompt).not.toContain('Current datetime');
    // Per-turn data rides in the wrapped message instead.
    expect(seen[0].prompt).toContain('<turn-context>');
    expect(seen[0].prompt).toContain('2026-01-01');
    expect(seen[0].prompt).toContain('first');
    expect(seen[1].prompt).toContain('2026-06-01');
    expect(seen[0].prompt).not.toBe(seen[1].prompt);
  });

  it('§ vision spike: attaches images as an SDKUserMessage content array instead of a plain string prompt; a plain turn keeps the string', async () => {
    const seenPrompts: unknown[] = [];
    const queryFn = ((args: any) => {
      seenPrompts.push(args.prompt);
      const messages = happyScript(args.options.model);
      return (async function* () {
        for (const m of messages) yield m;
      })();
    }) as unknown as QueryFn;
    const rt = mkRuntime(queryFn);

    // No images — prompt stays the plain wrapped string, byte-for-byte the
    // same shape as before this feature existed.
    await rt.run({ chatId: 't1', prompt: 'plain turn', kind: 'user', onEvent: () => {} });
    expect(typeof seenPrompts[0]).toBe('string');

    // With images — prompt becomes a one-shot async iterable yielding a
    // single SDKUserMessage whose content is [text, ...images].
    await rt.run({
      chatId: 't1',
      prompt: 'what is this?',
      kind: 'user',
      onEvent: () => {},
      images: [{ mediaType: 'image/png', base64: 'QUJD' }],
    });
    const second = seenPrompts[1] as AsyncIterable<any>;
    expect(typeof second[Symbol.asyncIterator]).toBe('function');
    const collected: any[] = [];
    for await (const m of second) collected.push(m);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ type: 'user', parent_tool_use_id: null });
    expect(collected[0].message.role).toBe('user');
    expect(collected[0].message.content[0].type).toBe('text');
    expect(collected[0].message.content[0].text).toContain('what is this?');
    expect(collected[0].message.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
    });
  });

  it('resumes user turns with the stored session id, not scheduled turns', async () => {
    cabinet.db.prepare("UPDATE chat SET sdk_session_id = 'prev-sess' WHERE id='t1'").run();
    const resumes: (string | undefined)[] = [];
    const rt = mkRuntime(
      scriptedQuery((opts) => {
        resumes.push(opts.resume);
        return happyScript(opts.model);
      }),
    );
    await rt.run({ chatId: 't1', prompt: 'a', kind: 'user', onEvent: () => {} });
    await rt.run({ chatId: 't1', prompt: 'b', kind: 'heartbeat', onEvent: () => {} });
    expect(resumes).toEqual(['prev-sess', undefined]);
  });

  it('falls back to opus when fable refuses', async () => {
    cabinet.db.prepare("UPDATE chat SET model_override = 'fable' WHERE id='t1'").run();
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
    const res = await rt.run({ chatId: 't1', prompt: 'build it', kind: 'user', onEvent: (e) => events.push(e) });
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
      rt.run({ chatId: 't1', prompt: 'x', kind: 'user', onEvent: (e) => events.push(e) }),
    ).rejects.toThrow('boom 529');
    expect(events.at(-1)).toMatchObject({ type: 'error', retryable: true });
  });

  // -------------------------------------------------------------------------
  // Continuation-on-limit (build 3): a maxTurns cutoff on a user turn should
  // auto-resume the SDK session, bounded, with a legible checkpoint notice.
  // -------------------------------------------------------------------------
  describe('continuation-on-limit', () => {
    const cutoffMsg = (sessionId: string, numTurns: number, lastTool = 'Bash') => [
      { type: 'system', subtype: 'init', session_id: sessionId },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: lastTool, input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] } },
      { type: 'result', subtype: 'error_max_turns', result: '', num_turns: numTurns, usage: {} },
    ];

    it('a user cutoff triggers exactly one auto-continuation and resumes the session, incrementing depth', async () => {
      const resumes: (string | undefined)[] = [];
      let call = 0;
      const rt = mkRuntime(
        scriptedQuery((opts) => {
          resumes.push(opts.resume);
          call++;
          if (call === 1) return cutoffMsg('sess-1', 120);
          return happyScript(opts.model);
        }),
      );
      const events: TurnEvent[] = [];
      const res = await rt.run({ chatId: 't1', prompt: 'build the thing', kind: 'user', onEvent: (e) => events.push(e) });

      expect(call).toBe(2); // original + exactly one auto-continuation
      expect(resumes).toEqual([undefined, 'sess-1']); // 2nd call resumes the session captured from the 1st
      expect(res.stopReason).toBe('success');

      const notices = events.filter((e) => e.type === 'notice') as Extract<TurnEvent, { type: 'notice' }>[];
      expect(notices.some((n) => /auto-continuing \(1\/3\)/.test(n.text))).toBe(true);
      expect(notices.some((n) => /last action: Bash/.test(n.text))).toBe(true);
    });

    it('the depth cap pauses instead of continuing further', async () => {
      let call = 0;
      const rt = mkRuntime(
        scriptedQuery(() => {
          call++;
          // Distinct num_turns each round so the no-progress guard doesn't
          // fire first — we want to exercise the depth cap specifically.
          return cutoffMsg('sess-cap', 120 + call);
        }),
      );
      const events: TurnEvent[] = [];
      const res = await rt.run({ chatId: 't1', prompt: 'build a lot of things', kind: 'user', onEvent: (e) => events.push(e) });

      // original + MAX_AUTO_CONTINUATIONS continuations, then stop
      expect(call).toBe(1 + MAX_AUTO_CONTINUATIONS);
      expect(res.stopReason).toBe('error_max_turns');

      const notices = events.filter((e) => e.type === 'notice') as Extract<TurnEvent, { type: 'notice' }>[];
      expect(notices.filter((n) => /auto-continuing/.test(n.text))).toHaveLength(MAX_AUTO_CONTINUATIONS);
      expect(notices.some((n) => /auto-continue cap \(3\/3\)/.test(n.text) && /reply "continue"/.test(n.text))).toBe(true);
    });

    it('two consecutive continuations with no new session activity pause for a human even under the depth cap', async () => {
      let call = 0;
      const rt = mkRuntime(
        scriptedQuery(() => {
          call++;
          // Same num_turns every round — no progress at all.
          return cutoffMsg('sess-stuck', 120);
        }),
      );
      const events: TurnEvent[] = [];
      const res = await rt.run({ chatId: 't1', prompt: 'stuck task', kind: 'user', onEvent: (e) => events.push(e) });

      // original (no progress check yet) -> continuation 1 (equal to original,
      // streak=1, still continues) -> continuation 2 (equal again, streak=2,
      // pauses) = 3 calls total, well under the depth cap of 3 continuations.
      expect(call).toBe(3);
      expect(res.stopReason).toBe('error_max_turns');

      const notices = events.filter((e) => e.type === 'notice') as Extract<TurnEvent, { type: 'notice' }>[];
      expect(notices.some((n) => /no progress/.test(n.text) && /reply "continue"/.test(n.text))).toBe(true);
      // Never reached the depth-cap message — the no-progress guard fired first.
      expect(notices.some((n) => /auto-continue cap/.test(n.text))).toBe(false);
    });

    it('a non-user kind does NOT auto-continue on a maxTurns cutoff', async () => {
      let call = 0;
      const rt = mkRuntime(
        scriptedQuery(() => {
          call++;
          return cutoffMsg('sess-hb', 6);
        }),
      );
      const events: TurnEvent[] = [];
      const res = await rt.run({ chatId: 't1', prompt: 'heartbeat check', kind: 'heartbeat', onEvent: (e) => events.push(e) });

      expect(call).toBe(1); // no resume attempt
      expect(res.stopReason).toBe('error_max_turns');
      const notices = events.filter((e) => e.type === 'notice') as Extract<TurnEvent, { type: 'notice' }>[];
      expect(notices.some((n) => /not auto-continuing/.test(n.text))).toBe(true);
    });

    it('the cutoff notice is emitted via onEvent, the same path the gateway live-persists to the transcript', async () => {
      let call = 0;
      const rt = mkRuntime(
        scriptedQuery((opts) => {
          call++;
          if (call === 1) return cutoffMsg('sess-2', 120);
          return happyScript(opts.model);
        }),
      );
      const events: TurnEvent[] = [];
      await rt.run({ chatId: 't1', prompt: 'go', kind: 'user', onEvent: (e) => events.push(e) });
      // Ordering: the checkpoint notice for round 1 must appear before the
      // continuation's own turn-start/turn-end, i.e. it's not dropped or
      // reordered relative to the events the gateway persists live.
      const noticeIdx = events.findIndex((e) => e.type === 'notice' && /auto-continuing/.test((e as any).text));
      const secondTurnStartIdx = events.findIndex(
        (e, i) => e.type === 'turn-start' && i > 0, // the 2nd turn-start (continuation's)
      );
      expect(noticeIdx).toBeGreaterThanOrEqual(0);
      expect(secondTurnStartIdx).toBeGreaterThan(noticeIdx);
    });
  });
});
