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
    expect(all.entries.every((e) => typeof e.reversible === 'boolean' && typeof e.kind === 'string')).toBe(true);
    const cron = await mockApi.ops({ kind: 'cron' });
    expect(cron.entries.every((e) => e.kind === 'cron')).toBe(true);
  });

  it('memory() returns editable files and lessons', async () => {
    const m = await mockApi.memory();
    // SOUL.md is gone — CHARTER.md replaced it (server/src/memory/index.ts).
    expect(m.files.some((f) => f.name === 'CHARTER.md')).toBe(true);
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

  /* The money mock exists to exercise the states the surface must never get
     wrong, so the assertions are about those states rather than about volume:
     a broken item, a partial net worth, a pending row, and both signs. */
  it('plaidStatus() exercises the unhappy states the Money surface must render', async () => {
    const s = await mockApi.plaidStatus();
    expect(['sandbox', 'production']).toContain(s.environment);
    expect(s.redirect_uri).toContain('/plaid/oauth');
    expect(s.webhook_url).toContain('/api/plaid/webhook');
    // exactly one broken connection, so the Reconnect affordance has a subject
    expect(s.items.filter((i) => i.status === 'login_required').length).toBe(1);
    expect(s.items.some((i) => i.status === 'active')).toBe(true);
    // counted < total, so the partial-total caveat renders in dev
    expect(s.net_worth.accounts_counted).toBeLessThan(s.net_worth.accounts_total);
    expect(s.net_worth.stalest_balance_at).toBeTruthy();
    // net_worth is already cash + investments − credit − loans
    const nw = s.net_worth;
    expect(nw.net_worth).toBeCloseTo(nw.cash + nw.investments - nw.credit - nw.loans, 2);
    // and the accounts that dropped out are the ones with no balance
    expect(s.accounts.filter((a) => a.current_balance === null).length).toBe(nw.accounts_total - nw.accounts_counted);
  });

  it('moneyTransactions() carries a pending row and both sign conventions', async () => {
    const { transactions } = await mockApi.moneyTransactions();
    expect(transactions.some((t) => t.pending === 1)).toBe(true);
    expect(transactions.some((t) => t.amount > 0)).toBe(true); // spent
    expect(transactions.some((t) => t.amount < 0)).toBe(true); // received
    expect(transactions.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date))).toBe(true);
  });

  it('moneyCategories() reports positive dollars out', async () => {
    const { categories } = await mockApi.moneyCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.every((c) => c.spent > 0 && c.txns > 0)).toBe(true);
  });

  it('moneySummary() surfaces what is broken, not just what is fine', async () => {
    const m = await mockApi.moneySummary();
    expect(m.linked_institutions).toBeGreaterThan(0);
    expect(m.needs_attention.length).toBeGreaterThan(0);
    expect(m.total_spent).toBeGreaterThan(0);
  });

  it('moneyHoldings() is empty until an investment item syncs', async () => {
    const { holdings } = await mockApi.moneyHoldings();
    expect(Array.isArray(holdings)).toBe(true);
  });

  /* The credentials mock, like the money one, is built out of the states the
     surface must render rather than out of a tidy happy path — and it must
     never carry a secret value, because no response shape has a field for
     one. Both are asserted here. */
  it('credentials() exercises filled, missing, managed and unrecognised at once', async () => {
    const c = await mockApi.credentials();
    expect(c.slots.some((s) => s.stored)).toBe(true);
    expect(c.slots.some((s) => !s.stored && s.required)).toBe(true);
    expect(c.managed.every((m) => m.name.startsWith('plaid-item-'))).toBe(true);
    expect(c.unrecognised.length).toBeGreaterThan(0);
    // no stored name appears in two buckets at once
    const managedNames = new Set(c.managed.map((m) => m.name));
    expect(c.unrecognised.some((u) => managedNames.has(u.name))).toBe(false);
    // env reports a value only for the non-secret config var
    expect(c.env.find((e) => e.name === 'PLAID_ENV')?.value).toBe('sandbox');
    expect(c.env.filter((e) => e.scrubbed).every((e) => e.value === null)).toBe(true);
    // and nothing anywhere in the payload looks like a secret value
    expect(JSON.stringify(c)).not.toMatch(/"secret":|"value":"(?!sandbox|https)/);
  });

  it('saveCredential() returns metadata only, and distinguishes a rotate from a create', async () => {
    const created = await mockApi.saveCredential({ name: 'brand-new-key', secret: 'sk_live_dontkeepthis' });
    expect(created.created).toBe(true);
    expect(JSON.stringify(created)).not.toContain('sk_live_dontkeepthis');
    const rotated = await mockApi.saveCredential({ name: 'brand-new-key', secret: 'sk_live_second' });
    expect(rotated.created).toBe(false);
    expect(rotated.credential.rotated_at).toBeTruthy();
    expect((await mockApi.deleteCredential('brand-new-key')).deleted).toBe('brand-new-key');
  });

  it('plaid mutations echo what they changed', async () => {
    expect((await mockApi.plaidUnlinkItem(7)).deleted).toBe(7);
    expect(await mockApi.plaidSetAccountHidden(11, true)).toMatchObject({ id: 11, hidden: true });
    const sync = await mockApi.plaidSync();
    expect(sync.reports.length).toBeGreaterThan(0);
    expect(sync.reports.some((r) => !r.ok)).toBe(true);
  });
});
