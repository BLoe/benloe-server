# Cabinet v2 — Personal Agent for the benloe.com Nexus
## Architecture & Implementation Specification (v2.0, July 2026)
### Designed from the ground up for this server, to be built in one continuous pass by Claude Code

**What this document is.** A complete rewrite of `AgentArchitecture.md` (v1), re-grounded in the actual machine it runs on. v1 was researched from the outside and specced a server that doesn't exist (nginx, DigitalOcean 4GB, `/opt/cabinet`, systemd app management, a from-scratch passkey auth system, a Python embedding sidecar, `benleo.com`). v2 is written against the real benloe.com nexus: Caddy, PM2, the artanis auth service, the `/srv/benloe` monorepo, 8GB/4-core, Node 24, and an existing unprivileged `claude-worker` user. It also adds the capability v1 omitted entirely — **agentic dev tools (bash, file read/write, deploys) so the agent can build and operate things on this server** — governed by the same autonomy-tier machinery. It is written to be executed top-to-bottom by Claude Code in a single build, no phases.

---

## 0. TL;DR — what changed from v1 and why

| Area | v1 said | v2 says | Why |
|---|---|---|---|
| Domain | `cabinet.benleo.com` | `cabinet.benloe.com` | Typo throughout v1 |
| Reverse proxy | nginx + certbot | **Caddy** drop-in file in `infra/caddy/` | It's what runs here; TLS is automatic |
| Process mgmt | systemd units in `/opt/cabinet` | **PM2** app in `/srv/benloe/apps/cabinet`, monorepo convention | Platform convention; one less management plane |
| Auth | New passkey/WebAuthn + password system | **artanis** magic-link cookie + owner-email allowlist | Auth service already exists and every app here uses it; don't build a second one |
| Embeddings | Python FastAPI sidecar (sentence-transformers) | **In-process Node** via `@huggingface/transformers` v4 (ONNX, CPU) in a worker thread | Kills an entire service; verified bge-small-en-v1.5 runs 384-dim on CPU in Node with zero Python |
| Frontend | Next.js + assistant-ui + Vercel AI SDK | **Vite + React + Tailwind, hand-rolled chat UI and SSE protocol**, with a test suite | Platform preference (Vite); we control both ends of the wire; dependencies only where we can't/shouldn't maintain the code ourselves |
| Models | Haiku 4.5 / Sonnet 4.6 / Opus 4.8 | **Haiku 4.5 / Sonnet 5 / Opus 4.8**, with **Fable 5** as explicit opt-in escalation | Sonnet 4.6 is previous-gen; Sonnet 5 (`claude-sonnet-5`) is the current daily driver |
| Claude auth | Subscription OAuth token, assumed stable | **Dual-path**: subscription OAuth token *and* `ANTHROPIC_API_KEY`, switchable by env var, with automatic fallback | Policy is verifiably in flux (June 15 credit-pool change paused on its start date); parts of current docs say the Agent SDK requires API-key auth. Wire both; verify live at build |
| Dev capability | None | **Full agentic toolset** (Bash/Read/Write/Edit/Glob/Grep + deploy privops), tier-governed | Ben's explicit requirement: the agent builds things on this server |
| Memory location | `memory/` inside the app, git-pushed | **`/srv/benloe/data/cabinet/`** (gitignored), own private local git repo | The benloe-server repo is **public**; personal/health data must never land in it |
| Privilege | implied root | **Runs as `claude-worker`** (uid 1000), root actions only via an audited, root-owned privops wrapper | An internet-reachable agent with shell tools must not be root |

What v1 got right and v2 keeps wholesale: the three-layer memory split (SQL facts / curated markdown / vector episodic), consequence-based autonomy tiers enforced in the tool layer, deterministic writes so logging never depends on a model call, model routing + prompt caching as first-order cost controls, serialized turns, heartbeat + cron proactivity, JSONL-inspectable everything, and the full eight life domains.

---

## 1. Platform context (the nexus as it exists today)

Facts the design builds on, verified on the box on 2026-07-07:

- **Host:** Ubuntu, kernel 6.17, 4 vCPU, 7.8 GB RAM (~6.5 GB available), 136 GB free disk. No swap (not needed at this RAM; embeddings are ~130 MB resident).
- **Ingress:** Caddy. `benloe.com` static + `import /srv/benloe/infra/caddy/*` for subdomains. TLS automatic.
- **Apps:** PM2 (root daemon): artanis-auth :3002, weights-api :3003, dada-api :3004, fantasy-hawk-api :3005, yahoo-fantasy-mcp :3006, fitness-api :3007, gamenight :3000/:3001. **Port 3008 is free → Cabinet gateway.**
- **Auth:** artanis issues a `.benloe.com`-scoped httpOnly JWT cookie (`token`) after magic-link login. Apps validate by calling `GET http://localhost:3002/api/auth/me` with the cookie (see `apps/weights-api/src/middleware/auth.ts` — the canonical middleware).
- **Secrets:** `/srv/benloe/.env` (never committed). Contains, among others, `ANTHROPIC_API_KEY` (already present) and `MCP_TOKEN_SECRET` for the Yahoo MCP.
- **Data:** SQLite files in `/srv/benloe/data/` (gitignored). better-sqlite3 already in use (yahoo-fantasy-mcp). sqlite3 CLI 3.46 installed.
- **Claude:** Claude Code 2.1.202 installed at `/root/.local/bin/claude`, logged in with Ben's **Max subscription**. `claude setup-token` available. Node v24.6.
- **Users:** `claude-worker` (uid 1000) exists and owns `/srv/benloe`. PM2 currently runs everything as root.
- **Hardening baseline:** ufw active (22, 80, 443, mosh 60000-61000/udp only), SSH key-only (`PermitRootLogin prohibit-password` wins in sshd_config.d), fail2ban active, unattended-upgrades replaced by the 7-day-delay apt system (`infra/scripts/apt-delayed-upgrade.sh`).
- **Repo:** `github.com/BLoe/benloe-server`, **public**. `data/`, `logs/`, `.env` gitignored.

---

## 2. What Cabinet is

A single-user, always-on personal assistant for Ben at `cabinet.benloe.com`: a streaming, mobile-installable PWA chat app backed by a gateway that embeds the **Claude Agent SDK**. It logs and reasons across eight life domains (food/nutrition, training/body, healthcare ops, mind/recovery, money, life admin, social/leisure, cross-domain intelligence), holds three-layer long-term memory, acts proactively on a heartbeat + cron schedule, and — new in v2 — **works as a platform engineer on this server**: it can read the monorepo, write code, build, test, deploy, and operate the other benloe.com apps through tier-gated dev tools.

