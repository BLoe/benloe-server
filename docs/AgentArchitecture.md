# Cabinet — Personal Autonomous Life System
## Architecture & UX Engineering Specification (v1.0, July 2026)
### An implementation-ready design document for a fully autonomous personal life assistant

**Author's note on posture:** This is an engineering spec written to be executed top-to-bottom by Claude Code on an Ubuntu VPS. It deliberately teaches the *why* behind each decision. Where research shows the state of the art has moved past the brief's assumptions, it says so and specs the better path. The single most important such correction is in the TL;DR.

---

## TL;DR

- **Build a first-party, self-authored agent runtime on the Claude Agent SDK — do NOT deploy OpenClaw itself.** OpenClaw is the correct *architectural template* (gateway + file memory + heartbeat/cron + layered system prompt), and we adopt its patterns wholesale, but as of July 2026 Anthropic bans third-party harnesses (OpenClaw included) from drawing on Claude subscription limits (enforced April 4, 2026; the softer June 15 plan that would have moved non-interactive Agent SDK/`claude -p`/GitHub-Actions/third-party-app usage to a separate monthly credit — $20 on Pro, $100 on Max 5x, $200 on Max 20x — was **paused** on the day it was to take effect). The clean, ToS-compliant way to power an always-on agent from a Claude Max subscription is a **first-party application built on the official Claude Agent SDK / Claude Code headless (`claude -p`)**, authenticated with a `claude setup-token` OAuth token — subscription-authenticated first-party Agent SDK usage remains supported; only third-party harnesses are excluded.

- **The three-layer memory split in the brief is correct and matches where the research literature converged in 2026** (declarative/semantic files + structured evidence + episodic/reflective recall). We implement it as: (a) **SQLite** for all quantified-self data (SQL, not embeddings); (b) **curated markdown context files** (OpenClaw-style `CLAUDE.md`/`MEMORY.md`) for preferences and narrative; (c) **`sqlite-vec` + a local `bge-small-en-v1.5` embedding model** for episodic chat recall and a governed "lessons learned" reflection bank. This entire stack fits comfortably on the $48/mo droplet alongside benleo.com and the Yahoo MCP.

- **"Full autonomy" in mid-2026 realistically means Tier-4 supervised autonomy for everything except a short list of irreversible, high-consequence actions** (spending money, sending messages to third parties, trades), which sit behind an approval queue. Everything else — logging, memory management, briefings, analysis, nudges, read-only data pulls — runs unattended on a heartbeat + cron scheduler. Model routing (Haiku 4.5 for classification/heartbeats, Sonnet 4.6 for the default agent loop, Opus 4.8 for weekly deep analysis) is what keeps an always-on agent inside Max 20x weekly limits.

---

## 1. Executive Summary & Design Philosophy

### 1.1 What we are building

Cabinet is a single-user, always-on personal life assistant for Ben — a 39-year-old senior engineer in the East Village. It lives at a subdomain of benleo.com (`cabinet.benleo.com`), presents as a streaming, mobile-first PWA chat app, and runs on the existing DigitalOcean droplet. It logs and reasons across eight life domains (food/nutrition, training/body, healthcare ops, mind/recovery, money, life admin, social/leisure, and cross-domain intelligence), holds long-term memory, and proactively acts on Ben's behalf under a bounded autonomy model.

### 1.2 Seven first-principles design decisions

**Principle 1 — The model is the runtime; everything else is plumbing.** Following OpenClaw's core insight, the LLM provides intelligence and the surrounding system provides *execution environment*: sessions, memory, tool sandboxing, scheduling, and routing. We never expose the raw model to user input directly; a gateway process mediates every turn. This is why Cabinet is structured as gateway → agent runtime → tools, not as a thin chat wrapper. (For context on why this template is battle-tested: OpenClaw hit 34,168 GitHub stars in its first 48 hours around Jan 30, 2026, reaching ~106,000, then ~157K within 60 days and 250K+ by ~April — the most-starred non-aggregator software project on GitHub. Its patterns are the most stress-tested personal-agent patterns in existence.)

**Principle 2 — Store facts as facts, prose as prose, and experiences as embeddings.** The biggest architectural error in personal-agent design is putting everything into a vector store. Quantified data ("172.4 lbs on 2026-07-03", "38g protein at lunch") must be queried with SQL aggregations, joins, and time windows — embeddings cannot sum a column or compute a 7-day rolling average. Preferences and narrative ("Ben is cutting; targets 185g protein/day; hates cardio") belong in curated markdown that is cheap to read, human-editable, and diffable. Only *episodic recall* ("what did we decide about the dentist?") and *accumulated insights* genuinely need semantic search. This three-way split is a deliberate rejection of one-size-fits-all RAG, and it's exactly the declarative/evidence/procedural decomposition the 2026 agent-memory literature converged on.

**Principle 3 — Autonomy is a property of the action, not the agent.** Borrowing from the 2026 autonomy-tier frameworks, oversight level is decided per-action by reversibility, magnitude, and confidence — not by a global "autonomous: on/off" switch. Reading health data is Tier 4 (executes freely). Sending an email to Ben's doctor is Tier 2 (proposes, waits for approval). The tier system is enforced in the tool layer, not the prompt — because a system prompt is not a guardrail. (This is not paranoia: Andrej Karpathy first called OpenClaw "the most incredible sci-fi takeoff-adjacent thing I've seen recently," then reversed course on Feb 2, 2026 — "it's way too much of a Wild West. You are putting your computer and private data at a high risk." Consequence-gating is the design answer to exactly that risk.)

**Principle 4 — Cost is an architectural constraint, not an afterthought.** An always-on agent that wakes every 30 minutes and runs weekly Opus analyses will exhaust a Max plan if built naively. Model routing, prompt-cache-friendly prompt layering, isolated lightweight heartbeat sessions, and SQL-first retrieval (which keeps tokens out of context) are all first-order design decisions driven by the Max weekly ceiling.

**Principle 5 — Local-first and single-tenant simplifies everything.** One user means no multi-tenancy, no RBAC matrix, no per-user cache partitioning. It also means health + financial data never leaves infrastructure Ben controls. This shapes the auth model (a single passkey/password, not OAuth-for-others) and the DB model (one SQLite file, not Postgres with row-level security).

**Principle 6 — Everything the agent knows should be inspectable and editable by a human.** Markdown memory, a plain SQLite file, and JSONL episodic logs mean Ben can `cat`, `grep`, edit, and `git`-version the agent's entire mind. This is OpenClaw's "avoid the black box" philosophy and it is a debugging superpower.

**Principle 7 — Degrade gracefully; never lose data.** The agent must survive Claude API outages, rate-limit exhaustion, and its own crashes without losing logged data or corrupting memory. Writes to structured storage happen deterministically (not through the LLM) wherever possible, so a logging action succeeds even if the model call later fails.

---

## 2. Complete Feature Specification

Each domain below is specified to implementable detail: the data captured, the tools involved, the proactive behaviors, and example interactions. All "logging" flows write to SQLite deterministically; all "analysis" flows read SQLite and/or memory.

### 2.1 Food & Nutrition

**Capabilities:**
- **Natural-language + photo macro/calorie logging.** "Two eggs, toast with butter, black coffee" → parsed into structured `food_log` rows with estimated kcal/protein/carbs/fat. Photo → Claude vision estimates portions and macros. Ambiguity is resolved by asking one clarifying question, then remembering the resolution as a lesson ("Ben's 'usual breakfast' = 3 eggs + 2 toast").
- **Restaurant meal estimation.** "Chicken tikka masala with rice and naan at an Indian place" → macro estimate with an explicit confidence band and the assumptions made.
- **Pantry/fridge/freezer inventory with expiration tracking.** Items tracked with location, quantity, purchase date, and expiration. Deducted when used in logged meals or cooking.
- **Grocery list generation.** Meal plan minus current pantry, plus auto-replenished staples, ordered by supermarket aisle. Output is a checklist card in the UI.
- **Meal planning against macro targets + training schedule.** Higher carbs on training days, protein floor every day, respects dietary preferences from memory.
- **Recipe library.** Save/scale/adapt/rate recipes; scaling recomputes macros; adaptation respects pantry and preferences.
- **Cooking teacher mode.** Step-by-step technique instruction with timers and the "why" behind each step.
- **Eating-out copilot.** Menu photo + remaining daily macros → ranked "best choice" recommendations.

**Example interaction:**
> **Ben:** [photo of a burrito bowl] logging lunch
> **Cabinet:** Logged: chipotle-style bowl — ~710 kcal, 46g protein, 68g carbs, 28g fat (medium confidence; assumed double chicken + brown rice + no cheese per your usual). That puts you at 112g protein / 185g target with dinner to go. Want me to bias tonight's plan high-protein?

