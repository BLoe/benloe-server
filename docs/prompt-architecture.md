# Cabinet — prompt architecture

Written 2026-08-11, from a design conversation that started with "why does
every build session turn into a safety discussion."

Deliberately not called "v3". `docs/cabinet-v2-design.md` and
`cabinet-v2-build-plan.md` describe the *product* — surfaces, UX, features —
and the "v2 persona stack" that landed 2026-08-01 was a rewrite of the memory
files. This is a different axis: how the prompt is assembled, on any version
of the product. Version numbers here have meant three different things
already; a name is clearer.

This supersedes items 2, 3 and 4 of `PRIORITIES.md`.

**Update 2026-08-11, after measuring.** The four layers below still hold. Three
pieces of reasoning under them do not, and the working list moved to
[`TODO.md`](TODO.md):

- Tool count is not a problem worth solving. The SDK already defers Cabinet's
  tools behind tool search — all 63 cost 631 prefix tokens, against 10,172 if
  forced in. `PRIORITIES.md` item 5 is dropped.
- The expensive toolset is the built-in one: 17,890 tokens before Cabinet adds
  anything. That is now the largest item on the list and it is not discussed
  anywhere below.
- Guidance living in tool descriptions is not read on a normal turn, because
  deferred tools expose a name and not a description. That is a stronger
  argument for the "system" layer than the one made below, and a different one.

The loader that layer 1 needs shipped on 2026-08-11 (`PROMPT_CORE` in
`memory/index.ts`); every layer is still `user`-sourced, so nothing has moved
yet.

**What we're building:** Cabinet's mind, rewritten. The tools, integrations,
database and a month of real data all stay — that's the asset. The prompt and
memory layer gets replaced, because that's where every conversation gets
stuck.

---

## Principles

These came out of the conversation and are the reason for everything below.
They apply to this document too.

**1. The prompt says what to do, never what to avoid.**
Naming a behaviour makes it more available, not less. Anthropic documents this
for Opus 5 specifically — with thinking tags, naming the tag by name
*increased* leakage. If a rule can only be phrased as a prohibition, it is
usually a missing capability or a missing convention.

**2. An incident note is usually a fix that wasn't made.**
"Don't use numbered placeholders" instead of writing the query convention.
"npm skips devDependencies" instead of fixing the environment. The note is the
cheap option at the moment of failure and it charges rent on every
conversation afterwards. Write the convention; fix the environment.

**3. Guardrails follow evidence, and evidence must be checkable.**
Not "we remember this going wrong" — verifiable against git, logs, or the
database today. `PLATFORM.md` currently records a leak of personal data into
the public repo. Git shows no such file was ever committed. The system wrote
down a failure it had prevented and re-narrated it as one it suffered.

**4. Mechanical guards are cheap; procedural rules are not.**
A `.gitignore` line costs nothing, can't be forgotten, and works whether or
not anyone remembers why. "Grep the diff before committing" taxes every future
action and depends on memory. Add the first freely; the second needs a real
incident.

**5. Every file is agent-editable.**
No exceptions, including the charter. The controls that matter are
reversibility (git history on everything) and visibility (say what changed and
why), not permission gates. A gate that isn't enforced — as the current
"Ben-edited only" line isn't — is worse than none, because it creates false
confidence.

**6. Instructions compete.**
Adherence degrades as constraint count rises. Every rule added weakens every
rule already there. A prompt that grows by one rule per incident gets
monotonically worse at its job.

---

## The four layers

Each layer answers one question, has one lifecycle, and can be assembled
independently.

### 1. Charter — who Cabinet is

Identity, goals, personality, how it talks. The fixed point everything else is
evaluated against.

- Small. Target ~1–2k tokens, against ~20k today.
- Lives **in the repo** as real markdown, reviewed by PR.
- Contains no personal data, so nothing blocks it from being public.
- Written as description and example, not rules and prohibitions.

The one thing carried over intact from V1: Cabinet and Ben are working to make
each other better. That is the anchor a self-improving system needs in order
to evaluate its own changes — a measurement reference, not a leash.

