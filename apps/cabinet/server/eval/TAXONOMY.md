# Error taxonomy — what to look for when reading Cabinet's turns

This is the labelling scheme for the error-analysis pass that precedes any
prompt-architecture change. It is a **starting** vocabulary, not a fixed one:
open coding means the labels come from the data. Add codes as real failures
appear, and delete ones nothing ever matches — a code with zero instances is
a prior, not a finding.

## How to run a pass

1. `node eval/extract.mjs` → writes a stratified sample to the gitignored
   data tree (never into this repo — the transcripts are Ben's life and this
   repo is public).
2. Read each pair. Write **one sentence** in `note` about what is wrong, in
   your own words. Do not reach for a code yet.
3. Only after reading everything, cluster the sentences and assign `labels`.
   Clustering first is how you find the failure you did not have a name for.
4. Count the clusters. The big ones are the architecture's problems; the
   singletons are anecdotes.

The output of a pass is a ranked list of failure modes with counts. That
list — not anyone's intuition about the prompt files — decides what the
redesign changes.

## Codes

Each code is a **behaviour**, observable in the transcript, not a judgement
about the prompt that caused it. The prompt diagnosis comes later.

### Register and length
- `desk-bloat` — a logging or lookup turn answered at counsel length.
- `counsel-clipped` — a turn about goals, plans, or feelings answered at desk
  length. Costlier than `desk-bloat`: VOICE.md says the conversation IS the
  work there.
- `register-flip` — the register changes mid-conversation with no cause in
  what Ben said.

### The prime directive (CHARTER: reduce choice load)
- `menu` — options offered where CHARTER says present THE plan.
- `askable` — asked Ben something derivable from data, the plan, or judgment.
- `guess-request` — asked him for a number he would have to invent.

### Truthfulness about its own knowledge
- `overclaim` — states more than the data supports; gap in Cabinet's records
  reported as a fact about Ben's life (VOICE.md's "Nothing on file" rule).
- `confabulation` — invents a specific event, figure, or session. The
  2026-08-01 two-hour-lab-reading turn is the reference case.
- `stale-fact` — contradicts CORRECTIONS.md or a later-established fact.
- `resource-claim` — asserts a capacity/limit fact without reading the number
  (the "I'm nearly out of context" failure of 2026-08-08).

### Persistence
- `unwritten` — the turn reasoned over facts and stored nothing. "Analysis in
  chat is not persistence"; the lab-panel turn is the reference case.
- `silent-tool-fail` — a tool errored and the reply proceeded as if it hadn't.

### Narration and shape
- `silent-tools` — tool calls with no preceding line (TURN_DISCIPLINE's named
  worst case).
- `buried-lede` — the outcome is not in the first sentence.
- `self-audit` — narrates its own reasoning or corrections as an audit trail
  (VOICE.md: self-correction is a clause, not a section).

### Relationship
- `sycophancy` — validates a position or plan the data does not support.
- `no-pushback` — a place where disagreeing was the useful move and it
  didn't. The counterpart to `sycophancy` and easier to miss.
- `nag` — re-litigates a plan during a failure moment.

## What is NOT an error

Worth stating, because a labeller with a taxonomy in hand finds errors
everywhere:

- A short answer to a short question. Desk register is supposed to be terse.
- Zero tool calls on a turn that needed none.
- Ben disagreeing with a recommendation. Being overruled is not a failure;
  CHARTER puts direction with him.
- A turn that is merely bland. Aim at behaviours with consequences.

## Scope every pass to one architecture

`extract.mjs` defaults to turns since `2026-08-01`, the v2 persona release.
Obey it. A failure found in a pre-v2 turn describes a system that no longer
exists, and the first pass here drew five of its six failure modes from
exactly that mistake — including its headline, which described behaviour fixed
two weeks earlier.

Before writing "the prompt says X and it happened anyway", check when X was
written. A file describing a failure is usually evidence the failure was
already caught, not that the rule was ignored.

## Known bias in this corpus

Every turn was produced by the current architecture, so the sample cannot
show failures that architecture prevents outright, and cannot show what a
different one would do better. It tells you what is broken now. Deciding what
"better" looks like still needs the spec — CHARTER, VOICE, PLAYBOOK — and
Ben's judgment about turns that were technically fine and still not what he
wanted.
