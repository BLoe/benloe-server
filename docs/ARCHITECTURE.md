# Cabinet — system map

What lives where, and why the pieces are split the way they are. Written
2026-08-11 from a read of the tree; accurate as of commit `18ad546`.

This is orientation, not reference. It does not list every file, and it will
drift — when it disagrees with the code, the code is right.

Cabinet is two npm packages under `apps/cabinet/` — a Node/Express/TypeScript
server and a React/Vite web client — plus a data tree that lives outside the
repo entirely.

---

## Layout

```
apps/cabinet/
├── node_modules/              deps live HERE, not in server/ or web/
├── ecosystem.config.js        PM2 config (cabinet-api, port 3008)
├── server/
│   ├── src/
│   │   ├── index.ts           composition root (~250 lines)
│   │   ├── gateway/           HTTP + SSE surface        (~2.8k LOC)
│   │   ├── runtime/           the agent loop            (~2.9k LOC)
│   │   ├── mcp/               tools exposed to the model  (~900)
│   │   ├── domains/           business logic per life area (~4.4k, biggest)
│   │   ├── memory/            the prompt / persona layer (~1.5k)
│   │   ├── episodic/          vector search over history  (~360)
│   │   ├── scheduler/         cron jobs                   (~950)
│   │   ├── tiers/             approval gates              (~520)
│   │   ├── integrations/      plaid, githubApp, secrets   (~1.4k)
│   │   ├── deploy/            self-redeploy intent + confirmation
│   │   ├── push/              web push
│   │   ├── embeddings/        local embedder in a worker thread
│   │   └── db/                SQLite open + migrations
│   └── test/                  ~50 files, ~830 tests
└── web/src/
    ├── surfaces/              Chat, Today, Brain, Money, Domains, Ops, Credentials
    ├── components/shell/      AppShell, Rail, CommandBar, PresenceStrip
    ├── components/instruments/ Dial, Gauge, Ring, Sparkline — dashboard vocabulary
    ├── lib/                   API client, contracts, draft handling
    └── styles/                tokens.css, base.css

/srv/benloe/data/cabinet/      NOT in git
├── cabinet.db                 the main database
├── episodic.db                embeddings for conversation + document search
├── memory/                    the persona files — its own git repo, no remote
├── documents/  chat-images/  backups/
```

Two layout facts that cost time if you don't know them:

- **Dependencies are hoisted to `apps/cabinet/node_modules`.** `server/` and
  `web/` have almost-empty `node_modules` of their own. Cabinet is *not* a npm
  workspace of the monorepo root, so tooling run from `server/` resolves
  upward. A git worktree of this repo therefore cannot build or test Cabinet
  without symlinking that directory in.
- **`server/cabinet.db` is a 0-byte relic**, gitignored. The real database is
  in `data/`. Pointing a tool at the wrong one produces an empty schema and a
  confusing silence rather than an error.

---

## The request path

**`gateway/`** is the only thing that talks to the outside. `app.ts` holds the
routes; the two that matter are `POST /api/chat` (run a turn) and
`GET /api/events` (the SSE stream every surface listens on). `sse.ts` is the
broadcast plumbing, `surfaces.ts` and `fold.ts` shape what the UI reads,
`transcript.ts` serves conversation history.

`pendingTurn.ts` is the crash-recovery breadcrumb: if a turn dies mid-flight —
which happens routinely, because Cabinet redeploys itself — the next boot
resumes that chat rather than leaving it hung.

**`runtime/`** is the agent loop.

- `agent.ts` drives the Claude Agent SDK and translates its message stream into
  UI events. The largest file in the module.
- `prompt.ts` assembles the prompt in two halves: a cache-stable `systemPrompt`
  and a per-turn `turnContext`.
- `session.ts` pools CLI subprocesses. **It keys the pool on the system
  prompt's hash**, so a system prompt that varies per turn respawns the
  subprocess every turn — the byte-stability requirement is about session reuse
  first and the prompt cache second.
- `queue.ts` serialises turns; one in flight per process.
- The rest are small and single-purpose: `register.ts`, `router.ts`,
  `titler.ts`, `rateLimits.ts`, `perf.ts`, `toolTruncate.ts`, `mcpHealth.ts`.

**`mcp/cabinet-server.ts`** builds the tools the model sees, in-process, via
`createSdkMcpServer` — `log_food`, `query_db`, `update_memory`, the `money_*`
family, and so on. They are deliberately thin: nearly every one is a wrapper
that validates arguments and calls into `domains/`. `external.ts` wires up
third-party MCP servers from the environment.

