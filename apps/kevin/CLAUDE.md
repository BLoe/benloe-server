# Kevin — working context

Ben's personal agent for life outside work: pantry, cooking, workouts, money,
taxes, documents. Live at https://kevin.benloe.com, owner-only. Designed by
Benji (Ben's work agent) over the relay (`apps/relay`); built and changed only
by Claude Code. Kevin never edits his own code: what he wants changed he
appends to `/var/lib/kevin/SUGGESTIONS.md` with `suggest_improvement`. Read
that file when Ben asks what Kevin has suggested.

One Node process (`kevin-api`, port 3016, uid `kevin`) serves the API, the
SSE stream and the built web app. It calls the Anthropic Messages API directly
through `@anthropic-ai/sdk`.

```
apps/kevin/
  workspace/   persona.md rules.md people.md profile.md   -> the system prompt; Ben edits these with Claude Code
  server/      src/ (TypeScript, ESM)  test/ (vitest)
  web/         Vite + React + Tailwind + shadcn/ui, a PWA
  deploy.sh    build, test, promote to /opt/kevin, restart
```

## Where things live at runtime

| | |
|---|---|
| Code that runs | `/opt/kevin/current` (root-owned release; `deploy.sh` promotes it) |
| Data | `/var/lib/kevin/` (uid `kevin`, 0700): `kevin.db`, `documents/`, `uploads/`, `backups/`, `SUGGESTIONS.md` |
| Shell sandbox | `/var/lib/kevin-sh/workspace` (uid `kevin-sh`, no network) |
| Secrets | set `kevin` in benloe-secrets: `ANTHROPIC_API_KEY`, `KEVIN_VAPID_*`, optional `OPENAI_API_KEY` |
| PM2 config | `/etc/benloe/ecosystem/kevin.config.js` |
| Logs | `/srv/benloe/logs/kevin-api-*.log` |

Data is outside the repo on purpose: the repo is public and `/srv/benloe/data`
is writable by another uid, and this database holds tax and medical records.

## Server map

| File | What it owns |
|---|---|
| `agent.ts` | The loop: stream, run tool calls in parallel, feed back, repeat. Read its header before touching it. |
| `threads.ts` | One turn at a time per thread; mid-turn messages fold into the running turn; titles; compaction. |
| `prompt.ts` | System prompt assembly and the per-message `<context>` block. |
| `tools.ts` | Tool registry: validation, audit log, daily-log event, `data_changed` event. |
| `core/index.ts` | Core tools (query, remember, recall, schedules, shell, files, web_research, ...) and the `system/*` views. |
| `domains.ts`, `domains/*.ts` | One file per life area. Dropping a file in `domains/` registers it. |
| `jobs.ts` | System jobs (in code), Kevin's schedules (in the DB), one runner, one ledger (`job_runs`), the watchdog. |
| `memory.ts` | Daily log, FTS5 search index, facts, optional embeddings. |
| `llm.ts` | Client, price table, usage recording, spend cap. |
| `attachments.ts` | Uploads and one-time text extraction (pdftotext, then vision). |
| `push.ts` | Inbox row + SSE event + web push. |
| `http.ts` | Express: auth, CSRF header, SSE, threads, uploads, `/api/view`, `/api/act`. |

## Rules the model API imposes (why agent.ts looks the way it does)

- **Within a turn, send the model's content back untouched** and change nothing
  earlier in the request. Thinking blocks are bound to the exact history that
  produced them.
- **Across turns, store only text, tool calls and tool results.** Kevin's
  history changes between turns (facts saved, old turns summarised), which
  would invalidate stored thinking blocks.
- **The system prompt is two blocks.** The stable one (workspace files, schema,
  domain notes) carries a 1-hour cache breakpoint and must be byte-identical
  between requests: no timestamps, sorted tools. Facts are a second block.
  Time, page and memory hits travel in the user message.
- **Ben's mid-turn message is a text block after the last `tool_result`** in the
  same user message. Text placed anywhere else near tool results reads to the
  model as an injection.
- Models: Sonnet at low effort for chat, Haiku for titles, summaries,
  extraction and research, Opus only on "think hard" or a schedule with
  `deep`. `config.ts` holds the ids; prices are in `llm.ts` and must be updated
  with them.

## Spaces: how Kevin handles what has no page

Ben's main complaint about Cabinet was that a fixed set of areas does not
generalise: a task that fits none of them has nowhere to live. So the built-in
domains are the exception, kept only where an area needs logic a list cannot
give (CSV import, progression math, the tax packet). Everything else is a
**space** (`domains/spaces.ts`): Kevin creates one at runtime with
`space_save` (name, layout, custom fields), fills it with
`space_records_update`, and it has a page at `/s/<slug>` and a place in the
nav immediately, rendered generically by layout (list, checklist, table,
board, notes). Open records with a due date reach Home.

When Ben asks for a new kind of tracking, the answer is a space, made by Kevin
in conversation. A new built-in domain is warranted only when Ben keeps hitting
something a space cannot do.

## Adding or changing a domain

A domain is one file, `server/src/domains/<name>.ts`, default-exporting
`defineDomain({...})`. Helpers go in a subfolder (`domains/_<name>/`), because
every top-level file in `domains/` is loaded as a domain.

```ts
import { z } from 'zod';
import { defineDomain } from '../domains.js';
import { defineTool, ToolError } from '../tools.js';
import { nowIso } from '../db.js';

export default defineDomain({
  name: 'pantry',                       // also the name in `touches` and in /api/view/pantry/<view>
  migrations: [{ id: 'pantry-001', sql: `CREATE TABLE pantry_items (...);` }],   // append-only; never edit a shipped one
  promptNote: `What this area is and how Kevin should work in it. A few lines.`,
  tools: [
    defineTool({
      name: 'pantry_update',            // snake_case, prefixed with the domain
      description: 'Written for the model: what it does and when to use it.',
      input: z.object({ ... }),         // .describe() the fields the model must get right
      touches: ['pantry'],              // marks it a write: audited, logged, pages refresh, callable from the UI
      run: (input, ctx) => { ... ctx.db ...; return { ... } },   // throw new ToolError('message for the model') on a user-level failure
    }),
  ],
  views: {                              // reads for the page: GET /api/view/pantry/items?location=fridge
    items: (params, db) => db.prepare('SELECT ...').all(),
    home: (_p, db) => ({ cards: [{ title: 'Use soon', lines: ['Milk — expires tomorrow'], link: '/pantry' }] }),
  },
  routes(router, db) { ... },           // optional: /api/x/pantry/... for downloads and raw uploads only
});
```

- **Reads are SQL, writes are tools.** The model reads through the core
  `query` tool using the schema in its prompt, so name tables and columns so
  they explain themselves, and comment the non-obvious ones in the `CREATE
  TABLE` (the comments reach the model). Give the model few, coarse write
  tools per domain (two to five): one tool that upserts a list beats separate
  add/edit/remove tools. Every tool is a schema the model reads on every call.
- **The UI uses the same write tools** through `POST /api/act/<tool>`, so the
  page and the agent cannot disagree about what a valid write is. A write only
  Ben should make from the page sets `agent: false`.
- **Every domain exposes a `home` view** returning `{ cards: [{ title, lines:
  string[], link }] }` for the Home page: what matters today, empty `cards`
  when nothing does.
- Table names are prefixed with the domain. Timestamps are UTC ISO strings;
  calendar dates are `YYYY-MM-DD` in Ben's timezone (`localDay()` in
  `time.ts`).