### 2.1 Design principles (v1's seven, amended)

1. **The model is the runtime; everything else is plumbing.** Gateway → agent runtime → tools. The raw model never sees user input without the gateway mediating.
2. **Facts as facts, prose as prose, experiences as embeddings.** SQL for anything aggregable; curated markdown for preferences/narrative; vectors only for genuine semantic recall.
3. **Autonomy is a property of the action, not the agent.** Tier decided per-action by reversibility × magnitude × confidence, enforced in the tool layer (`canUseTool`), never merely in the prompt.
4. **Cost is an architectural constraint.** Model routing, cache-friendly prompt layering, isolated light heartbeat sessions, SQL-first retrieval. This matters *more* in v2 because Claude billing policy is in flux (§9.1).
5. **Local-first, single-tenant.** One user, one box, no multi-tenancy. Health + financial data never leaves infrastructure Ben controls (embeddings are local; only per-turn context goes to the Claude API).
6. **Everything inspectable.** Markdown memory, plain SQLite, JSONL transcripts. `cat`-able, `grep`-able, git-versioned (privately).
7. **Degrade gracefully; never lose data.** Deterministic writes; logging works even when the model doesn't.
8. **(New) Dependencies only where we can't or shouldn't maintain the code.** The Agent SDK, native bindings (better-sqlite3, sqlite-vec), the ONNX runtime, and security-sensitive parsers (markdown sanitization) are dependencies. Chat UI, SSE protocol, stream parsing, turn queue, tier engine, scheduler glue are **hand-rolled with tests**. Claude Code maintains this codebase; generic architecture code is cheap to write and own, and a vitest suite is the quality gate.
9. **(New) Least privilege on a box that also runs everything else.** The agent process runs as `claude-worker`. The blast radius of a prompt-injected or confused agent is bounded by filesystem ownership and a short, audited sudo allowlist — not by trust in the prompt.

---

## 3. Feature specification

Domains 3.1–3.8 carry over from v1 §2 essentially unchanged in *what* they do (natural-language + photo food logging with macro estimates; workout/PR/volume tracking with EWMA weight trend; benefits Q&A over plan documents, deductible/OOP accumulators, meds/labs; sleep + mood check-ins and journaling; read-only money tracking with the hard rule that Cabinet never moves money; calendar/tasks/document vault/price watching; birthdays/keep-in-touch/reading/fantasy basketball via the existing Yahoo MCP; morning briefing / evening check-in / weekly review / anomaly nudges). Consult v1 §2 for the worked interaction examples — they remain the product bar. What changes is the substrate they run on (this document) and one **new domain**:

### 3.9 Platform engineering (new)

- **Read anything** in `/srv/benloe` (code, configs, logs, PM2 status) to answer questions and diagnose issues: "why is gamenight-api restarting?"
- **Build and modify apps**: write code in `/srv/benloe/apps/*` and `/srv/benloe/static/*`, run `npm install/build/test`, iterate. Notify-after (Tier 3) inside the workspace.
- **Deploy**: restart PM2 services, add Caddy site files and reload — via the root-owned privops wrapper, with Caddy changes and *new* services gated behind approval (Tier 2).
- **Ship**: `git add/commit` (Tier 3), `git push` (Tier 2 — it publishes to a public repo).
- **Structurally cannot**: touch artanis, its own gateway code, `/srv/benloe/.env`, other apps' databases (writes), systemd, apt, ufw, or anything outside its allowed directories (Tier 0, enforced by `canUseTool` *and* by unix permissions).

Example interaction:

> **Ben:** the dada site should have a button that regenerates the image. build it and deploy.
> **Cabinet:** Done. I added a "regenerate" button to `static/dada.benloe.com/index.html` wired to the existing `POST /api/generate` on dada-api :3004, rebuilt nothing (static site), and verified with a curl that the endpoint responds. Committed as `dada: add regenerate button` (not pushed — say the word and I'll push, that's approval-gated). 🔧 *2 files changed · view diff*

---

## 4. System architecture

### 4.1 Component diagram

