# Cabinet — the working list

Written 2026-08-11, at the end of a long session that measured a lot of things
and disproved several of them. This replaces `PRIORITIES.md` as the list to
work from; `prompt-architecture.md` is still the design it serves.

Ordered. One at a time, finished, deployed. Do not start two.

---

## Rules for unattended runs

This list is meant to be workable overnight with `/loop`. Three rules, learned
the hard way on 2026-08-10/11:

1. **PRs only, and do not merge your own.** A merge is not undoable by
   `/rewind`. Open the PR, describe it, leave it. Ben merges.
2. **Stop at the first thing that needs a decision.** A task that turns out to
   need Ben's judgment is finished when the question is written down clearly —
   that is a successful outcome, not a failure.
3. **Verify before claiming.** Typecheck, run the suite, and for anything that
   touches data, run it against a copy of the real database. "Tests pass" is
   not the same as "the thing works", and this session produced three
   changes that typechecked and were still wrong.

---

## How the plan changed

Four things this session invalidated or added. The four-layer design in
`prompt-architecture.md` survives; some of the reasoning under it does not.

**Tool count is not the problem, and the fix was already shipped.** Measured:
the SDK already defers Cabinet's tools behind tool search. All 63 cost **631
tokens**; forcing them into the prompt costs **10,172**. Anthropic's "selection
degrades past 30–50 tools" is real but the runtime already handles it.
`PRIORITIES.md` item 5 — consolidate 63 tools down to ~30 — is **dropped**. It
was justified by a cost that does not exist.

**The expensive toolset is the built-in one.** 17,890 tokens of prefix before
Cabinet adds anything, from 29 built-in Claude Code tools. A heartbeat pays it
297 times a day to do a job that needs almost none of them. This is now the
largest single item on the list and it was not in the plan at all.

**Guidance hidden in tool descriptions is not being read.** Deferred tools
expose a name, not a description. So the ~13 KB of behavioural prose living in
tool descriptions — clinical reasoning about substance routes, PLAYBOOK
references — is absent from a normal turn and appears only if a search happens
to match. This is the strongest argument for domain packs, and it is a
different argument than the one the plan makes.

**The blocker on repo-sourced prompts is gone.** `src/prompts/` sits under
`apps/cabinet/server`, which the tier policy classified Tier 0 — meaning
Cabinet could never have edited its own charter there. That policy was deleted
on 2026-08-11 (it had denied nothing in a month while classifying 445 actions
as blocked and running all of them), so the path is writable and no relocation
is needed.

---

## Part A — prompt architecture

### A1. Cut the built-in toolset

**Biggest measured win on this list.** 17,890 tokens of prefix, paid on every
turn including 297 daily heartbeats that use almost none of it.

Work out which built-ins each job actually needs, and pass a narrower set.
A heartbeat needs to read and query; it does not need `WebFetch`, `WebSearch`,
`NotebookEdit`, or subagent spawning. A conversation needs more. Deploys need
`Bash`.

**Done when:** the probe at `scratchpad/tool-prefix-probe.mts` (re-run it)
shows a materially smaller prefix for the heartbeat path, and heartbeats still
do their job. Report the before/after numbers.

**Autonomous:** yes, up to the point of choosing which tools each job keeps —
write the proposed table into the PR and let Ben confirm before it deploys.

---

### A2. Move guidance out of tool descriptions

Read all 63 descriptions as prose — nobody ever has. Separate two things:
what the tool *is* (stays, it is how the model finds it) from how Cabinet
should *behave* around it (moves).

The behaviour half has no home yet. That is A3. Do this first anyway, because
until the inventory exists there is nothing to design against.

**Done when:** a document lists every description carrying behavioural
guidance, quoting it, with a proposed destination. No code change.

**Autonomous:** yes. This is reading and writing, and it ends in a document
rather than a deploy.

---

### A3. Design the domain pack

A domain today is scattered: prompt language in tool descriptions, tools in
`tools/cabinet.ts`, logic in `domains/*.ts`, tables in the schema, narratives
in `data/cabinet/memory/domains/*.md`. Ben's own description — "prompt
language, tool calls, persistence with state and logging, plus integrations" —
is a folder, not a category.

Two working precedents worth reading first: `integrations/mcp.ts`, which
already gates a server on its env var so absent credentials mean no dead tools
in context; and Anthropic's Skills three-level loading (name always, body on
match, resources on demand).

**Done when:** `docs/domain-packs.md` specifies the folder shape, how a pack is
selected for a turn, and what happens to the four existing homes. One worked
example — food, the messiest — written out in full.

**Autonomous:** yes, as a design document. Building it is not.

---

### A4. Charter

The first layer to actually move into `src/prompts/`. Small (~1–2k tokens),
generic, no personal data. Flipping one manifest entry in `PROMPT_CORE` from
`user` to `repo` plus a file move.

