import type {
  CabinetApi, TodayView, DomainId, DomainView, OpsFeed, MemoryView, RecallResponse, HealthInfo, ChatSummary, ChatMessage, InstrumentSpec,
  UsageView, UsageRollingView, PerfView,
  PlaidStatus, PlaidItemSummary, FinancialAccount, NetWorth, MoneySummary, MoneyTransaction, CategorySpend,
  CredentialMeta, CredentialSlot, CredentialsView, EnvVarReport, SettingView,
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

// Shaped like a real slow turn: the SDK subprocess spawn and the model's
// time-to-first-token dominate, and one Bash call is the tool outlier.
const perf: PerfView = {
  enabled: true,
  window: '168h',
  turns: 42,
  byPhase: [
    { phase: 'tool', label: null, n: 214, totalMs: 486000, avgMs: 2271, p50Ms: 900, p95Ms: 9800, maxMs: 41200 },
    { phase: 'step', label: null, n: 268, totalMs: 402000, avgMs: 1500, p50Ms: 1100, p95Ms: 4200, maxMs: 18000 },
    { phase: 'sdk_spawn', label: null, n: 42, totalMs: 63000, avgMs: 1500, p50Ms: 1430, p95Ms: 2600, maxMs: 4100 },
    { phase: 'ttf_thinking', label: null, n: 42, totalMs: 37800, avgMs: 900, p50Ms: 820, p95Ms: 1900, maxMs: 3000 },
    { phase: 'recall', label: null, n: 42, totalMs: 12600, avgMs: 300, p50Ms: 280, p95Ms: 600, maxMs: 950 },
    { phase: 'profile_gap', label: null, n: 42, totalMs: 420, avgMs: 10, p50Ms: 8, p95Ms: 22, maxMs: 40 },
  ],
  byTool: [
    { phase: 'tool', label: 'Bash', n: 61, totalMs: 302000, avgMs: 4951, p50Ms: 2100, p95Ms: 18000, maxMs: 41200 },
    { phase: 'tool', label: 'mcp__cabinet__query_db', n: 88, totalMs: 61600, avgMs: 700, p50Ms: 540, p95Ms: 1800, maxMs: 3200 },
    { phase: 'tool', label: 'Read', n: 65, totalMs: 32500, avgMs: 500, p50Ms: 410, p95Ms: 1200, maxMs: 2400 },
  ],
  recent: [
    {
      turnId: 'mock-turn-1', chatId: 'c1', sessionKind: 'user', model: 'claude-opus-5',
      startedAt: '2026-08-01T14:02:11-04:00', totalMs: 38400,
      phases: { request_total: 38400, sdk_spawn: 1480, ttf_thinking: 860, tool: 21400, step: 12900, recall: 310 },
    },
  ],
};

const memory: MemoryView = {
  files: [
    { name: 'IDENTITY.md', content: '# IDENTITY — who Cabinet is\n\nCabinet is Ben’s chief of staff on the benloe.com nexus…', updatedAt: '2026-07-08T05:00:00-04:00', editable: true },
    { name: 'CHARTER.md', content: '# CHARTER — the constitution of Ben’s Cabinet\n\nPrime directive: reduce Ben’s choice load. Present THE plan, not a menu…', updatedAt: '2026-08-01T14:03:00-04:00', editable: true },
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

/* ---------- money ----------
   Deliberately not the happy path. Dev builds the Money surface against a
   world where one bank is broken, two accounts have no current balance (so
   accounts_counted < accounts_total and the caveat must render), and one
   transaction is still pending. A mock where everything is fine is a mock
   that lets the honest states rot. */
const netWorth: NetWorth = {
  cash: 24_318.44,
  credit: 2_146.09, // positive = owed
  investments: 118_402.7,
  loans: 0,
  net_worth: 140_575.05, // cash + investments − credit − loans
  accounts_counted: 4,
  accounts_total: 6,
  stalest_balance_at: '2026-07-29 04:12:07',
};

const plaidItems: PlaidItemSummary[] = [
  { id: 1, institution: 'Chase', status: 'active', error_code: null, last_synced_at: '2026-08-02 06:10:41', consent_expiration_time: null },
  { id: 2, institution: 'Bank of America', status: 'login_required', error_code: 'ITEM_LOGIN_REQUIRED', last_synced_at: '2026-07-29 04:12:07', consent_expiration_time: null },
  { id: 3, institution: 'Vanguard', status: 'active', error_code: null, last_synced_at: '2026-08-02 06:10:52', consent_expiration_time: null },
];

const plaidAccounts: FinancialAccount[] = [
  { id: 11, account_id: 'acc_chase_checking', institution_name: 'Chase', name: 'Total Checking', mask: '4417', type: 'depository', subtype: 'checking', current_balance: 8_412.19, available_balance: 8_312.19, limit_amount: null, balance_as_of: '2026-08-02 06:10:41', item_status: 'active', hidden: 0 },
  { id: 12, account_id: 'acc_chase_savings', institution_name: 'Chase', name: 'Premier Savings', mask: '9930', type: 'depository', subtype: 'savings', current_balance: 15_906.25, available_balance: 15_906.25, limit_amount: null, balance_as_of: '2026-08-02 06:10:41', item_status: 'active', hidden: 0 },
  { id: 13, account_id: 'acc_chase_sapphire', institution_name: 'Chase', name: 'Sapphire Reserve', mask: '2201', type: 'credit', subtype: 'credit card', current_balance: 2_146.09, available_balance: null, limit_amount: 24_000, balance_as_of: '2026-08-02 06:10:41', item_status: 'active', hidden: 0 },
  // Balances went stale the moment the item broke — no current_balance, so
  // these two drop out of the rollup and the counted/total caveat fires.
  { id: 21, account_id: 'acc_bofa_checking', institution_name: 'Bank of America', name: 'Advantage Plus', mask: '0088', type: 'depository', subtype: 'checking', current_balance: null, available_balance: null, limit_amount: null, balance_as_of: '2026-07-29 04:12:07', item_status: 'login_required', hidden: 0 },
  { id: 22, account_id: 'acc_bofa_card', institution_name: 'Bank of America', name: 'Customized Cash', mask: '7715', type: 'credit', subtype: 'credit card', current_balance: null, available_balance: null, limit_amount: 9_500, balance_as_of: '2026-07-29 04:12:07', item_status: 'login_required', hidden: 0 },
  { id: 31, account_id: 'acc_vanguard_brokerage', institution_name: 'Vanguard', name: 'Brokerage', mask: '5502', type: 'investment', subtype: 'brokerage', current_balance: 118_402.7, available_balance: null, limit_amount: null, balance_as_of: '2026-08-02 06:10:52', item_status: 'active', hidden: 0 },
];

const categories: CategorySpend[] = [
  { category: 'FOOD_AND_DRINK', detailed_top: 'FOOD_AND_DRINK_RESTAURANT', spent: 812.44, txns: 31 },
  { category: 'GENERAL_MERCHANDISE', detailed_top: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', spent: 421.08, txns: 14 },
  { category: 'TRANSPORTATION', detailed_top: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', spent: 188.6, txns: 19 },
  { category: 'ENTERTAINMENT', detailed_top: 'ENTERTAINMENT_STREAMING', spent: 96.94, txns: 6 },
  { category: 'PERSONAL_CARE', detailed_top: 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', spent: 64.0, txns: 2 },
];

const transactions: MoneyTransaction[] = [
  // pending: the amount and the merchant can both still change under us.
  { transaction_id: 'tx_1', date: '2026-08-02', amount: 18.42, merchant: 'Joe Coffee', category_primary: 'FOOD_AND_DRINK', category_detailed: 'FOOD_AND_DRINK_COFFEE', account: 'Total Checking', mask: '4417', pending: 1 },
  { transaction_id: 'tx_2', date: '2026-08-01', amount: 126.31, merchant: 'Whole Foods', category_primary: 'FOOD_AND_DRINK', category_detailed: 'FOOD_AND_DRINK_GROCERIES', account: 'Sapphire Reserve', mask: '2201', pending: 0 },
  // negative = money IN. The one row that catches a sign inversion.
  { transaction_id: 'tx_3', date: '2026-07-31', amount: -4_820.0, merchant: 'Payroll — Benloe LLC', category_primary: 'INCOME', category_detailed: 'INCOME_WAGES', account: 'Total Checking', mask: '4417', pending: 0 },
  { transaction_id: 'tx_4', date: '2026-07-31', amount: 42.6, merchant: 'MTA OMNY', category_primary: 'TRANSPORTATION', category_detailed: 'TRANSPORTATION_PUBLIC_TRANSIT', account: 'Total Checking', mask: '4417', pending: 0 },
  { transaction_id: 'tx_5', date: '2026-07-30', amount: 19.99, merchant: 'Spotify', category_primary: 'ENTERTAINMENT', category_detailed: 'ENTERTAINMENT_STREAMING', account: 'Sapphire Reserve', mask: '2201', pending: 0 },
  { transaction_id: 'tx_6', date: '2026-07-29', amount: 288.14, merchant: 'Con Edison', category_primary: 'RENT_AND_UTILITIES', category_detailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', account: 'Total Checking', mask: '4417', pending: 0 },
];

const plaidStatus: PlaidStatus = {
  configured: true,
  environment: 'sandbox',
  redirect_uri: 'https://cabinet.benloe.com/plaid/oauth',
  webhook_url: 'https://cabinet.benloe.com/api/plaid/webhook',
  items: plaidItems,
  accounts: plaidAccounts,
  net_worth: netWorth,
};

const moneySummary: MoneySummary = {
  linked_institutions: plaidItems.length,
  needs_attention: [{ institution: 'Bank of America', status: 'login_required', error: 'ITEM_LOGIN_REQUIRED' }],
  last_synced_at: '2026-08-02 06:10:52',
  net_worth: netWorth,
  window_days: 30,
  total_spent: 1_583.06,
  by_category: categories,
  accounts: plaidAccounts,
};

/* ---------- credentials ----------
   Same principle as the money mock: not the happy path. Dev builds the
   Credentials surface against a store where one required slot is filled and
   the other is missing (so "Set" and "Not set" both render, and the missing
   one is required so the warning tone fires), a machine-managed per-bank
   token is present (read-only section), and one stored name matches no slot
   (the delete-only section). No mock here carries a secret value, because no
   response shape has anywhere to put one. */
let credentialSeq = 3;

const credentialStore: CredentialMeta[] = [
  {
    id: 1, name: 'plaid-client-id', provider: 'Plaid', description: 'Identifies this Cabinet install to Plaid.',
    created_at: '2026-07-18 15:02:44', updated_at: '2026-08-02 04:41:09', last_used_at: '2026-08-02 06:10:52', rotated_at: null,
  },
  {
    id: 2, name: 'plaid-item-9f3ac1', provider: 'Plaid', description: 'Access token — Chase',
    created_at: '2026-07-18 15:14:03', updated_at: '2026-07-18 15:14:03', last_used_at: '2026-08-02 06:10:41', rotated_at: null,
  },
  {
    id: 3, name: 'weather-api-key', provider: null, description: null,
    created_at: '2026-05-02 11:20:00', updated_at: '2026-05-02 11:20:00', last_used_at: null, rotated_at: null,
  },
];

/** The catalog, mirroring server/src/domains/credentialCatalog.ts. */
const credentialCatalog: Omit<CredentialSlot, 'stored' | 'meta'>[] = [
  {
    name: 'plaid-client-id', group: 'Plaid', label: 'Client ID',
    description: 'Identifies this Cabinet install to Plaid. Needed before any bank can be linked.',
    where: 'Plaid Dashboard → Developers → Keys → client_id', required: true,
  },
  {
    name: 'plaid-secret', group: 'Plaid', label: 'Secret',
    description:
      'The API secret for the environment set in PLAID_ENV. Sandbox and Production have different secrets — ' +
      'storing the wrong one fails at the first API call, not at save time.',
    where: 'Plaid Dashboard → Developers → Keys → the row matching your environment', required: true,
  },
];

const isManaged = (name: string) => name.startsWith('plaid-item-');

const credentialEnv: EnvVarReport[] = [
  {
    name: 'CABINET_CRED_KEY', label: 'Credential encryption key',
    description:
      'The AES-256 key that encrypts everything on this page. Without it the store still lists names but ' +
      'cannot encrypt or decrypt anything.',
    reason:
      'This is the bootstrap secret — the one value that cannot be stored in the store it unlocks. It lives in ' +
      '/srv/benloe/.env, which is root-owned and which Cabinet can neither read nor write by design.',
    set: true, required: true, scrubbed: true, value: null, supersededBy: null,
  },
  {
    name: 'PLAID_ENV', label: 'Plaid environment',
    description: "'sandbox' for fake test banks, 'production' for real ones. Defaults to sandbox when unset.",
    reason: 'Superseded by the Plaid environment setting, which takes precedence over this variable.',
    set: true, required: false, scrubbed: false, value: 'sandbox', supersededBy: 'plaid.env',
  },
  // Deliberately NOT the value in force: the stored `public.origin` setting
  // below outranks it. Dev should meet the confusing case — a .env line that
  // looks authoritative and isn't — every time it opens the page, because that
  // is the case the precedence copy exists to defuse.
  {
    name: 'CABINET_PUBLIC_ORIGIN', label: 'Public origin',
    description: 'Base URL used to build the Plaid OAuth redirect and webhook URLs.',
    reason: 'Superseded by the public origin setting, which takes precedence over this variable.',
    set: true, required: true, scrubbed: false, value: 'https://cabinet.local:8080', supersededBy: 'public.origin',
  },
  {
    name: 'GITHUB_APP_PRIVATE_KEY_B64', label: 'GitHub App private key',
    description: 'Scrubbed from the process environment at boot after a token is minted from it.',
    reason: 'Secret, and root-injected. Presence is inferred from the token it produced, not from the variable.',
    set: false, required: false, scrubbed: true, value: null, supersededBy: null,
  },
];

/* ---- settings: the editable, plaintext half of the credentials page ----
   Seeded across two different sources on purpose — one value coming from the
   environment, one stored row overriding a DIFFERENT environment value — so
   the precedence rendering has something to say in dev without anyone having
   to hand-edit a database first. */
const settingStore: SettingView[] = [
  {
    key: 'plaid.env', group: 'Plaid', label: 'Environment',
    description:
      "Which Plaid environment to call. 'sandbox' uses fake test banks and fake data; 'production' connects real " +
      'accounts. The Client ID and Secret are environment-specific.',
    type: 'enum', options: ['sandbox', 'production'], default: 'sandbox', envVar: 'PLAID_ENV',
    value: 'sandbox', source: 'env', updated_at: null, env_value: 'sandbox',
  },
  {
    key: 'public.origin', group: 'Plaid', label: 'Public origin',
    description:
      'Base URL Cabinet is reachable at. Used to build the Plaid OAuth redirect and webhook URLs, both of which ' +
      "must match what is registered in Plaid's dashboard character-for-character.",
    type: 'origin', default: 'https://cabinet.benloe.com', envVar: 'CABINET_PUBLIC_ORIGIN',
    value: 'https://cabinet.benloe.com', source: 'db', updated_at: '2026-08-01 19:22:10',
    env_value: 'https://cabinet.local:8080',
  },
];

/** The server's normalisation, mirrored — the echo is only useful if it can differ from what was typed. */
function normaliseMockSetting(spec: SettingView, raw: string): string {
  const value = raw.trim();
  if (value.length === 0) throw new Error(`${spec.label} cannot be empty.`);
  if (spec.type === 'enum' && !(spec.options ?? []).includes(value)) {
    throw new Error(`${spec.label} must be one of: ${(spec.options ?? []).join(', ')}.`);
  }
  if (spec.type === 'origin') {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${spec.label} must be a full URL, e.g. https://cabinet.benloe.com`);
    }
    return `${url.protocol}//${url.host}`;
  }
  return value;
}

function credentialsView(): CredentialsView {
  const byName = new Map(credentialStore.map((c) => [c.name, c]));
  const catalogued = new Set(credentialCatalog.map((s) => s.name));
  const extra = credentialStore.filter((c) => !catalogued.has(c.name));
  return {
    configured: true,
    credentials: [...credentialStore],
    slots: credentialCatalog.map((slot) => ({ ...slot, stored: byName.has(slot.name), meta: byName.get(slot.name) ?? null })),
    managed: extra.filter((c) => isManaged(c.name)),
    unrecognised: extra.filter((c) => !isManaged(c.name)),
    env: credentialEnv,
  };
}

const delay = <T>(v: T): Promise<T> => Promise.resolve(v);

export const mockApi: CabinetApi = {
  health: () => delay<HealthInfo>({ ok: true, authMode: 'subscription', presence: 'idle', presenceMeta: 'last swept 06:06 · next sweep 06:36 · weekly review Sunday' }),
  today: () => delay(today),
  domain: (id) => delay(DOMAIN_DATA[id]),
  ops: (filter) => delay<OpsFeed>({ entries: ops.entries.filter((e) => (filter?.kind ? e.kind === filter.kind : true)) }),
  revertOp: () => delay({ ok: true }),
  usage: () => delay(usage),
  usageRolling: () => delay(usageRolling),
  perf: () => delay(perf),
  memory: () => delay(memory),
  saveMemoryFile: () => delay({ ok: true }),
  recall: (q) => delay(recallFor(q)),
  chats: () => delay({ chats }),
  createChat: () => delay({ id: 't-new' }),
  deleteChat: (id) => {
    const idx = chats.findIndex((c) => c.id === id);
    if (idx >= 0) chats.splice(idx, 1);
    return delay({ ok: true });
  },
  messages: () => delay({ messages: sampleMessages }),
  command: () => delay({ chatId: 't-new' }),

  credentials: () => delay(credentialsView()),
  // The mock takes the secret and drops it on the floor — deliberately. There
  // is nothing to store it in, and a dev fixture that kept plaintext around
  // would be the one place in this codebase that does.
  saveCredential: ({ name, provider, description }) => {
    const existing = credentialStore.find((c) => c.name === name);
    const at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (existing) {
      existing.updated_at = at;
      existing.rotated_at = at;
      return delay({ ok: true, created: false, credential: existing });
    }
    const credential: CredentialMeta = {
      id: ++credentialSeq, name, provider: provider ?? null, description: description ?? null,
      created_at: at, updated_at: at, last_used_at: null, rotated_at: null,
    };
    credentialStore.push(credential);
    return delay({ ok: true, created: true, credential });
  },
  deleteCredential: (name) => {
    const idx = credentialStore.findIndex((c) => c.name === name);
    if (idx >= 0) credentialStore.splice(idx, 1);
    return delay({ ok: true, deleted: name });
  },

  settings: () => delay({ settings: settingStore.map((s) => ({ ...s })) }),
  saveSetting: (key, value) => {
    const spec = settingStore.find((s) => s.key === key);
    if (!spec) return Promise.reject(new Error(`Unknown setting: ${key}`));
    let next: string;
    try {
      next = normaliseMockSetting(spec, value);
    } catch (e) {
      return Promise.reject(e as Error);
    }
    // The guard the real server enforces, and the single most important message
    // this page can show — so the mock can produce it too rather than leaving
    // the blocked path untested until it happens for real.
    if (key === 'plaid.env' && next !== spec.value && plaidItems.some((i) => i.status !== 'revoked')) {
      const n = plaidItems.filter((i) => i.status !== 'revoked').length;
      return Promise.reject(
        new Error(
          `Cannot switch to '${next}' while ${n} account connection${n === 1 ? ' is' : 's are'} linked — their ` +
          'access tokens only work in the environment that issued them. Unlink first, then switch.',
        ),
      );
    }
    spec.value = next;
    spec.source = 'db';
    spec.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return delay({ setting: { ...spec } });
  },
  revertSetting: (key) => {
    const spec = settingStore.find((s) => s.key === key);
    if (!spec) return Promise.reject(new Error(`Unknown setting: ${key}`));
    spec.value = spec.env_value ?? spec.default;
    spec.source = spec.env_value !== null ? 'env' : 'default';
    spec.updated_at = null;
    return delay({ setting: { ...spec } });
  },

  plaidStatus: () => delay(plaidStatus),
  plaidLinkToken: () => delay({ link_token: 'link-sandbox-mock-token', environment: plaidStatus.environment }),
  plaidExchange: () => delay({ ok: true, item: { id: 4, institution: 'Mock Bank', status: 'active' as const }, syncing: true }),
  plaidSync: () =>
    delay({
      reports: plaidItems.map((i) => ({
        item_id: i.id,
        institution: i.institution,
        ok: i.status === 'active',
        accounts: i.status === 'active' ? 2 : 0,
        transactions: { added: i.status === 'active' ? 3 : 0, modified: 0, removed: 0, skipped: 0 },
        holdings: 0,
        ...(i.status === 'active' ? {} : { status: 'login_required', error: 'ITEM_LOGIN_REQUIRED' }),
      })),
      net_worth: netWorth,
    }),
  plaidUnlinkItem: (itemId) => delay({ ok: true, deleted: itemId }),
  plaidSetAccountHidden: (accountId, hidden) => delay({ ok: true, id: accountId, hidden }),

  moneySummary: () => delay(moneySummary),
  moneyTransactions: () => delay({ transactions }),
  moneyTrend: () => delay({ net_worth: [], spend_by_day: [] }),
  moneyCategories: () => delay({ categories }),
  // Empty on purpose: holdings only exist once an investment item has synced,
  // so the graceful empty state is what dev sees first.
  moneyHoldings: () => delay({ holdings: [] }),
};
