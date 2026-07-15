import type {
  CabinetApi, TodayView, DomainId, DomainView, OpsFeed, MemoryView, RecallResponse, HealthInfo, ChatSummary, ChatMessage, InstrumentSpec,
  UsageView, UsageRollingView,
} from './contracts.js';

/* Deterministic mock data in Cabinet's voice — lets Movement 2 surfaces build
   and be verified before the real endpoints (A11) exist. Same interface. */

const weight = [178.9, 178.7, 179.0, 178.6, 178.5, 178.6, 178.4];
const cash = [18, 16, 17, 10, 12, 6];

const vitals: InstrumentSpec[] = [
  { kind: 'dial', label: 'Nutrition · today', tag: 'on track', value: 142, max: 185, unit: '/ 185 g protein', sub: '1,840 / 2,300 kcal · 3 meals' },
  { kind: 'rule', label: 'Weight · 7-day', tag: '−0.6', readout: '178.4', unit: 'lb', points: weight, markerPct: 41 },
  { kind: 'ring', label: 'Tasks · due', tag: '3 today', tagTone: 'warn', value: 3, max: 11, center: '3', sub: '2 overdue' },
  { kind: 'stat', label: 'Cash · month', tag: '+ flow', big: '+$1,240', tone: 'ok', sub: 'in $6,180 · out $4,940', points: cash, pointsColor: 'var(--patina)' },
];

const today: TodayView = {
  greeting: 'Good morning, Ben.',
  greetingAccent: 'A quiet day',
  read: 'Protein three mornings straight and weight still drifting down — you’re set up well. The only real items are a refill that runs out Saturday and dining running hot with a week left in the cycle. Training’s on the board for today.',
  attention: [
    { id: 'att-1', severity: 'crit', badge: '℞', title: 'Metformin runs out Saturday', meta: '4 days · 2×/day',
      detail: 'Eight tablets left. I can reorder from the pharmacy on your July plan and have it before you’re dry.',
      actions: [{ label: 'Reorder now', intent: 'reorder metformin', primary: true }, { label: 'Snooze', intent: 'snooze metformin refill' }] },
    { id: 'att-2', severity: 'warn', badge: '△', title: 'Dining budget at 92%', meta: '$46 left · 8 days',
      detail: 'At this pace you’ll finish about $70 over, like the last two months. Hold the line or raise the envelope?',
      actions: [{ label: 'Review spend', intent: 'review dining spend' }, { label: 'Let it ride', intent: 'raise dining budget' }] },
  ],
  vitals,
  overnight: { count: 3, summary: 'backed up your data, indexed 2 journal entries, titled a chat' },
  sweptAt: '2026-07-08T06:06:00-04:00',
  briefing: {
    at: '2026-07-08T10:32:00.000Z',
    isCurrent: true,
    narrative: 'Protein three mornings straight and weight still drifting down — you’re set up well. The only real items are a refill that runs out Saturday and dining running hot with a week left in the cycle.',
  },
  checkin: {
    at: '2026-07-08T00:32:00.000Z',
    isCurrent: true,
    vitals: [{ kind: 'stat', label: 'Protein · tonight', big: '162', unit: 'g', sub: '2,180 kcal · 4 meals' }],
    prompt: 'How was today? Tap mood / energy / stress.',
  },
};

