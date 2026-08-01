import { describe, expect, it } from 'vitest';
import { SessionPool, specKey, type SessionSpec } from '../src/runtime/session.js';
import type { QueryFn } from '../src/runtime/agent.js';
import { classifyMessage, effortForRegister, nextRegister } from '../src/runtime/register.js';

const SPEC: SessionSpec = { model: 'claude-opus-5', effort: 'high', systemPrompt: 'core', cwd: '/srv', maxTurns: 120 };

/**
 * A fake CLI that behaves like the real one under streaming input: it holds
 * the input stream open, and answers each user message with an init + result
 * pair. `spawns` counts subprocesses, which is the entire point of the pool.
 */
function fakeCli(opts: { onSpawn?: (options: any) => void; resultFor?: (n: number) => Record<string, any> } = {}) {
  const state = { spawns: 0, seen: [] as string[], options: [] as any[] };
  const queryFn = ((args: any) => {
    state.spawns++;
    state.options.push(args.options);
    opts.onSpawn?.(args.options);
    let n = 0;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const user of args.prompt as AsyncIterable<any>) {
          n++;
          state.seen.push(user.message.content.map((b: any) => b.text ?? '').join(''));
          yield { type: 'system', subtype: 'init', session_id: `s${state.spawns}` };
          yield opts.resultFor?.(n) ?? { type: 'result', subtype: 'success', num_turns: n, usage: {} };
        }
      },
      interrupt: async () => undefined,
      getContextUsage: async () => ({}),
    };
  }) as unknown as QueryFn;
  return { queryFn, state };
}

function runArgs(pool: SessionPool, text: string, over: Partial<Parameters<SessionPool['runTurn']>[0]> = {}) {
  const seen: Record<string, any>[] = [];
  const p = pool.runTurn({
    key: 'user:t1',
    spec: SPEC,
    buildOptions: () => ({ model: SPEC.model }),
    message: { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null } as never,
    onMessage: (m) => seen.push(m),
    ...over,
  });
  return { p, seen };
}

describe('SessionPool', () => {
  it('reuses one subprocess across turns — the whole point', async () => {
    const { queryFn, state } = fakeCli();
    const pool = new SessionPool({ queryFn });

    const first = await runArgs(pool, 'one').p;
    const second = await runArgs(pool, 'two').p;
    const third = await runArgs(pool, 'three').p;

    expect(state.spawns).toBe(1);
    expect(first.spawned).toBe(true);
    expect(second.spawned).toBe(false);
    expect(third.spawned).toBe(false);
    expect(state.seen).toEqual(['one', 'two', 'three']);
    await pool.closeAll();
  });

  it('each turn only sees its own messages', async () => {
    const { queryFn } = fakeCli();
    const pool = new SessionPool({ queryFn });
    const a = runArgs(pool, 'one');
    await a.p;
    const b = runArgs(pool, 'two');
    await b.p;
    expect(a.seen.filter((m) => m.type === 'result')).toHaveLength(1);
    expect(b.seen.filter((m) => m.type === 'result')).toHaveLength(1);
    pool.closeAll();
  });

  it('respawns when the spec changes — options are fixed at spawn, so a stale session would run under stale settings', async () => {
    const { queryFn, state } = fakeCli();
    const pool = new SessionPool({ queryFn });
    await runArgs(pool, 'desk').p;
    // Effort moves (register flipped): the live subprocess cannot serve it.
    await runArgs(pool, 'counsel', { spec: { ...SPEC, effort: 'medium' } }).p;
    expect(state.spawns).toBe(2);
    pool.closeAll();
  });

  it('recycles a session before its cumulative num_turns reaches maxTurns', async () => {
    // maxTurns is enforced by the CLI against the SESSION, not the turn, so a
    // long-lived session must be retired before a turn inherits an exhausted
    // budget and dies on its second tool call.
    let n = 0;
    const { queryFn, state } = fakeCli({ resultFor: () => ({ type: 'result', subtype: 'success', num_turns: (n += 40), usage: {} }) });
    const pool = new SessionPool({ queryFn });
    await runArgs(pool, 'a').p; // session reports 40 turns used
    await runArgs(pool, 'b').p; // 80 — still leaves 40, more than the headroom
    await runArgs(pool, 'c').p; // 120 — now at the ceiling
    expect(state.spawns).toBe(1);
    // The NEXT turn would start with no budget at all, so it gets a fresh one.
    await runArgs(pool, 'd').p;
    expect(state.spawns).toBe(2);
    pool.closeAll();
  });

  it('ephemeral turns close their session immediately (scheduled work holds no subprocess)', async () => {
    const { queryFn, state } = fakeCli();
    const pool = new SessionPool({ queryFn });
    await runArgs(pool, 'cron a', { ephemeral: true }).p;
    expect(pool.size).toBe(0);
    await runArgs(pool, 'cron b', { ephemeral: true }).p;
    expect(state.spawns).toBe(2);
  });

  it('reaps idle sessions', async () => {
    let now = 1_000_000;
    const { queryFn, state } = fakeCli();
    const pool = new SessionPool({ queryFn, idleMs: 60_000, now: () => now });
    await runArgs(pool, 'a').p;
    expect(pool.size).toBe(1);
    now += 61_000;
    await runArgs(pool, 'b').p;
    expect(state.spawns).toBe(2);
    pool.closeAll();
  });

  it('caps live sessions, evicting the least recently used', async () => {
    let now = 1_000;
    const { queryFn } = fakeCli();
    const pool = new SessionPool({ queryFn, maxSessions: 2, now: () => now });
    for (const key of ['user:a', 'user:b', 'user:c']) {
      now += 1_000;
      await runArgs(pool, key, { key }).p;
    }
    expect(pool.size).toBe(2);
    expect(pool.stats().map((s) => s.key).sort()).toEqual(['user:b', 'user:c']);
    pool.closeAll();
  });

  it('a dead session does not strand the next turn — it just respawns', async () => {
    // The CLI stream ending is the pre-pool behavior; pooling must never turn
    // it into a stuck turn.
    const queryFn = ((args: any) =>
      (async function* () {
        for await (const _user of args.prompt as AsyncIterable<any>) {
          yield { type: 'result', subtype: 'success', num_turns: 1, usage: {} };
          return; // stream closes after one turn
        }
      })()) as unknown as QueryFn;
    const pool = new SessionPool({ queryFn });
    await expect(runArgs(pool, 'one').p).resolves.toMatchObject({ spawned: true });
    await expect(runArgs(pool, 'two').p).resolves.toMatchObject({ spawned: true });
    pool.closeAll();
  });

  it('specKey notices a systemPrompt edit', () => {
    expect(specKey(SPEC)).toBe(specKey({ ...SPEC }));
    expect(specKey(SPEC)).not.toBe(specKey({ ...SPEC, systemPrompt: 'core.' }));
    expect(specKey(SPEC)).not.toBe(specKey({ ...SPEC, effort: 'medium' }));
  });
});

