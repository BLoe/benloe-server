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
  workspace/   persona.md rules.md   -> the fixed part of the system prompt; edited with Claude Code.
               Nothing about Ben goes here: this repo is public. What Kevin knows about him
               is the profile, in the database (Settings -> Memory).
  server/      src/ (TypeScript, ESM)  test/ (vitest)
  web/         Vite + React + Tailwind + shadcn/ui, a PWA
  deploy.sh    build, test, promote to /opt/kevin, restart (run through benloe-promote)
```

## Where things live at runtime

| | |
|---|---|
| Code that runs | `/opt/kevin/current` (root-owned release, built by `deploy.sh` from a pushed commit) |
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
| `threads.ts` | One turn at a time per thread; a message Ben sends mid-turn folds into the running turn when that turn is a chat turn, and otherwise runs as its own chat turn afterwards; titles; compaction. |
| `process.ts` | Logs unhandled promise rejections instead of letting one end the process. |
| `prompt.ts` | System prompt assembly and the per-message `<context>` block. |
| `tools.ts` | Tool registry: validation, audit log, daily-log event, `data_changed` event. |
| `core/index.ts` | Core tools (query, remember, recall, schedules, shell, files, web_research, ...) and the `system/*` views. |
| `domains/spaces.ts` | Spaces: runtime-created areas, their records, the data-driven nav. |
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
- **The system prompt is three blocks.** The stable one (persona, rules,
  schema, domain notes) carries a 1-hour cache breakpoint and must be
  byte-identical between requests: no timestamps, sorted tools. The profile
  is the second block, with its own cache breakpoint, so editing it rewrites
  only what follows. Facts and current state are the third, uncached. Time,
  page and memory hits travel in the user message.
- **Ben's mid-turn message is a text block after the last `tool_result`** in the
  same user message. Text placed anywhere else near tool results reads to the
  model as an injection.
- Models: Sonnet at low effort for chat, Haiku for titles, summaries,
  extraction and research, Opus only on "think hard" or a schedule with
  `deep`. `config.ts` holds the ids; prices are in `llm.ts` and must be updated
  with them.

## What Kevin knows about Ben, and where each kind of thing lives

Nothing personal is in this repository, which is public. `workspace/` holds
only Kevin's persona and working rules.

| Layer | What it is | Where | How it grows |
|---|---|---|---|
| Profile | Prose: who Ben is, family, history, health background, how he operates | `profile_sections` (+ `profile_history`: every earlier version) | Kevin, with `profile_update`; Ben, in Settings → Memory |
| Facts | Single sentences Ben has said that steer behaviour | `facts` | `remember` / `fact_update` |
| Log | What happened: notes, conversation summaries, every data change | `memory_log` | `note`; the `memory` job; automatically on each write |
| Records | Structured data | domain tables, spaces, the document vault | typed tools |

The profile is its own system block with its own cache breakpoint; facts and
the list of spaces follow it uncached. A fact is Ben's direct statement and
outranks the profile where they differ. Sections are versioned because
Cabinet lost a correction of Ben's when a later session re-authored the file
it lived in: a rewrite here can always be undone, and the rules tell Kevin to
fix a corrected belief where it lives and save the correction as a fact.

Everything is searchable through one index (`search_index`, kinds `profile`,
`log-*`, `document`, `attachment`, `recipe`, `space-record`), which is what
`recall` and the per-message memory hits read.

On 2026-11-15 Ben's real data was carried over from Cabinet in a one-time
import (no link between the systems remains): its file on Ben became the
profile, its lab results, insurance plans, claims and weigh-ins became
spaces, its lab documents went into the vault, and its account balances,
2025 HSA contributions and shelf-stable pantry staples went into the matching
domains. `settings.cabinet_import` records the counts.

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

## What protects Ben's records, and what does not

Kevin reads web pages and holds tax and medical records, so a page that
talks the model into something is the threat to design for.

- **The shell** runs as `kevin-sh`: no network (iptables owner rule, loopback
  included), an empty environment, resource limits, and its working directory
  is `/var/lib/kevin-sh/workspace`. It is a separate uid, with no chroot or
  mount namespace: it can read whatever is world-readable on this box. It
  cannot read `/var/lib/kevin` (0700, uid `kevin`) or the rendered secrets.
  Scheduled turns get no shell.
- **Kevin's file tools run as `kevin-sh` too**, through the same launcher, so
  they can reach exactly what the shell can. The server process never opens a
  path in the sandbox folder, and `kevin` is not in the `kevin-sh` group, so
  the kernel refuses if it tried. The path check inside the file-tool script
  catches mistakes; the uid is the boundary.
- **The main loop has no web tools.** `web_research` is the only way Kevin
  reads the web: a sub-call that receives only the question, searches and
  fetches, and returns text that the main loop treats as data.
- **Writes are typed tools**; `query` refuses anything but a single read.
  Deleting a space, raising the spend cap and hiding pages are Ben-only
  (`agent: false`).
- **Not closed:** the main model can see Ben's records and writes the
  question it hands to `web_research`, so a successful injection could leak
  a small amount through that question and the searches made from it. Tool
  inputs are written to `tool_audit` and the daily log in the same private
  database, so a summary Kevin passes to a tool is stored
  there too.

## Costs

Every model request is a row in `usage`; Settings shows month-to-date and the
cap (default $50) blocks new turns, extraction and summaries once reached.
The fixed prompt (38 tools, schema, workspace files) is about 35,000 tokens:
about a third of a cent per request from cache, about 14 cents for the first
message after an hour's silence. A "think hard" turn runs on Opus with its own
cache and costs tens of cents. A new built-in domain adds to every request;
a space adds nothing.

## Not configured yet (each needs something from Ben)

- **Offsite backup.** The nightly job writes `/var/lib/kevin/backups/<day>/`
  (database + documents + uploads, seven days). Copying it off the droplet
  needs a bucket and credentials.
- **Embeddings.** Recall is keyword search (FTS5). Adding `OPENAI_API_KEY` to
  the `kevin` secret set and restarting turns on the hybrid path already in
  `memory.ts`.
- **Old releases** accumulate in `/opt/kevin/releases`; `deploy.sh` says when
  there are more than five.

## Working on it

```
cd server && npm run typecheck && npm test      # vitest; no network, no API calls
cd web && npm run typecheck && npm test
```

To ship: read the diff, commit, push, get it merged to `main`, then

```
benloe-promote "$(gh api repos/BLoe/benloe-server/commits/main --jq .sha)" apps/kevin/deploy.sh
```

which takes the commit id from GitHub (never from this working tree), fetches
that exact commit into a root-owned directory,
installs dependencies from the lockfiles, runs both suites, builds a new
release in `/opt/kevin/releases/` and restarts `kevin-api`. `deploy.sh
rollback` (through `benloe-promote` the same way) returns to the previous
release. `deploy.sh` and `setup.sh` refuse to run from the working tree: see
"Promoting code that root runs" in `docs/CLAUDE.md`.

## Web map

For whoever writes or changes a page. `web/` is Vite + React 19 + TypeScript +
Tailwind v4, shadcn-style components copied into `src/components/ui`, no state
library. `npm run dev` proxies `/api` to `KEVIN_API` (default
`http://127.0.0.1:3016`).

```
web/src/
  App.tsx                 routes: one per registry page, /s/:slug, /chat/:threadId
  pages/registry.tsx      the built-in pages (path, label, icon, lazy component)
  pages/<Name>.tsx        one page per file, default export
  pages/Space.tsx         /s/:slug, renders every space by its layout (pages/space/*)
  pages/Spaces.tsx        /spaces, the index of all spaces and "New space"
  pages/jobs/, settings/  parts of the Jobs and Settings pages
  components/page/        the page building blocks (import from '@/components/page')
  components/ui/          button, input (Input, Textarea, Select), dialog, alert-dialog,
                          dropdown-menu, popover, tabs, switch, badge, card, skeleton, label
  components/chat/        the chat panel: transcript, tool rows, composer, thread list
  components/shell/       left nav, tab bar, More sheet, notification bell, toasts
  lib/                    api, events, useView, act, chat (openChat), transcript,
                          nav, spaces, links, format, trigger, image, push, toast, hooks, types
  public/                 manifest.webmanifest, sw.js, icons/ (npm run icons regenerates)
```

**Registering a page.** A built-in page is one line in `builtins` in
`pages/registry.tsx` plus its entry in `BUILTIN_PAGES` in
`server/src/domains/spaces.ts` (that list is what Ben hides and shows). To
replace a stub, overwrite `src/pages/<Name>.tsx` and keep the default export;
nothing else changes. Sub-routes (`/money/accounts`) need a `<Route>` in
`App.tsx`; prefer `useSearchParams` for tabs and filters, as Settings does.

**The nav is data.** `lib/nav.ts` builds it from `GET /api/view/spaces/nav`:
built-ins Ben has not hidden, then pinned spaces (lucide icon by name, a count
badge when records are due within three days). It refetches on `data_changed`
for `spaces`, so a space Kevin makes mid-chat appears at once. The phone's tab
bar is Home, the first three nav entries, More, and the chat button; nothing
in it is hardcoded. A space needs no page code: `pages/Space.tsx` renders
`spaces/get` by `space.layout` (checklist, list, table, board, notes), with a
typed edit sheet per record and the space's settings behind its menu. The pure
parts (field formatting and parsing, due states, board grouping) are in
`lib/spaces.ts`.

**Reading and writing.**

```tsx
import { useView } from '@/lib/useView';
import { act, useAct } from '@/lib/act';
import { openChat } from '@/lib/chat';

// useView<T>(path, params?, { enabled?, pollMs? }) -> { data, loading, error, refetch }
// GET /api/view/<path>?params. Refetches when a write touches the path's first
// segment (the domain), on reconnect and on window focus. Cached per URL, so a
// revisited page paints at once. `loading` is true only before the first answer.
const items = useView<Item[]>('pantry/items', { location: 'fridge' });

// act<T>(tool, input, { success?, silent? }) -> { ok: true, result } | { ok: false, error }
// POST /api/act/<tool>. Never throws; a failure is already shown as a toast.
// Do not refetch afterwards: the server's data_changed event does it.
const r = await act('pantry_update', { items: [{ name: 'Eggs', quantity: 9 }] }, { success: 'Saved' });
const { run, pending } = useAct();   // same call, plus a pending flag for the button

// openChat({ prefill?, send?, attachments?, threadId?, newThread? })
openChat({ send: 'What can I make tonight?', newThread: true });   // sends at once
openChat({ prefill: 'Log a workout: ' });                          // waits in the composer
```

Chat sends the current route as `page`, so "Ask Kevin" on a page needs no
extra context. `<AskKevin prompt="…" />` is the ready-made button.

**Building blocks** (`@/components/page`):

| Component | Use |
|---|---|
| `Page`, `PageHeader`, `Section` | Outer wrapper (width, gutters, rhythm), title + description + actions, titled block with an action on its title line. `<Page wide>` for tables and boards. |
| `List`, `ListRow` | One bordered surface of rows: `title`, `subtitle`, `meta` (right-aligned value), `leading`, `trailing` (switch, menu), `to` or `onClick`, `muted`, `wrap`. |
| `ViewState` | `<ViewState view={v} empty={<EmptyState …/>}>{(data) => …}</ViewState>`: skeleton, error with retry, empty, or content. |
| `EmptyState`, `ErrorState`, `LoadingRows` | The three non-content states on their own. |
| `FormDialog`, `Field`, `FieldRow` | Add/edit one thing: a bottom sheet on a phone, a dialog on desktop. `Field` gives the control its label, hint and error. |
| `ConfirmDialog` | Anything that cannot be undone; the confirm button names the action. |
| `Money`, `Meter`, `Chips`, `KeyValues`, `Markdown`, `AskKevin` | Aligned amounts, a bar against a cap, choice chips, label/value pairs, safe markdown (in-app paths such as `/s/<slug>` become links; add a new route to `lib/links.ts`), a chat button. |

Also: `toast.success/error/info` (`lib/toast`), `Badge` (neutral, success,
warning, danger, outline), and the formatters in `lib/format`: `money`, `cost`,
`plural`, `duration`, `clock`, `shortDate`, `longDate`, `dateTime`,
`relativeTime`, `ago`, `calendarDay` (for stored `YYYY-MM-DD` dates),
`localDay`. `lib/trigger` puts schedule triggers in words. `useMe()` has Ben's
timezone, `useNow()` re-renders relative times.

**Conventions.**

- Phone first. Base classes are the phone layout; `lg:` (1024px) is the
  desktop shell. Controls are 44px tall on a phone and 36px from `lg:` (the
  `Button` and `Input` sizes do this already).
- The page area is a container: with chat docked it is only about 400px wide
  on a 1024px window. Lay out columns with `@lg/page:` and `@2xl/page:`, never
  with viewport breakpoints.
- A page is `Page > PageHeader > Section…`. Lists are `List` + `ListRow`, at
  least 56px per row, with the row's main action on the row and secondary ones
  in a trailing menu. On a phone a table becomes stacked cards (see `Table` in
  `pages/space/layouts.tsx`); nothing scrolls sideways except chip rows, tab
  strips and a desktop board.
- Forms are `FormDialog`s, one column, labels above fields, with the reason a
  form cannot be saved shown in it. Quick entry (one line, Enter to add) sits
  at the top of the list it adds to.
- Colours are tokens (`bg-card`, `text-muted-foreground`, `bg-warning-soft`,
  `text-destructive`); both themes come from `src/index.css`. Numbers that
  line up get the `tabular` class.
- Empty states say what belongs there and offer the way to add it, usually
  including asking Kevin. Sentence case, plain verbs, buttons that say what
  they do.
- Logic that can be wrong goes in `lib/` as pure functions with a
  `*.test.ts` next to it (`npm test`); components stay thin.