const DOMAIN_DATA: Record<DomainId, DomainView> = {
  nutrition: { id: 'nutrition', label: 'Nutrition',
    instruments: [
      { kind: 'dial', label: 'Protein · today', tag: 'on track', value: 142, max: 185, unit: '/ 185 g', sub: '77% of target' },
      { kind: 'gauge', label: 'Calories · today', value: 1840, max: 2300, leftLabel: '80%', rightLabel: '460 left' },
      { kind: 'rule', label: 'Weight · 30-day', readout: '178.4', unit: 'lb', points: weight, markerPct: 38 },
    ],
    narrative: 'Solid week. You’ve cleared 180 g protein four of the last seven days and the two you missed were both rest days — no harm there. Calories are trending just under maintenance, which is why the scale keeps easing down. Keep breakfast where it is; it’s doing the heavy lifting.',
    log: [
      { id: 'n1', at: '08:10', text: '3 eggs, 2 toast, black coffee', meta: '~34 g protein · 410 kcal' },
      { id: 'n2', at: '12:40', text: 'Chicken burrito bowl', meta: '~48 g · 720 kcal' },
      { id: 'n3', at: '19:05', text: 'Salmon, rice, broccoli', meta: '~40 g · 610 kcal' },
    ] },
  training: { id: 'training', label: 'Training',
    instruments: [
      { kind: 'ring', label: 'Sessions · week', tag: '3 / 4', value: 3, max: 4, center: '3' },
      { kind: 'stat', label: 'Last lift', big: 'Push', sub: 'Tue · 52 min · 8 sets' },
    ],
    narrative: 'Three sessions in, one to go for the week. Bench moved — 5 lb on the top set with the same bar speed, so it’s real. Legs are lagging the split; if today’s open, make it lower.',
    log: [ { id: 't1', at: 'Tue', text: 'Push — bench, OHP, dips', meta: '8 sets · 52 min' }, { id: 't2', at: 'Sun', text: 'Pull — rows, chins', meta: '9 sets' } ] },
  health: { id: 'health', label: 'Health',
    instruments: [
      { kind: 'stat', label: 'Meds', big: '1', unit: 'refill due', tone: 'crit', sub: 'Metformin · Saturday' },
      { kind: 'stat', label: 'Claims', big: '$0', sub: 'nothing pending' },
    ],
    narrative: 'One thing that matters: the metformin refill runs out Saturday and I can handle it on your say-so. Labs from June are all in range; the A1c ticked down 0.2. No open claims against your HSA plan.',
    log: [ { id: 'h1', at: 'Jun 28', text: 'Lab panel — A1c 5.4, lipids normal', meta: 'trended' } ] },
  money: { id: 'money', label: 'Money',
    instruments: [
      { kind: 'stat', label: 'Net · month', big: '+$1,240', tone: 'ok', points: cash, pointsColor: 'var(--patina)' },
      { kind: 'gauge', label: 'Dining', value: 454, max: 500, threshold: 0.9, leftLabel: '92%', rightLabel: '$46 left' },
      { kind: 'gauge', label: 'Groceries', value: 210, max: 400, leftLabel: '53%', rightLabel: '$190 left' },
    ],
    narrative: 'Cash flow is positive by about twelve hundred. Dining is the one line running hot — 92% with eight days left, and you’ve finished over the last two months. Two subscriptions renew this week ($34 total); both still earn their keep.',
    log: [ { id: 'm1', at: 'Today', text: 'Whole Foods', meta: '−$63.40 · groceries' }, { id: 'm2', at: 'Mon', text: 'Salary', meta: '+$3,090' } ] },
  admin: { id: 'admin', label: 'Admin',
    instruments: [ { kind: 'ring', label: 'Tasks · open', tag: '2 overdue', tagTone: 'warn', value: 3, max: 11, center: '11', sub: '3 due today' } ],
    narrative: 'Eleven open, three due today, two already overdue — the car registration is the one that bites if it slips much further. I’ve drafted the renewal steps; say go and I’ll start it.',
    log: [ { id: 'a1', at: 'Overdue', text: 'Renew car registration', meta: 'due Jul 3' }, { id: 'a2', at: 'Today', text: 'Reply to landlord re: lease', meta: '' } ] },
  people: { id: 'people', label: 'People',
    instruments: [ { kind: 'stat', label: 'Overdue touchpoints', big: '2', tone: 'warn', sub: 'Dave · Mom' } ],
    narrative: 'You haven’t spoken to Dave since his move three weeks ago — worth a line. Mom’s birthday is a week out; I can remind you Friday or handle a gift order if you tell me the budget.',
    log: [ { id: 'p1', at: '3 wk', text: 'Dave — moved to Austin', meta: 'no contact since' } ] },
  play: { id: 'play', label: 'Play',
    instruments: [ { kind: 'stat', label: 'Fantasy · lineup', big: 'Set', tone: 'ok', sub: 'no injured starters' }, { kind: 'ring', label: 'Reading', value: 2, max: 5, center: '2', sub: 'in progress' } ],
    narrative: 'Lineup’s clean this week — no inactive or injured starters, no deadline risk before Sunday. Two articles saved and unread; both are short, want a two-line summary of each?',
    log: [ { id: 'pl1', at: 'Sat', text: 'Saved: "The case against microservices"', meta: '12 min read' } ] },
};