```
  iPhone / Desktop (installed PWA)
        │  HTTPS
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Caddy                                                        │
│  cabinet.benloe.com {                                           │
│    /api/*  → 127.0.0.1:3008 (SSE-friendly)                   │
│    /*      → static /srv/benloe/apps/cabinet/web/dist           │
│  }                                                           │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Cabinet GATEWAY  (Node/TS, Express, :3008, runs as claude-worker)│
│  • artanis auth middleware + owner-email allowlist           │
│  • Threads/messages API + hand-rolled SSE chat stream        │
│  • Serialized turn queue (one agent turn at a time)          │
│  • Tier engine: canUseTool → allow / deny / approval queue   │
│  • Scheduler: heartbeat (30m) + cron (briefings, review)     │
│  • Embedding worker thread (transformers.js, bge-small)      │
│  • Token/usage monitor + budget throttle                     │
└───────┬───────────────────────────────┬──────────────────────┘
        │ Agent SDK query()             │ better-sqlite3
        ▼                               ▼
┌────────────────────────┐   ┌─────────────────────────────────┐
│ AGENT RUNTIME          │   │ DATA  /srv/benloe/data/cabinet/    │
│ @anthropic-ai/         │   │  cabinet.db      (facts, threads)  │
│   claude-agent-sdk     │   │  episodic.db  (sqlite-vec)      │
│ model routing per turn │   │  memory/      (markdown, git)   │
│ session resume per     │   │  documents/ photos/ backups/    │
│   thread               │   └─────────────────────────────────┘
│ layered system prompt  │
└───────┬────────────────┘
        │ tools
        ▼
┌──────────────────────────────────────────────────────────────┐
│ TOOLS                                                        │
│  Built-in (SDK): Bash, Read, Write, Edit, Glob, Grep,        │
│                  WebSearch, WebFetch      ← tier-gated       │
│  In-process MCP: log_* , query_db, search_episodic,          │
│                  recall_lessons, update_memory, add_lesson,  │
│                  enqueue_approval, render_widget, …          │
│  External MCP:   yahoo-fantasy (127.0.0.1:3006, existing),   │
│                  google-workspace, apple-health, plaid       │
│                  (config-activated when creds are present)   │
│  Privops:        sudo /srv/benloe/infra/scripts/             │
│                  cabinet-privops.sh  (pm2 restart, caddy reload)│
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Gateway

Long-lived Node/TypeScript Express process, PM2-managed as `cabinet-api`, bound to `127.0.0.1:3008`, running as `claude-worker`.

Endpoints:

| Route | Purpose |
|---|---|
| `POST /api/chat` | Send a user message to a thread; responds with the SSE turn stream (§12.2) |
| `GET  /api/threads` / `POST /api/threads` / `PATCH /api/threads/:id` | List / create / rename-archive threads |
| `GET  /api/threads/:id/messages` | Paged message history for a thread |
| `GET  /api/approvals` / `POST /api/approvals/:id` | Pending approval packets; approve/deny/edit |
| `POST /api/interrupt` | Abort the in-flight turn (AbortController → SDK) |
| `GET  /api/usage` | Token/cost dashboard data |
| `GET  /healthz` | Gateway up, DB writable, embedder ready, Claude auth valid, queue depth |
| `GET  /api/events` | Long-lived SSE channel for out-of-band pushes (proactive nudges, approval cards arriving while no turn is open) |

**Turn queue.** All agent turns — user, heartbeat, cron — pass through one serialized queue. Scheduled turns defer while a user turn is active; a user turn preempts a *pending* (not running) heartbeat. This bounds memory (one SDK subprocess at a time), keeps cache locality, and — if subscription auth is active — respects the shared rate pool.

**Auth middleware** (the platform pattern, plus a hard allowlist):

```ts
// server/src/middleware/auth.ts — same shape as weights-api, plus owner pinning
const OWNER = process.env.CABINET_OWNER_EMAIL; // below413@gmail.com
export async function authenticate(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const r = await fetch('http://localhost:3002/api/auth/me', {
    headers: { Cookie: `token=${token}` },
  });
  if (!r.ok) return res.status(401).json({ error: 'Authentication failed' });
  const { user } = await r.json();
  if (!user || user.email !== OWNER) {
    return res.status(403).json({ error: 'Not authorized for Cabinet' }); // single-user, hard wall
  }
  req.user = user;
  next();
}
```

Anyone can get a magic link from artanis; only the owner email passes this wall. This check guards a process with shell tools, so it is applied to **every** route including `/healthz`'s detailed variant (a bare liveness ping is public).

### 4.3 Agent runtime

Wraps `@anthropic-ai/claude-agent-sdk` (TypeScript). One `query()` call per turn:

```ts
const q = query({
  prompt: userText,                      // or async generator for tool-result continuations
  options: {
    model: route(turn),                  // 'claude-haiku-4-5' | 'claude-sonnet-5' | 'claude-opus-4-8' | 'claude-fable-5'
    resume: thread.sdkSessionId,         // per-thread continuity across process restarts
    cwd: '/srv/benloe',
    additionalDirectories: ['/srv/benloe/data/cabinet'],
    systemPrompt: assemblePrompt(turn),  // layered, cache-stable prefix (§9.3)
    // ⚠ VALIDATED PITFALL: a tool listed bare in allowedTools is auto-approved
    // BEFORE canUseTool is consulted (the SDK warns: CAN_USE_TOOL_SHADOWED).
    // Gated tools (Bash/Write/Edit/…) must NEVER appear in allowedTools — they
    // fall through to the gate. allowedTools is reserved for ungated Tier-4
    // in-process MCP tools only.
    disallowedTools: HARD_DENIES,        // e.g. 'Bash(sudo *)' except privops, 'Bash(rm -rf /*)' …
    canUseTool: tierEngine.gate,         // async; blocks awaiting approval (§6) — validated: deny prevents execution
    hooks: { PreToolUse: [auditHook] },  // audit EVERY call, incl. the narrow echo-grade
                                         // "safe read-only" class the CLI auto-approves
                                         // without consulting canUseTool (validated)
    mcpServers: { cabinet: cabinetMcpServer, yahoo: yahooMcp, ...externalMcps },
    maxTurns: turn.kind === 'heartbeat' ? 6 : 40,
    includePartialMessages: true,        // stream deltas for the UI
    settingSources: [],                  // fully programmatic; ignore filesystem settings
  },
});
```

- The SDK provides the agentic loop, context compaction, session persistence, and subprocess isolation. The gateway records the `session_id` from the init message onto the thread row; `resume` restores it after restarts.
- `canUseTool` is the tier engine's hook: it is async and blocks, which is exactly how Tier-2 "approve-before" works — the turn pauses mid-flight, an approval card streams to the UI, and the callback resolves when Ben taps approve/deny (or the packet expires).
- Heartbeat/cron turns run as **fresh sessions with a minimal prompt** (no `resume`, light context) so a wake costs ~2–5K tokens, not a replay of history.
- Subagents (SDK `agents` option) are defined for the weekly review: read-only domain analysts (Sonnet 5) fanned out by an Opus 4.8 orchestrator.

### 4.4 Session & conversation management

Two complementary stores, by design:

1. **`cabinet.db` `thread` + `message` tables** — the UI's source of truth. Every user message, assistant message (as ordered typed parts: text, tool-run, widget, approval-ref), and turn usage row is written here as the stream happens. History rendering, search, and thread lists never touch SDK internals.
2. **SDK session transcripts** (JSONL under the `claude-worker` home) — the *agent's* source of truth for `resume`. The gateway treats these as an implementation detail; if a session is lost, the thread falls back to a fresh session seeded with a summary of recent `message` rows.

Threads are cheap; Ben can keep one long-running "main" thread and spin topical ones. Compaction is the SDK's job; durable facts are protected because they live in SQLite/markdown, not in the context window (Principle 2).

---

## 5. Data model

`/srv/benloe/data/cabinet/cabinet.db`, WAL mode, `foreign_keys=ON`. Timestamps ISO-8601 UTC; `local_day` derived in `America/New_York`. The v1 §4 domain schema is adopted **verbatim** — `food_log`, `pantry_item`, `recipe`, `recipe_ingredient`, `grocery_list_item`, `workout`, `workout_set`, `body_metric`, `health_daily`, `mood_log`, `journal_entry`, `goal`, `habit_event`, `insurance_plan`, `claim`, `prior_auth`, `medication`, `lab_result`, `hsa_contribution`, `account`, `transaction_row`, `budget`, `holding`, `subscription`, `task`, `document`, `price_watch`, `contact`, `reading_item`, `approval`, `action_audit`, `token_usage` — with these v2 additions:

```sql
-- ========== CHAT (new in v2) ==========
CREATE TABLE thread (
  id TEXT PRIMARY KEY,                  -- nanoid
  title TEXT,
  sdk_session_id TEXT,                  -- Agent SDK session for resume
  model_override TEXT,                  -- per-thread routing override ('fable', 'opus', …)
  kind TEXT CHECK(kind IN ('user','heartbeat','cron')) DEFAULT 'user',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  role TEXT CHECK(role IN ('user','assistant','system')) NOT NULL,
  parts TEXT NOT NULL,                  -- JSON array of typed parts (§12.2)
  usage TEXT,                           -- JSON usage snapshot for assistant turns
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_message_thread ON message(thread_id, created_at);

-- action_audit gains dev-tool context
ALTER TABLE action_audit ADD COLUMN thread_id TEXT;
ALTER TABLE action_audit ADD COLUMN tier INTEGER;      -- (already in v1; kept)
ALTER TABLE action_audit ADD COLUMN decision TEXT;     -- 'allowed','denied','approved','auto'
```

`episodic.db` is v1's design unchanged (`chunk` + `vec_chunk float[384]`, `lesson` + `vec_lesson float[384]`), loaded through the pinned `sqlite-vec@0.1.9` extension on better-sqlite3 12.x. Migrations live in `server/src/db/migrations/*.sql`, applied by a tiny hand-rolled runner (tracked in a `schema_migration` table) with tests.

Seed data: the `insurance_plan` row (Anthem HSA 3300 HDHP, plan year 2026, `deductible_individual=3300`) and the IRS 2026 limits as constants in the healthcare module ($4,400 self-only contribution / $1,700 min deductible / $8,500 OOP max per Rev. Proc. 2025-19; 2027: $4,500 / $1,750 / $8,700) — verify against the actual SPD when Ben uploads it.

---

## 6. Autonomy tier system

Five tiers, enforced in `canUseTool` (never only in the prompt). The engine classifies each call from `(toolName, input)` → tier → behavior:

| Tier | Behavior | Life-domain actions | Dev/platform actions |
|---|---|---|---|
| **4 — Autonomous** | Execute, audit-log | Read any Cabinet data; `log_*`; `query_db`; memory ops; analyses; briefings; web search/fetch; price checks | `Read`/`Glob`/`Grep` anywhere allowed; read-only Bash (`git status/log/diff`, `ls`, `cat` non-secret, `pm2 list` via privops, log tails); read other apps' DBs |
| **3 — Notify-after** | Execute, then tell Ben | Calendar events on Ben's own calendar; create tasks; set fantasy lineup; grocery staples | `Write`/`Edit` under `/srv/benloe/{apps,static}/**` (minus Tier-0 paths); `npm install/build/test`; `git add/commit`; `pm2 restart <existing app>` via privops |
| **2 — Approve-before** | Approval packet; blocked await | Send email/message to a third party; fantasy waiver claim; any purchase | `git push` (public repo!); Caddy site file changes + reload; **new** PM2 service; schema migrations on other apps' DBs; deleting files outside the current task's diff |
| **1 — Human-only** | Draft/recommend only, never execute | Trades, payments, medical appointments | `apt`, kernel/OS changes, ufw, DNS |
| **0 — Blocked** | Tool call rejected with explanation | Bulk-delete memory; disable guardrails | Touch `apps/artanis/**`, `apps/cabinet/server/**` (self-modification), `/srv/benloe/.env`, `infra/systemd/**`, `/etc/**`, `~/.ssh`, other apps' DB **writes**, `claude-worker` credentials |

Mechanics:

- **Bash classification** is conservative: a small hand-rolled classifier (tested) buckets commands by executable + args into `readonly` / `build` / `vcs-local` / `vcs-publish` / `privops` / `unknown`. `unknown` ⇒ Tier 2. Compound commands (`&&`, `;`, `|`) classify as the *max* tier of their parts.
- **Path checks** resolve symlinks (`realpath`) before matching allow/deny prefixes — no traversal games.
- **Approval packets** (Tier 2) carry: action, exact payload (full command / diff / email body), reasoning, confidence, reversibility note, expiry (default 24h). They render as cards in the chat stream *and* on the `/api/events` channel, and are answerable from any device. `canUseTool` resolves `allow` (optionally with edited input) or `deny{message}` accordingly.
- **Promotions**: `STANDING_ORDERS.md` can promote specific Tier-2 action classes to Tier-3 ("you may push to the games/ static site without asking"). Promotions are only ever written by Ben or via an approved packet — the lesson-governance validator rejects any lesson that would expand autonomy.
- **Everything audited**: every gate decision writes `action_audit` (tool, args hash, tier, decision, thread, session kind).

Tier 0 is defense-in-depth, not the only wall: unix permissions back it up (§13.2). Even a bypassed gate is a `claude-worker` process that cannot read root-owned secrets or write to `/etc`.

---

## 7. Memory system

### 7.1 Layer 1 — structured (SQLite)

As v1 §5.1. The agent never "remembers" a number in prose; `log_*` tools write rows; `query_db` reads with a SELECT-only guard (single statement, no PRAGMA/ATTACH, parses via better-sqlite3 `readonly` connection). Totals are exact and immune to compaction.

### 7.2 Layer 2 — curated markdown

`/srv/benloe/data/cabinet/memory/` — **outside the public repo**, its own local git repo (committed on every `update_memory`, optionally pushed to a *private* GitHub remote if Ben configures one):

```
memory/
  IDENTITY.md         # persona, tone, hard boundaries (never execute Tier 1; cite confidence)
  USER.md             # Ben: context, family, work
  PREFERENCES.md      # food, training, comms, UI
  GOALS.md            # live goals & targets (agent-updated, Tier 4)
  STANDING_ORDERS.md  # autonomy promotions — human-edited or approval-gated only
  HEARTBEAT.md        # the proactive checklist (§11)
  PLATFORM.md         # what the agent has learned about operating this server
  domains/*.md        # per-domain rolling narrative, rewritten in the weekly review, ≤200 lines each
```

Discipline unchanged from v1: curated files stay curated; daily detail goes to SQLite or episodic, never here.

### 7.3 Layer 3 — episodic + lessons (local vectors, no sidecar)

- **Embedding:** `@huggingface/transformers` v4 (ONNX runtime) running `Xenova/bge-small-en-v1.5` (384-dim, quantized ~30 MB) **inside a Node worker thread** in the gateway. No Python, no extra service, no port. The worker exposes `embed(texts[]) → Float32Array[]`; model loads lazily on first use and stays resident (~200–400 MB).
- **Store:** `sqlite-vec@0.1.9` (pinned — healthy but slow-cadence, bus-factor-1 project) `vec0` tables in `episodic.db`. Brute-force KNN is instant at our scale (thousands of chunks).
- **Chunking:** after a thread goes idle >30 min, a background job chunks new messages (~512 tokens, 64 overlap) tagged with thread id + local day; journal entries chunk at entry granularity.
- **Lessons:** the governed reflection bank exactly as v1 §5.4 — evaluated (confidence-gated), evidenced (`evidence` column), lifecycle-managed (active/retired/superseded, decay on disuse), governed (no autonomy escalations; those require STANDING_ORDERS.md through Ben). `recall_lessons(context)` injects top-k relevant active lessons per substantive turn; high-value stable ones get promoted into Layer 2.
- **Failure mode:** embedder down ⇒ episodic search returns "recall unavailable", chunks queue for backfill, nothing else blocks.

---

## 8. Tool catalog

**In-process MCP tools** (via `tool()` + `createSdkMcpServer`, zod schemas, exposed as `mcp__cabinet__*`):

- Logging (Tier 4): `log_food`, `log_workout`, `log_body_metric`, `log_mood`, `add_journal`, `log_claim`, `log_lab`, `log_medication`, `log_hsa_contribution`, `import_transactions_csv`, `update_pantry`, `add_recipe`, `upsert_task`, `upsert_contact`, `add_price_watch`.
- Read (Tier 4): `query_db` (SELECT-only), `search_episodic`, `recall_lessons`, `search_documents` (RAG over the vault: PDFs → text → chunks → episodic index with `kind='document'`).
- Memory (Tier 4): `update_memory` (git-committed), `add_lesson`, `retire_lesson`.
- UI/autonomy: `render_widget(type, data)` (emits a widget part on the stream + persists into the message), `enqueue_approval` (used by the engine; also directly callable when the agent wants to propose something unprompted).

**Built-in SDK tools** (tier-gated per §6): `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`. `cwd` is `/srv/benloe`; `additionalDirectories` adds the data dir. Hard `disallowedTools` patterns back up the tier engine (`Bash(sudo *)` except the privops wrapper, etc.).

**External MCP servers** (SDK `mcpServers`, each activates only when its env creds exist — absent creds ⇒ the server simply isn't registered, no dead tools in context):

- `yahoo` → the existing HTTP MCP at `127.0.0.1:3006` (lineups Tier 3, waiver claims Tier 2).
- `google-workspace` → Calendar (own-calendar writes Tier 3), Gmail (`draft` Tier 4 / `send` Tier 2), Drive read.
- `apple-health` → Health Auto Export ingestion into `health_daily`.
- `plaid` → read-only balances/transactions/holdings (Tier 4 read; there is no write).

**Privops** (the only sudo surface, §13.2): `cabinet-privops.sh pm2-restart <app>` (Tier 3), `cabinet-privops.sh pm2-start <ecosystem-under-/srv/benloe/apps>` (Tier 2), `cabinet-privops.sh caddy-reload` (Tier 2, always preceded by `caddy validate`).

---

## 9. Claude integration

### 9.1 Auth — dual-path, because policy is in flux

Verified timeline (July 2026): Anthropic blocked third-party harnesses (OpenClaw et al.) from subscription limits on **2026-04-04**; announced "Agent SDK credits" in May; the **2026-06-15** plan to move all non-interactive Agent SDK usage to separate monthly credits ($20 Pro / $100 Max 5x / $200 Max 20x) was **paused on its start date**. Today, Agent SDK usage under subscriptions works as before — but some current docs assert the SDK requires API-key auth under consumer ToS, and Anthropic has signaled the change may return with notice. Conclusion: **treat auth as a runtime configuration, not an architectural assumption.**

- `CABINET_CLAUDE_AUTH=subscription` → inject `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, stored in `/srv/benloe/.env`) into the SDK subprocess env.
- `CABINET_CLAUDE_AUTH=api` → inject `ANTHROPIC_API_KEY` (already present in `.env`).
- **Startup probe**: one cheap Haiku call; on 401/403/policy error in subscription mode, log loudly, flip to `api` for the session, and surface a banner in the UI. The `/healthz` endpoint reports which mode is live.
- Build-time step: run `claude setup-token` interactively (Ben), store the token, test both modes, document which one stuck.

### 9.2 Model routing

| Route | Model (exact ID) | $/MTok in/out | Used for |
|---|---|---|---|
| `nano` | `claude-haiku-4-5` | 1 / 5 | Heartbeats ("anything urgent?" → mostly `HEARTBEAT_OK`), intent classification, title generation |
| `default` | `claude-sonnet-5` | 3 / 15 (intro 2 / 10 through 2026-08-31) | All interactive chat, logging, planning, briefings, routine dev work. 1M context; near-Opus on coding/agentic work |
| `deep` | `claude-opus-4-8` | 5 / 25 | Weekly review + reflection, cross-domain correlation, hard multi-step dev builds, code review of its own diffs |
| `max` | `claude-fable-5` | 10 / 50 | **Opt-in only** (`/model fable` per thread, or the router escalating *with a notify*): the hardest long-horizon builds. Caveats: thinking always on, `refusal` stop reason must be handled (fall back to Opus 4.8), requires 30-day data retention org setting — the runtime handles all three |
| effort | — | — | `effort: 'high'` default; `xhigh` for `deep`/`max` dev tasks; `low` for heartbeats |

Escalation heuristic: the gateway never silently spends `max`; it either honors a thread override or asks ("this looks like a 45-minute build — want me to run it on Fable 5?").

### 9.3 Prompt layering & caching

Stable → volatile, so the cached prefix survives across turns (cache reads are 0.1× input price — the single biggest lever on an always-on agent):

1. **[stable]** IDENTITY.md + operating rules + tier definitions.
2. **[stable]** Tool guidance (the SDK manages tool schemas itself).
3. **[semi-stable]** USER.md, PREFERENCES.md, GOALS.md, STANDING_ORDERS.md, PLATFORM.md.
4. **[semi-stable]** Relevant `domains/*.md` for the active topic.
5. **[volatile]** Recalled lessons + episodic snippets for this turn.
6. **[volatile]** Runtime facts: datetime, session kind, today's snapshot from a fast deterministic `query_db`.

Datetime and any per-turn value stay **out** of layers 1–4 (the classic cache-killer). Heartbeats carry only IDENTITY + HEARTBEAT.md.

### 9.4 Budget

`token_usage` logs every turn's usage from the SDK result message (input/output/cache read/cache write, model, session kind, and `total_cost_usd` when API-billed). A monitor computes rolling spend; at a configurable threshold (default $2/day API mode; 80% of weekly limit in subscription mode, inferred from 429s) it: drops heartbeat cadence to 60m → 120m, defers the next Opus review, and posts a status note. Rough steady-state estimate at API rates with caching: heartbeats ≈ $5–8/mo, interactive (30–60 Sonnet 5 turns/day) ≈ $10–30/mo, weekly Opus review ≈ $3–5/mo, dev sessions variable — **order of $20–50/mo if metered, $0 marginal if subscription auth holds.** The dashboard makes it visible either way.

---

## 10. — (merged into §8)

---

## 11. Scheduler & proactive routines

Hand-rolled scheduler in the gateway (a ~80-line module + tests): fixed local-time jobs computed against `America/New_York` via `Intl.DateTimeFormat` (DST-safe "next occurrence" math, re-armed after each run) plus a simple interval heartbeat. No cron dependency; the schedule table *is* the config:

| Job | When (America/New_York) | Model | Does |
|---|---|---|---|
| Heartbeat | every 30m, 07:00–23:00 | Haiku 4.5 | Fresh light session reads HEARTBEAT.md + fast deterministic snapshot; replies `HEARTBEAT_OK` (suppressed) or escalates to a Sonnet 5 turn that posts a nudge |
| Morning briefing | 06:30 | Sonnet 5 | Deterministic assembly (queries + MCP reads) → model narrates → briefing widget to the main thread + `/api/events` push |
| Evening check-in | 20:30 | Sonnet 5 | Mood/energy tap card, macro gap, tomorrow's first event |
| Weekly review | Sun 09:00 | Opus 4.8 (+ Sonnet 5 subagents) | Correlations (sleep×mood, protein×training, spend), goal progress, subscription/portfolio audit, reflection pass → lessons, rewrite `domains/*.md` |
| Maintenance | 03:00 daily | none | `sqlite3 .backup` both DBs, WAL checkpoint, embedding backfill, expire stale approvals, usage rollup, memory-git gc, encrypted off-box backup sync |

`HEARTBEAT.md` checklist is v1's verbatim (pantry expiries, med supply, due tasks, calendar conflicts, price watches, fantasy deadlines — else `HEARTBEAT_OK`). Jobs defer while a user turn is active; missed windows run once on next tick, never stack.

---

## 12. Web UI — hand-rolled PWA

### 12.1 Stack

Vite + React + TypeScript + Tailwind, served as static files by Caddy from `web/dist`. Dependencies limited to: `react`, `react-dom`, `marked` + `dompurify` (markdown rendering with XSS sanitization — security-sensitive parsing we should not hand-roll), and a chart is drawn with hand-rolled SVG (macro ring, weight trend — they're two components, not a charting library). Everything else — chat state, stream parsing, components — is ours, with vitest coverage.

### 12.2 The wire protocol (ours)

`POST /api/chat {threadId, text}` responds `Content-Type: text/event-stream`. Named SSE events, JSON data:

```
event: turn-start      data: {"messageId","threadId","model"}
event: text-delta      data: {"delta"}
event: tool-start      data: {"toolId","name","input","tier"}
event: tool-end        data: {"toolId","output","isError","durationMs"}
event: widget          data: {"widgetType","data"}            # macro-ring, weight-chart, briefing, grocery, checkin, diff
event: approval        data: {"approvalId","action","payload","reasoning","confidence","reversibility","expiresAt"}
event: approval-result data: {"approvalId","status"}
event: notice          data: {"level","text"}                 # auth fallback, budget throttle, …
event: turn-end        data: {"usage","sessionId","stopReason"}
event: error           data: {"message","retryable"}
```

The same event vocabulary flows on `GET /api/events` for out-of-band pushes (briefings, nudges, approvals raised by scheduled turns). Server encoder and client parser share a TypeScript type module; a round-trip property test (encode → parse ≡ identity, chunk-boundary fuzzing included) is part of the suite. Client transport is `fetch` + `ReadableStream` (not `EventSource` — we need POST bodies and custom reconnect); reconnect with `Last-Event-ID` resumes `/api/events`.

### 12.3 Client architecture

- `useThread(threadId)` — hand-rolled hook: loads history from `/api/threads/:id/messages`, sends via `/api/chat`, folds stream events into an ordered `parts[]` per message (text accumulates; tool-runs get start→end lifecycle; widgets and approvals are typed parts). Optimistic user message, abort support, error surface. Fully unit-tested against recorded streams.
- Components: `ThreadList`, `ChatView`, `Composer` (bottom bar, safe-area insets), `MessagePart` dispatcher, `ToolRunCard` (collapsible terminal-style card for Bash/dev tools showing command + streamed output), `ApprovalCard` (payload preview, Approve / Edit / Deny, countdown), `MacroRing`, `WeightChart`, `BriefingCard`, `GroceryChecklist` (checkboxes POST back), `MoodCheckin` (1–5 taps), `UsageDash`.
- **PWA:** `manifest.json` (standalone, icons, theme), service worker for shell caching + installability; mobile-first layout; time-to-first-token target <1s (Sonnet 5 + warm cache makes this realistic).

---

## 13. Deployment & security

### 13.1 Layout, PM2, Caddy

```
/srv/benloe/apps/cabinet/
  server/        # gateway + runtime + tools (TS → dist/)
  web/           # Vite PWA (→ dist/, served by Caddy)
  ecosystem.config.js
  package.json   # npm workspaces: server, web
/srv/benloe/data/cabinet/          # gitignored: cabinet.db, episodic.db, memory/(git), documents/, photos/, backups/
/srv/benloe/infra/caddy/cabinet.benloe.com
/srv/benloe/infra/scripts/cabinet-privops.sh   # root-owned
```

`ecosystem.config.js` (PM2 root daemon reads secrets, spawns unprivileged):

```js
module.exports = { apps: [{
  name: 'cabinet-api',
  script: './server/dist/index.js',
  cwd: '/srv/benloe/apps/cabinet',
  uid: 'claude-worker', gid: 'claude-worker',        // ← privilege separation
  env: {
    NODE_ENV: 'production', PORT: 3008,
    CABINET_OWNER_EMAIL: 'below413@gmail.com',
    CABINET_CLAUDE_AUTH: env.CABINET_CLAUDE_AUTH,          // 'subscription' | 'api'
    CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    CABINET_DATA_DIR: '/srv/benloe/data/cabinet',
    HOME: '/home/claude-worker',                     // SDK session storage
    CLAUDE_CONFIG_DIR: '/home/claude-worker/.cabinet-claude',
    // ↑ mandatory isolation (validated): without it, ambient Claude settings
    //   files (permission allow rules) can shadow canUseTool entirely.
  },
  max_memory_restart: '1200M',                       // embedder headroom
  error_file: '/srv/benloe/logs/cabinet-api-err.log',
  out_file: '/srv/benloe/logs/cabinet-api-out.log',
  time: true,
}]};
```

`infra/caddy/cabinet.benloe.com`:

```caddy
cabinet.benloe.com {
    handle /api/* {
        reverse_proxy 127.0.0.1:3008 {
            flush_interval -1          # SSE: no buffering
        }
    }
    handle {
        root * /srv/benloe/apps/cabinet/web/dist
        try_files {path} /index.html
        file_server
    }
    encode gzip                        # Caddy skips compressing text/event-stream automatically
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
    log { output file /var/log/caddy/cabinet.benloe.com.log }
}
```

### 13.2 Privilege separation & privops

- `cabinet-api` runs as `claude-worker` (uid 1000), which owns `/srv/benloe` — so the agent can read/build/write apps and its own data **without** being able to touch `/etc`, `/root`, systemd, or root-owned secrets.
- **`/srv/benloe/.env` is re-owned `root:root` mode 600** (hardening fix — it's currently `claude-worker`-owned, which would hand the agent every platform secret). PM2's root daemon still reads it in ecosystem configs; all existing apps run as root and are unaffected. The agent process receives only the env vars its ecosystem entry injects.
- Root actions go through **one wrapper**, `/srv/benloe/infra/scripts/cabinet-privops.sh` — root-owned, 755, non-writable by claude-worker (note: it must live outside claude-worker-writable dirs or be immutable; we place the *canonical* copy at `/usr/local/sbin/cabinet-privops` root-owned and keep the repo copy as source) — which validates arguments against hard patterns before acting:
  - `pm2-restart <name>` — name must match an existing PM2 app.
  - `pm2-start <path>` — path must be `/srv/benloe/apps/*/ecosystem.config.js`; **still Tier 2** at the gate.
  - `caddy-reload` — runs `caddy validate` first; refuses on failure.
  - Everything else: exit 1.
- Sudoers (`/etc/sudoers.d/cabinet`): `claude-worker ALL=(root) NOPASSWD: /usr/local/sbin/cabinet-privops`. Nothing else.
- The SDK subprocess inherits `claude-worker`; even `permissionMode` misconfiguration cannot cross the unix boundary.

### 13.3 Hardening recommendations (server-wide, part of this build)

1. `chown root:root /srv/benloe/.env` — **done 2026-07-07** during pre-build validation; was `claude-worker`-owned, which would have handed the agent every platform secret.
2. Keep ufw/fail2ban/SSH state as-is (already good); add fail2ban jail for repeated 401/403s on `cabinet.benloe.com` via the Caddy log (defense against magic-link/cookie brute-forcing at the artanis layer too).
3. `/root/.claude/.credentials.json` stays root-only (already 600); the agent never sees Ben's interactive Claude credentials — its own token is injected per-process.
4. Backups (03:00 job): `sqlite3 .backup` + tar of `memory/`, `documents/`, thread exports → `age`-encrypted → off-box (rclone target Ben configures; until then, encrypted copies rotate locally in `data/cabinet/backups/`, 30 daily + 12 monthly). A restore drill is part of acceptance testing.
5. Prompt-injection posture: all web/MCP/email-derived content is data, not instructions; tier gates fire on *actions* regardless of what fetched content asks; Tier-2 can never be auto-approved by content; approval packets always show the exact payload so Ben approves what will actually run.
6. OS updates: already covered by the 7-day-delay apt system — the agent is Tier-1 on apt and must not touch it.

---

## 14. Failure modes

| Failure | Detection | Behavior |
|---|---|---|
| Claude API down / 5xx | SDK error | Backoff retries; user turns stream a graceful notice; deterministic logging tools still work; scheduled turns queue |
| Subscription auth revoked / policy change | 401/403 or policy error | Auto-flip to `ANTHROPIC_API_KEY`, notice banner, healthz reflects mode |
| Rate limit / budget threshold | 429s / usage monitor | Throttle heartbeats, defer Opus review, notify with reset time |
| Fable 5 refusal stop | `stop_reason: refusal` | Retry the turn on Opus 4.8 automatically; note in stream |
| Embedder crash | worker heartbeat | Episodic search degrades gracefully; backfill on recovery; chat unaffected |
| SDK session lost/corrupt | resume error | Fresh session seeded with summary of recent messages from `message` table |
| Gateway crash | PM2 restart | SQLite + streamed-as-written messages mean loss ≤ current partial turn |
| Runaway agent loop | `maxTurns` + per-turn tool-call ceiling + budget monitor | Circuit-break, report, audit |
| Bad macro/estimate | confidence field | Flagged, correctable, corrections become lessons |
| memory/ git corruption | parse check | Revert to last good commit; alert |
| Approval never answered | expiry | Packet expires (default 24h), turn resumes with deny+explanation |

---

## 15. Implementation plan — one continuous build

Dependency-ordered; each step lands with its tests. No phases, no deferred features — external-service integrations (Google, Plaid, Apple Health) ship fully wired and activate the moment their credentials appear in `.env`, because those credentials are OAuth dances only Ben can perform.

1. **Scaffold & permissions.** `apps/cabinet/{server,web}` workspaces; `data/cabinet/` dirs (+ `memory/` git init); confirm gitignore covers them; `chown root:root /srv/benloe/.env`; sudoers + install `cabinet-privops` to `/usr/local/sbin`; add `.env` keys (`CABINET_CLAUDE_AUTH`, `CABINET_OWNER_EMAIL`, `CLAUDE_CODE_OAUTH_TOKEN` placeholder).
2. **DB layer.** Migration runner + full DDL (v1 domain schema + §5 chat tables); db module (WAL, FK, readonly `query_db` guard). *Tests: migrations idempotent; SELECT-guard rejects writes/PRAGMA/ATTACH/multi-statement.*
3. **Embeddings + episodic.** Worker-thread embedder (`Xenova/bge-small-en-v1.5`), episodic store on sqlite-vec, chunker, backfill job. *Tests: 384-dim output, KNN round-trip, worker crash recovery.*
4. **Memory layer.** Template markdown files; `update_memory`/`add_lesson`/`recall_lessons`/`search_episodic` tools; lesson governance validator. *Tests: escalation-lesson rejection; git commit on write.*
5. **Tier engine.** Bash classifier, path resolver, tier table, approval queue (DB + await/resolve), `canUseTool` gate. *Tests are the heart of the build: table-driven cases for every row of §6 including compound commands, symlink traversal, privops args, expiry.*
6. **Agent runtime.** SDK wrapper: model router, prompt assembler (cache-stable layering), turn queue, session resume, usage recorder, auth dual-path + startup probe, Fable-refusal fallback. *Tests: routing, queue serialization, prompt stability across turns (byte-identical prefix).*
7. **Domain tools.** All `log_*`/read tools from §8 with macro estimation, EWMA, accumulators, PR detection. *Tests: accumulator math, EWMA, daily totals.*
8. **In-process MCP server + external MCP wiring.** `createSdkMcpServer` with everything; yahoo MCP registration against :3006; config-gated google/plaid/apple-health registrations + `docs/cabinet-integrations.md` setup guide for each credential dance.
9. **Gateway HTTP.** Express app, artanis+allowlist middleware, threads/messages/approvals/usage/healthz routes, SSE encoder, `/api/events` channel, interrupt. *Tests: auth wall (wrong email = 403), SSE encode/parse round-trip, approval resolve path.*
10. **Scheduler.** Hand-rolled next-occurrence scheduler + the five jobs; heartbeat escalation path; maintenance job incl. encrypted backups. *Tests: DST boundaries (Mar/Nov), defer-while-busy, no stacking.*
11. **Web UI.** Vite scaffold, `useThread` + stream parser, all components/widgets from §12.3, PWA manifest + SW, usage dashboard. *Tests: hook folding logic against recorded streams; parser fuzz.*
12. **Deploy.** Build both workspaces; ecosystem config (uid claude-worker); Caddy file + reload via privops; PM2 start + save. (Auth prerequisites already done during validation: `claude setup-token` minted → `CLAUDE_CODE_OAUTH_TOKEN` in `.env`; system Node at `/usr/local/bin/node` — replace with a proper NodeSource/apt Node 24 install or keep the copied binary updated alongside root's nvm.)
13. **Acceptance.** End-to-end: login wall (second account gets 403); chat streams; `log_food` → totals; dev task ("add a test page to static/") exercises Tier 3+2 incl. an approval card; heartbeat fires and suppresses `HEARTBEAT_OK`; briefing renders; restore-from-backup drill; tier red-team (attempt `.env` read, artanis edit, sudo escape — all blocked and audited); commit + push the code (not the data).

Acceptance is done when every §14 failure mode has been induced or simulated once, and the §6 tier table has a passing test per row.

---

## Appendix A — verified facts this design depends on (checked 2026-07-07)

- **Models/pricing:** `claude-haiku-4-5` $1/$5 (200K ctx); `claude-sonnet-5` $3/$15 (intro $2/$10 → 2026-08-31, 1M ctx); `claude-opus-4-8` $5/$25 (1M); `claude-fable-5` $10/$50 (1M; thinking always on; `refusal` stop reason; 30-day retention required). Cache reads 0.1×, 5-min writes 1.25×, 1-h writes 2×.
- **Agent SDK (TS):** `query({prompt, options})`; options include `model`, `resume`, `cwd`, `additionalDirectories`, `allowedTools`/`disallowedTools`, async blocking `canUseTool`, `mcpServers`, `agents`, `maxTurns`, `includePartialMessages`, `effort`, `settingSources`. Custom tools via `tool()` + `createSdkMcpServer` (zod). Built-ins: Bash/Read/Write/Edit/Glob/Grep/WebSearch/WebFetch. Result message carries usage (+ `total_cost_usd` under API billing).
- **Auth policy:** third-party harness block enforced 2026-04-04; Agent-SDK-credit plan ($20/$100/$200 monthly) paused 2026-06-15 on its start date; subscription-authenticated Agent SDK usage works today; some docs pages state API-key auth is required for the SDK — hence the dual-path design and startup probe. Re-verify at build.
- **Frontend/vector/embedding libs:** hand-rolled UI needs only `marked`+`dompurify` beyond React/Vite/Tailwind. `sqlite-vec@0.1.9` (2026-03-31) + `better-sqlite3@12.x` + Node 24: compatible; project alive but single-maintainer — pin. `@huggingface/transformers@4.2.0` runs `Xenova/bge-small-en-v1.5` (384-dim) on CPU in Node, replacing any Python sidecar.
- **Platform:** port 3008 free; artanis `/api/auth/me` validation pattern; PM2 `uid` per-app supported; `claude-worker` uid 1000 owns `/srv/benloe`; repo is public (personal data therefore lives only under gitignored `data/`).
- **IRS HSA limits** (healthcare module constants): 2026 — $4,400 self-only / $1,700 min deductible / $8,500 OOP (Rev. Proc. 2025-19); 2027 — $4,500 / $1,750 / $8,700 (Rev. Proc. 2026-24).

## Appendix B — pre-build validation results (experiments run on this box, 2026-07-07)

Agent SDK `0.3.202`, tiny Haiku probes (~$0.10 total metered + a few subscription turns). All in `/home/claude-worker/cabinet-auth-test/`.

| # | Question | Result |
|---|---|---|
| A | SDK on logged-in Max subscription, no API key? | ✅ works; init reports `apiKeySource: "none"` |
| B | SDK on `ANTHROPIC_API_KEY` with clean HOME? | ✅ works; `apiKeySource: "ANTHROPIC_API_KEY"` — this field is the healthz auth-mode signal; `total_cost_usd` is computed in both modes (estimate under subscription) |
| C | `claude-sonnet-5` / `claude-opus-4-8` accepted verbatim? | ✅ both, under both auth modes |
| D | `canUseTool` as blocking approval gate? | ✅ async callback held a Bash call 3s and deny prevented execution — **after** two corrections: (1) bare `allowedTools` entries auto-approve before the callback (SDK warns `CAN_USE_TOOL_SHADOWED`); (2) ambient settings-file allow rules also shadow — isolated `CLAUDE_CONFIG_DIR` is mandatory. Also: a narrow echo-grade "safe read-only" class auto-approves without the callback (`cat` is NOT in it — Tier-0 read denies hold); `PreToolUse` hook covers audit |
| E | Session `resume` across processes? | ✅ new process resumed by session id and recalled prior state |
| F | Runs as `claude-worker`? | ✅ full probe as uid 1000 with own HOME/config; required installing Node system-wide (`/usr/local/bin/node`) — root's nvm is inaccessible to other users |
| G | `setup-token` production shape? | ✅ `claude-worker` + `CLAUDE_CODE_OAUTH_TOKEN` (now in `.env`) + isolated config + no API key + no stored creds → subscription-billed success on Haiku, Sonnet 5, and Opus 4.8; prompt-cache reads observed across probes |

*End of specification. Execute §15 top to bottom.*
