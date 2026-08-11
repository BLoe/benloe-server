# Cabinet — rewriting the prompt

Written 2026-08-11. The working list for `prompt-architecture.md`, and nothing
else. Ordered. One at a time, finished, deployed. Do not start two.

Real defects in Cabinet's own behaviour (`log_food` cannot backdate,
`update_pantry` duplicates rows, the weight trend is wrong four ways) live in
Cabinet's task list where they already are. They are not here — this list is
about the prompt.

---

## Rules for unattended runs

1. **PRs only, and do not merge your own.** A merge is not undoable by
   `/rewind`. Open it, describe it, leave it.
2. **Stop at the first thing that needs a decision.** Writing the question down
   clearly is a successful outcome, not a failure.
3. **Verify before claiming.** Typecheck, run the suite, and for anything
   touching the prompt, diff the assembled output against the live memory
   directory. Three changes this session typechecked and were still wrong.

---

## What measurement changed about the plan

The four layers hold. Two pieces of reasoning under them do not.

**Tool count is not a problem.** The SDK already defers Cabinet's tools behind
tool search — all 63 cost 631 prefix tokens against 10,172 if forced in.
`PRIORITIES.md` item 5 is dropped.

**But guidance hidden in tool descriptions is not being read.** Deferred tools
expose a name, not a description. So the ~13 KB of behavioural prose that was
moved out of the system prompt and into tool descriptions is absent from a
normal turn, appearing only if a search happens to match. This is the single
most important finding of the session and it is what item 1 exists to fix.

Also worth recording as a thing we chose NOT to do: the built-in Claude Code
toolset is 17,890 prefix tokens, roughly 12k of which Cabinet never uses. It is
cached, it is 8.5% of the window, and trimming it would not make Cabinet more
useful. Measured, considered, dropped.

---

## 1. Read the tool descriptions as prose

Nobody ever has. 63 descriptions, ~13 KB, written over months, currently
invisible on a normal turn.

Separate two things in each: what the tool **is** — which stays, because it is
how the model finds it through search — and how Cabinet should **behave** —
which has no working home today and is the reason this whole rewrite matters.

**Done when:** a document quotes every description carrying behavioural
guidance and proposes where it goes. No code change.

**Why first:** every later item needs this inventory. The system layer cannot
be written without knowing what is currently being said in the wrong place.

---

## 2. Charter

Who Cabinet is. Identity, goals, personality, how it talks. Target 1–2k tokens
against ~20k today.

The first layer to move into `src/prompts/` — one manifest entry in
`PROMPT_CORE` flips from `user` to `repo`, plus a file move. The loader for
this shipped on 2026-08-11 and every layer is still `user`, so this is the
first real use of it.

Write it against what Cabinet is now, not what V1 said. One thing carries over
intact: Cabinet and Ben are working to make each other better.

**Done when:** repo-sourced, prompt-invariants tests pass, and the assembled
prompt diff shows one file's content changing and nothing else.

**Ben reads it before it ships.** This is Cabinet's personality.

---

## 3. System

What Cabinet can do and how this environment works. Generic, no personal data,
in the repo.

This is where item 1's behavioural guidance lands, and it is where the domain
question gets answered. A domain today is scattered across four homes — prompt
language in tool descriptions, tools in `tools/cabinet.ts`, logic in
`domains/*.ts`, narratives in `data/cabinet/memory/domains/*.md`. Ben's own
description of a domain ("prompt language, tool calls, persistence with state
and logging, plus integrations") describes a folder, not a category.

Two precedents worth reading before designing: `integrations/mcp.ts`, which
already gates a server on its env var so absent credentials mean no dead tools;
and Anthropic's Skills three-level loading — name always, body on match,
resources on demand.

**Done when:** the system layer is repo-sourced and loaded by job rather than
always. A heartbeat does not need the deploy conventions.

---

## 4. User

Ben's history, preferences, plans, corrections. Private, stays in `data/`.

Assembled for an **explicit user identity** even though there is one user — the
seam costs nothing now and avoids a rewrite later. Loaded by relevance, not
wholesale; most turns do not need the full biography.

Corrections merge into the facts they correct rather than being kept as a
ledger of times Cabinet was wrong.

**Done when:** `USER.md` is no longer loaded in full on every turn, and a turn
that needs a fact still gets it.

---

## 5. Now

Time, today's plan, what has been logged, what changed since the last message.
Regenerated every turn, never cached. Values, not prose.

The layer with the highest cost of being wrong — a bad timestamp produces
confident nonsense downstream, not a small error. Smallest and most mechanical;
do it last, once the shape of a turn is settled.

---

## 6. Job selection

Wire the four together. Conversation, heartbeat, weekly review, scheduled
brief — these are not a fifth layer, they select which layers load and how
much.

| job | charter | system | user | now |
|---|---|---|---|---|
| conversation | full | by topic | by relevance | full |
| heartbeat | minimal | minimal | none | full |
| weekly review | full | none | deep | full |
| scheduled brief | minimal | none | targeted | full |

**Done when:** a heartbeat and a conversation demonstrably assemble different
prompts, and the difference is visible in a test rather than only in prose.

---

## 7. Delete `templates.ts` as a home for designed prose

851 lines holding a second copy of the persona files, drifted from the live
ones by as much as 9×. Once a layer is repo-sourced there is exactly one copy
of it, and this file should hold only empty scaffolds for user-data files.

Housekeeping, but it has to happen or we end up with three homes instead of
two.

**Done when:** no designed prose in `templates.ts`, `ensureTemplates()` still
seeds a fresh install, and a test proves it.

---

## What gets deleted along the way

Named here so each is a decision rather than an omission.

- **The desk/counsel register.** Never once activated in a month of real use.
  Two things were built on it — a cheaper effort setting and reply-length
  rules — and neither has ever run.
- **`PLATFORM.md` as prompt content.** 22 KB of engineering post-mortems in
  every conversation, including ones about dinner. Durable facts move to
  `docs/`; the incident narrative goes.
- **Prohibition lists.** `VOICE.md`'s "Never" section mostly restates rules the
  same file already gives positively a few paragraphs earlier.

---

## How we know it worked

One question after a week of use: **is Cabinet more useful?**

The honest number is Cabinet's own task list — but watch the 43 items that are
Ben's life, not the 9 platform items, which any of this work closes directly
and which would otherwise measure my output rather than Cabinet's usefulness.
