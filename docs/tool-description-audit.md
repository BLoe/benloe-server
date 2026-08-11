# What the 63 tool descriptions actually say

TODO item 1. Written 2026-08-11. No code change — this is the inventory every
later item needs.

**Why it matters:** the SDK defers Cabinet's tools behind tool search, so a
deferred tool exposes its *name* and not its description. All 63 cost 631
prefix tokens; forcing them in costs 10,172. Whatever is written in these
descriptions is therefore **absent from a normal turn** and appears only if a
search happens to match that tool. Guidance that was moved out of the system
prompt and into tool descriptions is, in practice, not being read.

**How these were extracted:** by calling `buildCabinetTools()` and reading the
built objects. A regex over the source silently truncated 12 of the 63 at the
first string-concatenation boundary, which also means my earlier "~9.9 KB"
figure was wrong and the original ~13 KB estimate was right. The real total is
**12,760 bytes across 63 descriptions.**

---

## The shape of it

| | tools | what it is |
|---|---|---|
| **A. Pure API** | 38 | What the tool does, its arguments, its return shape. Stays. |
| **B. Behavioural guidance** | 19 | How Cabinet should act. Has no working home. |
| **C. Facts about Ben** | 6 | Personal history and clinical detail. Wrong layer *and* wrong repo. |

Some tools appear in more than one row. The counts are a description of the
prose, not a partition of the tools.

---

## C first, because it is the one that needs a decision

Six descriptions carry personal detail about Ben, and
`apps/cabinet/server/src/tools/cabinet.ts` **is tracked in a public GitHub
repo** (`BLoe/benloe-server`, visibility PUBLIC). Verified, not assumed.

> `health_days` — "Steps are the ankle-load budget — plans/health.md doses
> walking against **the talus lesion**, so read this before planning a
> walking-heavy day."

> `money_trend` — "The delivery series is the financial fingerprint of **the
> 8pm-to-midnight loop**."

> `log_craving` — "this is the response variable for **the whole evening
> program**"

> `symptom_days` — "the ankle load-vs-response join (morning ache paired
> against the PREVIOUS day's steps, **because flares lag load by a day**)"

> `log_symptom` — canonical keys `'ankle_ache_am'`, `'ankle_ache_pm'`,
> `'sore_throat'`

> `log_substance` — "Log cannabis, alcohol, caffeine, or nicotine... Dose+unit
> as labelled (edibles in mg, flower in g...)"

This is a named medical condition, a named behavioural pattern, and a substance
inventory, in a public file. It is not a leak of a document — nothing was
committed by accident — but it is personal data sitting in the public repo
because tool descriptions were treated as code rather than as prose.

**This is Ben's call, and it is the one blocking decision in this audit.** The
options are: leave it (it is arguably innocuous), generalise the wording
(`ankle_ache_am` needs no diagnosis attached to be a useful key), or move the
whole clinical framing into the user layer where it belongs anyway.

Worth noting the shape of the mistake. `PLATFORM.md` records a rule — a page
built from Ben's data must be gitignored before it is ever committed — that was
written about *static sites*. Nobody thought to apply it to source code,
because source code is obviously public and obviously not personal data. Here
it is both.

---

## B. The behavioural guidance, quoted

Nineteen descriptions tell Cabinet how to *act* rather than what the tool
*does*. Grouped by what kind of instruction it is, because that determines the
destination.

### Epistemic discipline — how to report uncertainty

The best writing in the whole corpus, and the least likely to be read.

> `adherence_report` — "Read `unmeasured: true` as 'nobody wrote it down', NOT
> as 'Ben failed' — reporting an unmeasured goal as a zero is the one error
> that would make Cabinet confidently wrong at Sunday review."

> `substance_nights` — "Under ~10 days of rows this is a table, not a
> correlation — report it as such rather than claiming a relationship."

> `craving_report` — "its verdict stays null until both arms have enough days,
> and a null verdict means say 'not yet', not 'no effect'."

> `money_summary` — "if those disagree, some account failed to sync and the
> total is understated; say so rather than reporting the number bare."

> `usage_status` — "`unknown: true` means no fresh reading exists; report that
> plainly rather than guessing a number, and never let an unknown become a
> reason to decline work."

> `log_craving` — "never guess it, a guessed outcome corrupts the redirect
> ranking."

**Destination: charter.** Every one of these is the same instruction wearing
six domain costumes — *say what you do not know, and do not let a gap render as
a fact*. That is character, not API. Six restatements in tool descriptions
nobody reads is strictly worse than one sentence in the charter.

### Workflow — when to reach for something

