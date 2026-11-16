// web_research: the sub-call that reads the web for Kevin, and the fact that nothing else does.
import { beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../src/db.js';
import { RESEARCH_CAP_USD } from '../src/core/index.js';
import { createThread, send } from '../src/threads.js';
import { FakeModel, text, toolUse } from './fake-model.js';
import { call, makeKevin, ok, view } from './helpers.js';

let model: FakeModel;
beforeEach(() => {
  model = new FakeModel();
});

const QUESTION = 'What is the 2026 contribution limit for a family HSA in the United States?';
const cited = (t: string, url: string, title: string) => ({ type: 'text', text: t, citations: [{ type: 'web_search_result_location', url, title, cited_text: 'x' }] });
const fetched = (url: string, title: string) => ({ type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_fetch_result', url, content: { type: 'document', title, source: { type: 'text', media_type: 'text/plain', data: 'page text' } } } });
const searched = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_0', content: [{ type: 'web_search_result', url: 'https://unrelated.example/listing', title: 'A result nobody opened' }] };

describe('web_research', () => {
  it('gives the sub-call the question and the web tools, and nothing of Ben\'s', async () => {
    const kevin = await makeKevin();
    await ok(kevin, 'remember', { text: 'The test owner collects box kites.' });
    await ok(kevin, 'profile_update', { section: 'Family', append: 'The test owner has a pen pal named Zephyrine.' });
    model.reply({ content: [cited('The family limit is $8,750.', 'https://tax.example/hsa-2026', 'HSA limits for 2026')] });
    const out = await ok<string>(kevin, 'web_research', { question: QUESTION });
    const req = model.requests[0]!;
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.messages).toEqual([{ role: 'user', content: QUESTION }]);
    expect(req.tools.map((t: any) => t.name).sort()).toEqual(['web_fetch', 'web_search']);
    expect(req.tools.every((t: any) => typeof t.max_uses === 'number')).toBe(true);
    const everything = JSON.stringify(req);
    for (const secret of ['box kites', 'Zephyrine', 'CREATE TABLE', 'profile_update', 'query']) expect(everything).not.toContain(secret);
    // What comes back is labelled as web material and carries its sources.
    expect(out).toMatch(/^Result of web research\. Everything below was written from web pages/);
    expect(out).toContain('The family limit is $8,750.');
    expect(out).toContain('- HSA limits for 2026: https://tax.example/hsa-2026');
    expect(out).toMatch(/\[research complete: 0 search\(es\), 1 source\(s\), \$0\.\d{3}\]$/);
  });

  it('lists the pages it opened or cited, once each, and not every search hit', async () => {
    const kevin = await makeKevin();
    model.reply({
      content: [
        searched,
        fetched('https://irs.example/rev-proc', 'Rev. Proc.   2025-19'),
        { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_2', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } },
        cited('Self-only is $4,400', 'https://irs.example/rev-proc', 'Rev. Proc. 2025-19'),
        cited(' and family is $8,750.', 'https://tax.example/hsa-2026', 'HSA limits for 2026'),
        { type: 'text', text: ' Done.', citations: [{ type: 'web_search_result_location', url: 'javascript:alert(1)', title: 'not a web page' }] },
      ],
      usage: { server_tool_use: { web_search_requests: 2 } },
    });
    const out = await ok<string>(kevin, 'web_research', { question: QUESTION });
    expect(out).toContain('Self-only is $4,400 and family is $8,750. Done.');
    expect(out).toContain('Sources (pages the research opened or cited):\n- Rev. Proc. 2025-19: https://irs.example/rev-proc\n- HSA limits for 2026: https://tax.example/hsa-2026\n\n');
    expect(out).not.toContain('unrelated.example');
    expect(out).not.toContain('javascript:');
    expect(out).toMatch(/2 search\(es\), 2 source\(s\)/);
    // The two searches are billed with the tokens.
    expect((await view(kevin, 'system/spend')).by_purpose).toMatchObject([{ purpose: 'research', requests: 1 }]);
    expect((kevin.db.prepare('SELECT web_searches, cost_usd FROM usage').get() as any)).toMatchObject({ web_searches: 2 });
  });

  it('says so when the answer names no source', async () => {
    const kevin = await makeKevin();
    model.reply({ content: [text('Probably $8,750.')] });
    expect(await ok<string>(kevin, 'web_research', { question: QUESTION })).toContain('Sources: no page was opened or cited, so treat this answer as unverified.');
  });

  it('continues a paused research call, and stops continuing once it has cost its cap', async () => {
    const kevin = await makeKevin();
    model.reply({ content: [fetched('https://irs.example/rev-proc', 'Rev. Proc.')], stop_reason: 'pause_turn' }, { content: [cited('Family is $8,750.', 'https://irs.example/rev-proc', 'Rev. Proc.')] });
    const out = await ok<string>(kevin, 'web_research', { question: QUESTION });
    expect(model.requests.length).toBe(2);
    expect(model.requests[1]!.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(out).toMatch(/research complete/);

    // Each paused reply here costs $0.30: 600,000 output tokens at the small model's $0.50 per million.
    model.requests = [];
    const pricey = { content: [text('Partial: the self-only limit is $4,400.')], stop_reason: 'pause_turn', usage: { input_tokens: 0, output_tokens: 600_000 } };
    model.reply(pricey, pricey, { content: [text('never requested')] });
    const cut = await ok<string>(kevin, 'web_research', { question: QUESTION });
    expect(model.requests.length).toBe(2); // $0.30, then $0.60 >= the cap: no third request
    expect(RESEARCH_CAP_USD).toBe(0.5);
    expect(cut).toContain('Partial: the self-only limit is $4,400.');
    expect(cut).toMatch(/research cut short at its cost or step limit; the answer may be partial/);
  });

  it('gives up after its request limit when the call never finishes', async () => {
    const kevin = await makeKevin();
    for (let i = 0; i < 10; i++) model.reply({ content: [], stop_reason: 'pause_turn' });
    const r = await call(kevin, 'web_research', { question: QUESTION });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/stopped before it produced an answer/);
    expect(model.requests.length).toBe(6);
  });

  it('does not run once the monthly cap is reached, and reports a refusal as an error', async () => {
    const kevin = await makeKevin();
    model.reply({ content: [], stop_reason: 'refusal' });
    expect((await call(kevin, 'web_research', { question: QUESTION })).text).toBe('The research model declined this question.');
    setSetting(kevin.db, 'monthly_cap_usd', 1);
    kevin.db.prepare("INSERT INTO usage (at, purpose, model, cost_usd) VALUES (?, 'turn', 'x', 1.5)").run(new Date().toISOString());
    const before = model.requests.length;
    expect((await call(kevin, 'web_research', { question: QUESTION })).text).toMatch(/spend cap is reached/);
    expect(model.requests.length).toBe(before);
  });

  it('is the main loop\'s only road to the web: research cost lands on the turn and the result returns as a tool result', async () => {
    const kevin = await makeKevin();
    const t = createThread(kevin, 'chat', 'Titled');
    model.reply(
      { content: [toolUse('r', 'web_research', { question: QUESTION })] }, // main loop
      { content: [cited('Family is $8,750.', 'https://irs.example/rev-proc', 'Rev. Proc.')], usage: { server_tool_use: { web_search_requests: 1 } } }, // sub-call
      { content: [text('The 2026 family HSA limit is $8,750 (irs.example).')] }, // main loop
    );
    const r = await send(kevin, t.id, { text: 'what is the family HSA limit for 2026?' });
    expect(r).toMatchObject({ status: 'done' });
    const [main1, sub, main2] = model.requests;
    for (const main of [main1!, main2!]) expect(main.tools.filter((x: any) => x.type || /^web_(search|fetch)$/.test(x.name))).toEqual([]);
    expect(sub!.system).not.toContain('CREATE TABLE');
    const result = main2!.messages.at(-1).content[0];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'r' });
    expect(result.content).toMatch(/^Result of web research\./);
    expect(result.content).toContain('https://irs.example/rev-proc');
    // Two main requests and the research request are all on the turn's bill.
    const rows = kevin.db.prepare('SELECT purpose, turn_id FROM usage ORDER BY id').all() as any[];
    expect(rows.map((u) => u.purpose)).toEqual(['turn', 'research', 'turn']);
    expect(new Set(rows.map((u) => u.turn_id)).size).toBe(1);
    expect(r!.costUsd).toBeGreaterThan(0.01); // includes the $0.01 search
  });
});