- Text worth finding later goes in the search index: `indexItem(db, kind, ref,
  title, body)` from `memory.ts` (`unindexItem` on delete). Kinds in use:
  `document`, `recipe`, `attachment`, `log-*`.
- Uploaded files are `attachments` rows (`getAttachment`, `attachmentPath` in
  `attachments.ts`), already text-extracted. `notify(db, {...})` in `push.ts`
  sends a notification.
- Tests: `server/test/<name>.test.ts`, using `makeKevin([domain])`, `ok()`,
  `call()` and `view()` from `test/helpers.ts` (see `test/core.test.ts`).
  They run on an in-memory database with throwaway data folders.

## The web app's contract with the server

- `GET /api/view/<domain>/<view>?params` returns the view's JSON.
- `POST /api/act/<tool>` with the tool's input as JSON returns `{ ok: true,
  result }` or 400 `{ ok: false, error }`.
- Every non-GET request sends the header `X-Kevin: 1`.
- `GET /api/events` is one SSE stream of every `BusEvent` (`server/src/bus.ts`
  is the source of truth for the shapes): chat streaming for all threads,
  `data_changed { domains }`, `notification`, `thread_updated`.
- Threads: `GET/POST /api/threads`, `GET/PATCH /api/threads/:id`,
  `POST /api/threads/:id/messages { text, attachments, page, deep }` (202; the
  turn's progress arrives on the stream), `/stop`, `/confirm { confirmId,
  approved }`.
- Uploads: `POST /api/uploads?filename=<name>` with the file as the raw body
  returns `{ id, filename, mime, kind, extract_status, extracted_preview }`;
  `GET /api/attachments/:id/raw` serves it back.
- `GET /api/domains`, `GET /api/tools`, `GET /api/me`, `POST
  /api/push/subscribe`, `POST /api/push/test`.

## Working on it

```
cd server && npm run typecheck && npm test      # vitest; no network, no API calls
cd web && npm run typecheck && npm test
./deploy.sh                                     # builds both, runs both suites, promotes, restarts
```

Nothing that runs is loaded from this directory. `deploy.sh` is the promotion
step; read the diff before running it.
