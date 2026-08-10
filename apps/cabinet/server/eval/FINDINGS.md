# Corpus measurements — 2026-08-10

Structural facts about the first month of Cabinet, measured before any prompt
changes. **Counts and shapes only — no transcript content.** This file is in a
public repo; the turns themselves live in the gitignored data tree.

Corpus: 2026-07-12 → 2026-08-10, 43 chats, 978 messages.

## 1. The desk register has never engaged

| `chat.register` | chats | chats with ≥1 real Ben turn |
|---|---|---|
| `counsel` | 9 | 9 |
| never set | 34 | 9 |
| `desk` | **0** | **0** |

Not "rare" — **zero, in a month**. Every chat Ben has actually talked in is
either `counsel` or has no register at all.

This matters more than a stale column would, because register is not
cosmetic: `runtime/register.ts` classifies, and the result drives effort and
the length rules in `VOICE.md` and `TURN_DISCIPLINE`. The entire desk half of
a deliberately two-register design has never run in production.

### Diagnosed: it is the classifier, not persistence

`classifyMessage` and `nextRegister` are pure, so both were replayed over all
136 of Ben's real turns.

```
classifyMessage over 136 turns:  desk 1 · counsel 92 · null 43
sticky replay, final per chat:   desk 0 · counsel 18 · null 0
chats that would EVER enter desk: 0 of 18
```

**One message in a month classified as desk-shaped.** Persistence is fine;
`settleRegister` writes whenever the value moves. It never moves to desk
because the classifier never says desk.

Two compounding causes, and the breakdown separates them:

```
counsel because length > DESK_MAX_CHARS : 80   (59% of all turns)
counsel because multi-sentence          :  4
counsel because a COUNSEL_MARKER hit    :  8
desk or ambiguous                       : 44   (43 null, 1 desk)

Ben's turn length: p25 88 · p50 197 · p75 420 · p90 1085
turns <= DESK_MAX_CHARS (160): 56 of 136
```

1. **`DESK_MAX_CHARS = 160` sits below Ben's median turn (197).** Length
   alone routes 59% of everything he writes to counsel, before any marker or
   shape is consulted. Only 8 turns hit an actual counsel marker — the
   constant, not the semantics, is doing nearly all the classifying.

2. **Of the 56 short turns, `DESK_PATTERNS` matched 1.** The other 43 return
   `null` ("genuinely ambiguous, leave the register alone"). Since a chat
   starts at `null` and entering desk requires a *streak* of desk messages,
   `null` can never build one. Desk is unreachable, not merely rare.

The asymmetry was deliberate — entering desk is expensive to get wrong — but
the two thresholds compose into an absolute bar rather than a high one.

**This still does not mean "raise the constant".** 197 median says 160 is
mistuned, but the deeper question is whether register should be inferred from
message SHAPE at all: Ben writing 200 characters to log a meal is not a
request for depth, and length is a poor proxy for what he wants back. Any fix
belongs in its own PR with this measurement attached — and should be re-run
against these numbers afterwards.

## 2. Replies are long, and the tail is extreme

Assistant message size (`parts` JSON, chars — a proxy, not token count):

| p25 | p50 | p90 |
|---|---|---|
| 396 | 844 | **47,153** |

In the 40-turn sample: median Ben turn 195 chars, median Cabinet reply 1,337 —
roughly **7×**.

Consistent with Anthropic's documented Opus 5 behaviour: *"its default
user-facing responses run longer than prior models', and raising or lowering
effort does not reliably change visible response length. Prompt explicitly for
conciseness instead."* Cabinet does prompt for it, in `TURN_DISCIPLINE` — but
that instruction is scoped to desk register, which per §1 never engages. The
length rule has no arm to apply to.

The p90 is a separate question from the median. A 47k-char reply is not a
verbose answer; it is a different kind of event, and worth identifying before
treating this as a tuning problem.

## 3. Three of forty turns got no reply

7.5% of sampled turns have no assistant message after them. Some will be Ben
sending two messages in a row; some will be crashed or abandoned turns. The
extractor keeps them (`reply: null`) precisely because dropping them would
hide the failures most worth studying.

Not yet diagnosed. `perf_span` and `pending-turn.json` should distinguish the
cases.

## 4. The corpus is smaller than the row count suggests

466 `role='user'` rows, but only **136** are Ben. The rest are heartbeat and
cron turns (NULL author) and a peer agent. Any analysis filtering on
`role='user'` alone is ~70% the system talking to itself.

136 turns is enough for error analysis. It is **not** enough to split into
train and held-out eval sets, so early eval cases will have to come from the
spec (`CHARTER`, `VOICE`, `PLAYBOOK`) rather than from held-out data.

## What this does not tell us