const ops: OpsFeed = {
  entries: [
    { id: 'o1', at: '2026-07-08T05:41:00-04:00', tool: 'backup', action: 'snapshot databases', reason: 'nightly maintenance', tier: 3, kind: 'cron', result: 'cabinet.db + episodic.db · integrity ok', chatId: null, reversible: false },
    { id: 'o2', at: '2026-07-08T05:41:20-04:00', tool: 'mcp__cabinet__search_episodic', action: 'index 2 journal entries', reason: 'embedding backfill', tier: 4, kind: 'cron', result: '2 indexed', chatId: null, reversible: false },
    { id: 'o3', at: '2026-07-08T02:14:00-04:00', tool: 'Write', action: 'title chat', reason: 'auto-title untitled chat', tier: 4, kind: 'heartbeat', result: '"Cabinet Systems Status Report"', chatId: 't-5dd8', reversible: true, diff: 'title: null → "Cabinet Systems Status Report"' },
  ],
};

// Tells tonight's real story: cache_write held ~40k/day for a week (a
// cache-busting bug in the prompt layering), then collapsed to ~800 today
// once it was fixed — cache_read stayed high (still reusing the prefix),
// so the read:write ratio jumps from ~1x to ~75x. The 5h window numbers
// echo the actual measured before/after from tonight's verification.
const usage: UsageView = {
  authMode: 'subscription',
  byDay: [
    { day: '2026-07-09', model: 'claude-sonnet-5', input: 1200, output: 900, cache_read: 58000, cache_write: 780, cost_usd: 0.31, turns: 9 },
    { day: '2026-07-08', model: 'claude-sonnet-5', input: 8300, output: 4150, cache_read: 40500, cache_write: 41000, cost_usd: 1.43, turns: 21 },
    { day: '2026-07-07', model: 'claude-sonnet-5', input: 9100, output: 4550, cache_read: 46000, cache_write: 43200, cost_usd: 1.61, turns: 26 },
    { day: '2026-07-06', model: 'claude-sonnet-5', input: 7400, output: 3700, cache_read: 36500, cache_write: 38900, cost_usd: 1.29, turns: 18 },
    { day: '2026-07-05', model: 'claude-sonnet-5', input: 8600, output: 4300, cache_read: 44000, cache_write: 41800, cost_usd: 1.51, turns: 24 },
    { day: '2026-07-04', model: 'claude-sonnet-5', input: 7900, output: 3950, cache_read: 38000, cache_write: 40200, cost_usd: 1.38, turns: 19 },
    { day: '2026-07-03', model: 'claude-sonnet-5', input: 8200, output: 4100, cache_read: 41000, cache_write: 39500, cost_usd: 1.42, turns: 22 },
  ],
};

const usageRolling: UsageRollingView = {
  authMode: 'subscription',
  windows: [
    { window: '5h', input: 480, output: 360, cache_read: 29200, cache_write: 245, cost_usd: 0.06, turns: 3, cacheReadWriteRatio: 119.18 },
    { window: '24h', input: 1200, output: 900, cache_read: 58000, cache_write: 780, cost_usd: 0.31, turns: 9, cacheReadWriteRatio: 74.36 },
    { window: '7d', input: 50700, output: 25650, cache_read: 304000, cache_write: 245380, cost_usd: 8.95, turns: 139, cacheReadWriteRatio: 1.24 },
  ],
};