Write it against what Cabinet actually is now, not what V1 said. The one thing
carried over intact: Cabinet and Ben are working to make each other better.

**Done when:** `CHARTER.md` is repo-sourced, the prompt-invariants tests pass,
and the assembled prompt diff is readable — one file's content changing and
nothing else.

**Autonomous:** draft yes, merge no. This is Cabinet's personality; Ben reads
it before it ships.

---

### A5. Delete `templates.ts` as a home for designed prose

851 lines holding a second copy of the persona files. The live files and these
have drifted, some by 9×. Once the charter is repo-sourced there is exactly
one copy of it and this file should hold only empty scaffolds for user-data
files.

**Done when:** `templates.ts` contains no designed prose, `ensureTemplates()`
still seeds a fresh install, and a fresh-install test proves it.

**Autonomous:** yes, after A4.

---

## Part B — real defects, from Cabinet's own list

These are pure software tasks pulled from Cabinet's 52 open items. Each is
specified well enough to build without asking. Priority order is theirs, not
mine: two of these lose data.

### B1. `log_food` cannot backdate — task 52

Every other logging tool takes a date (`log_workout` takes `localDay`,
`log_symptom` takes `local_day`, `log_substance` takes `when`). `log_food`
takes none, so a meal reported after the fact either lands on today and
corrupts today's totals, or is dropped into a journal entry and never reaches
`food_log`. Retrospective reporting is the most common kind there is. A week of
intake was lost to this once already.

**Fix:** optional `localDay` on the tool, threaded to the `food_log` insert.
**Done when:** backdating works, today's totals are unaffected by it, and a
test covers both.
**Autonomous:** yes. Smallest and highest value on the list.

---

### B2. `update_pantry` duplicates a row on a location change — task 57

The upsert keys on `(name, location)`, so moving something from freezer to
fridge creates a second row instead of updating the first. Silent inventory
inflation — and the pantry is what shopping lists are built from, so a wrong
count produces confidently wrong advice in both directions.

**Fix:** key on name alone and treat location as a mutable attribute (the
task's own recommendation). Also clamp `quantityDelta` at zero; a negative
delta on an empty row has already gone to −1.
**Done when:** a move updates one row, quantities cannot go negative, and both
are tested.
**Autonomous:** yes.

---

### B3. Today surface has dead controls — task 55

Several elements look interactive and have no handler.

**Fix:** audit the surface. Strip affordances that should not be there; wire
the ones that obviously should. Anything needing a product decision goes in the
PR description as a question, not a guess.
**Done when:** nothing on Today looks clickable and isn't.
**Autonomous:** yes for stripping, no for adding behaviour.

---

### B4. Chat is broken on mobile — task 54

Reported at 390px wide. Composer and scroll container.

**Fix:** reproduce with Playwright at 390px, fix the layout, keep the rail
reachable by touch.
**Done when:** screenshots at 390px before and after are in the PR.
**Autonomous:** yes, with the caveat that "looks right" is a judgment — attach
the screenshots and let Ben be the judge.

---

### B5. Weight trend is wrong four ways — task 49

`domains/training.ts`. The EWMA seeds so the first point equals the raw
reading; alpha applies per row rather than per day, so uneven gaps are
mis-weighted; `weightTrend(db, days)` is actually a row limit, and the surface
calls it expecting a week and gets ~3 weeks; `weeklyDelta` is "7 entries ago",
not 7 days.

**Fix:** half-life-in-days EWMA, real date-window filter, `weeklyDelta` against
the interpolated trend 7 days back, and `trend: null` with a reason when the
data is too thin to resolve.
**Blocked on one decision:** the half-life. The task recommends 7 days. Build
it parameterised, default 7, and say so in the PR.
**Autonomous:** yes under that stated assumption.

---

## Not on this list, deliberately

- **Task 58, durable write queue.** Part 3 (logging) shipped. Parts 1 and 2
  change behaviour on the persistence path and the task itself says "decide
  scope with Ben."
- **Task 56, site IA.** The task says it needs a design conversation and is not
  agent-eligible. It is right.
- **Task 14, integrations page.** Deferred on purpose until Plaid is live.
- **Task 20, GitHub support request.** Needs a human with an account.
- **Everything in health, money, mind, food, admin, social.** 43 of the 52 open
  items are Ben's life, not the platform. They are the product, and they are
  not autonomous work.

---

## How we will know any of it worked

The honest test has not changed and is still one question: **is Cabinet more
useful?**

One correction to how `prompt-architecture.md` proposed measuring it. It said
watch the 52-item task list go down. But 9 of those items are platform work
that this list will close directly, which makes the number partly a measure of
my own output rather than Cabinet's usefulness. Watch the other 43.
