import { describe, expect, it } from 'vitest';
import { mockApi } from '../src/lib/mock.js';
import { DOMAINS, type InstrumentSpec } from '../src/lib/contracts.js';

const KINDS = new Set(['dial', 'rule', 'ring', 'gauge', 'stat']);
const validInstrument = (i: InstrumentSpec) => KINDS.has(i.kind) && typeof i.label === 'string';

describe('mock CabinetApi — contract validity', () => {
  it('today() returns a briefing, attention items, and vitals as instruments', async () => {
    const t = await mockApi.today();
    expect(t.greeting).toContain('Ben');
    expect(t.attention.length).toBeGreaterThan(0);
    expect(t.attention.every((a) => a.actions.length > 0 && (a.severity === 'warn' || a.severity === 'crit'))).toBe(true);
    expect(t.vitals.length).toBeGreaterThan(0);
    expect(t.vitals.every(validInstrument)).toBe(true);
  });

  it('domain() returns instruments + narrative + log for every domain', async () => {
    for (const d of DOMAINS) {
      const v = await mockApi.domain(d.id);
      expect(v.id).toBe(d.id);
      expect(v.label).toBe(d.label);
      expect(v.narrative.length).toBeGreaterThan(20);
      expect(v.instruments.every(validInstrument)).toBe(true);
      expect(Array.isArray(v.log)).toBe(true);
    }
  });

  it('ops() returns typed entries and honors the kind filter', async () => {
    const all = await mockApi.ops();
    expect(all.entries.length).toBeGreaterThan(0);
    expect(all.entries.every((e) => typeof e.reversible === 'boolean' && typeof e.tier === 'number')).toBe(true);
    const cron = await mockApi.ops({ kind: 'cron' });
    expect(cron.entries.every((e) => e.kind === 'cron')).toBe(true);
  });

  it('memory() returns editable files and lessons', async () => {
    const m = await mockApi.memory();
    expect(m.files.some((f) => f.name === 'SOUL.md')).toBe(true);
    expect(m.files.every((f) => typeof f.editable === 'boolean')).toBe(true);
    expect(m.lessons.every((l) => l.confidence >= 0 && l.confidence <= 1)).toBe(true);
  });

  it('recall() echoes the query and returns scored, sourced results', async () => {
    const r = await mockApi.recall('breakfast');
    expect(r.query).toBe('breakfast');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((x) => typeof x.score === 'number' && x.provenance.length > 0)).toBe(true);
  });

  it('chats() + messages() are shaped for the archive', async () => {
    const { chats } = await mockApi.chats();
    expect(chats[0]?.title).toBeTruthy();
    const { messages } = await mockApi.messages(chats[0]!.id);
    expect(messages.every((m) => m.parts.length > 0)).toBe(true);
  });

  it('health() carries presence for the strip', async () => {
    const h = await mockApi.health();
    expect(['idle', 'working', 'thinking', 'offline']).toContain(h.presence);
  });
});
