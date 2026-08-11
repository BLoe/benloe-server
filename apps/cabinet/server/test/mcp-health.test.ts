import { describe, expect, it } from 'vitest';

import { describeTransition, readMcpStatus } from '../src/runtime/mcpHealth.js';

const init = (over: Record<string, unknown> = {}) => ({
  tools: ['Read', 'Bash', 'mcp__cabinet__log_food', 'mcp__cabinet__query_db', 'mcp__other__thing'],
  mcp_servers: [{ name: 'cabinet', status: 'connected' }],
  ...over,
});

describe('readMcpStatus', () => {
  it('counts only this server’s tools', () => {
    const s = readMcpStatus(init());
    expect(s.toolCount).toBe(2);
    expect(s.serverStatus).toBe('connected');
    expect(s.healthy).toBe(true);
  });

  it('is unhealthy when the toolset is absent — the 2026-08-08 shape', () => {
    // The incident: the server was registered but the model had no cabinet
    // tools for one turn, and nothing recorded it.
    const s = readMcpStatus(init({ tools: ['Read', 'Bash'] }));
    expect(s.toolCount).toBe(0);
    expect(s.healthy).toBe(false);
  });

  it('is unhealthy when the server reports a non-connected status', () => {
    expect(readMcpStatus(init({ mcp_servers: [{ name: 'cabinet', status: 'failed' }] })).healthy).toBe(false);
  });

  it('tolerates a missing or malformed init message rather than throwing', () => {
    // This runs inside the SDK message loop; a throw here would kill the turn.
    for (const msg of [{}, { tools: null }, { mcp_servers: 'nope' }, { tools: [1, 2] }]) {
      expect(() => readMcpStatus(msg as never)).not.toThrow();
    }
    expect(readMcpStatus({}).healthy).toBe(false);
  });

  it('does not report the server absent as unhealthy when tools are present', () => {
    // Some SDK paths omit mcp_servers; the toolset is the load-bearing signal.
    expect(readMcpStatus(init({ mcp_servers: undefined })).healthy).toBe(true);
  });
});

describe('describeTransition', () => {
  const healthy = { serverStatus: 'connected', toolCount: 62, healthy: true };
  const broken = { serverStatus: 'connected', toolCount: 0, healthy: false };

  it('says nothing on a steady healthy turn', () => {
    expect(describeTransition(healthy, healthy)).toBeNull();
    expect(describeTransition(null, healthy)).toBeNull();
  });

  it('warns on every unhealthy turn, not only the first', () => {
    // An outage that persists must stay visible; reporting once and going
    // quiet is how the original incident stayed invisible.
    expect(describeTransition(healthy, broken)).toMatch(/UNAVAILABLE/);
    expect(describeTransition(broken, broken)).toMatch(/UNAVAILABLE/);
  });

  it('names the consequence, not just the state', () => {
    // Someone reading this line at 2am needs to know what it cost.
    expect(describeTransition(healthy, broken)).toMatch(/writes .* may not exist/);
  });

  it('reports recovery so the outage has a closing bracket', () => {
    expect(describeTransition(broken, healthy)).toMatch(/recovered/);
  });

  it('notes a tool-count change, which is how a partial registration shows up', () => {
    expect(describeTransition(healthy, { ...healthy, toolCount: 61 })).toMatch(/62 → 61/);
  });
});