describe('register detection', () => {
  it.each([
    '278.4',
    '278.4 lb',
    'logged 2 miles',
    'had eggs and toast',
    'ate a banana',
    "what's my weight trend",
    'yes',
    'done',
  ])('reads %j as desk', (text) => {
    expect(classifyMessage(text)?.register).toBe('desk');
  });

  it.each([
    'help me plan tomorrow evening',
    'why did this week go badly',
    'should i push the studio yoga to next month',
    "i'm struggling with the evenings again",
    'what do you think about the calorie target',
    "i've been thinking about whether the trainer schedule still makes sense given how the ankle has been feeling lately",
  ])('reads %j as counsel', (text) => {
    expect(classifyMessage(text)?.register).toBe('counsel');
  });

  it('leaves genuinely ambiguous messages unclassified rather than guessing', () => {
    expect(classifyMessage('hmm')).toBeNull();
    expect(classifyMessage('the salmon one')).toBeNull();
  });

  it('is sticky: an unrecognized message never moves the chat off its register', () => {
    expect(nextRegister({ register: 'desk', deskStreak: 2 }, 'hmm').register).toBe('desk');
    expect(nextRegister({ register: 'counsel', deskStreak: 0 }, 'hmm').register).toBe('counsel');
  });

  it('entering desk takes a STREAK; one stray log in a planning chat does not downgrade it', () => {
    // The failure this exists to prevent, observed live 2026-08-01: switching
    // on every unambiguous message flipped the register (and respawned the
    // subprocess) on all three turns of a real session.
    const s0 = { register: 'counsel' as const, deskStreak: 0 };
    const s1 = nextRegister(s0, '278.4');
    expect(s1).toEqual({ register: 'counsel', deskStreak: 1 }); // not yet
    const s2 = nextRegister(s1, '279.0');
    expect(s2).toEqual({ register: 'desk', deskStreak: 2 }); // settled
    const s3 = nextRegister(s2, 'had eggs');
    expect(s3.register).toBe('desk');
  });

  it('leaving desk takes ONE counsel signal, and resets the streak', () => {
    const desk = { register: 'desk' as const, deskStreak: 5 };
    expect(nextRegister(desk, 'why is the trend flat?')).toEqual({ register: 'counsel', deskStreak: 0 });
  });

  it('defaults to counsel, never desk — shallow-when-it-mattered is the costly failure', () => {
    expect(nextRegister({ register: null, deskStreak: 0 }, 'hmm').register).toBe('counsel');
    expect(nextRegister({ register: null, deskStreak: 0 }, '').register).toBe('counsel');
    // Even a first message that reads as desk keeps the safe default.
    expect(nextRegister({ register: null, deskStreak: 0 }, '278.4').register).toBe('counsel');
  });

  it('a counsel marker beats a desk shape even in a short message', () => {
    // Starts with a desk verb, but "should i" is the giveaway.
    expect(classifyMessage('log it — or should i wait until tomorrow?')?.register).toBe('counsel');
  });

  it('only desk gets a reduced effort; counsel keeps the routed value', () => {
    expect(effortForRegister('counsel', 'high')).toBe('high');
    expect(effortForRegister('desk', 'high')).toBe('medium');
    expect(effortForRegister('counsel', 'xhigh')).toBe('xhigh');
  });
});
