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

30 of the 40 sampled turns read and labelled by hand. 10 carry at least one
label. Counts, not content; the labelled file stays in the gitignored tree.

| n | code | |
|---|---|---|
| 3 | `onboarding-pitch` | new code — not in the original taxonomy |
| 3 | `plumbing-narration` | new code |
| 2 | `overclaim` | |
| 2 | `no-reply` | |
| 1 | `desk-bloat` | |
| 1 | `sycophancy-recovered` | a save, not a failure |

Two of the top three were **not in `TAXONOMY.md`**. That is the argument for
open coding: a taxonomy written from the prompt files finds the failures the
prompt files anticipate.

## `onboarding-pitch` — the architecture predicted this and it happened anyway

Three separate turns on one day, including a bare "How's it going?", answered
with an unprompted pitch about the empty profile — **enumerating the missing
fields**.

`ONBOARDING.md` contains this, in writing, before any of those turns:

> It should NOT enumerate raw fields in the injected line — name the outcome
> ("no confirmed plan yet"), never the form fields, **because whatever that
> line says, the agent will recite.**

The prediction was exactly right and it did not prevent the behaviour. That is
the most important thing in this pass: *a rule stated in prose, in a file the
model reads every turn, did not survive contact with an injected line that
contradicted it.* The fix is not a better-worded rule. It is that `profileGap`
must not put field names in the context at all — the model recites its input,
and no instruction outranks the input's own shape.

Costs beyond tone: it fires on greetings, so the first thing Ben sees after
"hi" is a list of chores.

## `plumbing-narration` — Cabinet reporting its own infrastructure at Ben

Three turns narrate tool-layer failures to Ben: an MCP server dropping
mid-session, tool calls being denied, a workaround performed in front of him.
Ben asked about his life; he got an incident report about Cabinet.

`VOICE.md` bans "helpfulness narration" and self-audit, but says nothing about
infrastructure narration, and `CHARTER`'s prime directive is about choice
load, which this technically doesn't add to. It is a real failure with no rule
covering it — the gap is in the spec, not in adherence.

## `overclaim` — twice, both the same shape

Both are Cabinet reporting an absence in its own records as an absence in the
world ("nothing is running", "this thread has no prior messages") while Ben
was looking at the thing on screen. One was hedged with "on my end"; the other
was not. `VOICE.md` names this failure precisely — the "Nothing on file" rule
— so here the rule exists and adherence is partial, which is a different
problem from `onboarding-pitch` and wants a different fix.

## `no-reply` — 2 of 30

Both are Ben pointing at UI behaviour mid-session. Not yet diagnosed;
`perf_span` and `pending-turn.json` should say whether the turn crashed or was
superseded.

## What this changes about the redesign

The single highest-leverage change suggested by this pass is **not** a
rewording of any memory file. It is that **injected per-turn context outranks
the prose**: `profileGap` recited its field list straight through a file that
told the model not to. Before touching `CHARTER`/`VOICE`/`PLAYBOOK` wording,
audit what `assemblePrompt` actually injects and what shape it is in.

Sample caveat: 30 turns, one labeller, one pass. These are directions to
investigate, not measurements to optimise against.
