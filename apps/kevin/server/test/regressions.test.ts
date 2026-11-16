// Smaller defects found while reviewing the agent loop and the gateway, each pinned by a test.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../src/bus.js';
import { config } from '../src/config.js';
import { runtime } from '../src/core/index.js';
import { createHttp } from '../src/http.js';
import { JobRunner } from '../src/jobs.js';
import { buildStableSystem } from '../src/prompt.js';
import { createThread, isRunning, send } from '../src/threads.js';
import { FakeModel, text, toolUse } from './fake-model.js';
import { makeKevin, ok } from './helpers.js';

let model: FakeModel;
beforeEach(() => {
  model = new FakeModel();
  bus.removeAllListeners('event');
});
afterEach(() => {
  runtime.runner = null;
});
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('running a schedule by hand from a conversation', () => {
  it('does not wait for an agent turn that is queued behind the very turn asking for it', async () => {
    const kevin = await makeKevin();
    runtime.runner = new JobRunner(kevin, []);
    const s = await ok(kevin, 'schedule_create', { name: 'Weekly plan', trigger_type: 'cron', trigger_value: '0 18 * * 0', action: 'agent_turn', prompt: 'Plan the week.' });
    // The schedule already has its conversation, and Ben is talking in it.
    const t = createThread(kevin, 'job', 'Weekly plan');
    kevin.db.prepare('UPDATE schedules SET payload = ? WHERE id = ?').run(JSON.stringify({ prompt: 'Plan the week.', thread_id: t.id }), s.id);
    const before = kevin.db.prepare('SELECT next_run_at, enabled FROM schedules WHERE id = ?').get(s.id);
    model.reply(
      { content: [toolUse('j', 'job_control', { job_key: `schedule:${s.id}`, action: 'run_now' })] },
      { content: [text('Started it.')] },
      { content: [text('Planned.')] }, // the scheduled turn, once Ben's turn is out of the way
    );
    const r = await Promise.race([send(kevin, t.id, { text: 'run the weekly plan now' }), settle(3000).then(() => 'deadlock' as const)]);
    expect(r).toMatchObject({ status: 'done', text: 'Started it.' });
    expect(JSON.stringify(model.requests[1]!.messages.at(-1))).toContain('Started in its own conversation');
    for (let i = 0; i < 100 && (isRunning(t.id) || model.requests.length < 3); i++) await settle(10);
    const turns = kevin.db.prepare('SELECT origin, status FROM turns WHERE thread_id = ? ORDER BY id').all(t.id);
    expect(turns).toEqual([{ origin: 'chat', status: 'done' }, { origin: 'job', status: 'done' }]);
    await settle();
    expect((await ok(kevin, 'job_status', { job_key: `schedule:${s.id}` })).runs[0]).toMatchObject({ outcome: 'did-work' });
    // Fired by hand: the timetable is as it was.
    expect(kevin.db.prepare('SELECT next_run_at, enabled FROM schedules WHERE id = ?').get(s.id)).toEqual(before);
  });

  it('still waits and reports the outcome when Ben runs it from the Jobs page', async () => {
    const kevin = await makeKevin();
    runtime.runner = new JobRunner(kevin, []);
    const s = await ok(kevin, 'schedule_create', { name: 'Weekly plan', trigger_type: 'cron', trigger_value: '0 18 * * 0', action: 'agent_turn', prompt: 'Plan the week.' });
    model.reply({ content: [text('Planned.')] }, { content: [text('T')] });
    const r = await kevin.tools.call('job_control', { job_key: `schedule:${s.id}`, action: 'run_now' }, { db: kevin.db, source: 'ui', confirm: async () => true });
    expect(r.value).toMatchObject({ outcome: 'did-work', detail: 'Planned.' });
    await settle();
  });
});

describe('a schedule whose stored trigger no longer parses', () => {
  it('is switched off and the reason is logged', async () => {
    const kevin = await makeKevin();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const runner = new JobRunner(kevin, []);
      kevin.db.prepare("INSERT INTO schedules (name, trigger_type, trigger_value, action, payload, next_run_at, created_at, created_by) VALUES ('odd', 'cron', 'not a cron', 'notify', ?, ?, ?, 'kevin')")
        .run(JSON.stringify({ title: 'Odd' }), new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
      await runner.tick(new Date());
      expect(kevin.db.prepare('SELECT enabled, next_run_at FROM schedules').get()).toEqual({ enabled: 0, next_run_at: null });
      expect(errors.mock.calls.some((c: unknown[]) => String(c[0]).includes('unusable trigger'))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('the prompt', () => {
  it('logs a workspace file it cannot read instead of quietly leaving it out', async () => {
    const kevin = await makeKevin();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const real = config.workspaceDir;
    config.workspaceDir = '/nonexistent/workspace';
    try {
      expect(buildStableSystem(kevin.db, [])).not.toContain('You are Kevin');
      expect(errors.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual(['workspace file persona.md could not be read', 'workspace file rules.md could not be read']);
    } finally {
      config.workspaceDir = real;
      errors.mockRestore();
    }
    expect(buildStableSystem(kevin.db, [])).toContain('You are Kevin');
    // The rules name the web tool that exists, and none that do not.
    expect(buildStableSystem(kevin.db, [])).toContain('`web_research`');
    expect(buildStableSystem(kevin.db, [])).not.toMatch(/`web_search`|`web_fetch`/);
  });
});

describe('uploads', () => {
  let app: Server;
  afterEach(() => app?.close());

  it('accepts a file whose name has a percent sign or other characters that need encoding', async () => {
    const kevin = await makeKevin();
    app = createServer(createHttp(kevin));
    const base = await new Promise<string>((resolve) => app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(app.address() as AddressInfo).port}`)));
    for (const name of ['savings 50% off.txt', 'résumé & notes (v2).txt', '100%.txt']) {
      const r = await fetch(`${base}/api/uploads?filename=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-Kevin': '1', 'Content-Type': 'text/plain' }, body: 'hello' });
      expect(r.status, name).toBe(200);
      expect((await r.json()).extract_status).toBe('done');
    }
    const no = await fetch(`${base}/api/uploads`, { method: 'POST', headers: { 'X-Kevin': '1', 'Content-Type': 'text/plain' }, body: 'hello' });
    expect((await no.json()).filename).toBe('upload');
  });
});