Because the server is in-process, it cannot fail independently of the API
process — so an MCP outage means the CLI subprocess's connection state
flipped, which is what `runtime/mcpHealth.ts` exists to record.

**`domains/`** is where the actual logic lives — one file per life area (food,
health, healthcare, money, mealplan, shopping, training, substances, cravings,
symptoms, credentials, and so on). This is the largest module in the server and
the part that is neither prompt nor plumbing.

---

## Supporting modules

**`memory/`** — the persona layer. `MemoryStore` reads and writes the markdown
files in `data/cabinet/memory/`; `promptCore()` concatenates a fixed ordered
subset of them into the system prompt. `templates.ts` holds seed copies,
`release.ts` applies template changes to already-deployed files, `lessons.ts`
handles the promotable-lesson lifecycle.

**`episodic/`** — a second SQLite database of embedded conversation chunks and
documents, searched by the `search_episodic` / `search_documents` /
`recall_lessons` tools.

**`scheduler/`** — cron jobs, armed at startup unless `CABINET_SCHEDULER=off`.
The current set: `heartbeat`, `morning-briefing`, `morning-nudge`,
`evening-checkin`, `weekly-review`, `maintenance`, `money-sync`,
`idle-builder`, and three timed pings. `idle-builder` is Cabinet building
things unprompted. Every job is also reachable by hand through
`POST /api/admin/jobs/:name/run`, backed by the same job array the timers use.

**`tiers/`** — the approval model. Actions are classified and gated;
`approvals.ts` is the queue, and expired approvals are swept at boot.

**`integrations/`** — `plaid.ts` (banking), `githubApp.ts` (mints and refreshes
`GH_TOKEN`, and scrubs the private key out of `process.env` because agent
shells snapshot it), `brokerClient.ts` (reads secrets from cabinet-secrets over
a unix socket, so this process holds none of them).

**`db/`** — `openDb()` plus numbered SQL migrations. Roughly fifty tables,
spanning the quantified-self data, money, healthcare, tasks, and Cabinet's own
bookkeeping (`action_audit`, `perf_span`, `token_usage`, `build_run`).

---

## Startup

`server/src/index.ts` is a composition root and reads top to bottom as one.
Two things happen before anything else, both load-bearing:

1. **Privilege drop.** PM2 starts the process as root (its fork wrapper lives
   under `/root` and is unreadable to an unprivileged user), so the process
   immediately becomes `claude-worker` and refuses to continue if it is still
   root. This runs above the imports, so no module side effect ever executes
   with root privileges.
2. **`$HOME` correction.** Node does not touch `process.env` on privilege drop,
   so `HOME` is still `/root` afterwards. The SDK's bash tool snapshots
   `process.env` verbatim when it builds a session's shell, so every agent
   shell would inherit the wrong home directory. It is fixed here by asking the
   OS user database for the effective uid's home.

After that: open the databases, build the memory store and apply any pending
template release, construct Plaid, build the MCP server, build the runtime,
build the scheduler, build the app, listen, resume any interrupted turn, arm
the scheduler.

---

## Where the prompt actually comes from

Worth stating plainly, because it is the seam the prompt-architecture work has
to move (see [`prompt-architecture.md`](prompt-architecture.md)).

The prompt is assembled from two places:

| source | size | in the public repo? | reviewable? |
|---|---|---|---|
| `memory/index.ts` → `promptCore()`, reading `data/cabinet/memory/*.md` | ~19.5k tokens | no | no |
| `runtime/prompt.ts` → `TURN_DISCIPLINE` | ~0.5k tokens | yes | yes |

`promptCore()` reads a fixed ordered list of markdown files from a single
directory and concatenates them, each wrapped in a `<memory file="...">` tag.
`assemblePrompt()` then splits the result into the cache-stable `systemPrompt`
and a `turnContext` carrying everything volatile — the clock, the interlocutor,
recalled lessons, today's snapshot, topic-selected domain files — with
`TURN_DISCIPLINE` last so it lands immediately before the user's words.

The consequence for the rewrite: moving charter and system content into the
repo is not a file move. `MemoryStore` is constructed with one directory and
`promptCore()` has no notion of reading from anywhere else. A second source has
to exist before any of those files can live under review.