### 2.2 Training & Body

- **Workout logging** (sets/reps/RPE), free-text or structured ("bench 3x5 @ 185, RPE 8").
- **PR history and volume tracking** per lift and muscle group, with weekly tonnage.
- **Programming for non-trainer days:** progression, deload detection, and injury-aware substitutions (from a substitution table + memory of Ben's injuries). Cabinet is explicit that it is not a certified trainer and flags when a human coach is warranted.
- **Weight-trend smoothing:** exponentially-weighted moving average to strip daily water-weight noise; reports trend, not single points.
- **Apple Health / wearable ingestion:** steps, active energy, cardio, HRV, recovery — via the Health Auto Export pipeline (see §5/§7).

### 2.3 Healthcare Ops

- **Benefits Q&A over actual plan documents.** Ben's plan is an **Anthem HSA 3300 HDHP** — a $3,300-deductible HSA-qualified high-deductible plan. RAG over the uploaded SPD/benefits PDFs in the document vault answers "is a dermatology visit covered before deductible?"
- **Deductible / out-of-pocket accumulator tracking.** Running totals against plan limits, updated as claims/EOBs are logged.
- **Claims / EOB logging**, prior-auth status tracking, appointment prep question lists, post-visit notes.
- **HSA contribution strategy.** Cabinet knows the **2026 IRS HSA limits per IRS Rev. Proc. 2025-19 (released May 1, 2025): self-only $4,400 contribution; $1,000 age-55+ catch-up; HDHP minimum deductible $1,700; OOP max $8,500**, and the already-published **2027 limits per IRS Revenue Procedure 2026-24 (released May 29, 2026): self-only $4,500; HDHP minimum deductible $1,750; OOP max $8,700**, and tracks Ben's YTD contributions against the limit, nudging before year-end. (Ben, 39, is not yet catch-up eligible; Cabinet notes the age-55 milestone. Design note: a $3,300 self-only deductible comfortably exceeds the 2026 self-only minimum of $1,700, so it is a valid HSA-qualified HDHP; confirm from the plan document whether the $3,300 is a self-only or family deductible — $3,300 would fall *below* the 2026 family minimum of $3,400 and would need re-checking if it is a family tier.)
- **Medication/supplement schedules** with refill nudges (days-of-supply countdown).
- **Labs trended over time** (e.g., LDL, A1c, vitamin D) with reference ranges.

**Example:**
> **Cabinet (proactive):** Heads up — your Anthem EOB for the 6/18 PT visit posted. You've now hit $2,140 of your $3,300 deductible for 2026. Two more PT visits and you're likely through it; after that most visits shift to coinsurance. Also: you've put $2,900 into your HSA — $1,500 of headroom left before the $4,400 cap. Want me to model maxing it by December?

### 2.4 Mind & Recovery

- **Sleep ingestion and analysis** from Apple Health (duration, stages, consistency).
- **One-tap mood/energy/stress check-ins** — rendered as tappable 1–5 scales in the UI, written to `mood_log`.
- **Journaling with semantic retrieval** — free-form entries embedded for later recall ("when did I last feel this burned out?").
- **Goals and habit streak tracking** with streak counts and gentle recovery framing after a miss.

### 2.5 Money

- **Spend tracking** via Plaid (read-only) or CSV import.
- **Budget vs. actual**, subscription audit (recurring-charge detection), portfolio monitoring with allocation-drift detection, rebalancing suggestions, tax-loss-harvesting flags, contribution reminders, tax-document organization.
- **Hard rule: all financial data is read-only. Cabinet recommends; Ben executes every trade and payment.** Trades and payments are Tier-1 (never executed by the agent, full stop).

### 2.6 Life Admin

- **Calendar read/write** (Google Calendar) with conflict detection.
- **Tasks/reminders** including recurring maintenance ("replace HVAC filter every 90 days").
- **Document vault with Q&A** over personal PDFs (insurance, lease, tax docs).
- **Travel planning, purchase research, price watching, message drafting** (drafts only; sending is gated).

### 2.7 Social & Leisure

- **Birthday/gift tracking**, keep-in-touch cadence suggestions ("you haven't talked to Dave in ~6 weeks").
- **Reading backlog and recommendations.**
- **Fantasy basketball operations** via Ben's existing Yahoo Fantasy MCP at `yahoomcp.benloe.com`: lineup-deadline reminders, waiver-wire suggestions, matchup prep. Lineup *changes* are Tier-3 (proposed, one-tap approve); waiver *claims* are Tier-2 (approve-before).

### 2.8 Cross-Domain Intelligence

- **Morning briefing** (assembled 6:30am): weather, calendar, overnight sleep/recovery, macro targets for the day given training, top tasks, any anomaly nudges, fantasy deadlines.
- **Evening check-in** (~8:30pm): mood/energy prompt, macro gap, tomorrow's first event.
- **Weekly review** (Sunday, Opus): correlation analysis across sleep/training/mood/macros, trend summaries, goal progress, a "lesson of the week."
- **Anomaly detection nudges** (heartbeat-driven): low-protein streaks, food nearing expiration, spend spikes, missed medications, weight-trend inflections.

---

## 3. System Architecture

### 3.1 Component diagram (textual)

```
                         ┌───────────────────────────────────────────┐
   iPhone / Desktop      │            cabinet.benleo.com (PWA)           │
   (installed PWA)  ────► │   assistant-ui + Vercel AI SDK front end   │
                         └───────────────────┬───────────────────────┘
                                             │ HTTPS / SSE (streaming)
                                             ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                        nginx (reverse proxy, TLS)                      │
   │   cabinet.benleo.com → :8787   |   benleo.com → existing   |   yahoomcp   │
   └───────────────────────────────┬──────────────────────────────────────┘
                                    ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                     GATEWAY  (Node/TS, :8787)                          │
   │  - HTTP+SSE server, single-user auth (passkey/session cookie)         │
   │  - Session & conversation manager (per-chat JSONL transcripts)      │
   │  - Request queue (serializes turns; prevents concurrent Max calls)    │
   │  - Autonomy policy engine + approval queue                            │
   │  - Scheduler: heartbeat (30m) + cron (briefings/reviews)             │
   └───────────────┬──────────────────────────────────────┬──────────────┘
                   │ spawns / streams                       │ reads/writes
                   ▼                                        ▼
   ┌───────────────────────────────┐        ┌──────────────────────────────┐
   │   AGENT RUNTIME               │        │   MEMORY & DATA LAYER          │
   │   Claude Agent SDK / claude -p│        │  (1) cabinet.db  (SQLite)         │
   │   OAuth (CLAUDE_CODE_OAUTH_   │        │  (2) memory/*.md  (curated)    │
   │        TOKEN, Max sub)        │        │  (3) episodic.db (sqlite-vec)  │
   │   - layered system prompt     │◄──────►│  (4) embed service (bge-small) │
   │   - model routing             │        └──────────────────────────────┘
   │   - in-process MCP tools      │
   └───────────────┬───────────────┘
                   │ MCP (stdio / http)
                   ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  TOOL / MCP LAYER                                                       │
   │  In-process SDK tools: log_food, log_workout, query_db, update_memory, │
   │      search_episodic, add_lesson, enqueue_approval, render_widget ...   │
   │  External MCP servers: Google Workspace (Gmail/Cal/Drive), Apple Health │
   │      (Health Auto Export), Plaid (read-only), Yahoo Fantasy             │
   │      (yahoomcp.benloe.com), web search/fetch (SDK built-ins)           │
   └──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Gateway design

The gateway is the single control plane — OpenClaw's "single source of truth." It is a long-lived Node/TypeScript process managed by systemd. Responsibilities:

1. **Ingress:** an HTTP server exposing `POST /api/chat` (SSE streaming), `GET /api/chats`, `POST /api/approvals/:id`, plus a static file server for the PWA. Binds to `127.0.0.1:8787`; nginx terminates TLS and proxies.
2. **Auth:** a single-user session cookie issued after a passkey (WebAuthn) or password login. No third-party OAuth login surface.
3. **Session/queue management:** all agent turns — whether user-initiated, heartbeat, or cron — go through one serialized queue. **This is critical for a Max subscription:** concurrent Claude calls burn the weekly limit faster and risk rate-limit 429s. One turn at a time; scheduled turns defer while a user turn is active (exactly OpenClaw's "heartbeat skips when busy" pattern).
4. **Autonomy policy engine:** intercepts tool calls flagged high-consequence and routes them to the approval queue instead of executing (see §3.7).
5. **Scheduler:** node-cron for exact schedules; an internal heartbeat timer for flexible monitoring.

### 3.3 Agent runtime

The runtime wraps the **Claude Agent SDK** (TypeScript, `@anthropic-ai/claude-agent-sdk`). It is the same harness that powers Claude Code, exposed as a library, giving us the agent loop, tool execution, context compaction, subagents, and MCP client support for free.

- **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (a one-year token tied to Ben's Max subscription, drawing from subscription limits rather than pay-per-token API billing). This is the sanctioned path for subscription-powered programmatic use. `ANTHROPIC_API_KEY` is configured as an **optional overflow** (unset by default) so that if the weekly Max limit is exhausted, high-priority turns can fall back to metered API billing rather than failing — a deliberate resilience choice.
- **Model routing** is set per-invocation via the SDK's options (see §6.1).
- **Tools** are defined as in-process MCP tools via the SDK's `@tool` decorator / `create_sdk_mcp_server` equivalent, which run inside our Node process (no separate subprocess) — the lowest-latency, lowest-overhead way to give the agent custom tools.

**Why Agent SDK over raw Messages API:** the raw Client SDK requires us to implement the tool loop, compaction, and context management ourselves. The Agent SDK handles the tool-use loop, server-side compaction, prompt caching, and context editing natively. For a long-running agent this is a large amount of undifferentiated heavy lifting we do not want to own.

### 3.4 Session & conversation management

- Each conversation chat is a JSONL transcript on disk (`chats/<id>.jsonl`), one row per message — human-inspectable, appendable, crash-safe.
- The "main" session is the ongoing relationship chat; heartbeat and cron runs use **isolated lightweight sessions** (fresh session, minimal bootstrap context) to keep per-run token cost at ~2–5K instead of replaying the full history — directly modeled on OpenClaw's `isolatedSession: true` + `lightContext: true`.
- Server-side **compaction** (Agent SDK beta, `compact-2026-01-12`) summarizes the main chat when it approaches the context window; durable facts are flushed to memory *before* compaction via the context-editing warning hook.

### 3.5 The three-layer memory system

| Layer | Store | Contents | Access pattern | Why this store |
|---|---|---|---|---|
| **Structured / quantified** | `cabinet.db` (SQLite) | Every measurable fact: food logs, workouts, weight, sleep, mood, claims, meds, labs, transactions, tasks, contacts | Deterministic SQL via `query_db` tool | Aggregation, joins, time-windows, exactness. Embeddings cannot compute a 7-day protein average. |
| **Curated semantic / narrative** | `memory/*.md` | Preferences, goals, personas, standing orders, per-domain narrative summaries | Loaded into system prompt (small, stable files) or read on demand | Cheap, diffable, human-editable, cache-friendly. This is the OpenClaw `MEMORY.md`/`CLAUDE.md` pattern. |
| **Episodic + lessons** | `episodic.db` (SQLite + `sqlite-vec`) | Chunked past-conversation snippets; accumulated "lessons learned" insights | Vector search via `search_episodic` / `recall_lessons` tools | Only genuinely semantic recall needs embeddings. Governed reflection bank. |

Deep dive in §5.

### 3.6 Tool / MCP layer

Two classes of tools:
- **In-process SDK tools** (we author these): domain logging, DB queries, memory ops, episodic search, approval enqueue, widget rendering. Defined in-process for latency and because they touch our own SQLite/files.
- **External MCP servers** (existing or off-the-shelf): Google Workspace, Apple Health, Plaid (read-only), Yahoo Fantasy (already running), web search/fetch (SDK built-ins). Registered with the Agent SDK's MCP client.

Full tool catalog in §7.

### 3.7 Autonomy tier system

Five tiers, decided per-action by the policy engine. This is enforced in the tool layer (a `PreToolUse` hook), never merely in the prompt.

| Tier | Name | Behavior | Example actions |
|---|---|---|---|
| **Tier 4** | Autonomous | Executes freely, logged | Read any data; log food/workout/mood; update memory; run analyses; generate briefings; price-watch; search web |
| **Tier 3** | Notify-after | Executes, then tells Ben what it did | Add/modify calendar events on *Ben's own* calendar; create tasks; set fantasy lineup before deadline; reorder grocery staples on the list |
| **Tier 2** | Approve-before | Proposes an action packet; waits for one-tap approval | Send email/message to a third party; submit a fantasy waiver claim; make a purchase; add a recurring subscription |
| **Tier 1** | Human-only | Agent may draft/recommend but can never execute | Execute trades; move money; pay bills; make/cancel medical appointments with providers |
| **Tier 0** | Blocked | Not available to the agent at all | Delete financial records; disable its own guardrails; bulk-delete memory |

**Approval packets** (Tier 2) contain: the action, the exact payload (e.g., full email text + recipient), the reasoning, a confidence score, and a reversibility note. They surface as rich cards in the chat UI and expire (default 24h). Approval requirements follow *consequence*, not convenience — the 2026 governance consensus. Autonomy expands only after a stable low-risk history: a config flag can promote specific Tier-2 action classes to Tier-3 once Ben trusts them (e.g., "you can now send calendar invites to my wife without asking").

**Budget/spend controls:** a hard monthly agent-initiated spend cap (default $0 until Ben raises it, since all spend is Tier-1/2 anyway) and a token budget monitor (see §6.4) that throttles proactive routines when the weekly Max limit is >80% consumed.

### 3.8 What "full autonomy" realistically is in mid-2026

Research reality check: production personal agents in 2026 do not run truly unsupervised on high-consequence actions. The dominant deployed pattern is **"supervised autonomy"** — Tier-3/Tier-4 for the vast majority of actions (read, log, analyze, remind, draft) with a consequence-gated approval layer for the few irreversible ones. The failure modes that make full hands-off autonomy unsafe (agents looping, sending wrong messages, over-spending) are well documented, and the OpenClaw "Wild West" security critique (§1.2, Karpathy) is exactly why. Cabinet is spec'd to the practical ceiling: it *feels* fully autonomous day-to-day because ~95% of what it does is Tier-3/4, while the irreversible 5% stays gated. This is the correct target, not a limitation.

---

## 4. Data Model — SQLite Schema DDL

`cabinet.db` uses SQLite with WAL mode (`PRAGMA journal_mode=WAL`) for concurrent read during writes, and `PRAGMA foreign_keys=ON`. All timestamps are ISO-8601 UTC text; local-day derivations use `America/New_York`. Selected core tables (representative, not exhaustive — Claude Code should extend following these patterns):

```sql
-- ========== FOOD & NUTRITION ==========
CREATE TABLE food_log (
  id INTEGER PRIMARY KEY,
  eaten_at TEXT NOT NULL,               -- ISO-8601 UTC
  local_day TEXT NOT NULL,              -- 'YYYY-MM-DD' America/New_York
  meal TEXT CHECK(meal IN ('breakfast','lunch','dinner','snack')),
  description TEXT NOT NULL,
  kcal REAL, protein_g REAL, carbs_g REAL, fat_g REAL, fiber_g REAL,
  confidence TEXT CHECK(confidence IN ('high','medium','low')),
  source TEXT CHECK(source IN ('text','photo','recipe','restaurant')),
  photo_path TEXT,
  recipe_id INTEGER REFERENCES recipe(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_food_local_day ON food_log(local_day);

CREATE TABLE pantry_item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT CHECK(location IN ('pantry','fridge','freezer')),
  quantity REAL, unit TEXT,
  purchased_on TEXT, expires_on TEXT,
  is_staple INTEGER NOT NULL DEFAULT 0,   -- auto-replenish
  reorder_threshold REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pantry_expires ON pantry_item(expires_on);

CREATE TABLE recipe (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, instructions TEXT,
  servings INTEGER,
  kcal_per_serving REAL, protein_g REAL, carbs_g REAL, fat_g REAL,
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  tags TEXT,                              -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE recipe_ingredient (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  name TEXT NOT NULL, quantity REAL, unit TEXT
);
CREATE TABLE grocery_list_item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, quantity REAL, unit TEXT,
  aisle TEXT, checked INTEGER NOT NULL DEFAULT 0,
  added_by TEXT CHECK(added_by IN ('mealplan','staple','manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ========== TRAINING & BODY ==========
CREATE TABLE workout (
  id INTEGER PRIMARY KEY,
  performed_at TEXT NOT NULL, local_day TEXT NOT NULL,
  name TEXT, notes TEXT, rpe_session REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE workout_set (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL,
  set_number INTEGER, reps INTEGER, weight_lb REAL, rpe REAL,
  is_pr INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_set_exercise ON workout_set(exercise);

CREATE TABLE body_metric (
  id INTEGER PRIMARY KEY,
  measured_at TEXT NOT NULL, local_day TEXT NOT NULL,
  metric TEXT NOT NULL,        -- 'weight_lb','bodyfat_pct','waist_in',...
  value REAL NOT NULL,
  source TEXT                  -- 'manual','apple_health'
);
CREATE INDEX idx_body_metric ON body_metric(metric, local_day);

-- ========== WEARABLE / RECOVERY ==========
CREATE TABLE health_daily (
  local_day TEXT PRIMARY KEY,
  steps INTEGER, active_kcal REAL, resting_hr REAL, hrv_ms REAL,
  sleep_minutes INTEGER, sleep_deep_min INTEGER, sleep_rem_min INTEGER,
  vo2max REAL, source TEXT DEFAULT 'apple_health',
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ========== MIND ==========
CREATE TABLE mood_log (
  id INTEGER PRIMARY KEY,
  logged_at TEXT NOT NULL, local_day TEXT NOT NULL,
  mood INTEGER CHECK(mood BETWEEN 1 AND 5),
  energy INTEGER CHECK(energy BETWEEN 1 AND 5),
  stress INTEGER CHECK(stress BETWEEN 1 AND 5),
  note TEXT
);
CREATE TABLE journal_entry (
  id INTEGER PRIMARY KEY,
  written_at TEXT NOT NULL, local_day TEXT NOT NULL,
  body TEXT NOT NULL,
  embedded INTEGER NOT NULL DEFAULT 0   -- flag: pushed to episodic.db
);
CREATE TABLE goal (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, domain TEXT, target_value REAL, unit TEXT,
  cadence TEXT,                          -- 'daily','weekly'
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE habit_event (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER REFERENCES goal(id) ON DELETE CASCADE,
  local_day TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 1
);

-- ========== HEALTHCARE OPS ==========
CREATE TABLE insurance_plan (
  id INTEGER PRIMARY KEY,
  plan_name TEXT NOT NULL,               -- 'Anthem HSA 3300 HDHP'
  plan_year INTEGER NOT NULL,
  deductible_individual REAL, deductible_family REAL,
  oop_max_individual REAL, oop_max_family REAL,
  coinsurance_pct REAL
);
CREATE TABLE claim (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER REFERENCES insurance_plan(id),
  service_date TEXT, provider TEXT, description TEXT,
  billed REAL, allowed REAL, plan_paid REAL, patient_owed REAL,
  applied_to_deductible REAL, applied_to_oop REAL,
  status TEXT CHECK(status IN ('submitted','processed','paid','denied','appeal')),
  eob_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE prior_auth (
  id INTEGER PRIMARY KEY,
  service TEXT, provider TEXT, submitted_on TEXT,
  status TEXT CHECK(status IN ('pending','approved','denied')),
  expires_on TEXT, notes TEXT
);
CREATE TABLE medication (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, dose TEXT, schedule TEXT,   -- 'qd','bid', cron-ish
  is_supplement INTEGER NOT NULL DEFAULT 0,
  days_supply INTEGER, last_filled_on TEXT, refills_left INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lab_result (
  id INTEGER PRIMARY KEY,
  drawn_on TEXT NOT NULL, panel TEXT, analyte TEXT NOT NULL,
  value REAL, unit TEXT, ref_low REAL, ref_high REAL, flag TEXT
);
CREATE INDEX idx_lab_analyte ON lab_result(analyte, drawn_on);
CREATE TABLE hsa_contribution (
  id INTEGER PRIMARY KEY,
  contributed_on TEXT NOT NULL, tax_year INTEGER NOT NULL,
  amount REAL NOT NULL, source TEXT       -- 'payroll','manual'
);

-- ========== MONEY ==========
CREATE TABLE account (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, type TEXT,          -- 'checking','brokerage','hsa',...
  institution TEXT, plaid_item_id TEXT, is_read_only INTEGER DEFAULT 1
);
CREATE TABLE transaction_row (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES account(id),
  posted_on TEXT NOT NULL, amount REAL NOT NULL,
  merchant TEXT, category TEXT, is_recurring INTEGER DEFAULT 0,
  source TEXT CHECK(source IN ('plaid','csv','manual'))
);
CREATE INDEX idx_txn_posted ON transaction_row(posted_on);
CREATE TABLE budget (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL, monthly_limit REAL NOT NULL, active INTEGER DEFAULT 1
);
CREATE TABLE holding (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES account(id),
  symbol TEXT NOT NULL, shares REAL, cost_basis REAL,
  asset_class TEXT, target_pct REAL,      -- for drift detection
  as_of TEXT
);
CREATE TABLE subscription (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, amount REAL, cadence TEXT,
  next_charge_on TEXT, last_used_on TEXT, flagged_unused INTEGER DEFAULT 0
);

-- ========== LIFE ADMIN ==========
CREATE TABLE task (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, notes TEXT, domain TEXT,
  due_on TEXT, recur_rule TEXT,           -- RRULE-ish for recurring maintenance
  priority INTEGER DEFAULT 3,
  status TEXT CHECK(status IN ('open','done','snoozed','cancelled')) DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_due ON task(due_on, status);
CREATE TABLE document (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, category TEXT,     -- 'insurance','lease','tax',...
  file_path TEXT NOT NULL, added_on TEXT, indexed INTEGER DEFAULT 0
);
CREATE TABLE price_watch (
  id INTEGER PRIMARY KEY,
  item TEXT NOT NULL, url TEXT, target_price REAL,
  last_price REAL, last_checked TEXT, active INTEGER DEFAULT 1
);

-- ========== SOCIAL ==========
CREATE TABLE contact (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, relationship TEXT,
  birthday TEXT, keep_in_touch_days INTEGER, last_contacted_on TEXT,
  gift_ideas TEXT, notes TEXT
);
CREATE TABLE reading_item (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, author TEXT, kind TEXT,   -- 'book','article'
  status TEXT CHECK(status IN ('backlog','reading','done')) DEFAULT 'backlog',
  rating INTEGER, added_on TEXT
);

-- ========== SYSTEM / AUTONOMY ==========
CREATE TABLE approval (
  id INTEGER PRIMARY KEY,
  tier INTEGER NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL,  -- JSON
  reasoning TEXT, confidence REAL, reversibility TEXT,
  status TEXT CHECK(status IN ('pending','approved','denied','expired')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT,
  decided_at TEXT
);
CREATE TABLE action_audit (
  id INTEGER PRIMARY KEY,
  tool TEXT NOT NULL, tier INTEGER, args TEXT, result TEXT,
  session_kind TEXT,                      -- 'user','heartbeat','cron'
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE token_usage (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT, input_tokens INTEGER, output_tokens INTEGER,
  cache_read INTEGER, cache_write INTEGER, session_kind TEXT
);
```

`episodic.db` (separate file, sqlite-vec extension loaded):

```sql
CREATE TABLE chunk (
  id INTEGER PRIMARY KEY,
  kind TEXT CHECK(kind IN ('conversation','journal')),
  source_ref TEXT,           -- chat id + message range, or journal_entry id
  local_day TEXT, text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 384-dim vectors for bge-small-en-v1.5
CREATE VIRTUAL TABLE vec_chunk USING vec0(embedding float[384]);

CREATE TABLE lesson (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,                     -- the insight, imperative voice
  domain TEXT, evidence TEXT,             -- what observation(s) produced it
  confidence REAL, status TEXT CHECK(status IN ('active','retired','superseded')) DEFAULT 'active',
  times_applied INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE VIRTUAL TABLE vec_lesson USING vec0(embedding float[384]);
```

Seed `insurance_plan` at build time with the Anthem HSA 3300 HDHP row: `plan_name='Anthem HSA 3300 HDHP'`, `plan_year=2026`, `deductible_individual=3300`, and the IRS-derived defaults for OOP max (verify against the actual SPD).

---

## 5. Memory System Deep Dive

### 5.1 Layer 1 — Structured (SQLite)

Already specified in §4. The agent never "remembers" a number by putting it in prose; it calls `log_*` tools that write rows, and `query_db` to read. This means totals are always exact and never drift with context compaction. The `query_db` tool accepts parameterized read-only SQL (SELECT-only, enforced by a statement allowlist) so Claude can compose arbitrary aggregations without us pre-building every query.

### 5.2 Layer 2 — Curated markdown context files

Directory `memory/` (git-versioned):

```
memory/
  IDENTITY.md        # Who Cabinet is, tone, boundaries (the persona/SOUL)
  USER.md            # Ben: age, location, job, family, high-level context
  PREFERENCES.md     # Food dislikes, training style, comms tone, UI prefs
  GOALS.md           # Current active goals & targets (protein 185g, cut to 175lb)
  STANDING_ORDERS.md # Persistent operating authority & autonomy promotions
  HEARTBEAT.md       # The proactive checklist (see §8)
  domains/
    nutrition.md     # Narrative summary + rolling insights, curated
    training.md
    health.md
    money.md
    ...
```

**Templates.** `IDENTITY.md` establishes persona and hard boundaries (never execute Tier-1; always cite confidence on estimates). `GOALS.md` is a living file the agent updates (Tier-4) as goals change. `STANDING_ORDERS.md` is where autonomy promotions live ("You may set my fantasy lineup without asking"). These files are small and stable, so they sit in the **cached** portion of the system prompt (§6.3). The `domains/*.md` files are curated summaries — the agent rewrites them during the weekly review, keeping each under ~200 lines to respect the CLAUDE.md size guidance and avoid prompt bloat.

**Critical discipline (from OpenClaw's lessons):** curated files stay curated. Detailed daily notes do NOT go here — they go to SQLite (facts) or episodic (recall). `MEMORY.md`-style files bloat and degrade if used as a daily log; keeping them a "curated long-term summary" is an explicit rule.

### 5.3 Layer 3 — Episodic memory pipeline

**Chunking.** After each conversation chat goes idle (>30 min) or is compacted, a background job chunks new messages into ~512-token windows with ~64-token overlap, tagging each with chat id and local day. Journal entries are chunked at entry granularity.

**Embedding model choice: `bge-small-en-v1.5` (BAAI), 384-dim, ~130MB, CPU-only.** Rationale from the research:
- Per BAAI/Hugging Face, `bge-small-en-v1.5` is 384-dim, **33.36M params** (model.safetensors ~133MB; ONNX fp32 ~127MB). This is markedly lighter than the ~109M-param `bge-base-en-v1.5`; the small model runs comfortably on CPU on a small VPS with no GPU and low RAM. (The 109M `bge-base` also benchmarks fine on CPU if we later want more headroom.)
- On English retrieval, local BGE-class models land within ~1.5 points of OpenAI `text-embedding-3-large` — parity for our purposes.
- 384-dim vectors keep `sqlite-vec` storage and scan costs tiny.
- Ben has ChatGPT Plus but **no OpenAI API access**; local embeddings avoid adding a separate API bill and keep sensitive health/journal text on-box. (Nomic-embed-text-v1.5 is a fine alternative at 768-dim/8k-context if longer chunks matter; `bge-small` is the leaner default.)

Runs as a tiny Python **embedding sidecar** (FastAPI + `sentence-transformers`) on `127.0.0.1:8799`, exposing `POST /embed`. Kept separate from the Node gateway so a model reload never blocks the agent, and so it can be memory-capped.

**Vector store: `sqlite-vec`.** Chosen over LanceDB/Chroma because: our corpus is small (thousands, not millions, of chunks — brute-force KNN is instant at this scale), it's a single-file in-process extension over SQLite we already use, no separate server, full-platform, and it sits right next to relational metadata for hybrid filtering (e.g., "semantic match *within* health-domain journal entries from Q1"). sqlite-vec's brute-force approach is only a liability past ~1M vectors, which we will never approach.

**Retrieval.** `search_episodic(query, filters, k)` embeds the query, runs vector KNN in `vec_chunk`, optionally filters by kind/day/domain via SQL join, and returns the top-k snippets with source refs. Injected into context only when the agent decides recall is relevant (just-in-time), never preloaded.

### 5.4 The "lessons learned" reflection bank

This is the Reflexion/Generative-Agents insight-accumulation pattern, made governed. The 2026 literature is explicit that naive reflection (dump every self-observation into a store) degrades; insights must be **evaluated, evidenced, lifecycle-managed, and governed**.

**Generation.** During the weekly review (Opus) and opportunistically at end of notable interactions, the agent runs a reflection pass: "What did I learn about Ben or about how to serve him better this week? What did I get wrong?" Each candidate lesson is written in imperative voice ("Log Ben's 'usual breakfast' as 3 eggs + 2 toast unless told otherwise"; "Ben's mood drops when deep sleep <60 min for 3+ nights — surface this early").

**Governance (the four requirements, implemented):**
1. **Evaluated** — each lesson gets a confidence score; low-confidence candidates are held, not stored.
2. **Evidenced** — the `evidence` column records the observations that produced it (query results, dated interactions), so a lesson is auditable and can be re-checked.
3. **Lifecycle-managed** — lessons have `status` (active/retired/superseded). When a new lesson contradicts an old one, the old is marked `superseded`. Lessons unused for a long window and never re-confirmed decay toward retirement.
4. **Governed** — no lesson may encode a Tier-0/1 permission escalation; a validation step rejects lessons that would expand autonomy (those require an explicit `STANDING_ORDERS.md` edit that Ben sees).

**Storage & retrieval.** Lessons live in `episodic.db` (`lesson` + `vec_lesson`). At the start of each substantive turn, `recall_lessons(context)` pulls the top few semantically-relevant active lessons and injects them into context. High-value, always-relevant lessons get promoted by the agent into `PREFERENCES.md`/`GOALS.md` (Layer 2) so they're always in the cached prompt. This gives a two-speed memory: cheap always-on preferences vs. situational recalled insights.

---

## 6. Claude API Integration

### 6.1 Model routing strategy

Anthropic's current lineup (July 2026) and our mapping. Note Fable 5 (frontier, ~$10/$50 per million tokens) is available but its subscription inclusion window closed June 22, 2026 and it is overkill here; Mythos 5 is Glasswing-restricted. We use the Claude 4.x agentic tier:

| Task tier | Model | Why | Where |
|---|---|---|---|
| Classification, intent routing, heartbeat "anything urgent?" checks | **Haiku 4.5** (~$1/$5 per MTok, ~97 tok/s) | Cheapest, fastest; most heartbeats resolve to "nothing to do." Minimizes weekly-limit burn on the every-30-min loop. | Heartbeat isolated sessions; message pre-classification |
| Default interactive agent loop; all logging, Q&A, planning, drafting; daily briefings | **Sonnet 4.6** ($3/$15 per MTok, 1M context) | Per ClaudeFast v5.3 benchmarks, Sonnet execution runs came back "~99.5% identical in output quality" to Opus and "Sonnet pulls roughly five times less from your usage limits than Opus does for equivalent work" — the correct daily driver. | Main session; morning/evening routines |
| Weekly review; cross-domain correlation analysis; reflection/lesson generation; hard multi-step reasoning | **Opus 4.8** ($5/$25 per MTok, browser/agent SoTA) | Deeper reasoning where a wrong insight is costly and the run is infrequent (once weekly). | Sunday cron, isolated session |

This "Haiku for monitoring, Sonnet for execution, Opus on the bookends" routing is exactly the pattern the 2026 Claude-Code community converged on to stretch Max limits, and it maps cleanly onto our workload shape.

### 6.2 System prompt architecture (layered)

The system prompt is assembled per-run from stable→volatile layers, mirroring OpenClaw's "stable prefix, volatile suffix" ordering so the cache prefix stays reusable:

1. **[STABLE, cached]** Core identity + operating rules + autonomy tier definitions (`IDENTITY.md`). Rarely changes.
2. **[STABLE, cached]** Tool catalog / MCP tool definitions.
3. **[SEMI-STABLE, cached]** `USER.md`, `PREFERENCES.md`, `GOALS.md`, `STANDING_ORDERS.md`. Change occasionally; still cached with 1h TTL; a change invalidates only from here down.
4. **[SEMI-STABLE]** Relevant `domains/*.md` summary(ies) for the active topic.
5. **[VOLATILE, not cached]** Recalled lessons (`recall_lessons`) and episodic snippets for this turn.
6. **[VOLATILE, not cached]** Runtime facts: current datetime, session kind (user/heartbeat/cron), today's macro/task snapshot from a fast `query_db`.

Dynamic values (datetime, "user name") are kept OUT of the cached prefix and injected in the message body or a mid-conversation `system` message. This is a documented cache-killing anti-pattern: cache hits require 100% identical prompt segments, so one developer's system prompt opening with `f"Today is {datetime.now().date()}..."` produced "Zero cache hits, all day."

### 6.3 Prompt caching strategy

- Mark cache breakpoints on the last stable block (end of layer 3) with 1h TTL. Per Anthropic's official pricing, cache reads cost 0.1× the base input rate (5-minute cache writes 1.25×, 1-hour cache writes 2×) — e.g., Sonnet 4.6 cache reads run $0.30 vs. $3/MTok base. For an always-on agent re-sending a large stable prefix every turn this is the single highest-leverage cost lever (production workloads report 60–90% input-cost reduction).
- The Agent SDK manages conversation-layer caching automatically for multi-turn chats.
- Heartbeat isolated sessions deliberately carry a *minimal* prefix (`IDENTITY.md` + `HEARTBEAT.md` only) so each 30-min wake is cheap.
- Never interpolate per-turn state into the cached prefix (§6.2).

### 6.4 Token budget math against Max limits

**Plan:** Ben has Claude Max. Sizing assumes **Max 20x ($200/mo)** — per Duet's Claude Code Pricing 2026 breakdown, "roughly 220,000 tokens per 5-hour window, 240 to 480 hours of Sonnet, and 24 to 40 hours of Opus weekly." Treat the hour figures as directional: per Morph (2026), "Anthropic's support docs no longer state fixed hours-of-Sonnet or hours-of-Opus per week. Treat any page quoting exact weekly-hour figures as stale." Monitor actual consumption. If Ben is on Max 5x, cut proactive frequency (see resilience below).

Rough per-turn budgets with caching:
- **Heartbeat (Haiku, isolated, light):** ~3K input (mostly cache reads) + ~200 output. 48 runs/day → trivial; most return `HEARTBEAT_OK`.
- **Morning briefing (Sonnet):** ~8–15K input (cached prefix + a few `query_db` results) + ~1.5K output. 1/day.
- **Interactive turns (Sonnet):** ~5–12K input (largely cached) + ~500–1.5K output. Assume 30–60/day.
- **Weekly review (Opus):** ~40–80K input + ~4K output. 1/week.

This profile sits well within Max 20x weekly limits with headroom, *because* of routing + caching + SQL-first retrieval (facts fetched via tools don't bloat the base prompt). The `token_usage` table logs every call's usage object; a monitor computes rolling weekly consumption and, at >80%, automatically (a) drops heartbeat frequency to 60 min, (b) defers the next Opus review, and (c) surfaces a status note. This is the "watch absorption rate, not just ceiling" discipline.

### 6.5 Agent SDK usage patterns

- Use the SDK's streaming `query()` for the main loop; iterate typed message stream and forward text deltas over SSE to the PWA.
- **Custom tools as in-process MCP servers** via the SDK — no subprocess overhead.
- **Hooks:** `PreToolUse` implements the autonomy policy engine (block/redirect Tier-1/2 to approval queue); `PostToolUse` writes `action_audit`; `SessionStart` loads memory layers; context-editing warning hook flushes durable facts to memory before compaction.
- **Subagents** for parallelizable read-only work (e.g., weekly review spins up domain-scoped analysis subagents), following the Opus-orchestrator / Sonnet-subagent mixed-model pattern.
- **Compaction** (server-side beta) enabled on the main chat; memory tool + context editing paired so nothing durable is lost when tool results are cleared. (Anthropic's internal benchmarks show the memory tool + context editing pairing delivered 84% token savings and a 39% performance improvement on a 100-turn task — the pattern this design leans on.)

---

## 7. Tool Specifications

All tools are in-process SDK tools unless marked (MCP). Each lists name, params, tier, behavior.

**Logging / write (Tier 4 unless noted):**
- `log_food(description, meal?, when?, photo_path?)` → parses to macros, writes `food_log`, returns running daily totals vs. target.
- `log_workout(text|structured)` → writes `workout`+`workout_set`, flags PRs against history.
- `log_body_metric(metric, value, when?)` → writes `body_metric`; if weight, returns EWMA trend.
- `log_mood(mood, energy, stress, note?)` → writes `mood_log`.
- `add_journal(body)` → writes `journal_entry`, queues embedding.
- `log_claim(...)`, `log_lab(...)`, `log_medication(...)`, `log_hsa_contribution(...)` → healthcare writes; recompute accumulators.
- `import_transactions_csv(path)` / Plaid sync (MCP, read-only) → writes `transaction_row`.
- `update_pantry(item, delta, ...)`, `add_recipe(...)`, `upsert_task(...)`, `upsert_contact(...)`, `add_price_watch(...)`.

**Read / query (Tier 4):**
- `query_db(sql)` → SELECT-only, allowlist-validated, returns rows. The workhorse for all aggregation/trend/accumulator reads.
- `search_episodic(query, filters?, k?)` → vector recall of past conversations/journals.
- `recall_lessons(context, k?)` → vector recall of active lessons.
- `search_documents(query)` → RAG over document vault (embeds query, searches indexed docs).
- `web_search` / `web_fetch` (SDK built-ins) → research, price checks.

**Memory management (Tier 4):**
- `update_memory(file, patch)` → edits a `memory/*.md` file (git-committed).
- `add_lesson(text, domain, evidence, confidence)` → governed insert into `lesson` (validation rejects autonomy-escalation).
- `retire_lesson(id, reason)`.

**External integrations (MCP):**
- **Google Workspace** (Gmail/Calendar/Drive; the mature `taylorwilsdon/google_workspace_mcp` covers all of these with OAuth 2.1, or the lighter `mcp-google-workspace`): `calendar_list/create/update` (create/update on own calendar = Tier 3), `gmail_search/draft` (Tier 4 draft) / `gmail_send` (Tier 2, and gated behind the server's `GMAIL_ALLOW_SENDING` flag), `drive_get`.
- **Apple Health** (Health Auto Export MCP, `HealthyApps/health-auto-export-mcp-server`, feeding continuous sync; or the `davidmosiah/apple-health-mcp` local export reader with summary privacy mode): `health_query(metric, range)` → feeds `health_daily` ingestion.
- **Plaid** (read-only MCP): balances, transactions, holdings, liabilities — Tier 4 read only.
- **Yahoo Fantasy** (existing, `yahoomcp.benloe.com`): `fantasy_matchup`, `fantasy_waivers`, `set_lineup` (Tier 3), `submit_waiver_claim` (Tier 2).

**Autonomy / UI:**
- `enqueue_approval(tier, action, payload, reasoning, confidence, reversibility)` → writes `approval`, renders a card.
- `render_widget(type, data)` → emits a rich card to the UI (macro ring, weight chart, pantry list, briefing, approval).

---

## 8. Scheduler & Proactive Routines

Two mechanisms, straight from OpenClaw's model:

- **Heartbeat** — flexible monitoring, every 30 min (default; note OpenClaw itself defaults to 1h under Anthropic OAuth to save tokens — we run 30m on Haiku, which is cheap enough), active hours 07:00–23:00 America/New_York. Runs an **isolated, light-context Haiku** turn that reads `HEARTBEAT.md` and decides if anything needs attention. If nothing: replies `HEARTBEAT_OK` and the gateway suppresses delivery. If something: escalates (may hand off to a Sonnet turn for a substantive response). Defers while a user turn or cron job is active. (OpenClaw's cost note: isolated + light context takes a heartbeat from ~100K tokens down to ~2–5K per run — the reason we can afford 30m cadence.)
- **Cron** — exact schedules, each creating an audited task record.

`HEARTBEAT.md` checklist (small, stable — kept tiny because empty/near-empty heartbeat files are skipped and large ones bloat every run):
```markdown
# Heartbeat checklist
- Any pantry items expiring within 3 days? If so, note for next briefing.
- Any medication with < 5 days supply? Nudge refill.
- Any task overdue or due within 2 hours? Surface it.
- Any calendar conflict in the next 24h? Flag it.
- Any price-watch target hit? Notify.
- Any fantasy lineup deadline within 3h with an inactive/injured starter? Alert.
- If nothing needs attention, reply HEARTBEAT_OK.
```

**Cron schedule (America/New_York):**
| Cron | Time | Model | Routine |
|---|---|---|---|
| `30 6 * * *` | 6:30am | Sonnet | **Morning briefing**: weather (web), calendar, overnight sleep/recovery (health_daily), macro targets for the day (training-adjusted), top 3 tasks, anomaly nudges, fantasy deadlines. Rendered as a briefing widget. |
| `30 20 * * *` | 8:30pm | Sonnet | **Evening check-in**: mood/energy one-tap prompt, macro gap for the day, tomorrow's first event, gentle nudge on any unmet daily habit. |
| `0 9 * * 0` | Sun 9am | Opus | **Weekly review**: correlation analysis (sleep×mood, protein×training, spend trends), goal progress, subscription audit, portfolio drift check, reflection pass → new lessons, rewrite `domains/*.md` summaries. |
| `0 3 * * *` | 3:00am | — | **Maintenance (no LLM)**: SQLite backup, WAL checkpoint, embedding backfill for new chunks, expire stale approvals, token-usage rollup. |

**Briefing assembly** is deterministic-first: a Node function runs the needed `query_db` calls and MCP reads, assembles a structured context block, and hands it to the model to narrate — minimizing tokens and ensuring the numbers are exact.

---

## 9. Web UI / UX Specification

### 9.1 Stack decision

**Custom React (Next.js) PWA using `assistant-ui` + Vercel AI SDK UI**, not LibreChat/Open WebUI.

**Why not the off-the-shelf UIs:** LibreChat and Open WebUI are excellent multi-provider ChatGPT clones, but they're built around chatting with a *model/provider*, expect their own backends (LibreChat requires MongoDB + Meilisearch, and runs three containers; Open WebUI runs a Python backend), and don't natively speak to our custom gateway/agent runtime or render our domain widgets (macro rings, weight charts, approval cards). Bending them to our architecture is more work than a focused custom build.

**Why assistant-ui + Vercel AI SDK:** `assistant-ui` provides production-grade chat primitives (chats, streaming, markdown, attachments, persistence) as React components; the Vercel AI SDK provides the streaming transport (`useChat`, UI message stream protocol over SSE) and — critically — **generative UI**, letting the agent emit rich custom components (our widgets) inline in the conversation. `@assistant-ui/react-ai-sdk` wraps the AI SDK's `useChat` hook as an assistant-ui runtime; our gateway returns a UI message stream (`x-vercel-ai-ui-message-stream: v1`) so we control the backend entirely while getting a polished streaming UI. This is the lowest-friction path to "feels like a native app with rich domain cards."

### 9.2 PWA

- `manifest.json` (name, icons, `display: standalone`, theme color) + a service worker for install-to-home-screen and offline shell. Installable on iPhone so it behaves like an app.
- Mobile-first responsive layout; bottom input bar; safe-area insets for iOS.
- Optimistic send + streaming token render (time-to-first-token < 1s target).

### 9.3 Widgets / rich cards (generative UI)

The agent calls `render_widget(type, data)`; the front end maps types to components:
- **Macro ring** — daily protein/carb/fat/kcal vs. target as concentric rings.
- **Weight chart** — EWMA trend line with raw points.
- **Pantry list / grocery checklist** — grouped by location/aisle, tappable checkboxes (writes back via API).
- **Briefing card** — the morning briefing, sectioned.
- **Approval card** — Tier-2 action packet with payload preview, Approve/Deny/Edit buttons, expiry countdown.
- **Mood/energy check-in** — tappable 1–5 scales.
- **Lab/lab-trend, claim/deductible accumulator, portfolio drift** cards.

### 9.4 Auth

Single-user. **Primary: passkey (WebAuthn)** for phone-native Face/Touch ID unlock; **fallback: strong password** + secure `httpOnly` session cookie. No third-party OAuth login surface (nothing to log in *as others*). Rate-limit login; lock the gateway to localhost behind nginx. Given health + financial data, this is the appropriate bar for a single-user app — simple, phishing-resistant, no external identity dependency.

### 9.5 Streaming architecture

Browser `POST /api/chat` → gateway enqueues turn → Agent SDK `query()` streams typed messages → gateway translates to Vercel UI message stream parts (text-delta, tool-call, custom data for widgets) over SSE → `useChat` renders incrementally. Tool calls and widget payloads travel on the same stream, so cards appear inline as the agent works.

---

## 10. Deployment

### 10.1 Target box & resource budget

DigitalOcean droplet, Ubuntu, **$48/mo tier**. This is either 8GB/4vCPU (standard) or 4GB/2vCPU (premium-Intel/AMD) — Cabinet is spec'd to fit the **4GB floor** so it works on either. It coexists with existing benleo.com and the Yahoo Fantasy MCP.

Resource budget (fits 4GB):
| Component | RAM (typical) | Notes |
|---|---|---|
| Existing benleo.com + nginx | ~150–300MB | already resident |
| Yahoo Fantasy MCP | ~80–150MB | already resident |
| Cabinet gateway (Node/TS) | ~200–400MB | main process |
| Claude Code / Agent SDK subprocess | ~150–300MB | spawned per active turn; serialized so ≤1 at a time |
| Embedding sidecar (Python, bge-small) | ~350–500MB | model resident; memory-capped via systemd |
| SQLite (cabinet.db + episodic.db) | negligible RAM; on-disk | WAL |
| External MCP servers (Google/Plaid/Health, on-demand) | ~50–120MB each, short-lived | spawned as needed |
| **Headroom / OS** | remainder | add 2GB swap for safety |

CPU: embedding of a day's chunks is a few seconds on CPU; agent turns are network-bound (Claude is remote). Comfortably within 2 vCPU. **Add a 2GB swapfile** as a safety margin for embedding-model load spikes on the 4GB box.

### 10.2 Directory layout

```
/opt/cabinet/
  gateway/            # Node/TS gateway + agent runtime (built)
  web/                # Next.js PWA (built static + SSR)
  embed/              # Python embedding sidecar
  memory/             # curated markdown (git repo)
  data/
    cabinet.db  episodic.db  chats/*.jsonl
    documents/  photos/   backups/
  config/
    .env              # secrets (0600): CLAUDE_CODE_OAUTH_TOKEN, session secret,
                      #   Plaid keys, Google OAuth creds, ANTHROPIC_API_KEY (overflow, optional)
  logs/
```

### 10.3 systemd vs Docker

**Recommendation: systemd units, not Docker**, for this box. Rationale: the droplet already runs services directly; the workload is a few long-lived processes (gateway, embed sidecar) plus short-lived spawns; Docker adds image + daemon overhead that matters on a 4GB box; systemd gives us clean process supervision, resource caps (`MemoryMax=`), auto-restart, and journald logging with zero container overhead. (If Ben later wants isolation, containerizing the embed sidecar is the one place it'd help — but it's not needed for v1.)

Units:
- `cabinet-gateway.service` — `Restart=always`, `MemoryMax=700M`, `EnvironmentFile=/opt/cabinet/config/.env`, `After=network.target`.
- `cabinet-embed.service` — `Restart=always`, `MemoryMax=700M`, binds `127.0.0.1:8799`.
- `cabinet-web.service` — Next.js server (or serve static build via nginx directly).
- Scheduling via **node-cron inside the gateway** (keeps schedule logic with the agent) — with the heavy weekly Opus review run as a **systemd timer that spawns an isolated `claude -p`** to isolate its memory footprint. Heartbeat + daily routines run in-process.

### 10.4 nginx

Add a server block for `cabinet.benleo.com` proxying to `127.0.0.1:8787`, with SSE-friendly settings (`proxy_buffering off;`, long `proxy_read_timeout`), reusing the existing certbot setup. `cabinet.benleo.com` gets its own Let's Encrypt cert (`certbot --nginx -d cabinet.benleo.com`).

### 10.5 SSL, backups, monitoring

- **SSL:** certbot/Let's Encrypt, auto-renew (already in place for benleo.com).
- **Backups:** nightly (3am maintenance job) `sqlite3 .backup` of both DBs + tarball of `memory/`, `documents/`, `chats/` → encrypted (age/gpg) → off-box (DO Spaces or a second location). Retain 30 daily + 12 monthly. `memory/` is also a git repo pushed to a private remote.
- **Monitoring:** a `/healthz` endpoint (gateway up, DB writable, embed sidecar reachable, OAuth token valid); a lightweight uptime check (UptimeRobot or a cron curl that alerts on failure); token-usage dashboard in the UI; journald for logs. Alert Ben in-app if the OAuth token is within 14 days of its 1-year expiry.

---

## 11. Security & Privacy

Holding health + financial data raises the bar. Controls:

- **Encryption at rest:** full-disk/volume encryption (LUKS) on the droplet's data volume; DB backups encrypted before leaving the box. Secrets in `.env` at `0600`, never in git.
- **Network:** gateway and embed sidecar bind localhost only; nginx is the sole ingress; TLS enforced; HSTS. Firewall (ufw) allows only 80/443/22; SSH key-only.
- **Auth:** passkey/strong password; secure httpOnly SameSite cookies; login rate-limiting.
- **Least-privilege tools:** Plaid and all financial tools are read-only; Tier-0/1 actions are structurally impossible for the agent; the SELECT-only `query_db` allowlist prevents writes/deletes via SQL. Gmail send stays behind both the Tier-2 approval queue *and* the MCP server's own send flag.
- **Prompt-injection defense:** content fetched from the web or third-party MCPs (emails, docs) is untrusted. Treat it as data, not instructions; the policy engine still gates any consequential action regardless of what fetched content "asks." Never auto-execute Tier-2 from content-derived requests. This is the concrete mitigation for the OpenClaw "Wild West" risk Karpathy flagged.
- **Audit:** every tool call logged to `action_audit`; every approval decision timestamped. Full traceability for incident review.
- **Data minimization:** episodic/journal text stays local (local embeddings, no third-party embedding API). Only the necessary context for a given turn is sent to Claude; Anthropic's API (not training) processes it. Prefer ZDR-eligible features (the memory tool and context editing are both ZDR-eligible) for the most sensitive flows.
- **Token hygiene:** the `CLAUDE_CODE_OAUTH_TOKEN` is a bearer credential to Ben's subscription — treat like a password, `0600`, rotate on the 1-year cycle, revocable via `claude logout`. (Note the sharp edge: OAuth failures have been observed when a 1M-context model is selected under subscription auth; if auth breaks, confirm the routed model is a 200K/standard variant.)

---

## 12. Failure Modes & Resilience

| Failure | Detection | Behavior |
|---|---|---|
| **Claude API down / 5xx** | SDK error | Retry with exponential backoff; if a user turn, stream a graceful "I'm having trouble reaching my brain, retrying"; **logging tools still work** (deterministic writes don't need the model), so data capture never blocks. Queue proactive routines for later. |
| **Max weekly limit hit (429)** | 429 / usage monitor >100% | If `ANTHROPIC_API_KEY` overflow is configured and enabled, fall back to metered API for high-priority (user) turns only; suppress proactive routines until reset. Otherwise, degrade to logging-only + notify Ben with reset time. The token monitor pre-empts this by throttling at 80%. |
| **OAuth token expired/revoked** | 401 | Detect on first 401, stop retry storm, mark auth-expired, notify Ben in-app with re-`setup-token` instructions. (Token is 1-year; 14-day expiry warning pre-empts.) |
| **Embedding sidecar down** | health check | Episodic search returns "recall temporarily unavailable"; agent proceeds on SQL + curated memory. Chunk embedding backfills when sidecar returns. Never blocks logging or chat. |
| **Memory file corruption** | git + parse check | `memory/` is git-versioned; on parse failure, revert to last good commit; alert Ben. |
| **SQLite corruption** | integrity check in maintenance job | Restore from nightly `.backup`; WAL mode + serialized writes minimize risk. |
| **Runaway loop / repeated tool calls** | per-turn tool-call cap + max-turns | Hard `max_turns` (and `--max-turns` on headless review runs) plus a per-turn tool-call ceiling; circuit-breaker halts and reports rather than burning tokens. |
| **Gateway crash** | systemd | `Restart=always`; JSONL transcripts + SQLite mean no in-flight data loss beyond the current partial turn. |
| **Bad/hallucinated macro or estimate** | confidence field + human review | Estimates always carry a confidence band; low-confidence values are flagged and easily corrected, and corrections become lessons. |

---

## 13. Implementation Order for Claude Code (dependency-ordered build plan)

This is **build sequencing**, not product phasing — execute top to bottom.

1. **Provisioning & auth spine.** Create `/opt/cabinet` layout; install Node LTS, Python, sqlite + sqlite-vec, bge-small model; generate `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`; write `.env` (0600); add 2GB swap; ufw + SSH hardening.
2. **Data layer.** Create `cabinet.db` with the full §4 schema; create `episodic.db` with sqlite-vec tables; seed `insurance_plan` with the Anthem HSA 3300 HDHP row and the 2026 IRS limits ($4,400 self-only contribution, $1,700 min deductible, $8,500 OOP max per Rev. Proc. 2025-19); write DB access module with WAL + SELECT-only `query_db` allowlist.
3. **Embedding sidecar.** FastAPI + sentence-transformers `bge-small-en-v1.5` on `127.0.0.1:8799`; `/embed` + `/healthz`; systemd unit with `MemoryMax`.
4. **Memory layer.** Create `memory/*.md` from templates (IDENTITY, USER, PREFERENCES, GOALS, STANDING_ORDERS, HEARTBEAT, domains/*); init as git repo; `update_memory`/`add_lesson`/`recall_lessons`/`search_episodic` tools + chunk/embed pipeline.
5. **Gateway + agent runtime core.** Node/TS gateway: HTTP+SSE server, serialized turn queue, Agent SDK integration with OAuth auth, layered system-prompt assembler, prompt-cache breakpoints, model routing. Get a single streaming text turn working end-to-end from a curl.
6. **In-process tool suite + autonomy engine.** All `log_*`, `query_db`, memory tools; `PreToolUse` policy hook implementing the 5-tier system + approval queue (`approval` table + `enqueue_approval`); `PostToolUse` audit; `token_usage` logging.
7. **Structured domains (no external deps).** Wire and test food, training, body, mood, journal, tasks, healthcare (claims/meds/labs/HSA accumulators), money-CSV, contacts, reading, recipes/pantry/grocery. This is fully functional via chat before any MCP.
8. **External MCP integrations.** Register Google Workspace (Cal/Gmail/Drive), Apple Health (Health Auto Export), Plaid (read-only), and the existing Yahoo Fantasy MCP; wire their tiers.
9. **Document vault + RAG.** Ingest/index PDFs (insurance SPD, lease, tax) into the doc store; `search_documents`; benefits Q&A.
10. **Scheduler & proactive routines.** node-cron heartbeat (Haiku, isolated/light) + `HEARTBEAT.md`; daily briefing (6:30) and evening check-in (20:30) on Sonnet; weekly review (Opus) as a systemd timer spawning isolated `claude -p`; 3am maintenance (backup/checkpoint/embed-backfill).
11. **Web UI / PWA.** Next.js + assistant-ui + Vercel AI SDK; SSE wired to gateway UI-message-stream; passkey/password auth; PWA manifest + service worker; widget components (macro ring, weight chart, pantry/grocery, briefing, approval card, mood check-in).
12. **Reflection & lessons governance.** Wire the weekly reflection pass; lesson evaluation/evidence/lifecycle/governance validation; promotion of high-value lessons into Layer-2 files.
13. **Resilience & ops.** Backoff/fallback logic, token-budget throttle at 80%, `/healthz`, uptime alert, encrypted off-box backups, token-expiry warning, nginx `cabinet.benleo.com` block + certbot cert.
14. **Hardening pass.** Prompt-injection review of all content-ingesting tools; confirm Tier-0/1 are structurally blocked; verify SELECT-only enforcement; end-to-end autonomy-tier tests including approval expiry; restore-from-backup drill.

---

## Appendix A — Key external facts this design depends on (verify before/at build)

- **Third-party-harness ban:** Anthropic enforced blocking third-party harnesses (OpenClaw etc.) from Claude subscription limits on **April 4, 2026**; first-party subscription-authenticated Agent SDK / `claude -p` via `claude setup-token` remains supported. The planned **June 15, 2026** move of non-interactive usage to a separate monthly credit ($20 Pro / $100 Max 5x / $200 Max 20x) was **paused on the day it was to take effect** — nothing changed, but Anthropic signaled it may revisit. Design for portability (the `ANTHROPIC_API_KEY` overflow path) so a future policy change doesn't brick Cabinet.
- **Model prices (per MTok, July 2026):** Haiku 4.5 ~$1/$5; Sonnet 4.6 $3/$15; Opus 4.8 $5/$25; Fable 5 ~$10/$50 (subscription inclusion ended June 22, 2026). Prompt-cache reads 0.1×, 5-min writes 1.25×, 1-hr writes 2×.
- **Max 20x sizing (directional):** ~220,000 tokens per 5-hour window; ~240–480 Sonnet-hours + ~24–40 Opus-hours weekly. Exact hour figures are no longer officially published — monitor `token_usage`.
- **IRS HSA/HDHP limits:** 2026 (Rev. Proc. 2025-19) — self-only contribution $4,400, catch-up $1,000, min deductible $1,700, OOP max $8,500. 2027 (Rev. Proc. 2026-24) — self-only $4,500, min deductible $1,750, OOP max $8,700. A $3,300 self-only deductible is a valid HSA-qualified HDHP for 2026.
- **Embedding model:** `bge-small-en-v1.5` — 384-dim, 33.36M params, ~133MB — CPU-only, within ~1.5 pts of `text-embedding-3-large` on English retrieval.

*End of specification. Built to be executed directly by Claude Code on the target droplet.*