These are structural measurements, not quality judgements. Nothing here says a
single reply was *wrong* — that needs the labelling pass in `TAXONOMY.md`, and
Ben's own read of turns that were technically fine and still not what he
wanted.

The value of §1 is that it is a finding no amount of reading the prompt files
would have produced. `register.ts` looks well designed on the page. It has
just never done the thing it was designed to do.

---

# Labelling pass — 2026-08-10

## Retracted, and why it matters

**The first version of this section was wrong, and its headline finding was
wrong twice over.** It is corrected in place rather than deleted, because the
mistake is more instructive than the finding was.

It claimed `ONBOARDING.md` predicted its own top failure and failed to prevent
it. Checking the dates:

- the failing turns are **2026-07-15**
- the "do not enumerate raw fields" note entered `ONBOARDING.md` on
  **2026-08-01** (`777181c`, the v2 persona release)
- `profileGap` was rewritten the same day to emit outcomes, not field names

So it is a **post-mortem, not a prediction** — the note was written *because*
of those turns — and the behaviour it describes was already fixed two weeks
before I called it a live problem.

The second error is worse, because it invalidates most of the pass. Splitting
the labels by the v2 cutoff:

```
labelled turns:      30   (18 pre-v2, 12 v2-era)
all labels:          onboarding-pitch 3 · plumbing-narration 3 · overclaim 2
                     no-reply 2 · desk-bloat 1 · sycophancy-recovered 1
v2-era labels only:  plumbing-narration 2
```

**Of six failure modes, exactly one survives the cutoff.** Everything else
described an architecture that no longer exists.

The cause is in the extractor, not the labelling: stratifying by chat
over-weights the OLDEST chats, because they have had the longest to
accumulate turns. 22 of 40 sampled turns predated v2. `extract.mjs` now takes
`EVAL_SINCE`, defaulting to `2026-08-01`, with a test.

This is the same failure this file catalogues under `overclaim` — reporting
something as true of the world that was only true of my own records — and I
made it in the act of cataloguing it. Worth stating plainly, because the whole
point of error analysis is to be corrected by data rather than to confirm a
prior.

## What actually holds for the current architecture

One code, twice in 12 turns.

### `plumbing-narration` — Cabinet reporting its own infrastructure at Ben

Turns narrate tool-layer failures to Ben: an MCP server dropping mid-session,
a workaround performed in front of him. He asked about his life and got an
incident report about Cabinet.

`VOICE.md` bans "helpfulness narration" and self-audit narration, but says
nothing about infrastructure narration, and `CHARTER`'s prime directive is
about choice load, which this does not obviously add to. **The rule does not
exist** — this is a gap in the spec rather than a failure of adherence, which
is what makes it worth acting on.

2 of 12 is a direction, not a rate. It needs a bigger v2-only sample before it
justifies a prompt change.

## Method notes carried forward

- Re-run the labelling pass against a v2-only sample before drawing any
  conclusion. The current numbers are too small and were drawn wrong.
- Check the date of any rule before claiming it failed. A file that describes
  a failure is usually evidence the failure was already caught.
- Findings from the pre-v2 corpus are still useful for one thing: confirming
  that a fix worked. `onboarding-pitch` appearing 3× before 2026-08-01 and 0×
  after is exactly that.

---

# v2-only measurements — 2026-08-10

Re-extracted with the `EVAL_SINCE=2026-08-01` cutoff. 78 real Ben turns since
v2; 60 sampled across 9 chats. This is the first set of numbers that describes
the architecture actually running.

Two of the earlier findings resolve immediately:

- **`no-reply`: 0 of 60.** Both instances were pre-v2. That failure mode is
  gone, most likely fixed by the interrupted-turn resume work.
- **Register: `counsel` on 60 of 60.** Not merely "no desk" — every single
  v2-era turn is counsel. §1's conclusion holds under the cutoff.

## The length control is inoperative

```
Cabinet reply chars   p25 1362 · p50 3070 · p75 4578 · p90 5711 · max 14761
Ben turn chars        p25   98 · p50  284 · p75  493 · p90 1760
                      ratio of medians: 10.8x

replies over 2000 chars:  37 of 60
replies over 5000 chars:  12 of 60
```

The median reply is **3,070 characters** — roughly 750 tokens — against a
median Ben turn of 284.

The sharpest cut is short turns. 19 of 60 of Ben's turns are ≤160 characters,
i.e. short enough that `DESK_MAX_CHARS` would even consider them for desk:

```
their replies:  p50 1303 · max 5017
```

**A one-line message gets a 1,300-character answer.**

This is not a tone problem, it is a wiring problem — though not the wiring I
first described. `TURN_DISCIPLINE` says:

> Length: desk register stays tight — most replies are a few sentences.
> Counsel register ... is exempt: there, the conversation IS the work and
> length limits are suspended.