### 2. System — the harness it lives in

What Cabinet can do and how this environment works: available tools, how to
reach them, how the server is laid out, what the conventions are.

- Also in the repo. Generic, no personal data.
- Reads like a manual: "queries use named parameters bound with an object,"
  not "a past query broke."
- Loaded by job. A heartbeat does not need the deploy conventions.

Engineering history that is genuinely expensive to rediscover lives in
`docs/`, read when Cabinet is working on the server, never ambient.

### 3. User — who this person is

Ben's history, preferences, plans, goals, corrections, domain narratives.

- Private. Lives in `data/`, never in the public repo.
- Assembled for **an explicit user identity**, even though there is one user
  today. That seam costs nothing now and avoids a rewrite later.
- Loaded by relevance, not wholesale. Most turns do not need the full
  biography.
- Facts are stated as facts. Corrections merge into the facts they correct
  rather than being maintained as a ledger of times Cabinet was wrong.

### 4. Now — the current state of the world

Time, today's plan, what has been logged, what has changed since the last
message.

- Regenerated every turn, never cached.
- The layer with the highest cost of being wrong: a bad timestamp produces
  confident nonsense downstream, not a small error.
- Kept minimal and concrete. Values, not prose.

---

## Job as a selector

Cabinet does several different jobs: live conversation, heartbeat, weekly
review, scheduled brief. These are not a fifth layer — they select which
layers load and how much of each.

This is the mechanism that keeps the conversational prompt small. The question
stops being "what might Cabinet need?" and becomes "what does *this job*
need?"

Rough shape:

| job | charter | system | user | now |
|---|---|---|---|---|
| conversation | full | by topic | by relevance | full |
| heartbeat | minimal | minimal | none | full |
| weekly review | full | none | deep | full |
| scheduled brief | minimal | none | targeted | full |

---

## Multi-user

Design the seam now, build the system later.

**Now:** user context is assembled for an explicit user identity. One
parameter, always Ben.

**Later, when there is a second user:** auth scoping, and a `user_id` on the
quantified-self tables (weight, food, mood — currently unsegmented). The
memory files are already per-user by directory and conversations already carry
an author, so the gap is narrower than it looks.

That migration costs the same whether it happens now or in six months, so
there is no reason to do it now.

---

## Order of work

1. **Charter.** Smallest, and it defines the voice everything else is written
   against.
2. **System.** Scope is easier to judge once the charter exists.
3. **User.** Including how relevance selection works.
4. **Now.** Smallest and most mechanical; do it last, when the shape of a turn
   is settled.
5. **Job selection**, wiring the four together.

Each is one focused session ending in something deployed. Not a migration
plan — a rewrite, with V1 available to diff against afterwards to check
nothing load-bearing was left behind.

---

## What gets deleted

Named here so it is a decision rather than an omission.

- **The desk/counsel register.** Has never once activated in a month of real
  use. Two things were built on it — a cheaper effort setting and reply-length
  rules — and neither has ever run.
- **`PLATFORM.md` as prompt content.** 22 KB of engineering post-mortems in
  every conversation, including ones about dinner. The durable facts move to
  `docs/`; the incident narrative goes.
- **`templates.ts` as a home for designed prose.** Repo templates and live
  files have drifted, some by 9×. Design files live in the repo as the only
  copy. Templates shrink to empty scaffolds for user-data files.
- **File-edit restrictions.** `STANDING_ORDERS.md`'s refusal and the
  "Ben-edited only" line. Keep the catastrophic-shrink check — that blocks
  corruption, not authorship.
- **Prohibition lists.** `VOICE.md`'s "Never" section mostly restates rules
  the same file already gives positively a few paragraphs earlier.

---

## How we know it worked

One question, asked after a week of use: **is Cabinet more useful?**

The honest test is the task list — 52 open items, most of them Ben's life
rather than the platform. If Cabinet is working, that number goes down.

Not a metrics suite. Not a re-measurement plan. One question and one number
that already exists.
