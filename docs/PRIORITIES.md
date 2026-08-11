# Cabinet — what to do next, in order

Written 2026-08-10 after a long session that produced more analysis than
progress. This is the reset: one list, discrete items, ordered.

**Update 2026-08-11:** items 2, 3 and 4 are superseded by
[`prompt-architecture.md`](prompt-architecture.md), which answers them together rather than
separately. Items 5–8 still stand as written.

**The goal, restated:** make Cabinet more effective as the thing that runs
Ben's day. Everything below is judged against that, not against tidiness.

Each item is meant to be a single sitting. Do them top to bottom. Do not
start two.

---

## 1. Deploy what's already merged — ✅ DONE 2026-08-10

cabinet-api redeployed on build `740d478b6471`. Both merged prompt changes
are live: the unconditional length rule, and the rule about not narrating
its own tool failures at Ben.

**Still open, and it belongs to Ben:** use it for a day and say whether
replies actually feel shorter. If they do not, item 2 is the reason — see
the VOICE.md conflict there.

---

## 2. Decide where Cabinet's personality lives

This is the real architectural question, and everything in section 3+
depends on the answer.

Cabinet's prompt is ~20,000 tokens. About 500 of them live in the repo
(`TURN_DISCIPLINE` in `prompt.ts`) and go through review. The other ~19,500
— CHARTER, VOICE, USER, PLATFORM, PLAYBOOK, RHYTHM — live in a private git
repo under `data/` with no remote, no review, and Cabinet can edit most of
them itself.

Two concrete consequences today:

- `VOICE.md` currently contradicts the length rule that just merged. The
  merged rule says keep replies proportionate; VOICE says counsel replies
  have "length limits suspended". VOICE outranks it.
- No change to 97% of the prompt can be reviewed, diffed in a PR, or rolled
  back with the code that reads it.

**Decision needed:** should the *persona* files (CHARTER, VOICE, PLAYBOOK,
RHYTHM, TUNING) move into the repo, leaving only the genuinely private ones
(USER, PLATFORM, CORRECTIONS) in `data/`?

Nothing in the persona files is personal data. They are the design of the
system.

---

## 3. Cut the prompt down

Three quarters of what Cabinet reads on every turn is reference material,
not instruction. The files that define who it *is* are about a quarter of
the budget.

Two files are half of everything:

| file | share | what it is |
|---|---|---|
| `PLATFORM.md` | 29% | engineering post-mortems about this server |
| `USER.md` | 25% | Ben's biography and history |

`PLATFORM.md` is only relevant when Cabinet is doing server work, which is
a minority of turns. There is already a mechanism for loading a file only
when the topic calls for it, and already a `domains/platform.md` sibling.

`USER.md` is always relevant in principle, but most of it is history rather
than anything that changes an answer.

**Action:** move `PLATFORM.md` out of the always-loaded set first. It is the
bigger win and the easier one to reverse. Leave `USER.md` alone until that
has been live a while.

---

## 4. Kill or fix the desk/counsel register

Cabinet has two registers: desk (terse, for logging) and counsel (long, for
planning). In a month of real use, **desk has never once activated.** Every
conversation has been counsel.

It has never worked, and two things were built on top of it: a cheaper
effort setting, and reply-length rules.

**Decision needed:** fix the classifier so short messages route to desk, or
delete the register entirely and treat every turn the same.

Deleting it is a legitimate answer. A mechanism that has never fired is not
load-bearing, and removing it would simplify three files.

---

## 5. Reduce the tool count

Cabinet exposes 63 tools. Anthropic's own guidance says tool-selection
accuracy degrades past 30–50, and recommends consolidating related
operations behind one tool with an action parameter.

This is a plausible cause of Cabinet reaching for the wrong tool or missing
one, though I have not measured it.

**Action:** group the obvious families (the `money_*` set, the memory set,
the logging set) and see what the count drops to.

---

## 6. Stop silently losing writes

The real bug on Cabinet's own task list (#58, priority 1).

When the tool connection drops mid-turn, a write Cabinet believes it made
can vanish — and the chat still says "logged". It has happened at least
once. Nothing catches it.

PR #8 (open, unreviewed) adds logging so it is visible. That is only the
diagnosis.

**Decision needed:** the fix is either a queue that retries the write, or a
check at the end of each turn comparing what Cabinet claims it saved against
what actually landed. The second is smaller and catches more.

---

## 7. Decide whether to keep the PR reviewer

It is built, merged, and currently switched off.

Honest assessment: it found real bugs, including a prompt-injection hole and
a credential that leaked onto redirects. It also produced a lot of noise,
never converged on "done", and consumed a large share of a working session
on itself.

**Decision needed:** keep it running on a slower schedule (hourly, not every
five minutes), keep it as something you trigger by hand, or turn it off.

My recommendation is on-demand. The value was in the first review of a
change, not the fifth.

---

## 8. Ben's actual to-do list

Cabinet has **52 open tasks**, most of them Ben's life rather than the
platform: an ankle MRI prescription in hand, unpaid medical bills, a sleep
apnea test, a urology referral, an HSA contribution question.

That list is the product. If Cabinet is working, those get smaller.

**Action:** at some point soon, spend a session on that list instead of on
Cabinet. It is also the honest test of whether any of the above helped.

---

## How we should work on this

The last session went wrong in a specific, repeatable way, and it is worth
writing down:

1. **One item at a time, finished.** Seven open PRs at once meant none could
   land and each new review created more work than it closed.
2. **Ship before measuring again.** Measurement without a deployed change is
   just numbers.
3. **Small PRs off `main`.** Stacked PRs meant every fix rippled through
   three branches.
4. **Analysis is not the deliverable.** If a session produces a findings
   document and no change, it did not produce anything.
5. **Say the one thing.** A report with nine bullet points is a report with
   no conclusion.

---

## Not on this list, on purpose

Effort tuning, prompt-cache economics, review-loop convergence rules,
per-turn cost percentiles. All real, none of them the reason Cabinet is or
is not useful to Ben right now.