> `craving_report` — "Read this BEFORE offering a move in a live craving
> moment — offer the one with the best record, not the first one that comes to
> mind."

> `health_days` — "read this before planning a walking-heavy day."

> `log_symptom` — "The ankle readings are what make step counts mean anything,
> so capture them in the morning check-in and the wind-down."

> `usage_status` — "Use it when Ben asks about limits or headroom, or before
> committing to an unusually large piece of work — NOT as a routine
> self-check."

> `promote_lesson` — "call this only after the update_memory write succeeds,
> not before."

> `enqueue_approval` — "returns the packet id; do NOT wait."

**Destination: system layer / domain pack.** These are procedures. A procedure
that only loads when its own tool is discovered is a procedure that fires after
the moment it was meant to govern — `craving_report`'s instruction is
explicitly about what to do *before* choosing a tool.

### Tool routing — which of two tools to use

> `upsert_goal` — "For narrative/qualitative goals... use update_memory on
> GOALS.md instead — this tool is for numbers a dial can compare against, not
> prose."

> `upsert_constraint` — "This is for machine-durable safety gates, NOT soft
> preferences — 'dislikes cilantro'... belongs in update_memory on
> domains/nutrition.md or domains/health.md instead."

> `decrement_pantry_for` — "For a plain add/subtract already in the pantry
> row's own unit, use update_pantry's quantityDelta instead."

> `mark_habit` — "ONLY needed for goals no query can see... marking those by
> hand is redundant."

> `money_summary` — "Start here for any money question."

> `query_db` — "The workhorse for totals, trends, and accumulators."

**Destination: stays, mostly.** This is the one category that genuinely belongs
in a description — it is discoverability, and tool search reads descriptions
when matching. The catch is that a routing hint only helps if the model finds
*this* tool first, which makes `upsert_goal`'s and `upsert_constraint`'s
pointers a coin flip. Those two are better stated once in the domain pack as
"structured vs narrative" rather than twice from inside the structured half.

### Policy

> `add_lesson` — "needs evidence + confidence >= 0.6; autonomy escalations are
> rejected"

> `update_memory` — "STANDING_ORDERS.md is Ben-only."

> `log_craving` — "'held' and 'planned_snack' are BOTH successes: an evening
> snack is in the budget on purpose."

**Destination: mixed.** The first two describe enforcement that already exists
in code — the description is documentation of a guard, which is fine and cheap.
The third is a *definition* of what success means in a program Ben is running,
which is user-layer content.

---

## A. What stays

Thirty-eight descriptions are doing their job: naming the tool, its arguments,
its return shape, and its edge cases. These are good and should not be touched.

The best of them earn their length by describing a failure the caller cannot
see:

> `consume_plan_entry` — "atomically, so a failure never leaves food logged
> without the pantry decremented or vice versa. Calling this twice on the same
> entry is a safe no-op."

> `list_constraints` — "how you tell apart three states: no rows for a kind =
> never asked; one row with is_none_confirmation=true = asked, confirmed none;
> rows with real subjects = must-respect constraints."

> `import_transactions_csv` — "sign='bank' (default) means the file uses
> negative for money spent, which is normalized on import to the convention
> used everywhere else (positive = money out)."

That last one is worth keeping as a model: it states a convention rather than
recounting the bug that made the convention necessary.

---

## One structural problem, separate from any of the above

**Eleven descriptions cite documents by name** — `plans/health.md`,
`PLAYBOOK P4`, `TUNING E1`, `TUNING E2`, `GOALS.md`, `PREFERENCES.md`,
`PLATFORM.md`, `domains/nutrition.md`, `domains/health.md`, `CHARTER`.

A tool description that says "see PLAYBOOK P4" is only useful if PLAYBOOK is
loaded, and the whole direction of the redesign is that most files stop being
loaded on most turns. These references will rot silently: nothing checks that
`TUNING E2` still exists, and nothing will notice when it does not.

The domain-pack design (item 3) needs an answer for this. The cheapest one is
that a pack owns both its tools and its guidance, so a reference is intra-pack
and can be checked by a test.

---

## What this means for the next items

**Item 2 (charter)** now has concrete material. The six epistemic-discipline
quotes above collapse into one clause, and it is a clause about character:
Cabinet does not let a gap in its records render as a fact about Ben's life.

**Item 3 (system / domain packs)** has its first real requirement. A pack must
hold the procedures that govern *when* to reach for its tools, because a
description loaded at discovery time is loaded too late to route the decision
that led to the discovery.

**Item 4 (user)** gains the clinical framing currently living in public source.

**Nothing is blocked** except the question in section C, which is Ben's.