An earlier version of this section claimed "every turn is counsel, so every
turn takes the exemption". **That is not how the code works.** `register`
reaches exactly one place — `effortForRegister` in `runtime/agent.ts:419` —
and `assemblePrompt` takes no register parameter at all. `chat.register`
never enters the prompt.

So the model is **never told which register it is in.** It reads a static
rule keyed on a distinction it cannot observe, and has to guess which side it
is on, every turn, with no signal. That is worse than the exemption story:
an inert rule at least fails predictably, while an unobservable one fails
however the model happens to guess — and Anthropic's Opus 5 guidance says the
default guess is long.

The register→length path could not have worked even if the classifier were
fixed. Register only sets effort, and effort *"does not reliably change
visible response length"* — Anthropic's words. Two mechanisms were assumed to
connect and neither does.

Anthropic's Opus 5 guidance is that this model runs longer than its
predecessors by default, that effort does not reliably change visible length,
and that conciseness must be prompted for explicitly. Cabinet does prompt for
it — behind a condition that is always false.

## What follows

The two candidate fixes are independent and should be tried in that order,
because the second is only measurable once the first is real:

1. **Give the length rule an unconditional floor.** Some length guidance must
   apply regardless of register, or the model has none. The counsel exemption
   can survive as a widening, not as the only clause.
2. **Then revisit register.** With a working floor, fixing the classifier
   (§1) becomes a tuning question rather than a load-bearing one — which is
   the right order, since the classifier fix is the riskier change and the
   one whose correct shape is still unclear.

Both belong in their own PRs, with these numbers re-run after each. The
re-run is the point: `p50 3070` and `19 short turns → p50 1303` are the two
numbers a length change has to move.

---

# Cost of the dead desk register — 2026-08-10

§1 established that `chat.register` has never been `desk`. §"v2-only" showed
that register never reaches the prompt, so it cannot affect what Cabinet
*says*. It does affect one thing:

```ts
// runtime/register.ts
export function effortForRegister(register: Register, base: string): string {
  if (register !== 'desk') return base;
  return process.env.CABINET_DESK_EFFORT || 'medium';
}
```

Lowering effort is the desk register's **only** mechanical function, and the
branch has never once been taken. Every user turn since v2 has run at the
router's base effort, which is `high`.

## What that costs, from `token_usage`

Since 2026-08-01:

| session_kind | turns | output tokens | cache read | USD |
|---|---|---|---|---|
| `user` | 79 | 1,084,374 | 125,190,770 | **233.46** |
| `cron` | 11 | 47,761 | 2,326,960 | 6.45 |
| `heartbeat` | 265 | 298,600 | 5,345,632 | 4.96 |

**$244.88 in nine days**, 95% of it on 79 user turns — **$2.96 per turn on
average**.

Per user turn:

```
cost USD       p25 0.82 · p50 1.39 · p90 8.76 · max 34.83
output tokens  p50 4505 · p90 44469 · max 115394
cache read     avg 1,584,693 per turn
```

Three things worth separating here:

1. **The median turn is $1.39 and the p90 is $8.76** — a 6× spread. The tail
   is where the money is, and a single turn cost $34.83.
2. **Output per turn (p50 4,505 tokens) is far larger than the reply Ben
   sees.** The earlier measurement — reply text p50 3,070 *characters*, about
   750 tokens — counts only the final message. The rest is the agentic loop:
   tool arguments, intermediate reasoning, subagents. Roughly 6× more output
   is produced than delivered.
3. **1.58M cache-read tokens per turn** means the ~20k-token cache-stable
   prefix is being re-read on the order of 80 times per turn. That is the
   agentic loop doing its job — but it makes the size of `promptCore()` a
   multiplier on every turn, not a one-off.

## What this does and does not license

It does **not** license flipping effort down. Anthropic's guidance is to use
`low`/`medium` liberally as the primary cost control *"wherever your evals
show quality holds"* — and there are no evals yet. Cutting effort blind on
the system that manages Ben's health and money is the wrong trade.

What it does establish is that the classifier fix (§1) has a payoff that is
now quantified rather than assumed: it is worth roughly the difference
between `high` and `medium` on the cheap half of turns. That is a real
number to weigh against the risk of misrouting a counsel turn to desk — which
`register.ts` correctly calls the costly failure.

It also reframes point 3 as the larger lever. `PLATFORM.md` alone is 22KB of
engineering post-mortems injected into every turn including trivial ones, and
at ~80 cache reads per turn its cost is multiplied, not amortised. Trimming
the cache-stable prefix is a bigger, safer win than changing effort, and it
does not require an eval to justify — only a judgement about which
post-mortems still earn their slot.

**Next measurement**, before either change: attribute `promptCore()` size by
file, and check what fraction of the 1.58M cache reads is prefix versus
conversation.