const memory: MemoryView = {
  files: [
    { name: 'IDENTITY.md', content: '# IDENTITY — who Cabinet is\n\nCabinet is Ben’s chief of staff on the benloe.com nexus…', updatedAt: '2026-07-08T05:00:00-04:00', editable: true },
    { name: 'SOUL.md', content: '# SOUL — Cabinet’s character\n\nUnflappable and dry. Economical. Candid…', updatedAt: '2026-07-08T05:00:00-04:00', editable: true },
    { name: 'USER.md', content: '# USER — Ben\n\nSenior engineer (15+ years), East Village, NYC…', updatedAt: '2026-07-07T12:00:00-04:00', editable: true },
    { name: 'PREFERENCES.md', content: '# PREFERENCES\n\nLead with the outcome; keep it tight…', updatedAt: null, editable: true },
  ],
  lessons: [
    { id: 1, text: 'Ben’s usual breakfast is 3 eggs and 2 toast (~34 g protein).', domain: 'nutrition', confidence: 0.92 },
    { id: 2, text: 'Prefers high-protein dinners on lifting days.', domain: 'nutrition', confidence: 0.8 },
    { id: 3, text: 'Reviews code rarely — build in public, iterate on whole versions.', domain: 'platform', confidence: 0.9 },
  ],
};

function recallFor(query: string): RecallResponse {
  return {
    query,
    results: [
      { source: 'fact', title: 'Breakfast', snippet: '3 eggs and 2 toast, ~34 g protein', provenance: 'facts · nutrition', score: 0.94, ref: 'fact:breakfast' },
      { source: 'lesson', title: 'Protein on lifting days', snippet: 'Prefers high-protein dinners on lifting days.', provenance: 'lessons · meal logs 2026-06', score: 0.86, ref: 'lesson:2' },
      { source: 'chat', title: 'Weight-tracker deploy', snippet: 'We shipped the weight tracker and wired the macro ring…', provenance: 'chat · 2026-07-05', score: 0.77, ref: 'chat:t-5dd8' },
      { source: 'episodic', title: 'June labs', snippet: 'A1c 5.4, lipids normal — trended down 0.2.', provenance: 'episodic · 2026-06-28', score: 0.71, ref: 'episodic:labs-jun' },
    ],
  };
}

const chats: ChatSummary[] = [
  { id: 't-5dd8', title: 'Cabinet Systems Status Report', model_override: null, archived: 0, updated_at: '2026-07-07T13:10:00-04:00', messages: 6, preview: 'Full status check across services and data.' },
  { id: 't-1a2b', title: 'Weight tracker + macro ring', model_override: 'opus', archived: 0, updated_at: '2026-07-05T20:30:00-04:00', messages: 14, preview: 'Built and deployed the weight tracker.' },
];

const sampleMessages: ChatMessage[] = [
  { id: 'm1', role: 'user', author: 'below413@gmail.com', parts: [{ type: 'text', text: 'How are the services looking?' }], created_at: '2026-07-07T13:00:00-04:00' },
  { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'All green. Nine services up, backups ran at 05:41, nothing pending.' }], created_at: '2026-07-07T13:00:20-04:00' },
  { id: 'm3', role: 'user', author: 'benji@agents.benloe.com', parts: [{ type: 'text', text: 'Worth caching the domain reads — the Today aggregate hits four tables per load.' }], created_at: '2026-07-07T13:01:10-04:00' },
  { id: 'm4', role: 'assistant', parts: [{ type: 'text', text: "Fair. They're cheap now but I'll add a short-TTL cache before it matters. Good catch." }], created_at: '2026-07-07T13:01:35-04:00' },
];

const delay = <T>(v: T): Promise<T> => Promise.resolve(v);

export const mockApi: CabinetApi = {
  health: () => delay<HealthInfo>({ ok: true, authMode: 'subscription', presence: 'idle', presenceMeta: 'last swept 06:06 · next sweep 06:36 · weekly review Sunday' }),
  today: () => delay(today),
  domain: (id) => delay(DOMAIN_DATA[id]),
  ops: (filter) => delay<OpsFeed>({ entries: ops.entries.filter((e) => (filter?.kind ? e.kind === filter.kind : true)) }),
  revertOp: () => delay({ ok: true }),
  usage: () => delay(usage),
  usageRolling: () => delay(usageRolling),
  memory: () => delay(memory),
  saveMemoryFile: () => delay({ ok: true }),
  recall: (q) => delay(recallFor(q)),
  chats: () => delay({ chats }),
  createChat: () => delay({ id: 't-new' }),
  messages: () => delay({ messages: sampleMessages }),
  command: () => delay({ chatId: 't-new' }),
};
